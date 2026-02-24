// ============================================================
// M6 工具系统 — BashTool 执行命令
// ============================================================

import { spawn } from 'node:child_process';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { middleTruncate, MAX_TOOL_OUTPUT_LENGTH } from '@/core/utils/truncation';

/** 默认命令超时 (ms) */
const DEFAULT_TIMEOUT = 120_000;

/**
 * Bash 命令执行工具
 */
export class BashTool extends BaseTool {
  readonly name = 'bash';
  readonly description = '在 shell 中执行 bash 命令。工作目录默认为当前项目根目录。';
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 bash 命令',
      },
      timeout: {
        type: 'number',
        description: `超时时间 (毫秒)，默认 ${DEFAULT_TIMEOUT}ms`,
      },
    },
    required: ['command'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number | undefined) ?? DEFAULT_TIMEOUT;

    try {
      const result = await this.runCommand(command, timeout);

      // 中间截断过长输出（保留头部和尾部，删除中间）
      let output = result.output;
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

  private runCommand(command: string, timeout: number): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('bash', ['-c', command], {
        cwd: process.cwd(),
        env: { ...process.env },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`命令超时 (${timeout}ms)`));
      }, timeout);

      proc.on('close', (exitCode) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');

        let output = '';
        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n' : '') + `[stderr]\n${stderr}`;

        resolve({ output, exitCode: exitCode ?? 1 });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
