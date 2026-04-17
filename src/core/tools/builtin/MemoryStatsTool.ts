// ============================================================
// MemoryStatsTool — 记忆统计工具
// ============================================================
// 供 memory-refiner Agent 使用，获取记忆库统计信息

import type { Tool, ToolResult } from '@/core/types';
import type { MemoryStore } from '@/memory/MemoryStore';

export class MemoryStatsTool implements Tool {
  name = 'memory_stats';
  description = 'Get statistics about the memory database. Use this to understand the scale of work before processing.';

  parameters = {
    type: 'object',
    properties: {
      groupBy: {
        type: 'string',
        description: 'Group statistics by field',
        enum: ['type', 'scope', 'volatility'],
        default: 'type',
      },
      includeObsolete: {
        type: 'boolean',
        description: 'Include obsolete memories in statistics',
        default: false,
      },
    },
    required: [],
  } as const;

  private store: MemoryStore | null = null;

  setStore(store: MemoryStore): void {
    this.store = store;
  }

  async execute(args: {
    groupBy?: string;
    includeObsolete?: boolean;
  }): Promise<ToolResult> {
    if (!this.store) {
      return {
        success: false,
        output: 'Error: MemoryStore not initialized',
      };
    }

    try {
      const memories = this.store.readAll({ limit: 100000 });
      const groupBy = args.groupBy || 'type';
      const includeObsolete = args.includeObsolete || false;

      // Filter obsolete
      const activeMemories = includeObsolete
        ? memories
        : memories.filter(m => !m.obsolete);

      // Total counts
      const totalCount = memories.length;
      const activeCount = activeMemories.length;
      const obsoleteCount = totalCount - activeCount;

      // Group by field
      const groups: Record<string, {
        count: number;
        avgAccessCount: number;
        avgConfidence: number;
        highFrequency: number; // accessCount >= 3
      }> = {};

      for (const memory of activeMemories) {
        const key = (memory as any)[groupBy] || 'unknown';
        if (!groups[key]) {
          groups[key] = {
            count: 0,
            avgAccessCount: 0,
            avgConfidence: 0,
            highFrequency: 0,
          };
        }

        groups[key].count++;
        groups[key].avgAccessCount += memory.accessCount;
        groups[key].avgConfidence += memory.confidence || 0;
        if (memory.accessCount >= 3) {
          groups[key].highFrequency++;
        }
      }

      // Calculate averages
      for (const key in groups) {
        const group = groups[key];
        group.avgAccessCount = Math.round((group.avgAccessCount / group.count) * 10) / 10;
        group.avgConfidence = Math.round((group.avgConfidence / group.count) * 100) / 100;
      }

      // Sort by count descending
      const sortedGroups = Object.entries(groups)
        .sort(([, a], [, b]) => b.count - a.count)
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {} as typeof groups);

      // Recommendations
      const recommendations: string[] = [];

      // Check for high-frequency error_resolutions
      if (sortedGroups['error_resolution']?.highFrequency > 0) {
        recommendations.push(
          `Found ${sortedGroups['error_resolution'].highFrequency} high-frequency error_resolution memories (accessCount >= 3). Consider upgrading them to lesson_learned.`
        );
      }

      // Check for many decisions
      if (sortedGroups['decision']?.count > 20) {
        recommendations.push(
          `Found ${sortedGroups['decision'].count} decision memories. Consider merging similar ones to reduce redundancy.`
        );
      }

      // Check obsolete ratio
      const obsoleteRatio = obsoleteCount / totalCount;
      if (obsoleteRatio > 0.2) {
        recommendations.push(
          `${Math.round(obsoleteRatio * 100)}% of memories are obsolete. Consider cleaning them up.`
        );
      }

      return {
        success: true,
        output: JSON.stringify({
          summary: {
            total: totalCount,
            active: activeCount,
            obsolete: obsoleteCount,
            obsoleteRatio: Math.round(obsoleteRatio * 100) + '%',
          },
          groupBy,
          groups: sortedGroups,
          recommendations,
        }, null, 2),
      };
    } catch (error) {
      return {
        success: false,
        output: `Error getting memory stats: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
