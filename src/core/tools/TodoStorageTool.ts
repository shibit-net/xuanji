// ============================================================
// M6 工具系统 — TodoStorageTool 创建任务
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { TodoManager } from './TodoManager';

// 共享单例
let sharedManager: TodoManager | undefined;

export function setTodoManager(manager: TodoManager): void {
  sharedManager = manager;
}

export function getTodoManager(): TodoManager {
  if (!sharedManager) {
    sharedManager = new TodoManager();
  }
  return sharedManager;
}

/**
 * TodoStorageTool — 创建待办任务
 */
export class TodoStorageTool extends BaseTool {
  readonly name = 'todo_create';
  readonly description = [
    'Create a new todo task to track progress on multi-step work.',
    '',
    'Use this to organize complex tasks into smaller, trackable items.',
    'Each task gets a unique ID for later updates.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Task title (brief, actionable, imperative form e.g. "Fix auth bug")',
      },
      description: {
        type: 'string',
        description: 'Detailed description (optional)',
      },
      activeForm: {
        type: 'string',
        description: 'Present continuous form shown while in_progress (e.g. "Fixing auth bug")',
      },
      owner: {
        type: 'string',
        description: 'Task owner (agent name, optional)',
      },
      metadata: {
        type: 'object',
        description: 'Extra metadata (optional)',
      },
    },
    required: ['title'],
  };

  readonly readonly = false;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const title = input.title as string;
    if (!title?.trim()) {
      return this.error('title 不能为空');
    }

    try {
      const manager = getTodoManager();
      const todo = await manager.create({
        title: title.trim(),
        description: input.description as string | undefined,
        metadata: input.metadata as Record<string, unknown> | undefined,
        owner: input.owner as string | undefined,
        activeForm: input.activeForm as string | undefined,
      });

      return this.success(JSON.stringify(todo, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`创建任务失败: ${msg}`);
    }
  }
}
