// ============================================================
// M6 工具系统 — TodoUpdateTool 更新任务
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { getTodoManager } from './TodoStorageTool';

/**
 * TodoUpdateTool — 更新任务状态/内容/依赖关系
 */
export class TodoUpdateTool extends BaseTool {
  readonly name = 'todo_update';
  readonly description = [
    'Update an existing todo task (status, title, description, dependencies).',
    '',
    'Use to mark tasks as in_progress or completed, modify content, or set up dependencies.',
    'Setting status to "completed" automatically unblocks dependent tasks.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Task ID (e.g. "todo-001")',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed'],
        description: 'New status (optional)',
      },
      title: {
        type: 'string',
        description: 'New title (optional)',
      },
      description: {
        type: 'string',
        description: 'New description (optional)',
      },
      activeForm: {
        type: 'string',
        description: 'Present continuous form shown while in_progress (optional)',
      },
      owner: {
        type: 'string',
        description: 'Task owner (agent name, optional)',
      },
      addBlocks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that this task blocks (cannot start until this one completes)',
      },
      addBlockedBy: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that must complete before this task can start',
      },
    },
    required: ['id'],
  };

  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const id = input.id as string;
    if (!id?.trim()) {
      return this.error('id 不能为空');
    }

    try {
      const manager = getTodoManager();

      const updates: {
        title?: string;
        description?: string;
        status?: 'pending' | 'in_progress' | 'completed';
        owner?: string;
        activeForm?: string;
        addBlocks?: string[];
        addBlockedBy?: string[];
      } = {};

      if (input.status) {
        updates.status = input.status as 'pending' | 'in_progress' | 'completed';
      }
      if (input.title) {
        updates.title = input.title as string;
      }
      if (input.description !== undefined) {
        updates.description = input.description as string;
      }
      if (input.owner !== undefined) {
        updates.owner = input.owner as string;
      }
      if (input.activeForm !== undefined) {
        updates.activeForm = input.activeForm as string;
      }
      if (input.addBlocks) {
        updates.addBlocks = input.addBlocks as string[];
      }
      if (input.addBlockedBy) {
        updates.addBlockedBy = input.addBlockedBy as string[];
      }

      const todo = await manager.update(id, updates);

      const action = updates.status === 'completed' ? '✅ 已完成' :
                     updates.status === 'in_progress' ? '🔄 开始执行' :
                     '📝 已更新';
      const summary = `${action}: ${todo.title} (${todo.id})${manager.formatProgress()}`;
      return this.success(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`更新任务失败: ${msg}`);
    }
  }
}
