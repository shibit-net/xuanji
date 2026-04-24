// ============================================================
// TodoArchiveTool — 归档已完成任务
// ============================================================

import type { Tool, ToolResult, JSONSchema } from '@/core/types';
import { getTodoManager } from './TodoManager';

export interface TodoArchiveInput {
  /** 归档策略：'completed' 归档所有已完成，'auto' 自动归档超过阈值的任务 */
  strategy?: 'completed' | 'auto';
  /** 自动归档阈值（小时），默认 24 小时 */
  thresholdHours?: number;
}

/**
 * TodoArchiveTool — 归档已完成任务
 *
 * 用途：
 * - LLM 检测到任务列表过长时主动归档
 * - 用户显式请求清理已完成任务
 * - 定期自动归档（通过 cron 或后台任务）
 */
export class TodoArchiveTool implements Tool {
  name = 'todo_archive';
  description = `归档已完成的任务，保留记录但不再显示在活跃列表中。

使用场景：
- 任务列表过长，影响可读性
- 定期清理已完成任务
- 用户明确表示要清理旧任务

参数：
- strategy: 'completed' 归档所有已完成任务，'auto' 仅归档超过阈值的任务（默认 'auto'）
- thresholdHours: 自动归档阈值（小时），默认 24 小时

示例：
- 归档所有已完成任务：{"strategy": "completed"}
- 归档 24 小时前完成的任务：{"strategy": "auto", "thresholdHours": 24}
- 归档 1 小时前完成的任务：{"strategy": "auto", "thresholdHours": 1}`;

  input_schema: JSONSchema = {
    type: 'object',
    properties: {
      strategy: {
        type: 'string',
        enum: ['completed', 'auto'],
        description: '归档策略',
      },
      thresholdHours: {
        type: 'number',
        description: '自动归档阈值（小时）',
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
        content: `✅ 已归档 ${archivedCount} 个任务

归档策略：${strategy === 'completed' ? '所有已完成任务' : `${thresholdHours} 小时前完成的任务`}
归档总数：${archivedTotal} 个任务

归档的任务已保存到 .xuanji/todos-archive.jsonl，可随时查询历史记录。`,
        isError: false,
      };
    } catch (err) {
      return {
        content: `归档失败: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}
