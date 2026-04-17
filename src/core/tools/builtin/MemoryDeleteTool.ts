// ============================================================
// MemoryDeleteTool — 记忆删除工具
// ============================================================
// 软删除记忆（标记为已删除，不实际删除）
// 主要供 DreamAgent 使用
// ============================================================

import type { Tool, ToolResult } from '@/core/types';
import type { MemoryStore } from '@/memory/MemoryStore';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryDeleteTool' });

/**
 * 记忆删除工具（软删除）
 */
export class MemoryDeleteTool implements Tool {
  name = 'memory_delete';
  readonly = false;

  description = `Soft-delete a memory entry (mark as deleted, not actually remove).

**When to use**:
- Remove duplicate memories
- Prune low-value memories
- Delete obsolete memories
- Merge memories (delete originals after creating merged version)

**Parameters**:
- id: Memory ID to delete
- reason: Reason for deletion (required, e.g., "duplicate", "prune", "merged", "obsolete")

**Note**: This is a soft delete - the memory is marked as deleted but not removed from database.`;

  input_schema = {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string' as const,
        description: 'Memory ID to delete',
      },
      reason: {
        type: 'string' as const,
        description: 'Reason for deletion (e.g., "duplicate", "prune", "merged", "obsolete")',
      },
    },
    required: ['id' as const, 'reason' as const],
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
    const reason = input.reason as string;

    if (!id || !reason) {
      return {
        content: '❌ Missing required parameters: id, reason',
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

      // 检查是否已删除
      if (existing.deletedAt) {
        return {
          content: `⚠️ Memory already deleted: ${id}`,
          isError: false,
        };
      }

      // 软删除：标记删除时间和原因
      this.store.updateEntry(id, {
        deletedAt: Date.now(),
        deleteReason: reason,
      });

      log.info(`记忆已删除: ${id} (${reason})`);

      return {
        content: `✅ Memory deleted: ${id}\nReason: ${reason}`,
        isError: false,
      };
    } catch (err) {
      log.error('记忆删除失败', err);
      return {
        content: `❌ Failed to delete memory: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}
