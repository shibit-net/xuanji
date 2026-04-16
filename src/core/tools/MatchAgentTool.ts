/**
 * MatchAgentTool — 智能 Agent 匹配
 *
 * 根据任务描述自动推荐最合适的 Agent。
 * 使用向量相似度、关键词匹配、标签匹配等多维度评分。
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { EmbeddingService } from '@/embedding/EmbeddingService';
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
    tag?: number;
    capability?: number;
  };
  reason: string;
}

export class MatchAgentTool extends BaseTool {
  readonly name = 'match_agent';
  readonly description = [
    '🎯 Find the best preset agent for a specific task.',
    '',
    '⚡ WHEN TO USE:',
    'ALWAYS call this BEFORE using task or agent_team tools to find the most suitable preset agent.',
    'This ensures you leverage specialized agents (coder, explore, test-writer, etc.) instead of generic ones.',
    '',
    'The system analyzes the task description and recommends the most suitable agent using:',
    '✓ Semantic similarity (vector matching)',
    '✓ Keyword matching',
    '✓ Capability matching',
    '✓ Domain/tag matching',
    '',
    'Workflow:',
    '1. Call match_agent with task description',
    '2. Review top recommendations and scores',
    '3. If score >= 0.5 (50%), use that agent ID in task/agent_team',
    '4. If score < 0.5, use general-purpose or create custom agent',
    '',
    'Returns:',
    '- Top 3 agent recommendations',
    '- Match scores (0-1) and reasoning',
    '- Agent capabilities and descriptions',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      task_description: {
        type: 'string',
        description: 'Description of the task you need an agent for',
      },
      domain_hint: {
        type: 'string',
        description: 'Optional domain hint (e.g., "finance", "coding", "data-analysis")',
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
  private embeddingService: EmbeddingService | null = null;

  /**
   * 注入依赖
   */
  setDependencies(deps: {
    agentRegistry: AgentRegistry;
    embeddingService?: EmbeddingService | null;
  }): void {
    this.agentRegistry = deps.agentRegistry;
    this.embeddingService = deps.embeddingService ?? null;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.agentRegistry) {
      return this.error('AgentRegistry not available.');
    }

    const taskDescription = input.task_description as string;
    const domainHint = input.domain_hint as string | undefined;
    const topK = Math.min((input.top_k as number) || 3, 5);

    // 获取所有启用的 Agent
    const agents = this.agentRegistry.getAllIds()
      .map(id => this.agentRegistry!.get(id)!)
      .filter(a => a.enabled !== false);

    if (agents.length === 0) {
      return this.error('No agents available.');
    }

    // 计算匹配分数
    const matches = await this.scoreAgents(agents, taskDescription, domainHint);

    // 排序并取 top K
    const topMatches = matches
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // 格式化输出
    const output = this.formatMatches(topMatches, taskDescription);

    return this.success(output);
  }

  /**
   * 对所有 Agent 评分
   */
  private async scoreAgents(
    agents: any[],
    taskDescription: string,
    domainHint?: string,
  ): Promise<AgentMatch[]> {
    const matches: AgentMatch[] = [];

    for (const agent of agents) {
      const breakdown: AgentMatch['breakdown'] = {};
      let totalScore = 0;

      // 1. 向量相似度（如果可用）
      if (this.embeddingService) {
        try {
          const vectorScore = await this.calculateVectorSimilarity(
            taskDescription,
            agent.capabilities.join(' ') + ' ' + agent.description
          );
          breakdown.vector = vectorScore;
          totalScore += vectorScore * 0.4; // 40% 权重
        } catch (err) {
          log.debug(`Vector matching failed for ${agent.id}:`, err);
        }
      }

      // 2. 关键词匹配
      const keywordScore = this.calculateKeywordMatch(taskDescription, agent);
      breakdown.keyword = keywordScore;
      totalScore += keywordScore * 0.3; // 30% 权重

      // 3. 标签匹配（如果有 domain hint）
      if (domainHint) {
        const tagScore = this.calculateTagMatch(domainHint, agent.tags);
        breakdown.tag = tagScore;
        totalScore += tagScore * 0.2; // 20% 权重
      }

      // 4. 能力匹配
      const capabilityScore = this.calculateCapabilityMatch(taskDescription, agent.capabilities);
      breakdown.capability = capabilityScore;
      totalScore += capabilityScore * 0.1; // 10% 权重

      // 生成推荐理由
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
    if (!this.embeddingService) return 0;

    const [embedding1, embedding2] = await Promise.all([
      this.embeddingService.embed(text1),
      this.embeddingService.embed(text2),
    ]);

    // 计算余弦相似度
    const dotProduct = embedding1.reduce((sum, val, idx) => sum + val * embedding2[idx], 0);
    const magnitude1 = Math.sqrt(embedding1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(embedding2.reduce((sum, val) => sum + val * val, 0));

    return dotProduct / (magnitude1 * magnitude2);
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
      agent.capabilities.join(' ') + ' ' +
      agent.tags.join(' ')
    ).toLowerCase();

    const matchedWords = taskWords.filter(word =>
      word.length > 3 && agentText.includes(word)
    );

    return matchedWords.length / taskWords.length;
  }

  /**
   * 计算标签匹配分数
   */
  private calculateTagMatch(domainHint: string, agentTags: string[]): number {
    const hint = domainHint.toLowerCase();
    const matchingTags = agentTags.filter(tag =>
      tag.toLowerCase().includes(hint) || hint.includes(tag.toLowerCase())
    );

    return matchingTags.length > 0 ? 1 : 0;
  }

  /**
   * 计算能力匹配分数
   */
  private calculateCapabilityMatch(taskDescription: string, capabilities: string[]): number {
    const taskLower = taskDescription.toLowerCase();
    const matchingCaps = capabilities.filter(cap =>
      taskLower.includes(cap.toLowerCase()) || cap.toLowerCase().includes(taskLower.substring(0, 20))
    );

    return capabilities.length > 0 ? matchingCaps.length / capabilities.length : 0;
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
    if (breakdown.tag && breakdown.tag > 0) {
      reasons.push('Domain match');
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
  private formatMatches(matches: AgentMatch[], taskDescription: string): string {
    const lines: string[] = [
      `Task: "${taskDescription}"`,
      '',
      `Top ${matches.length} recommended agents:`,
      '',
    ];

    matches.forEach((match, idx) => {
      const scorePercent = (match.score * 100).toFixed(0);
      const stars = '★'.repeat(Math.ceil(match.score * 5));

      lines.push(`${idx + 1}. **${match.agentName}** (${match.agentId})`);
      lines.push(`   Match: ${stars} ${scorePercent}%`);
      lines.push(`   Reason: ${match.reason}`);

      // 详细评分
      const details: string[] = [];
      if (match.breakdown.vector) {
        details.push(`Semantic: ${(match.breakdown.vector * 100).toFixed(0)}%`);
      }
      if (match.breakdown.keyword) {
        details.push(`Keyword: ${(match.breakdown.keyword * 100).toFixed(0)}%`);
      }
      if (match.breakdown.tag) {
        details.push(`Domain: ${(match.breakdown.tag * 100).toFixed(0)}%`);
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
    lines.push('💡 Recommendation: Use the top-ranked agent for best results.');
    lines.push('You can also use `list_agents` to explore all available agents.');

    return lines.join('\n');
  }
}
