/**
 * Command Handler — 执行 shell 脚本
 *
 * 功能:
 * - 执行用户配置的 shell 脚本
 * - 注入环境变量（TOOL_NAME, TOOL_INPUT, ERROR_MESSAGE 等）
 * - 超时保护
 * - 非零退出码视为阻塞（仅对同步事件有效）
 */

import { exec } from 'child_process';
import type {
  CommandHookHandler,
  HookEventContext,
  HookHandlerResult,
} from '../types.js';

/**
 * 执行 Command Hook Handler
 */
export async function executeCommandHandler(
  handler: CommandHookHandler,
  context: HookEventContext,
): Promise<HookHandlerResult> {
  const startTime = Date.now();
  const timeout = handler.timeout ?? 5000;

  // 构建环境变量
  const env = buildEnvVars(context);

  // 不再做脚本内 ${VAR} 插值（防止命令注入），仅通过环境变量传递数据
  const script = handler.script;

  return new Promise((resolve) => {
    const child = exec(
      script,
      {
        timeout,
        env: { ...process.env, ...env },
        shell: '/bin/sh',
        maxBuffer: 1024 * 1024, // 1MB
      },
      (error, stdout, stderr) => {
        clearTimeout(fallbackTimer);
        const duration = Date.now() - startTime;

        if (error) {
          // 超时
          if (error.killed) {
            resolve({
              success: false,
              exitCode: -1,
              stdout: stdout?.toString() ?? '',
              stderr: stderr?.toString() ?? '',
              error: `Command timed out after ${timeout}ms`,
              duration,
              blocked: true,
            });
            return;
          }

          // 非零退出码
          resolve({
            success: false,
            exitCode: error.code ?? 1,
            stdout: stdout?.toString() ?? '',
            stderr: stderr?.toString() ?? '',
            error: stderr?.toString().trim() || error.message,
            duration,
            blocked: true,
          });
          return;
        }

        resolve({
          success: true,
          exitCode: 0,
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          duration,
          blocked: false,
          ...parseJsonOutput(stdout?.toString() ?? ''),
        });
      },
    );

    // 超时兜底（exec 自带 timeout，但加一层保护）
    const fallbackTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }, timeout + 1000);
  });
}

/**
 * 从事件上下文构建环境变量
 */
function buildEnvVars(context: HookEventContext): Record<string, string> {
  const env: Record<string, string> = {
    HOOK_EVENT: context.event,
    HOOK_TIMESTAMP: String(context.timestamp),
  };

  if (context.toolName) env.TOOL_NAME = context.toolName;
  if (context.toolInput) env.TOOL_INPUT = JSON.stringify(context.toolInput);
  if (context.toolResult) env.TOOL_RESULT = context.toolResult.slice(0, 10000);
  if (context.toolIsError !== undefined) env.TOOL_IS_ERROR = String(context.toolIsError);
  if (context.toolDuration !== undefined) env.TOOL_DURATION = String(context.toolDuration);
  if (context.errorMessage) env.ERROR_MESSAGE = context.errorMessage;
  if (context.errorStack) env.ERROR_STACK = context.errorStack;
  if (context.originalTokens !== undefined) env.ORIGINAL_TOKENS = String(context.originalTokens);
  if (context.compressedTokens !== undefined) env.COMPRESSED_TOKENS = String(context.compressedTokens);
  if (context.sessionId) env.SESSION_ID = context.sessionId;
  if (context.checkpointId) env.CHECKPOINT_ID = context.checkpointId;
  if (context.checkpointLabel) env.CHECKPOINT_LABEL = context.checkpointLabel;
  if (context.subAgentId) env.SUBAGENT_ID = context.subAgentId;
  if (context.memoryContent) env.MEMORY_CONTENT = context.memoryContent.slice(0, 10000);

  return env;
}

/**
 * 尝试从 stdout 解析 JSON 输出
 *
 * Hook 脚本可以输出 JSON 对象来控制工具行为:
 * - blocked: boolean — 是否阻塞工具执行
 * - modifiedInput: object — 修改后的工具输入参数
 * - replaceTool: string — 替换工具名称
 * - mockResult: { content, isError?, metadata? } — 模拟工具结果
 *
 * 非 JSON 输出或解析失败时返回空对象（不影响正常执行）。
 */
function parseJsonOutput(stdout: string): Partial<HookHandlerResult> {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const result: Partial<HookHandlerResult> = {};

    // blocked 覆盖
    if (typeof parsed.blocked === 'boolean') {
      result.blocked = parsed.blocked;
    }

    // 修改工具输入
    if (parsed.modifiedInput && typeof parsed.modifiedInput === 'object' && !Array.isArray(parsed.modifiedInput)) {
      result.modifiedInput = parsed.modifiedInput as Record<string, unknown>;
    }

    // 替换工具名称
    if (typeof parsed.replaceTool === 'string' && parsed.replaceTool.length > 0) {
      result.replaceTool = parsed.replaceTool;
    }

    // 模拟工具结果
    if (parsed.mockResult && typeof parsed.mockResult === 'object' && typeof parsed.mockResult.content === 'string') {
      result.mockResult = {
        content: parsed.mockResult.content,
        isError: typeof parsed.mockResult.isError === 'boolean' ? parsed.mockResult.isError : false,
        metadata: parsed.mockResult.metadata,
      };
    }

    return result;
  } catch {
    // JSON 解析失败，静默忽略
    return {};
  }
}
