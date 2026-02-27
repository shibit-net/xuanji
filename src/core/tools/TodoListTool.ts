// ============================================================
// M6 工具系统 — TodoListTool 列出任务
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { getTodoManager } from './TodoStorageTool';

/**
 * TodoListTool — 列出待办任务
 */
export class TodoListTool extends BaseTool {
  readonly name = 'todo_list';
  readonly description = [
    'List todo tasks with optional status filter.',
    '',
    'Returns all tasks by default, showing dependencies (blocks/blockedBy).',
    'Tasks with unresolved blockedBy cannot be started.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['all', 'pending', 'in_progress', 'completed'],
        description: 'Filter by status (default: all)',
      },
    },
  };

  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const manager = getTodoManager();
      const status = (input.status as string) || 'all';
      const todos = await manager.list({
        status: status as 'all' | 'pending' | 'in_progress' | 'completed',
      });

      if (todos.length === 0) {
        return this.success(`没有${status === 'all' ? '' : ` ${status} 状态的`}任务`);
      }

      const lines = todos.map((t) => {
        const statusIcon =
          t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';

        let line = `${statusIcon} [${t.id}] ${t.title} (${t.status})`;

        // 显示 owner
        if (t.owner) {
          line += ` [owner: ${t.owner}]`;
        }

        // 显示阻塞关系
        const openBlockedBy = (t.blockedBy ?? []).filter((bid) => {
          // 只显示未完成的 blocker
          return true; // TodoManager 在完成时已清理，此处直接显示剩余的
        });

        if (openBlockedBy.length > 0) {
          line += ` ⛔ blockedBy: ${openBlockedBy.join(', ')}`;
        }
        if (t.blocks && t.blocks.length > 0) {
          line += ` → blocks: ${t.blocks.join(', ')}`;
        }

        return line;
      });

      return this.success(lines.join('\n'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`列出任务失败: ${msg}`);
    }
  }
}
