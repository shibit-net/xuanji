// ============================================================
// MemoryUpdateTool — 记忆更新工具
// ============================================================
// 用于更新现有记忆的字段（压缩、评分更新等）
// 主要供 DreamAgent 使用
// ============================================================

import type { Tool, ToolResult } from '@/core/types';
import type { MemoryStore } from '@/memory/MemoryStore';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryUpdateTool' });

/**
 * 记忆更新工具
 */
export class MemoryUpdateTool implements Tool {
  name = 'memory_update';
  readonly = false;

  description = `Update an existing memory entry (for compression, scoring, etc.).

**When to use**:
- Compress verbose memory content
- Update significance/confidence scores
- Adjust constraint level
- Update usage scenarios

**Parameters**:
- id: Memory ID to update
- updates: Fields to update (content, significance, confidence, constraint, etc.)
- reason: Reason for update (required)`;

  input_schema = {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string' as const,
        description: 'Memory ID to update',
      },
      updates: {
        type: 'object' as const,
        description: 'Fields to update',
        properties: {
          content: { type: 'string' as const },
          significance: { type: 'number' as const },
          confidence: { type: 'number' as const },
          constraint: { type: 'string' as const, enum: ['must', 'should', 'may'] },
          usageScenarios: { type: 'array' as const, items: { type: 'string' as const } },
        },
      },
      reason: {
        type: 'string' as const,
        description: 'Reason for update (e.g., "compress", "score-update", "constraint-adjust")',
      },
    },
    required: ['id' as const, 'updates' as const, 'reason' as const],
  };

  private store: MemoryStore | null = null;

  setMemoryStore(store: MemoryStore): void {
    this.store = store;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.store) {
      return {
        content: '❌ Memory store not available',
        isError: true,
      };
    }

    const id = input.id as string;
    const updates = input.updates as Record<string, unknown>;
    const reason = input.reason as string;

    if (!id || !updates || !reason) {
      return {
        content: '❌ Missing required parameters: id, updates, reason',
        isError: true,
      };
    }

    try {
      // 检查记忆是否存在
      const existing = this.store.getEntry(id);
      if (!existing) {
        return {
          content: `❌ Memory not found: ${id}`,
          isError: true,
        };
      }

      // 构建更新对象
      const updateData: Record<string, unknown> = {};

      if (updates.content !== undefined) {
        updateData.content = updates.content;
      }
      if (updates.significance !== undefined) {
        updateData.significance = updates.significance;
      }
      if (updates.confidence !== undefined) {
        updateData.confidence = updates.confidence;
      }
      if (updates.constraint !== undefined) {
        updateData.constraint = updates.constraint;
      }
      if (updates.usageScenarios !== undefined) {
        updateData.usageScenarios = updates.usageScenarios;
      }

      // 更新记忆
      this.store.updateEntry(id, updateData);

      log.info(`记忆已更新: ${id} (${reason})`);

      return {
        content: `✅ Memory updated: ${id}\nReason: ${reason}`,
        isError: false,
      };
    } catch (err) {
      log.error('记忆更新失败', err);
      return {
        content: `❌ Failed to update memory: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}
