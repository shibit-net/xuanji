// ============================================================
// DecisionPointMemoryRetriever — 决策点驱动的记忆检索器
// ============================================================
// 基于决策点智能检索相关记忆，调用 memory-retriever SubAgent 评估适用性
// ============================================================

import type { DecisionPoint, RetrievedMemory, MemoryEntry } from './types';
import type { MemoryStore } from './MemoryStore';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DecisionPointMemoryRetriever' });

/**
 * 决策点驱动的记忆检索器
 */
export class DecisionPointMemoryRetriever {
  private store: MemoryStore;
  private subAgentFactory: SubAgentFactory;

  constructor(store: MemoryStore, subAgentFactory: SubAgentFactory) {
    this.store = store;
    this.subAgentFactory = subAgentFactory;
  }

  /**
   * 根据决策点检索相关记忆
   */
  async retrieve(context: {
    decisionPoints: DecisionPoint[];
    userMessage: string;
    conversationHistory?: any[];
    currentScene: string;
  }): Promise<RetrievedMemory[]> {
    if (context.decisionPoints.length === 0) {
      log.debug('没有决策点，跳过记忆检索');
      return [];
    }

    log.info(`开始记忆检索，决策点数量: ${context.decisionPoints.length}`);

    const allMemories: RetrievedMemory[] = [];

    // 1. 针对每个决策点检索记忆
    for (const point of context.decisionPoints) {
      const memories = await this.retrieveForDecisionPoint(point, context);
      allMemories.push(...memories);
    }

    // 2. 去重（同一条记忆可能匹配多个决策点）
    const uniqueMemories = this.deduplicateMemories(allMemories);

    // 3. 排序（constraint > applicability > recency）
    const sorted = this.sortMemories(uniqueMemories);

    // 4. 更新使用统计
    await this.updateUsageStats(sorted);

    log.info(`检索完成，返回 ${sorted.length} 条记忆`);

    return sorted;
  }

  /**
   * 针对单个决策点检索记忆
   */
  private async retrieveForDecisionPoint(
    point: DecisionPoint,
    context: any
  ): Promise<RetrievedMemory[]> {
    log.debug(`检索决策点: ${point.type}`, { keywords: point.keywords });

    // 1. 关键词快速过滤（must 级别优先）
    const mustMemories = await this.searchByKeywords(point.keywords, 'must', 10);

    // 2. 场景匹配
    const sceneMemories = await this.searchByScenarios(
      [point.type, context.currentScene],
      20
    );

    // 3. 合并候选记忆
    const allCandidates = [...mustMemories, ...sceneMemories];

    if (allCandidates.length === 0) {
      log.debug('没有找到候选记忆');
      return [];
    }

    // 4. 调用 MemoryRetriever SubAgent 评估适用性
    const evaluated = await this.evaluateApplicability(
      allCandidates,
      point,
      context
    );

    log.debug(`评估完成，返回 ${evaluated.length} 条记忆`);

    return evaluated;
  }

  /**
   * 按关键词搜索记忆
   */
  private async searchByKeywords(
    keywords: string[],
    constraint?: 'must' | 'should' | 'may',
    limit = 20
  ): Promise<MemoryEntry[]> {
    // 构建搜索查询
    const query = keywords.join(' ');

    // 使用 FTS5 全文搜索
    const sql = `
      SELECT m.*
      FROM memories m
      JOIN memories_fts fts ON m.id = fts.id
      WHERE fts.content MATCH ?
        AND m.deleted_at IS NULL
        ${constraint ? 'AND m.constraint_level = ?' : ''}
      ORDER BY fts.rank
      LIMIT ?
    `;

    const params = constraint ? [query, constraint, limit] : [query, limit];

    try {
      const rows = this.store.db!.prepare(sql).all(...params) as any[];
      return rows.map(row => this.store['rowToEntry'](row));
    } catch (err) {
      log.error('关键词搜索失败', err);
      return [];
    }
  }

  /**
   * 按场景搜索记忆
   */
  private async searchByScenarios(
    scenarios: string[],
    limit = 20
  ): Promise<MemoryEntry[]> {
    const sql = `
      SELECT *
      FROM memories
      WHERE deleted_at IS NULL
      ORDER BY
        CASE
          WHEN constraint_level = 'must' THEN 3
          WHEN constraint_level = 'should' THEN 2
          ELSE 1
        END DESC,
        last_used DESC
      LIMIT ?
    `;

    try {
      const rows = this.store.db!.prepare(sql).all(limit) as any[];
      const memories = rows.map(row => this.store['rowToEntry'](row));

      // 过滤：usageScenarios 包含任一场景
      return memories.filter(m => {
        if (!m.usageScenarios || m.usageScenarios.length === 0) return false;
        return scenarios.some(s => m.usageScenarios!.includes(s));
      });
    } catch (err) {
      log.error('场景搜索失败', err);
      return [];
    }
  }

  /**
   * 评估记忆适用性（调用 SubAgent）
   */
  private async evaluateApplicability(
    memories: MemoryEntry[],
    point: DecisionPoint,
    context: any
  ): Promise<RetrievedMemory[]> {
    if (memories.length === 0) return [];

    log.debug(`调用 memory-retriever Agent 评估 ${memories.length} 条记忆`);

    try {
      // 调用 MemoryRetriever SubAgent
      const agent = await this.subAgentFactory.create('memory-retriever', {
        maxIterations: 5,
        timeout: 30000
      });

      const prompt = `评估以下记忆对当前决策点的适用性：

**决策点信息**：
- 类型: ${point.type}
- 关键词: ${point.keywords.join(', ')}
- 当前场景: ${context.currentScene}
- 用户消息: ${context.userMessage}

**记忆列表**：
${memories.map((m, i) => `${i + 1}. [${m.constraint || 'may'}] ${m.content.substring(0, 200)}...
   - ID: ${m.id}
   - 使用场景: ${m.usageScenarios?.join(', ') || '无'}
   - 使用次数: ${m.usageCount || 0}
   - 有效次数: ${m.effectiveCount || 0}
   - 置信度: ${m.confidence || 0.8}
`).join('\n')}

请为每条记忆打分（0-1），并说明理由。返回 JSON 格式：
\`\`\`json
[
  { "memoryId": "id1", "applicability": 0.9, "reason": "..." },
  ...
]
\`\`\``;

      const result = await agent.run(prompt);

      return this.parseEvaluationResult(result, memories);
    } catch (err) {
      log.error('适用性评估失败', err);
      // 降级：使用简单规则评分
      return this.fallbackEvaluation(memories, point);
    }
  }

  /**
   * 解析评估结果
   */
  private parseEvaluationResult(
    agentResult: any,
    memories: MemoryEntry[]
  ): RetrievedMemory[] {
    try {
      // 从 Agent 响应中提取 JSON
      const response = agentResult.response || agentResult.content || '';
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                       response.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        log.warn('无法解析评估结果，使用降级评分');
        return this.fallbackEvaluation(memories, null);
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const scores = JSON.parse(jsonStr);

      // 构建结果
      const results: RetrievedMemory[] = [];
      for (const score of scores) {
        const memory = memories.find(m => m.id === score.memoryId);
        if (memory && score.applicability > 0.3) {
          results.push({
            ...memory,
            applicability: score.applicability,
            reason: score.reason || 'unknown'
          });
        }
      }

      return results;
    } catch (err) {
      log.error('解析评估结果失败', err);
      return this.fallbackEvaluation(memories, null);
    }
  }

  /**
   * 降级评估（简单规则）
   */
  private fallbackEvaluation(
    memories: MemoryEntry[],
    point: DecisionPoint | null
  ): RetrievedMemory[] {
    return memories.map(m => {
      let score = 0.5; // 基础分

      // 约束级别加分
      if (m.constraint === 'must') score += 0.3;
      else if (m.constraint === 'should') score += 0.15;

      // 有效率加分
      const effectiveRate = m.usageCount && m.usageCount > 0
        ? (m.effectiveCount || 0) / m.usageCount
        : 0.5;
      score += effectiveRate * 0.2;

      // 置信度加分
      score += (m.confidence || 0.8) * 0.1;

      return {
        ...m,
        applicability: Math.min(score, 1.0),
        reason: 'fallback-evaluation'
      };
    }).filter(m => m.applicability > 0.3);
  }

  /**
   * 去重记忆
   */
  private deduplicateMemories(memories: RetrievedMemory[]): RetrievedMemory[] {
    const seen = new Set<string>();
    const unique: RetrievedMemory[] = [];

    for (const memory of memories) {
      if (!seen.has(memory.id)) {
        seen.add(memory.id);
        unique.push(memory);
      }
    }

    return unique;
  }

  /**
   * 排序记忆
   */
  private sortMemories(memories: RetrievedMemory[]): RetrievedMemory[] {
    return memories.sort((a, b) => {
      // 1. constraint 优先级: must > should > may
      const constraintOrder = { must: 3, should: 2, may: 1 };
      const constraintA = constraintOrder[a.constraint || 'may'];
      const constraintB = constraintOrder[b.constraint || 'may'];
      if (constraintA !== constraintB) return constraintB - constraintA;

      // 2. 适用性分数
      const applicabilityDiff = b.applicability - a.applicability;
      if (Math.abs(applicabilityDiff) > 0.05) return applicabilityDiff;

      // 3. 有效率
      const effectiveRateA = a.usageCount && a.usageCount > 0
        ? (a.effectiveCount || 0) / a.usageCount
        : 0;
      const effectiveRateB = b.usageCount && b.usageCount > 0
        ? (b.effectiveCount || 0) / b.usageCount
        : 0;
      const effectiveRateDiff = effectiveRateB - effectiveRateA;
      if (Math.abs(effectiveRateDiff) > 0.05) return effectiveRateDiff;

      // 4. 时效性
      return (b.lastUsed || 0) - (a.lastUsed || 0);
    });
  }

  /**
   * 更新使用统计
   */
  private async updateUsageStats(memories: RetrievedMemory[]): Promise<void> {
    const nowMs = Date.now();

    for (const memory of memories) {
      try {
        await this.store.updateEntry(memory.id, {
          usageCount: (memory.usageCount || 0) + 1,
          lastUsed: nowMs
        });
      } catch (err) {
        log.error(`更新记忆使用统计失败: ${memory.id}`, err);
      }
    }
  }
}
