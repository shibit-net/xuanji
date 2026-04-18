// ============================================================
// DreamAgent — 做梦机制（记忆整理）
// ============================================================
// 后台自动整理记忆：提炼、压缩、去重、淘汰
// 支持分批处理、无上限、断点续传
// ============================================================

import type { DreamResult, DreamProgress, MemoryEntry } from './types';
import type { MemoryStore } from './MemoryStore';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DreamAgent' });

/**
 * 做梦机制 - 记忆整理
 */
export class DreamAgent {
  private store: MemoryStore;
  private subAgentFactory: SubAgentFactory;

  private readonly BATCH_SIZE = 100;      // 每批处理100条
  private readonly BATCH_INTERVAL = 5000; // 批次间隔5秒

  constructor(store: MemoryStore, subAgentFactory: SubAgentFactory) {
    this.store = store;
    this.subAgentFactory = subAgentFactory;
  }

  /**
   * 执行做梦（无上限处理）
   */
  async dream(options: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (progress: DreamProgress) => void;
  } = {}): Promise<DreamResult> {
    const batchSize = options.batchSize || this.BATCH_SIZE;
    const startTime = Date.now();

    log.info('🌙 开始做梦（记忆整理）...');

    // 1. 获取待处理记忆总数
    const totalCount = await this.getProcessableCount();

    if (totalCount === 0) {
      log.info('🌙 没有需要处理的记忆');
      return {
        merged: 0,
        distilled: 0,
        compressed: 0,
        deduplicated: 0,
        pruned: 0,
        scored: 0,
        duration: Date.now() - startTime
      };
    }

    log.info(`📊 共 ${totalCount} 条记忆待处理`);

    // 2. 计算总批次数
    const totalBatches = Math.ceil(totalCount / batchSize);

    // 3. 聚合结果
    const aggregatedResult: DreamResult = {
      merged: 0,
      distilled: 0,
      compressed: 0,
      deduplicated: 0,
      pruned: 0,
      scored: 0,
      duration: 0
    };

    // 4. 分批处理
    let processedCount = 0;

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      log.info(`🌙 处理第 ${batchIndex + 1}/${totalBatches} 批...`);

      // 获取本批次记忆
      const memories = await this.fetchBatch(batchIndex * batchSize, batchSize);

      if (memories.length === 0) {
        log.info('🌙 已到达最后一批');
        break;
      }

      // 处理本批次
      const batchResult = await this.processBatch({
        memories,
        batchIndex: batchIndex + 1,
        totalBatches,
        dryRun: options.dryRun
      });

      // 聚合结果
      aggregatedResult.merged += batchResult.merged;
      aggregatedResult.distilled += batchResult.distilled;
      aggregatedResult.compressed += batchResult.compressed;
      aggregatedResult.deduplicated += batchResult.deduplicated;
      aggregatedResult.pruned += batchResult.pruned;
      aggregatedResult.scored += batchResult.scored;
      aggregatedResult.duration += batchResult.duration;

      processedCount += memories.length;

      // 进度回调
      if (options.onProgress) {
        options.onProgress({
          currentBatch: batchIndex + 1,
          totalBatches,
          processedCount,
          totalCount,
          result: aggregatedResult
        });
      }

      // 批次间隔
      if (batchIndex < totalBatches - 1) {
        await this.sleep(this.BATCH_INTERVAL);
      }
    }

    const duration = Date.now() - startTime;
    aggregatedResult.duration = duration;

    log.info(
      `🌙 做梦完成（${totalBatches}批，${processedCount}条）：` +
      `合并${aggregatedResult.merged}条、` +
      `提炼${aggregatedResult.distilled}条、` +
      `压缩${aggregatedResult.compressed}条、` +
      `去重${aggregatedResult.deduplicated}条、` +
      `淘汰${aggregatedResult.pruned}条、` +
      `评分更新${aggregatedResult.scored}条，` +
      `总耗时${duration}ms`
    );

    return aggregatedResult;
  }

  /**
   * 获取可处理的记忆数量
   */
  private async getProcessableCount(): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count
      FROM memories
      WHERE deleted_at IS NULL
        AND (
          last_dreamed IS NULL
          OR last_dreamed < ?
        )
    `;

    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;

    try {
      const row = this.store.db!.prepare(sql).get(sevenDaysAgo) as any;
      return row.count || 0;
    } catch (err) {
      log.error('获取可处理记忆数量失败', err);
      return 0;
    }
  }

  /**
   * 获取一批记忆
   */
  private async fetchBatch(offset: number, limit: number): Promise<MemoryEntry[]> {
    const sql = `
      SELECT *
      FROM memories
      WHERE deleted_at IS NULL
        AND (
          last_dreamed IS NULL
          OR last_dreamed < ?
        )
      ORDER BY
        CASE
          WHEN usage_count > 10 AND (effective_count * 1.0 / usage_count) < 0.3 THEN 100
          WHEN last_used < ? THEN 90
          WHEN length(content) > 500 THEN 80
          ELSE 50
        END DESC,
        last_used DESC
      LIMIT ? OFFSET ?
    `;

    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const ninetyDaysAgo = Date.now() - 90 * 24 * 3600 * 1000;

    try {
      const rows = this.store.db!.prepare(sql).all(sevenDaysAgo, ninetyDaysAgo, limit, offset) as any[];
      return rows.map(row => this.store['rowToEntry'](row));
    } catch (err) {
      log.error('获取批次记忆失败', err);
      return [];
    }
  }

  /**
   * 处理单个批次
   */
  private async processBatch(options: {
    memories: MemoryEntry[];
    batchIndex: number;
    totalBatches: number;
    dryRun?: boolean;
  }): Promise<DreamResult> {
    const startTime = Date.now();

    // 准备上下文（精简版，减少 token）
    const context = {
      memories: options.memories.map(m => ({
        id: m.id,
        content: m.content.substring(0, 300),  // 截断长内容
        type: m.type,
        constraint: m.constraint,
        usageCount: m.usageCount,
        effectiveCount: m.effectiveCount,
        confidence: m.confidence,
        lastUsed: m.lastUsed,
        memoryOriginV2: m.memoryOriginV2
      })),
      batchInfo: {
        current: options.batchIndex,
        total: options.totalBatches
      },
      dryRun: options.dryRun
    };

    try {
      // 调用 DreamAgent SubAgent
      const agent = await this.subAgentFactory.create('dream-agent', {
        maxIterations: 30,
        timeout: 180000  // 3分钟超时
      });

      const prompt = `处理本批次记忆（${options.batchIndex}/${options.totalBatches}）：

${JSON.stringify(context, null, 2)}

请执行以下任务：
1. **合并冲突记忆**（最高优先级）
   - 检测唯一性字段的冲突（用户称呼、助手名字、用户姓名、人格设定、语气风格）
   - 将多条冲突记忆合并为一条最新的记忆
   - 在 metadata.history 中保存修改历史
   - 标记旧记忆为 obsolete = true
   - 示例：
     * 记忆 A: "用户希望被称呼为'先生'" (2026-04-12)
     * 记忆 B: "用户希望被称呼为'Boss'" (2026-04-17)
     * 操作：保留 B，标记 A 为 obsolete，在 B 的 metadata.history 中记录 ["先生" (2026-04-12)]

2. 提炼相似记忆
   - 将多条相似但不冲突的记忆提炼为一条更精炼的记忆

3. 压缩冗长记忆
   - 将过长的记忆内容压缩为更简洁的表达

4. 去重重复记忆
   - 删除完全重复的记忆

5. 淘汰低价值记忆
   - 删除使用率低、置信度低的记忆

6. 更新记忆评分
   - 根据使用情况更新记忆的 significance 和 confidence

**重要提示**：
- 唯一性字段冲突检测模式：
  * 用户称呼：包含"被称呼为"、"叫我"、"call me"
  * 助手名字：包含"称呼助手为"、"你的名字"、"your name"
  * 用户姓名：包含"我的名字"、"my name is"
  * 人格设定：包含"人格设定"、"性格设定"、"persona"
  * 语气风格：包含"语气风格"、"说话风格"、"tone"
- 合并时优先保留最新的记忆（createdAt 最大）
- 修改历史格式：metadata.history = [{ value: "旧值", timestamp: "时间戳" }]

${options.dryRun ? '【试运行模式，不实际修改】' : ''}`;

      const result = await agent.run(prompt);

      // 解析结果
      const dreamResult = this.parseDreamResult(result);

      // 标记本批次记忆已处理
      if (!options.dryRun) {
        await this.markBatchProcessed(options.memories);
      }

      return {
        ...dreamResult,
        duration: Date.now() - startTime
      };
    } catch (err) {
      log.error('处理批次失败', err);
      return {
        merged: 0,
        distilled: 0,
        compressed: 0,
        deduplicated: 0,
        pruned: 0,
        scored: 0,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 解析做梦结果
   */
  private parseDreamResult(agentResult: any): Omit<DreamResult, 'duration'> {
    // 从工具调用中统计
    const toolCalls = agentResult.toolCalls || [];

    // 合并操作：标记为 obsolete 的记忆
    const merged = toolCalls.filter((t: any) =>
      t.name === 'memory_update' &&
      (t.input?.obsolete === true || t.input?.reason?.includes('merge') || t.input?.reason?.includes('conflict'))
    ).length;

    const distilled = toolCalls.filter((t: any) =>
      t.name === 'memory_store' && t.input?.dreamGeneration > 0
    ).length;

    const compressed = toolCalls.filter((t: any) =>
      t.name === 'memory_update' && t.input?.reason?.includes('compress')
    ).length;

    const deduplicated = toolCalls.filter((t: any) =>
      t.name === 'memory_delete' && t.input?.reason === 'duplicate'
    ).length;

    const pruned = toolCalls.filter((t: any) =>
      t.name === 'memory_delete' && t.input?.reason === 'prune'
    ).length;

    const scored = toolCalls.filter((t: any) =>
      t.name === 'memory_update' && t.input?.reason?.includes('score')
    ).length;

    return { merged, distilled, compressed, deduplicated, pruned, scored };
  }

  /**
   * 标记批次已处理
   */
  private async markBatchProcessed(memories: MemoryEntry[]): Promise<void> {
    const now = Date.now();

    for (const memory of memories) {
      try {
        const sql = `
          UPDATE memories
          SET last_dreamed = ?,
              dream_count = dream_count + 1
          WHERE id = ?
        `;

        this.store.db!.prepare(sql).run(now, memory.id);
      } catch (err) {
        log.error(`标记记忆 ${memory.id} 已处理失败`, err);
      }
    }
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
