/**
 * SubAgentHooks — 子代理专属 Hook 事件
 *
 * 封装子代理生命周期中的 Hook 触发逻辑:
 * - SubAgentToolUse: 子代理每次工具调用后触发
 * - 统一的 subAgentId 和 depth 上下文
 */

import type { HookRegistry } from '@/hooks/HookRegistry';

/**
 * 子代理 Hook 上下文
 */
export interface SubAgentHookContext {
  hookRegistry: HookRegistry;
  subAgentId: string;
  depth: number;
  task: string;
}

/**
 * 触发 SubAgentToolUse Hook
 *
 * 在子代理执行工具后调用，记录工具使用信息
 */
export function emitSubAgentToolUse(
  ctx: SubAgentHookContext,
  toolInfo: {
    toolName: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    toolIsError?: boolean;
    toolDuration?: number;
  },
): void {
  ctx.hookRegistry.emit('SubAgentToolUse', {
    subAgentId: ctx.subAgentId,
    toolName: toolInfo.toolName,
    toolInput: toolInfo.toolInput,
    toolResult: toolInfo.toolResult?.slice(0, 2000),
    toolIsError: toolInfo.toolIsError,
    toolDuration: toolInfo.toolDuration,
    data: {
      task: ctx.task,
      depth: ctx.depth,
    },
  }).catch(() => {});
}

/**
 * 创建子代理 AgentLoop 的 PostToolUse 回调
 *
 * 监听子代理 AgentLoop 的 PostToolUse 事件，
 * 转发为 SubAgentToolUse 事件
 */
export function createSubAgentToolUseHook(
  ctx: SubAgentHookContext,
): (toolName: string, toolInput: Record<string, unknown>, toolResult: string, isError: boolean, duration: number) => void {
  return (toolName, toolInput, toolResult, isError, duration) => {
    emitSubAgentToolUse(ctx, {
      toolName,
      toolInput,
      toolResult,
      toolIsError: isError,
      toolDuration: duration,
    });
  };
}
