// ============================================================
// TodoArchiveTool — Archive completed tasks
// ============================================================

import type { Tool, ToolResult, JSONSchema } from '@/infrastructure/core-types';
import { getTodoManager } from './TodoManager';

export interface TodoArchiveInput {
  /** Archive strategy: 'completed' archives all completed, 'auto' auto-archives tasks exceeding threshold */
  strategy?: 'completed' | 'auto';
  /** Auto-archive threshold in hours, default 24 */
  thresholdHours?: number;
}

/**
 * TodoArchiveTool — Archive completed tasks
 *
 * Use cases:
 * - LLM detects task list is too long and proactively archives
 * - User explicitly requests cleaning up completed tasks
 * - Periodic auto-archive (via cron or background task)
 */
export class TodoArchiveTool implements Tool {
  name = 'todo_archive';
  description = `Archive completed tasks, preserving records but removing them from the active list.

Use cases:
- Task list is too long, affecting readability
- Periodic cleanup of completed tasks
- User explicitly requests cleaning up old tasks

Parameters:
- strategy: 'completed' archives all completed tasks, 'auto' only archives tasks exceeding threshold (default 'auto')
- thresholdHours: Auto-archive threshold in hours (default 24)

Examples:
- Archive all completed tasks: {"strategy": "completed"}
- Archive tasks completed 24 hours ago: {"strategy": "auto", "thresholdHours": 24}
- Archive tasks completed 1 hour ago: {"strategy": "auto", "thresholdHours": 1}`;

  input_schema: JSONSchema = {
    type: 'object',
    properties: {
      strategy: {
        type: 'string',
        enum: ['completed', 'auto'],
        description: 'Archive strategy',
      },
      thresholdHours: {
        type: 'number',
        description: 'Auto-archive threshold (hours)',
      },
    },
  };

  readonly = true;

  async execute(input: TodoArchiveInput): Promise<ToolResult> {
    const todoManager = getTodoManager();
    const strategy = input.strategy || 'auto';
    const thresholdHours = input.thresholdHours || 24;

    try {
      let archivedCount: number;

      if (strategy === 'completed') {
        archivedCount = await todoManager.archiveCompleted();
      } else {
        archivedCount = await todoManager.autoArchive(thresholdHours);
      }

      const archivedTotal = await todoManager.getArchivedCount();

      return {
        content: `Archived ${archivedCount} tasks

Archive strategy: ${strategy === 'completed' ? 'all completed tasks' : `tasks completed ${thresholdHours} hours ago`}
Total archived: ${archivedTotal} tasks

Archived tasks saved to .xuanji/todos-archive.jsonl, query history anytime.`,
        isError: false,
      };
    } catch (err) {
      return {
        content: `Archive failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}
