// ============================================================
// AgentLoop Log Adapter - AgentLoop 日志适配器
// ============================================================
// 作用：
// - 将 AgentLoop 的事件转换成统一日志格式
// - 自动把日志推送到 UnifiedLogManager
// - 保持向后兼容，不破坏现有功能
// ============================================================

import type { UnifiedLogManager } from './UnifiedLogManager';
import type { AgentLoopLogger } from '../telemetry/AgentLoopLogger';
import { getUnifiedLogManager } from './UnifiedLogManager';

/**
 * AgentLoop 事件类型（从 AgentLoopLogger 推断）
 */
export type AgentLoopEventType = 
  | 'iteration_start'
  | 'iteration_end'
  | 'llm_request'
  | 'llm_response'
  | 'tool_call'
  | 'tool_result'
  | 'error_caught'
  | 'interrupt'
  | 'llm_retry'
  | 'error_recovery'
  | 'session_complete'
  | string;

/**
 * AgentLoop 日志记录
 */
interface AgentLoopLogRecord {
  timestamp: string;
  eventType: AgentLoopEventType;
  sessionId?: string;
  iteration?: number;
  data?: Record<string, unknown>;
}

/**
 * AgentLoop 日志适配器
 */
export class AgentLoopLogAdapter {
  private manager: UnifiedLogManager;
  private originalLogger: AgentLoopLogger | null = null;
  private isWrapping: boolean = false;

  constructor(manager?: UnifiedLogManager) {
    this.manager = manager || getUnifiedLogManager();
  }

  /**
   * 包装现有的 AgentLoopLogger
   * @deprecated AgentLoopLogger 不再有 record 方法，此方法已废弃
   */
  wrap(originalLogger: AgentLoopLogger) {
    if (this.isWrapping) return this;

    this.originalLogger = originalLogger;
    this.isWrapping = true;

    // TODO: 需要重新实现包装逻辑，因为 AgentLoopLogger 使用具体的方法而不是通用的 record 方法

    return this;
  }

  /**
   * 记录到统一日志系统
   */
  private recordUnifiedLog(
    eventType: AgentLoopEventType,
    data?: Record<string, unknown>
  ) {
    const level = this.inferLevel(eventType);
    const message = this.formatMessage(eventType, data);

    this.manager.addLog({
      timestamp: new Date().toISOString(),
      source: 'agentloop',
      level,
      message,
      namespace: 'agentloop',
      data: { eventType, ...data },
    });
  }

  /**
   * 根据事件类型推断日志级别
   */
  private inferLevel(eventType: AgentLoopEventType): string {
    const errorTypes = ['error_caught', 'interrupt'];
    const warnTypes = ['llm_retry', 'error_recovery'];
    const successTypes = ['session_complete', 'tool_result', 'iteration_end'];

    if (errorTypes.includes(eventType)) return 'error';
    if (warnTypes.includes(eventType)) return 'warn';
    if (successTypes.includes(eventType)) return 'success';
    return 'info';
  }

  /**
   * 格式化消息
   */
  private formatMessage(
    eventType: AgentLoopEventType,
    data?: Record<string, unknown>
  ): string {
    switch (eventType) {
      case 'iteration_start':
        return `🔄 开始第 ${data?.iteration || '?'} 轮迭代`;

      case 'iteration_end':
        return `✅ 第 ${data?.iteration || '?'} 轮迭代完成`;

      case 'llm_request':
        return `🤖 发送 LLM 请求${data?.model ? ` (${data.model})` : ''}`;

      case 'llm_response':
        return `💬 收到 LLM 响应${data?.tokens ? ` (${data.tokens} tokens)` : ''}`;

      case 'tool_call':
        return `🔧 调用工具${data?.toolName ? `: ${data.toolName}` : ''}`;

      case 'tool_result':
        return `✅ 工具执行完成${data?.toolName ? `: ${data.toolName}` : ''}`;

      case 'error_caught':
        return `❌ 错误: ${data?.error || '未知错误'}`;

      case 'interrupt':
        return `⏹️ 任务被中断`;

      case 'llm_retry':
        return `🔄 LLM 请求重试${data?.attempt ? ` (第 ${data.attempt} 次)` : ''}`;

      case 'error_recovery':
        return `🛡️ 尝试从错误中恢复`;

      case 'session_complete':
        return `🎉 会话完成${data?.iterations ? ` (共 ${data.iterations} 轮)` : ''}`;

      default:
        return `[${eventType}] ${data ? JSON.stringify(data).slice(0, 100) : ''}`;
    }
  }

  /**
   * 手动记录一条 AgentLoop 日志
   */
  log(
    eventType: AgentLoopEventType,
    message: string,
    data?: Record<string, unknown>
  ) {
    const level = this.inferLevel(eventType);

    this.manager.addLog({
      timestamp: new Date().toISOString(),
      source: 'agentloop',
      level,
      message,
      namespace: 'agentloop',
      data: { eventType, ...data },
    });
  }
}

// ========== 全局便捷函数 ==========

let globalAdapter: AgentLoopLogAdapter | null = null;

/**
 * 获取全局 AgentLoop 日志适配器
 */
export function getAgentLoopLogAdapter(): AgentLoopLogAdapter {
  if (!globalAdapter) {
    globalAdapter = new AgentLoopLogAdapter();
  }
  return globalAdapter;
}

/**
 * 快速记录 AgentLoop 事件
 */
export function logAgentLoop(
  eventType: AgentLoopEventType,
  message: string,
  data?: Record<string, unknown>
) {
  const adapter = getAgentLoopLogAdapter();
  adapter.log(eventType, message, data);
}

/**
 * 便捷函数：记录 AgentLoop 开始
 */
export function logAgentLoopStart(iteration: number, model?: string) {
  logAgentLoop('iteration_start', `🔄 开始第 ${iteration} 轮迭代${model ? ` (${model})` : ''}`, {
    iteration,
    model,
  });
}

/**
 * 便捷函数：记录 AgentLoop 结束
 */
export function logAgentLoopEnd(iteration: number, stats?: Record<string, unknown>) {
  logAgentLoop('iteration_end', `✅ 第 ${iteration} 轮迭代完成`, {
    iteration,
    ...stats,
  });
}

/**
 * 便捷函数：记录工具调用
 */
export function logAgentLoopToolCall(
  toolName: string,
  input?: Record<string, unknown>
) {
  logAgentLoop('tool_call', `🔧 调用工具: ${toolName}`, {
    toolName,
    input,
  });
}

/**
 * 便捷函数：记录工具结果
 */
export function logAgentLoopToolResult(
  toolName: string,
  success: boolean = true,
  output?: unknown
) {
  logAgentLoop('tool_result', `${success ? '✅' : '❌'} 工具 ${toolName} 执行完成`, {
    toolName,
    success,
    output,
  });
}

/**
 * 便捷函数：记录错误
 */
export function logAgentLoopError(error: Error | string) {
  const message = error instanceof Error ? error.message : error;
  logAgentLoop('error_caught', `❌ 错误: ${message}`, {
    error: message,
  });
}

export default AgentLoopLogAdapter;
