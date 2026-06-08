/**
 * MatchAgentTool — 智能 Agent 匹配
 *
 * 纯向量语义匹配，不依赖文本分词。
 * 向量模型不可用时触发后台下载，返回异常让 LLM 回退到 list_agents。
 */

import type { JSONSchema, ToolResult } from '@/infrastructure/core-types';
import type { AgentRegistry } from '@/agent/AgentRegistry';
import type { EmbeddingProviderInterface } from '@/infrastructure/embedding/EmbeddingProvider';
import { BaseTool } from './BaseTool';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'MatchAgentTool' });

/** 最低向量匹配阈值，低于此分数视为无匹配 */
const MIN_SCORE = 0.35;

interface AgentMatch {
  agentId: string;
  agentName: string;
  score: number;
  reason: string;
}

export class MatchAgentTool extends BaseTool {
  readonly name = 'match_agent';
  readonly description = [
    'Find the best pre-built agent for a given task description using semantic vector matching.',
    '',
    'Use this when intent analysis did not provide a confident agent or when delegation needs a specialist agent.',
    '',
    'Score guide:',
    '  ≥ 0.5 — Use the recommended agent ID directly in task()',
    '  < 0.5 — No suitable pre-built agent. Use list_agents to browse available agents',
    '           or create a temporary one:',
    '           task({ subagent_type: "custom-id", system_prompt: "...", tools: [...] })',
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
        description: 'Agent ID recommended by intent analysis. When provided, this agent is verified first for a match and returned directly if matching (score bonus). If no match, falls back to global search.',
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
  private onMissingEmbedding: (() => void) | null = null;

  /**
   * 注入依赖
   */
  setDependencies(deps: {
    agentRegistry: AgentRegistry;
    embeddingProvider?: EmbeddingProviderInterface | null;
    onMissingEmbedding?: () => void;
  }): void {
    this.agentRegistry = deps.agentRegistry;
    this.embeddingProvider = deps.embeddingProvider ?? null;
    if (deps.onMissingEmbedding) {
      this.onMissingEmbedding = deps.onMissingEmbedding;
    }
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.agentRegistry) {
      return this.formatError({
        type: '系统错误',
        message: 'AgentRegistry 未初始化',
        reason: 'match_agent 工具依赖 AgentRegistry，但该服务未正确初始化。',
        solutions: ['重启应用程序', '检查系统配置'],
        tip: '内部错误，非调用问题。',
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
        solutions: ['提供详细的任务描述，包括任务类型、目标和要求'],
        example: `match_agent({ task_description: "分析代码质量，检查代码规范、性能和安全问题" })`,
        tip: '任务描述越详细，匹配结果越准确。',
      });
    }

    // 向量模型不可用 → 触发下载 → 返回异常让 LLM 回退到 list_agents
    if (!this.embeddingProvider) {
      if (this.onMissingEmbedding) {
        this.onMissingEmbedding();
      }
      return this.formatError({
        type: '资源错误',
        message: '向量模型未安装，无法进行语义匹配',
        reason: 'match_agent 依赖本地 embedding 模型进行语义匹配，当前模型文件不存在。已在后台触发下载，下次调用时可用。',
        solutions: [
          '使用 list_agents 查看所有可用 agent，手动选择合适的 agent ID',
          '等待向量模型下载完成后重试 match_agent',
          '使用 task({ subagent_type: "custom-id", system_prompt: "...", tools: [...] }) 创建临时 agent',
        ],
        tip: '向量模型通常 5 分钟内下载完成，下载进度可在设置页查看。',
      });
    }

    // 获取所有启用的 Agent（排除主 agent / system / internal）
    const agents = this.agentRegistry.getEnabled()
      .filter(a => {
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
          '使用 list_agents 工具查看所有 agent 的状态',
        ],
        tip: '这通常是系统配置问题，请联系管理员。',
      });
    }

    // 向量匹配
    const matches = await this.scoreAgents(agents, taskDescription);

    // preferred_agent 优先验证
    if (preferredAgentId) {
      const preferredConfig = this.agentRegistry.get(preferredAgentId);
      if (!preferredConfig || preferredConfig.enabled === false) {
        return this.formatError({
          type: '资源错误',
          message: `推荐的 agent "${preferredAgentId}" 不存在或已被禁用`,
          reason: `意图分析推荐了 "${preferredAgentId}"，但该 agent 不在可用列表中。`,
          solutions: [
            '使用 list_agents 查看可用 agent，选择合适的替代',
            '使用 task() 创建临时 agent',
          ],
        });
      }

      const taskVec = await this.embedSafe(taskDescription);
      const agentVec = await this.embedSafe(this.buildAgentMatchText(preferredConfig));
      const preferredScore = (taskVec && agentVec && this.embeddingProvider)
        ? this.embeddingProvider.cosineSimilarity(taskVec, agentVec)
        : 0;
      // 推荐 agent 1.5x 加权
      const boostedScore = Math.min(1.0, preferredScore * 1.5);

      // 用加权后的分数替换或插入
      const existingIdx = matches.findIndex(m => m.agentId === preferredAgentId);
      const preferredMatch: AgentMatch = {
        agentId: preferredAgentId,
        agentName: preferredConfig.name,
        score: boostedScore,
        reason: preferredScore >= MIN_SCORE ? 'Semantic match' : 'Low similarity',
      };
      if (existingIdx >= 0) {
        matches[existingIdx] = preferredMatch;
      } else {
        matches.push(preferredMatch);
      }
    }

    // 排序取 top K
    const topMatches = matches
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // 最高分低于阈值 → 无合适匹配
    if (topMatches.length === 0 || topMatches[0].score < MIN_SCORE) {
      return this.success(
        `Task: "${taskDescription}"\n\n` +
        `❌ 未找到匹配的 agent（最高分: ${(topMatches[0]?.score || 0 * 100).toFixed(0)}%，阈值: ${(MIN_SCORE * 100).toFixed(0)}%）\n\n` +
        `建议：\n` +
        `1. 使用 list_agents 查看所有可用 agent，手动选择\n` +
        `2. 使用 task({ subagent_type: "custom-id", system_prompt: "...", tools: [...] }) 创建临时 agent\n`
      );
    }

    const output = this.formatMatches(topMatches, taskDescription, preferredAgentId);
    return this.success(output);
  }

  /**
   * 对所有 Agent 评分（task description 只 embed 一次）
   */
  private async scoreAgents(agents: any[], taskDescription: string): Promise<AgentMatch[]> {
    if (!this.embeddingProvider) {
      return agents.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        score: 0,
        reason: 'Embedding not available',
      }));
    }

    // task description 只 embed 一次，不重复 embed
    const taskVec = await this.embedSafe(taskDescription);
    if (!taskVec) {
      return agents.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        score: 0,
        reason: 'Failed to embed task description',
      }));
    }

    const results: AgentMatch[] = [];
    for (const agent of agents) {
      const agentVec = await this.embedSafe(this.buildAgentMatchText(agent));
      const score = agentVec
        ? this.embeddingProvider.cosineSimilarity(taskVec, agentVec)
        : 0;
      results.push({
        agentId: agent.id,
        agentName: agent.name,
        score,
        reason: score >= 0.7 ? 'High semantic similarity' :
                score >= MIN_SCORE ? 'Moderate semantic match' :
                'Low similarity',
      });
    }

    return results;
  }

  private async embedSafe(text: string): Promise<number[] | null> {
    if (!this.embeddingProvider) return null;
    try {
      return await this.embeddingProvider.embed(text);
    } catch (err) {
      log.debug(`Embed failed: ${(err as Error).message}`);
      return null;
    }
  }

  private buildAgentMatchText(agent: any): string {
    const examples = Array.isArray(agent.examples)
      ? agent.examples.map((e: any) => [e.input, e.output].filter(Boolean).join(' '))
      : [];
    return [
      agent.id,
      agent.name,
      agent.description,
      ...(Array.isArray(agent.tags) ? agent.tags : []),
      ...(Array.isArray(agent.triggers) ? agent.triggers : []),
      ...(Array.isArray(agent.capabilities) ? agent.capabilities : []),
      ...examples,
    ].filter(Boolean).join(' ');
  }

  /**
   * 格式化匹配结果
   */
  private formatMatches(matches: AgentMatch[], taskDescription: string, preferredAgentId?: string): string {
    const lines: string[] = [
      `Task: "${taskDescription}"`,
      '',
    ];

    if (preferredAgentId) {
      const preferredMatch = matches.find(m => m.agentId === preferredAgentId);
      if (preferredMatch && preferredMatch.score >= 0.5) {
        lines.push(`✅ 推荐的 agent "${preferredAgentId}" 匹配成功 (score: ${(preferredMatch.score * 100).toFixed(0)}%)，直接使用 task({ subagent_type: "${preferredAgentId}", ... })`);
        lines.push('');
      } else if (preferredMatch) {
        lines.push(`⚠️ 推荐的 agent "${preferredAgentId}" 匹配度不足 (score: ${(preferredMatch.score * 100).toFixed(0)}%)，建议使用 list_agents 或创建临时 agent`);
        lines.push('');
      }
    }

    lines.push(`Top ${matches.length} agents (vector similarity):`, '');

    matches.forEach((match, idx) => {
      const scorePercent = (match.score * 100).toFixed(0);
      const stars = '★'.repeat(Math.ceil(match.score * 5));
      const isPreferred = match.agentId === preferredAgentId;
      const prefix = isPreferred ? '👉 ' : '';

      lines.push(`${prefix}${idx + 1}. **${match.agentName}** (${match.agentId})${isPreferred ? ' ← 推荐' : ''}`);
      lines.push(`   Match: ${stars} ${scorePercent}% (${match.reason})`);
      lines.push('');
    });

    lines.push('---');
    lines.push('');

    if (preferredAgentId) {
      const preferredMatch = matches.find(m => m.agentId === preferredAgentId);
      if (preferredMatch && preferredMatch.score >= 0.5) {
        lines.push(`💡 Decision: 使用推荐的 agent "${preferredAgentId}"，调用 task({ subagent_type: "${preferredAgentId}", ... })`);
      } else {
        lines.push('💡 Decision: 没有合适的预置 agent。使用 list_agents 浏览可用的 agent，或创建临时 agent。');
      }
    } else {
      if (matches[0].score >= 0.5) {
        lines.push('💡 Decision: 使用最高分 agent。也可用 list_agents 浏览全部 agent。');
      } else {
        lines.push('💡 Decision: 最高分低于 0.5，建议使用 list_agents 浏览可用的 agent。');
      }
    }

    return lines.join('\n');
  }
}
