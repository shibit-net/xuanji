// ============================================================
// M6 工具系统 — Todo 工具集（合并自 TodoStorageTool/TodoListTool/TodoUpdateTool）
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

// ─── todo_create ────────────────────────────────────────────

export class TodoCreateTool extends BaseTool {
  readonly name = 'todo_create';
  readonly description = [
    'Create a new todo task to track progress on multi-step work.',
    '',
    '⚠️ BEFORE creating tasks: Check if there are old completed tasks from previous work.',
    'If yes, call todo_list first to check, then call todo_clear to clean up before creating new tasks.',
    '',
    'Use this to organize complex tasks into smaller, trackable items.',
    'Each task gets a unique ID for later updates.',
    '',
    'Best practice:',
    '1. Call todo_list to check existing tasks',
    '2. If old tasks exist and are completed, call todo_clear',
    '3. Then create new tasks for current work',
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

  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const title = input.title as string;
    if (!title?.trim()) return this.error('title 不能为空');

    try {
      const manager = getTodoManager();
      const todo = await manager.create({
        title: title.trim(),
        description: input.description as string | undefined,
        metadata: input.metadata as Record<string, unknown> | undefined,
        owner: input.owner as string | undefined,
        activeForm: input.activeForm as string | undefined,
      });
      return this.success(`✅ 已创建: ${todo.title} (${todo.id})${manager.formatProgress()}`);
    } catch (err) {
      return this.error(`创建任务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ─── todo_list ──────────────────────────────────────────────

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
        const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
        let line = `${icon} [${t.id}] ${t.title} (${t.status})`;
        if (t.owner) line += ` [owner: ${t.owner}]`;
        const blockedBy = t.blockedBy ?? [];
        if (blockedBy.length > 0) line += ` ⛔ blockedBy: ${blockedBy.join(', ')}`;
        if (t.blocks && t.blocks.length > 0) line += ` → blocks: ${t.blocks.join(', ')}`;
        return line;
      });

      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`列出任务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ─── todo_update ────────────────────────────────────────────

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
      id: { type: 'string', description: 'Task ID (e.g. "todo-001")' },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed'],
        description: 'New status (optional)',
      },
      title: { type: 'string', description: 'New title (optional)' },
      description: { type: 'string', description: 'New description (optional)' },
      activeForm: {
        type: 'string',
        description: 'Present continuous form shown while in_progress (optional)',
      },
      owner: { type: 'string', description: 'Task owner (agent name, optional)' },
      addBlocks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that this task blocks',
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
    if (!id?.trim()) return this.error('id 不能为空');

    try {
      const manager = getTodoManager();
      const updates: Parameters<TodoManager['update']>[1] = {};

      if (input.status) updates.status = input.status as 'pending' | 'in_progress' | 'completed';
      if (input.title) updates.title = input.title as string;
      if (input.description !== undefined) updates.description = input.description as string;
      if (input.owner !== undefined) updates.owner = input.owner as string;
      if (input.activeForm !== undefined) updates.activeForm = input.activeForm as string;
      if (input.addBlocks) updates.addBlocks = input.addBlocks as string[];
      if (input.addBlockedBy) updates.addBlockedBy = input.addBlockedBy as string[];

      const todo = await manager.update(id, updates);

      // 任务完成时保存到记忆
      if (updates.status === 'completed') {
        // TODO: MemoryStoreTool 已移除，需要重新实现记忆功能
        /*
        try {
          const { MemoryStoreTool } = await import('./MemoryStoreTool.js');
          const memoryStore = new MemoryStoreTool();
          await memoryStore.execute({
            content: `完成任务：${todo.title}${todo.description ? ` - ${todo.description}` : ''}`,
            type: 'task_completion',
            tags: ['task', 'completed'],
            metadata: {
              taskId: todo.id,
              description: todo.description,
              completedAt: new Date().toISOString(),
            },
          });
        } catch {
          // 记忆保存失败不影响任务更新
        }
        */
      }

      const action =
        updates.status === 'completed' ? '✅ 已完成' :
        updates.status === 'in_progress' ? '🔄 开始执行' : '📝 已更新';
      return this.success(`${action}: ${todo.title} (${todo.id})${manager.formatProgress()}`);
    } catch (err) {
      return this.error(`更新任务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ─── todo_clear ─────────────────────────────────────────────

export class TodoClearTool extends BaseTool {
  readonly name = 'todo_clear';
  readonly description = [
    'Clear all todo tasks and start fresh.',
    '',
    '⚠️ IMPORTANT: You MUST call this tool BEFORE creating new todos if:',
    '1. User starts a completely new, unrelated task',
    '2. All previous tasks are completed and user asks for something new',
    '3. User explicitly asks to clear/reset the task list',
    '',
    'Example workflow:',
    '- User: "Help me refactor the auth module" → creates Task 1-4',
    '- Tasks 1-4 completed',
    '- User: "Now help me write tests" → CALL todo_clear FIRST, then create new tasks',
    '',
    'Why: Without clearing, old completed tasks will clutter the UI and confuse the user.',
    '',
    'When NOT to clear:',
    '- User is continuing work on existing tasks',
    '- User asks to add more tasks to current work',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {},
  };

  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const manager = getTodoManager();
      const oldCount = Array.from(manager['todos'].values()).length;
      await manager.startTurn();
      return this.success(`✅ 已清空 ${oldCount} 个旧任务，可以创建新任务了`);
    } catch (err) {
      return this.error(`清空任务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
