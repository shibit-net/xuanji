// ============================================================
// MemoryCompactor — 记忆压缩器
// ============================================================
// 职责：
// 1. 去重：合并内容相似的记忆
// 2. 压缩：将多条相关记忆合并为更抽象的知识
// 3. 淘汰：删除过时、低价值的记忆

import type { MemoryStore } from './MemoryStore.js';
import type { MemoryEntry } from './types.js';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryCompactor' });

export interface CompactionResult {
  duplicatesRemoved: number;
  memoriesMerged: number;
  obsoleteMarked: number;
  duration: number;
}

/**
 * MemoryCompactor — 记忆压缩器
 *
 * 定期执行记忆整理，保持记忆库的质量和效率
 */
export class MemoryCompactor {
  private store: MemoryStore;
  private subAgentFactory: SubAgentFactory | null;
  private compacting = false;

  constructor(store: MemoryStore, subAgentFactory?: SubAgentFactory) {
    this.store = store;
    this.subAgentFactory = subAgentFactory || null;
  }

  /**
   * 执行记忆压缩
   *
   * @param options.dryRun - 只分析不执行
   * @param options.aggressiveness - 压缩激进程度 0-1，越高越激进
   * @param options.useLLM - 是否使用 LLM 进行智能合并
   */
  async compact(options?: {
    dryRun?: boolean;
    aggressiveness?: number;
    useLLM?: boolean;
  }): Promise<CompactionResult> {
    if (this.compacting) {
      log.warn('Compaction already in progress, skipping');
      return { duplicatesRemoved: 0, memoriesMerged: 0, obsoleteMarked: 0, duration: 0 };
    }

    this.compacting = true;
    const startTime = Date.now();
    const dryRun = options?.dryRun ?? false;
    const aggressiveness = options?.aggressiveness ?? 0.5;
    const useLLM = options?.useLLM ?? (this.subAgentFactory !== null);

    try {
      log.info(`Starting memory compaction (dryRun: ${dryRun}, aggressiveness: ${aggressiveness}, useLLM: ${useLLM})`);

      let duplicatesRemoved = 0;
      let memoriesMerged = 0;
      let obsoleteMarked = 0;

      // 1. 去重：删除完全相同的记忆
      duplicatesRemoved = await this.removeDuplicates(dryRun);

      // 2. 标记过时记忆
      obsoleteMarked = await this.markObsolete(dryRun, aggressiveness);

      // 3. 合并相似记忆（使用 LLM）
      if (useLLM && this.subAgentFactory) {
        memoriesMerged = await this.mergeSimilarWithLLM(dryRun, aggressiveness);
      }

      const duration = Date.now() - startTime;
      log.info(`Compaction completed in ${duration}ms: ${duplicatesRemoved} duplicates, ${memoriesMerged} merged, ${obsoleteMarked} obsolete`);

      return { duplicatesRemoved, memoriesMerged, obsoleteMarked, duration };
    } finally {
      this.compacting = false;
    }
  }

  /**
   * 删除重复记忆
   * 标准：content 完全相同，保留最新的
   */
  private async removeDuplicates(dryRun: boolean): Promise<number> {
    const allMemories = this.store.readAll({ limit: 10000 });
    const contentMap = new Map<string, MemoryEntry[]>();

    // 按 content 分组
    for (const memory of allMemories) {
      if (memory.obsolete) continue;
      const key = memory.content.trim().toLowerCase();
      if (!contentMap.has(key)) {
        contentMap.set(key, []);
      }
      contentMap.get(key)!.push(memory);
    }

    // 找出重复项
    let removed = 0;
    for (const [content, memories] of contentMap) {
      if (memories.length <= 1) continue;

      // 按创建时间排序，保留最新的
      memories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const toKeep = memories[0]!;
      const toRemove = memories.slice(1);

      log.debug(`Found ${memories.length} duplicates: "${content.slice(0, 50)}..."`);
      log.debug(`  Keeping: ${toKeep.id} (${toKeep.createdAt})`);

      for (const dup of toRemove) {
        log.debug(`  Removing: ${dup.id} (${dup.createdAt})`);
        if (!dryRun) {
          this.store.deleteEntry(dup.id);
        }
        removed++;
      }
    }

    return removed;
  }

  /**
   * 标记过时记忆
   *
   * 标准：
   * 1. session_summary 超过 90 天
   * 2. error_resolution 超过 180 天且访问次数 < 2
   * 3. tool_pattern 超过 180 天且访问次数 < 3
   * 4. decision 超过 365 天且访问次数 < 2
   */
  private async markObsolete(dryRun: boolean, aggressiveness: number): Promise<number> {
    const now = Date.now();
    const allMemories = this.store.readAll({ limit: 10000 });
    let marked = 0;

    // 根据激进程度调整阈值
    const thresholds = {
      session_summary: { days: 90 * (1 - aggressiveness * 0.5), minAccess: 0 },
      error_resolution: { days: 180 * (1 - aggressiveness * 0.3), minAccess: 2 },
      tool_pattern: { days: 180 * (1 - aggressiveness * 0.3), minAccess: 3 },
      decision: { days: 365 * (1 - aggressiveness * 0.2), minAccess: 2 },
    };

    for (const memory of allMemories) {
      if (memory.obsolete) continue;

      const threshold = thresholds[memory.type as keyof typeof thresholds];
      if (!threshold) continue;

      const ageMs = now - new Date(memory.createdAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays > threshold.days && memory.accessCount < threshold.minAccess) {
        log.debug(`Marking obsolete: [${memory.type}] ${memory.content.slice(0, 50)}... (age: ${ageDays.toFixed(0)}d, access: ${memory.accessCount})`);
        if (!dryRun) {
          this.store.updateEntry(memory.id, { obsolete: true });
        }
        marked++;
      }
    }

    return marked;
  }

  /**
   * 获取压缩统计
   */
  getStats(): {
    total: number;
    obsolete: number;
    byType: Record<string, number>;
  } {
    const allMemories = this.store.readAll({ limit: 10000 });
    const stats = {
      total: allMemories.length,
      obsolete: allMemories.filter(m => m.obsolete).length,
      byType: {} as Record<string, number>,
    };

    for (const memory of allMemories) {
      if (!memory.obsolete) {
        stats.byType[memory.type] = (stats.byType[memory.type] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * 使用 LLM 合并相似记忆
   */
  private async mergeSimilarWithLLM(dryRun: boolean, aggressiveness: number): Promise<number> {
    if (!this.subAgentFactory) {
      log.warn('SubAgentFactory not available, skipping LLM merge');
      return 0;
    }

    log.info('Starting LLM-based memory merging');

    // 使用 memory-refiner Agent 进行合并
    // Agent 会自主决定处理多少记忆，使用分页机制
    const maxGroups = Math.ceil(10 * aggressiveness); // 激进程度影响合并数量

    const task = `Analyze and merge similar decision memories.

**Your Task:**
1. Use memory_stats to understand the scale
2. Use memory_query with pagination to process decision memories in batches
3. Identify and merge similar memories (up to ${maxGroups} groups)
4. Process in batches of 30 memories at a time
5. Merge 2-5 memories per group
6. Report progress and results

**Goal:** Reduce redundancy by merging similar decisions.`;

    try {
      const result = await this.subAgentFactory.createAndRun('memory-refiner', {
        task,
        depth: 1,
        timeout: 120_000, // 2 minutes for large-scale processing
      });

      // 解析结果中的合并数量
      const merged = this.parseMergeCount(result.result);
      log.info(`LLM merge completed: ${merged} groups merged`);

      return merged;
    } catch (err) {
      log.warn('LLM merge failed:', err);
      return 0;
    }
  }

  /**
   * 解析合并数量
   */
  private parseMergeCount(response: string): number {
    const match = response.match(/merged[:\s]+(\d+)/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * 按相似度分组记忆
   */
  private groupSimilarMemories(memories: MemoryEntry[]): MemoryEntry[][] {
    const groups: MemoryEntry[][] = [];
    const used = new Set<string>();

    for (const memory of memories) {
      if (used.has(memory.id)) continue;

      const group = [memory];
      used.add(memory.id);

      // 查找相似的记忆
      for (const other of memories) {
        if (used.has(other.id)) continue;
        if (this.isSimilar(memory, other)) {
          group.push(other);
          used.add(other.id);
        }
      }

      if (group.length >= 2) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * 判断两条记忆是否相似
   */
  private isSimilar(m1: MemoryEntry, m2: MemoryEntry): boolean {
    // 简单的关键词重叠度判断
    const keywords1 = new Set(m1.keywords || []);
    const keywords2 = new Set(m2.keywords || []);

    let overlap = 0;
    for (const kw of keywords1) {
      if (keywords2.has(kw)) overlap++;
    }

    const total = keywords1.size + keywords2.size;
    return total > 0 && overlap / total > 0.3;
  }

  /**
   * 构建合并 Prompt
   */
  private buildMergePrompt(memories: MemoryEntry[]): string {
    const memoryList = memories.map((m, idx) =>
      `${idx + 1}. ${m.content}`
    ).join('\n');

    return `Merge the following similar memories into one concise, comprehensive memory.

## Memories to Merge
${memoryList}

## Task
Create a single merged memory that:
- Captures the common essence of all memories
- Is more concise than the sum of parts
- Preserves important details
- Uses clear, professional language

## Output Format (JSON)
\`\`\`json
{
  "content": "Merged memory content (max 150 words)",
  "keywords": ["keyword1", "keyword2"],
  "confidence": 0.85
}
\`\`\``;
  }

  /**
   * 解析合并结果
   */
  private parseMergeResult(response: string): MemoryEntry | null {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
        ?? response.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[1]!);
      const now = new Date().toISOString();

      return {
        id: `merged_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type: 'decision',
        content: parsed.content,
        keywords: parsed.keywords || [],
        source: 'memory-compactor-llm',
        confidence: parsed.confidence || 0.85,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        scope: 'knowledge',
        volatility: 'normal',
        significance: 0.7,
        categoryLabel: 'Merged Knowledge',
      };
    } catch {
      return null;
    }
  }
}

