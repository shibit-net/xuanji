// ============================================================
// M6 工具系统 — TaskOutputTool 查询后台任务结果
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { BackgroundTaskManager } from './BackgroundTaskManager';
import { middleTruncate, MAX_TOOL_OUTPUT_LENGTH } from '@/shared/utils/truncation';

/**
 * 查询后台任务结果的工具
 */
export class TaskOutputTool extends BaseTool {
  readonly name = 'task_output';
  readonly description = 'Query the output of a background task. Can block until completion or return current status immediately.';
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Background task ID (returned by bash tool run_in_background)',
      },
      block: {
        type: 'boolean',
        description: 'Whether to wait for task completion (default true)',
        default: true,
      },
      timeout: {
        type: 'number',
        description: 'Max wait time in milliseconds (default 30000)',
        default: 30000,
      },
    },
    required: ['task_id'],
  };

  /** 只读工具，可并行执行 */
  override readonly readonly: boolean = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const taskId = input.task_id as string;
    const block = (input.block as boolean | undefined) ?? true;
    const timeout = (input.timeout as number | undefined) ?? 30_000;

    try {
      const manager = BackgroundTaskManager.getInstance();
      const result = await manager.getResult(taskId, block, timeout);

      let output = '';
      output += `任务: ${result.taskId}\n`;
      output += `状态: ${result.status}\n`;
      output += `命令: ${result.command}\n`;

      if (result.exitCode !== undefined) {
        output += `退出码: ${result.exitCode}\n`;
      }

      if (result.completedAt) {
        const duration = result.completedAt - result.startedAt;
        output += `耗时: ${(duration / 1000).toFixed(1)}s\n`;
      }

      output += '\n';

      if (result.stdout) {
        output += result.stdout;
      }
      if (result.stderr) {
        output += (output.endsWith('\n') ? '' : '\n') + `[stderr]\n${result.stderr}`;
      }

      // 截断过长输出
      output = middleTruncate(output, MAX_TOOL_OUTPUT_LENGTH);

      if (result.status === 'failed' || result.status === 'timeout') {
        return this.error(output, { taskId, status: result.status, exitCode: result.exitCode });
      }

      return this.success(output, { taskId, status: result.status, exitCode: result.exitCode });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`查询任务失败: ${message}`);
    }
  }
}
