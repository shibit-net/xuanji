/**
 * MemoryStatsTool — 记忆统计工具
 *
 * 返回记忆系统的完整快照，包括统计数据、样本数据、孤立实体、高频共现实体对等。
 * 供记忆管理机器人在执行维护任务时分析记忆整体情况。
 * 设计文档：docs/memory-system-part-3-integration.md §4
 */

import type { JSONSchema, ToolResult } from '@/infrastructure/core-types';
import { BaseTool } from './BaseTool';
import { getMemoryManager } from '@/memory/globals';

export class MemoryStatsTool extends BaseTool {
  readonly name = 'memory_stats';
  readonly description = [
    'Get a complete status report of the memory system.',
    '',
    'Returns: statistics (total counts by type), sample data (recent entities/facts/events), and potential issues (orphan entities, high-frequency co-occurrence pairs).',
    '',
    'WHEN TO USE: checking memory health, analyzing stored knowledge, finding orphaned data, or inspecting co-occurrence patterns.',
    '',
    'Use detail=basic for quick stats only, detail=full for comprehensive analysis including samples and issues.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      detail: {
        type: 'string',
        enum: ['basic', 'full'],
        description: 'basic=only statistics, full=includes samples and potential issue analysis. Default basic.',
        default: 'basic',
      },
    },
  };

  override readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const detail = (input.detail as string) ?? 'basic';

    const manager = getMemoryManager();
    if (!manager) {
      return this.error('记忆系统未初始化，请稍后再试。');
    }

    try {
      const snapshot = manager.getMemorySnapshot();
      const stats = snapshot.stats;

      if (detail === 'basic') {
        const lines = [
          `## 记忆统计`,
          `- 实体数: ${stats.entityCount}`,
          `- 事实数: ${stats.factCount}`,
          `- 事件数: ${stats.eventCount}`,
          `- 关系数: ${stats.relationCount}`,
          `- 叙事数: ${stats.episodeCount}`,
          `- FTS 索引条目: ${stats.ftsEntryCount}`,
          `- 数据库大小: ${(stats.dbSizeBytes / 1024).toFixed(1)} KB`,
        ];
        return this.success(lines.join('\n'), {
          stats,
          detail: 'basic',
        });
      }

      // full 模式：包含样本和潜在问题
      const parts: string[] = [];
      parts.push(`## 记忆统计`);
      parts.push(`- 实体数: ${stats.entityCount}`);
      parts.push(`- 事实数: ${stats.factCount}`);
      parts.push(`- 事件数: ${stats.eventCount}`);
      parts.push(`- 关系数: ${stats.relationCount}`);
      parts.push(`- 叙事数: ${stats.episodeCount}`);
      parts.push('');

      if (snapshot.recentEntities.length > 0) {
        parts.push(`## 最近实体（${snapshot.recentEntities.length} 条）`);
        for (const e of snapshot.recentEntities) {
          parts.push(`- [${e.type}] **${e.name}**: ${e.summary}${e.category ? ` (${e.category})` : ''} (重要度: ${e.importance})`);
        }
        parts.push('');
      }

      if (snapshot.recentFacts.length > 0) {
        parts.push(`## 最近事实（${snapshot.recentFacts.length} 条）`);
        for (const f of snapshot.recentFacts) {
          parts.push(`- **${f.title}**: ${f.content.slice(0, 120)} (来源: ${f.source})`);
        }
        parts.push('');
      }

      if (snapshot.activeRelations.length > 0) {
        parts.push(`## 活跃关系（${snapshot.activeRelations.length} 条）`);
        for (const r of snapshot.activeRelations) {
          parts.push(`- **${r.subjectName}** → ${r.relation} → **${r.objectName}** (强度: ${r.strength})`);
        }
        parts.push('');
      }

      if (snapshot.orphanEntities.length > 0) {
        parts.push(`## ⚠️ 孤立实体（${snapshot.orphanEntities.length} 个）`);
        parts.push('以下实体无关系关联也无事件引用，建议清理或建立关联：');
        for (const e of snapshot.orphanEntities) {
          parts.push(`- **${e.name}** (${e.type}): ${e.summary}`);
        }
        parts.push('');
      }

      if (snapshot.cooccurrencePairs.length > 0) {
        parts.push(`## 高频共现实体对`);
        for (const p of snapshot.cooccurrencePairs.slice(0, 10)) {
          parts.push(`- **${p.entityA}** ↔ **${p.entityB}** (共现 ${p.count} 次) — 建议建立 relation`);
        }
        parts.push('');
      }

      return this.success(parts.join('\n'), {
        stats,
        orphanCount: snapshot.orphanEntities.length,
        cooccurrenceCount: snapshot.cooccurrencePairs.length,
        detail: 'full',
      });
    } catch (err) {
      return this.error(`获取记忆统计失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
