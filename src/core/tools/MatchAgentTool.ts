/**
 * MatchAgentTool — 智能 Agent 匹配
 *
 * 根据任务描述自动推荐最合适的 Agent。
 * 使用向量相似度、能力匹配、关键词匹配等多维度评分。
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { EmbeddingProviderInterface } from '@/core/embedding/EmbeddingProvider';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MatchAgentTool' });

interface AgentMatch {
  agentId: string;
  agentName: string;
  score: number;
  breakdown: {
    vector?: number;
    keyword?: number;
    capability?: number;
  };
  reason: string;
}

export class MatchAgentTool extends BaseTool {
  readonly name = 'match_agent';
  readonly description = [
    'Find the best pre-built agent for a given task description.',
    '',
    'Always call this before task or agent_team to discover the right agent.',
    '',
    'Score guide:',
    '  ≥ 0.5 — Use the recommended agent ID directly in task()',
    '  < 0.5 — No suitable pre-built agent. Create a temporary one:',
    '          task({ subagent_type: "custom-id", system_prompt: "...", tools: [...] })',
    '',
    'Optionally pass preferred_agent to verify a specific agent instead of searching all.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      task_description: {
        type: 'string',
        description: 'Description of the task you need an agent for',
      },
      preferred_agent: {
        type: 'string',
        description: '意图分析推荐的 agent ID。传入后优先验证该 agent 是否匹配，匹配则直接返回（分数加成），不匹配再全局搜索。',
      },
      top_k: {
        type: 'number',
        description: 'Number of recommendations to return (default: 3, max: 5)',
      },
    },
    required: ['task_description'],
  };

  readonly readonly = true;

  private agentRegistry: AgentRegistry | null = null;
  private embeddingProvider: EmbeddingProviderInterface | null = null;

  /**
   * 注入依赖
   */
  setDependencies(deps: {
    agentRegistry: AgentRegistry;
    embeddingProvider?: EmbeddingProviderInterface | null;
  }): void {
    this.agentRegistry = deps.agentRegistry;
    this.embeddingProvider = deps.embeddingProvider ?? null;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.agentRegistry) {
      return this.formatError({
        type: '系统错误',
        message: 'AgentRegistry 未初始化',
        reason: 'match_agent 工具依赖 AgentRegistry，但该服务未正确初始化。这通常是系统配置问题。',
        solutions: [
          '重启应用程序',
          '检查系统配置是否正确',
          '联系系统管理员',
        ],
        tip: '这是一个内部错误，不是你的调用问题。',
      });
    }

    const taskDescription = input.task_description as string;
    const preferredAgentId = input.preferred_agent as string | undefined;
    const topK = Math.min((input.top_k as number) || 3, 5);

    if (!taskDescription || taskDescription.trim() === '') {
      return this.formatError({
        type: '参数错误',
        message: '缺少必需参数 task_description',
        reason: 'match_agent 需要任务描述来匹配合适的 agent。',
        solutions: [
          '提供详细的任务描述，包括任务类型、目标和要求',
        ],
        example: `match_agent({
  task_description: "分析代码质量，检查代码规范、性能和安全问题"
})`,
        tip: '任务描述越详细，匹配结果越准确。',
      });
    }

    // 获取所有启用的 Agent（排除系统 agent）
    const agents = this.agentRegistry.getAllIds()
      .map(id => this.agentRegistry!.get(id)!)
      .filter(a => {
        // 过滤条件：
        // 1. 必须启用
        // 2. 不是主 agent（isMainAgent）
        // 3. 不是系统内部 agent（category: "system" 或 internal: true）
        if (a.enabled === false) return false;
        if (a.metadata?.isMainAgent === true) return false;
        if (a.metadata?.category === 'system') return false;
        if (a.metadata?.internal === true) return false;
        return true;
      });

    if (agents.length === 0) {
      return this.formatError({
        type: '资源错误',
        message: '没有可用的 agent',
        reason: '系统中没有启用的 agent，无法进行匹配。',
        solutions: [
          '检查 agent 配置文件是否正确',
          '确保至少有一个 agent 的 enabled 字段为 true',
          '使用 list_agents 工具查看所有 agent 的状态',
        ],
        tip: '这通常是系统配置问题，请联系管理员。',
      });
    }

    // 计算匹配分数
    const matches = await this.scoreAgents(agents, taskDescription);

    // 如果指定了 preferred_agent，优先验证该 agent
    if (preferredAgentId) {
      const preferredConfig = this.agentRegistry.get(preferredAgentId);
      if (!preferredConfig || preferredConfig.enabled === false) {
        // 推荐的 agent 不存在：直接返回错误，让 LLM 创建临时 agent
        return this.formatError({
          type: '资源错误',
          message: `推荐的 agent "${preferredAgentId}" 不存在或已被禁用`,
          reason: `意图分析推荐了 "${preferredAgentId}"，但该 agent 不在可用列表中。`,
          solutions: [
            `使用 match_agent 重新搜索合适的 agent（不带 preferred_agent 参数）`,
            `或创建临时 agent：task({ subagent_type: "custom-id", system_prompt: "...", tools: [...] })`,
          ],
        });
      }

      // 对推荐的 agent 单独评分
      const preferredMatch = await this.scoreSingleAgent(
        preferredConfig, taskDescription
      );
      // 推荐 agent 获得 1.5x 加权（存在即加成本应被优先使用）
      preferredMatch.score = Math.min(1.0, preferredMatch.score * 1.5);

      // 插入匹配列表并重新排序
      const existingIdx = matches.findIndex(m => m.agentId === preferredAgentId);
      if (existingIdx >= 0) {
        matches[existingIdx] = preferredMatch;
      } else {
        matches.push(preferredMatch);
      }
    }

    // 排序并取 top K
    const topMatches = matches
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // 格式化输出
    const output = this.formatMatches(topMatches, taskDescription, preferredAgentId);

    return this.success(output);
  }

  /**
   * 对单个 Agent 评分（用于 preferred_agent 验证）
   */
  private async scoreSingleAgent(
    agent: any,
    taskDescription: string,
  ): Promise<AgentMatch> {
    const breakdown: AgentMatch['breakdown'] = {};
    let totalScore = 0;

    if (this.embeddingProvider) {
      try {
        const vectorScore = await this.calculateVectorSimilarity(
          taskDescription,
          agent.capabilities.join(' ') + ' ' + agent.description
        );
        breakdown.vector = vectorScore;
        totalScore += vectorScore * 0.5;
      } catch (err) {
        log.debug(`Vector matching failed for ${agent.id}:`, err);
      }
    }

    const capabilityScore = this.calculateCapabilityMatch(taskDescription, agent.capabilities);
    breakdown.capability = capabilityScore;
    totalScore += this.embeddingProvider ? capabilityScore * 0.3 : capabilityScore * 0.5;

    const keywordScore = this.calculateKeywordMatch(taskDescription, agent);
    breakdown.keyword = keywordScore;
    totalScore += this.embeddingProvider ? keywordScore * 0.2 : keywordScore * 0.5;

    const reason = this.generateReason(agent, breakdown);

    return {
      agentId: agent.id,
      agentName: agent.name,
      score: totalScore,
      breakdown,
      reason,
    };
  }

  /**
   * 对所有 Agent 评分
   */
  private async scoreAgents(
    agents: any[],
    taskDescription: string,
  ): Promise<AgentMatch[]> {
    const matches: AgentMatch[] = [];

    for (const agent of agents) {
      const breakdown: AgentMatch['breakdown'] = {};
      let totalScore = 0;

      if (this.embeddingProvider) {
        try {
          const vectorScore = await this.calculateVectorSimilarity(
            taskDescription,
            agent.capabilities.join(' ') + ' ' + agent.description
          );
          breakdown.vector = vectorScore;
          totalScore += vectorScore * 0.5;
        } catch (err) {
          log.debug(`Vector matching failed for ${agent.id}:`, err);
        }
      }

      const capabilityScore = this.calculateCapabilityMatch(taskDescription, agent.capabilities);
      breakdown.capability = capabilityScore;
      totalScore += this.embeddingProvider ? capabilityScore * 0.3 : capabilityScore * 0.5;

      const keywordScore = this.calculateKeywordMatch(taskDescription, agent);
      breakdown.keyword = keywordScore;
      totalScore += this.embeddingProvider ? keywordScore * 0.2 : keywordScore * 0.5;

      const reason = this.generateReason(agent, breakdown);

      matches.push({
        agentId: agent.id,
        agentName: agent.name,
        score: totalScore,
        breakdown,
        reason,
      });
    }

    return matches;
  }

  /**
   * 计算向量相似度
   */
  private async calculateVectorSimilarity(text1: string, text2: string): Promise<number> {
    if (!this.embeddingProvider) return 0;

    const [embedding1, embedding2] = await Promise.all([
      this.embeddingProvider.embed(text1),
      this.embeddingProvider.embed(text2),
    ]);

    // 使用 EmbeddingProvider 的余弦相似度计算
    return this.embeddingProvider.cosineSimilarity(embedding1, embedding2);
  }

  /**
   * 计算关键词匹配分数
   */
  private calculateKeywordMatch(taskDescription: string, agent: any): number {
    const taskWords = taskDescription.toLowerCase().split(/\s+/);
    const agentText = (
      agent.id + ' ' +
      agent.name + ' ' +
      agent.description + ' ' +
      agent.capabilities.join(' ')
    ).toLowerCase();

    const matchedWords = taskWords.filter(word =>
      word.length > 3 && agentText.includes(word)
    );

    return matchedWords.length / taskWords.length;
  }

  /**
   * 计算能力匹配分数
   */
  private calculateCapabilityMatch(taskDescription: string, capabilities: string[]): number {
    const taskLower = taskDescription.toLowerCase();
    const taskWords = taskLower.split(/\s+/).filter(w => w.length > 2);

    let matchScore = 0;
    for (const cap of capabilities) {
      const capLower = cap.toLowerCase();
      const capWords = capLower.split(/\s+/).filter(w => w.length > 2);

      // 检查任务描述中的词是否出现在能力中
      const matchedWords = taskWords.filter(word => capLower.includes(word));
      if (matchedWords.length > 0) {
        // 匹配度 = 匹配的词数 / 任务词数
        matchScore += matchedWords.length / taskWords.length;
      }

      // 检查能力中的词是否出现在任务描述中
      const reverseMatchedWords = capWords.filter(word => taskLower.includes(word));
      if (reverseMatchedWords.length > 0) {
        // 匹配度 = 匹配的词数 / 能力词数
        matchScore += reverseMatchedWords.length / capWords.length;
      }
    }

    // 归一化：平均匹配分数
    return capabilities.length > 0 ? matchScore / (capabilities.length * 2) : 0;
  }

  /**
   * 生成推荐理由
   */
  private generateReason(agent: any, breakdown: AgentMatch['breakdown']): string {
    const reasons: string[] = [];

    if (breakdown.vector && breakdown.vector > 0.7) {
      reasons.push('High semantic similarity');
    }
    if (breakdown.keyword && breakdown.keyword > 0.3) {
      reasons.push('Strong keyword match');
    }
    if (breakdown.capability && breakdown.capability > 0.3) {
      reasons.push('Relevant capabilities');
    }

    if (reasons.length === 0) {
      return 'General-purpose match';
    }

    return reasons.join(', ');
  }

  /**
   * 格式化匹配结果
   */
  private formatMatches(matches: AgentMatch[], taskDescription: string, preferredAgentId?: string): string {
    const lines: string[] = [
      `Task: "${taskDescription}"`,
      '',
    ];

    // 如果指定了 preferred_agent，首先给出验证结论
    if (preferredAgentId) {
      const preferredMatch = matches.find(m => m.agentId === preferredAgentId);
      if (preferredMatch && preferredMatch.score >= 0.5) {
        lines.push(`✅ 推荐的 agent "${preferredAgentId}" 存在且匹配 (score: ${(preferredMatch.score * 100).toFixed(0)}%)，直接使用 task({ subagent_type: "${preferredAgentId}", ... })`);
        lines.push('');
      } else if (preferredMatch) {
        lines.push(`⚠️ 推荐的 agent "${preferredAgentId}" 匹配度不足 (score: ${(preferredMatch.score * 100).toFixed(0)}%)，建议创建临时 agent`);
        lines.push('');
      }
    }

    lines.push(`Top ${matches.length} recommended agents:`, '');

    matches.forEach((match, idx) => {
      const scorePercent = (match.score * 100).toFixed(0);
      const stars = '★'.repeat(Math.ceil(match.score * 5));
      const isPreferred = match.agentId === preferredAgentId;

      const prefix = isPreferred ? '👉 ' : '';
      lines.push(`${prefix}${idx + 1}. **${match.agentName}** (${match.agentId})${isPreferred ? ' ← 推荐' : ''}`);
      lines.push(`   Match: ${stars} ${scorePercent}%`);
      lines.push(`   Reason: ${match.reason}`);

      const details: string[] = [];
      if (match.breakdown.vector) {
        details.push(`Semantic: ${(match.breakdown.vector * 100).toFixed(0)}%`);
      }
      if (match.breakdown.keyword) {
        details.push(`Keyword: ${(match.breakdown.keyword * 100).toFixed(0)}%`);
      }
      if (match.breakdown.capability) {
        details.push(`Capability: ${(match.breakdown.capability * 100).toFixed(0)}%`);
      }
      if (details.length > 0) {
        lines.push(`   Breakdown: ${details.join(', ')}`);
      }

      lines.push('');
    });

    lines.push('---');
    lines.push('');
    if (preferredAgentId) {
      const preferredMatch = matches.find(m => m.agentId === preferredAgentId);
      if (preferredMatch && preferredMatch.score >= 0.5) {
        lines.push(`💡 Decision: 直接使用推荐的 agent "${preferredAgentId}"，调用 task({ subagent_type: "${preferredAgentId}", scene: "<scene>", description: "<任务描述>", stream_to_user: true })`);
      } else {
        lines.push(`💡 Decision: 没有合适的预置 agent，创建临时 agent：task({ subagent_type: "custom-id", system_prompt: "...", tools: [...] })`);
      }
    } else {
      lines.push('💡 Recommendation: Use the top-ranked agent for best results.');
      lines.push('You can also use `list_agents` to explore all available agents.');
    }

    return lines.join('\n');
  }
}
