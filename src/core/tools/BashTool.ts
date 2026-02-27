// ============================================================
// M6 工具系统 — BashTool 执行命令
// ============================================================

import { spawn } from 'node:child_process';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { BackgroundTaskManager } from './BackgroundTaskManager';
import { getSharedShell } from './PersistentShell';
import { middleTruncate, MAX_TOOL_OUTPUT_LENGTH } from '@/core/utils/truncation';

/** 默认命令超时 (ms) */
const DEFAULT_TIMEOUT = 120_000;

/**
 * Bash 命令执行工具
 *
 * 前台命令使用持久化 Shell（cwd/环境变量跨调用保持），
 * 后台命令使用 BackgroundTaskManager（独立子进程）。
 */
export class BashTool extends BaseTool {
  readonly name = 'bash';
  readonly description = [
    '在 shell 中执行 bash 命令。',
    '工作目录在多次调用间保持（cd 效果持久）。',
    '环境变量也会跨调用保持。',
    '支持后台运行长时间任务（run_in_background）。',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 bash 命令',
      },
      timeout: {
        type: 'number',
        description: `超时时间 (毫秒)，默认 ${DEFAULT_TIMEOUT}ms，最大 600000ms`,
      },
      description: {
        type: 'string',
        description: '命令描述（用于权限确认 UI 展示），简要说明命令的意图',
      },
      run_in_background: {
        type: 'boolean',
        description: '是否在后台运行（默认 false）。后台任务立即返回 task_id，通过 task_output 工具查询结果。适用于长时间运行的命令（如 npm test、构建等）。',
        default: false,
      },
    },
    required: ['command'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = Math.min(
      (input.timeout as number | undefined) ?? DEFAULT_TIMEOUT,
      600_000,
    );
    const runInBackground = (input.run_in_background as boolean | undefined) ?? false;
    // description 参数仅用于权限确认 UI，不影响执行逻辑

    try {
      // 后台执行模式（独立子进程）
      if (runInBackground) {
        const manager = BackgroundTaskManager.getInstance();
        const result = manager.startTask(command);

        if (result.status === 'failed') {
          return this.error(result.stderr ?? '启动后台任务失败');
        }

        return this.success(
          `后台任务已启动\n任务 ID: ${result.taskId}\n命令: ${command}\n\n使用 task_output 工具查询结果: task_output({ task_id: "${result.taskId}" })`,
          { taskId: result.taskId, status: 'running' },
        );
      }

      // 前台同步执行：使用持久化 Shell
      const shell = getSharedShell();
      const result = await shell.execute(command, timeout);

      // 合并 stdout 和 stderr
      let output = '';
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? '\n' : '') + `[stderr]\n${result.stderr}`;

      // 中间截断过长输出
      output = middleTruncate(output, MAX_TOOL_OUTPUT_LENGTH);

      if (result.exitCode !== 0) {
        return this.error(`命令退出码: ${result.exitCode}\n${output}`, { exitCode: result.exitCode });
      }

      return this.success(output || '(无输出)', { exitCode: result.exitCode });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`执行命令失败: ${message}`);
    }
  }
}
