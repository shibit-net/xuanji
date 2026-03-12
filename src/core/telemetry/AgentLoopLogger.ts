// ============================================================
// M10 遥测 — AgentLoop 执行日志
// ============================================================
//
// 记录 AgentLoop 执行过程中的所有关键事件到 JSONL 文件：
// - 迭代开始/结束
// - 消息准备（追加、压缩）
// - LLM 调用（请求/响应）
// - 工具执行（分组/调用/结果）
// - 异常处理（错误/重试/恢复）
// - 性能指标（耗时/tokens）
//
// 特性:
// - 异步追加写入，不阻塞主流程
// - 结构化 JSON 日志，便于分析
// - 敏感数据自动脱敏
// - 支持按 sessionId/迭代/事件类型查询
//

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { TokenUsage, ToolCall, Message } from '@/core/types';

// ── 事件类型定义 ──

/** AgentLoop 事件类型 */
export type AgentLoopEventType =
  | 'iteration_start'      // 迭代开始
  | 'iteration_end'        // 迭代结束
  | 'message_append'       // 用户追加消息
  | 'context_compress'     // 上下文压缩
  | 'llm_request'          // LLM 请求
  | 'llm_response'         // LLM 响应
  | 'llm_retry'            // LLM 重试
  | 'tool_group'           // 工具分组
  | 'tool_execute'         // 工具执行
  | 'tool_result'          // 工具结果
  | 'error_caught'         // 异常捕获
  | 'error_recovery'       // 错误恢复
  | 'interrupt'            // 用户中断
  | 'session_complete';    // 会话完成

/** 基础日志记录 */
export interface AgentLoopLogBase {
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 事件类型 */
  eventType: AgentLoopEventType;
  /** 会话 ID */
  sessionId: string;
  /** 当前迭代次数 */
  iteration: number;
  /** 模型名称 */
  model?: string;
}

/** 迭代开始日志 */
export interface IterationStartLog extends AgentLoopLogBase {
  eventType: 'iteration_start';
  /** 最大迭代次数 */
  maxIterations: number;
  /** 消息总数 */
  messageCount: number;
  /** 是否有待追加消息 */
  hasPendingAppend: boolean;
}

/** 迭代结束日志 */
export interface IterationEndLog extends AgentLoopLogBase {
  eventType: 'iteration_end';
  /** 停止原因 */
  stopReason: string;
  /** 工具调用数量 */
  toolCallCount: number;
  /** 迭代耗时 (ms) */
  durationMs: number;
}

/** 消息追加日志 */
export interface MessageAppendLog extends AgentLoopLogBase {
  eventType: 'message_append';
  /** 追加的消息 (脱敏) */
  message: string;
  /** 是否硬中断 */
  interrupted: boolean;
  /** 延迟时间 (ms) */
  delayMs?: number;
}

/** 上下文压缩日志 */
export interface ContextCompressLog extends AgentLoopLogBase {
  eventType: 'context_compress';
  /** 压缩前 token 数 */
  originalTokens: number;
  /** 压缩后 token 数 */
  compressedTokens: number;
  /** 压缩率 */
  compressionRatio: number;
  /** 压缩耗时 (ms) */
  durationMs: number;
}

/** LLM 请求日志 */
export interface LLMRequestLog extends AgentLoopLogBase {
  eventType: 'llm_request';
  /** 消息数量 */
  messageCount: number;
  /** 工具数量 */
  toolCount: number;
  /** 预估输入 tokens */
  estimatedInputTokens?: number;
  /** 最大输出 tokens */
  maxTokens?: number;
  /** 请求参数摘要 */
  requestParams: {
    temperature?: number;
    topP?: number;
    hasThinking?: boolean;
  };
}

/** LLM 响应日志 */
export interface LLMResponseLog extends AgentLoopLogBase {
  eventType: 'llm_response';
  /** 停止原因 */
  stopReason: string;
  /** 内容块数量 */
  contentBlockCount: number;
  /** 工具调用数量 */
  toolCallCount: number;
  /** Token 使用统计 */
  usage: TokenUsage;
  /** 响应耗时 (ms) */
  durationMs: number;
  /** 流式事件统计 */
  streamStats?: {
    totalEvents: number;
    textDeltaCount: number;
    toolUseCount: number;
    thinkingDeltaCount?: number;
  };
}

/** LLM 重试日志 */
export interface LLMRetryLog extends AgentLoopLogBase {
  eventType: 'llm_retry';
  /** 重试次数 */
  retryCount: number;
  /** 重试原因 */
  reason: string;
  /** 错误类型 */
  errorType?: string;
  /** 错误消息 (脱敏) */
  errorMessage?: string;
  /** 下次重试延迟 (ms) */
  delayMs?: number;
}

/** 工具分组日志 */
export interface ToolGroupLog extends AgentLoopLogBase {
  eventType: 'tool_group';
  /** 并行工具 ID 列表 */
  parallelIds: string[];
  /** 串行工具 ID 列表 */
  serialIds: string[];
  /** 总工具数 */
  totalTools: number;
}

/** 工具执行日志 */
export interface ToolExecuteLog extends AgentLoopLogBase {
  eventType: 'tool_execute';
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具输入 (脱敏) */
  input: Record<string, unknown>;
  /** 是否并行执行 */
  isParallel: boolean;
}

/** 工具结果日志 */
export interface ToolResultLog extends AgentLoopLogBase {
  eventType: 'tool_result';
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 是否成功 */
  success: boolean;
  /** 错误消息 (如果失败) */
  errorMessage?: string;
  /** 结果长度 (字符数) */
  resultLength: number;
  /** 执行耗时 (ms) */
  durationMs: number;
}

/** 异常捕获日志 */
export interface ErrorCaughtLog extends AgentLoopLogBase {
  eventType: 'error_caught';
  /** 错误名称 */
  errorName: string;
  /** 错误消息 */
  errorMessage: string;
  /** 错误堆栈 */
  errorStack?: string;
  /** 错误上下文快照 */
  context: {
    running: boolean;
    messageCount: number;
    pendingAppend: boolean;
    interrupted: boolean;
    lastStopReason?: string;
  };
  /** 是否可恢复 */
  recoverable: boolean;
}

/** 错误恢复日志 */
export interface ErrorRecoveryLog extends AgentLoopLogBase {
  eventType: 'error_recovery';
  /** 原始错误类型 */
  originalError: string;
  /** 恢复策略 */
  recoveryStrategy: string;
  /** 是否恢复成功 */
  success: boolean;
  /** 恢复耗时 (ms) */
  durationMs?: number;
}

/** 用户中断日志 */
export interface InterruptLog extends AgentLoopLogBase {
  eventType: 'interrupt';
  /** 中断原因 */
  reason: 'user_stop' | 'user_interrupt' | 'max_iterations';
  /** 补充消息 (如果有) */
  appendMessage?: string;
  /** 当前流式输出状态 */
  streamActive: boolean;
  /** 正在执行的工具 */
  activeTools: string[];
}

/** 会话完成日志 */
export interface SessionCompleteLog extends AgentLoopLogBase {
  eventType: 'session_complete';
  /** 总迭代次数 */
  totalIterations: number;
  /** 总耗时 (ms) */
  totalDurationMs: number;
  /** Token 使用汇总 */
  totalUsage: TokenUsage;
  /** 总成本 (USD) */
  totalCost: number;
  /** 工具调用汇总 */
  toolStats: Array<{
    name: string;
    count: number;
    totalDurationMs: number;
    errorCount: number;
  }>;
  /** 完成状态 */
  status: 'completed' | 'stopped' | 'error' | 'max_iterations';
}

/** 联合类型 */
export type AgentLoopLog =
  | IterationStartLog
  | IterationEndLog
  | MessageAppendLog
  | ContextCompressLog
  | LLMRequestLog
  | LLMResponseLog
  | LLMRetryLog
  | ToolGroupLog
  | ToolExecuteLog
  | ToolResultLog
  | ErrorCaughtLog
  | ErrorRecoveryLog
  | InterruptLog
  | SessionCompleteLog;

/** 查询过滤器 */
export interface AgentLoopLogFilter {
  /** 会话 ID */
  sessionId?: string;
  /** 事件类型 */
  eventType?: AgentLoopEventType | AgentLoopEventType[];
  /** 迭代范围 */
  iterationRange?: { min?: number; max?: number };
  /** 时间范围 */
  timeRange?: { start?: string; end?: string };
  /** 是否仅查询错误 */
  errorsOnly?: boolean;
  /** 最大条数 */
  limit?: number;
}

// ── AgentLoopLogger 类 ──

/** 脱敏截断最大长度 */
const MAX_SANITIZE_LENGTH = 500;

/**
 * AgentLoopLogger — AgentLoop 执行日志记录器
 *
 * 将 AgentLoop 执行过程中的所有关键事件持久化到 JSONL 文件，
 * 支持查询、分析和调试。
 */
export class AgentLoopLogger {
  private filePath: string;
  private sessionId: string;
  private model: string;
  private startTime: number;

  constructor(
    sessionId: string,
    model: string,
    filePath?: string,
  ) {
    this.sessionId = sessionId;
    this.model = model;
    this.startTime = Date.now();
    this.filePath = filePath ?? join(homedir(), '.xuanji', 'logs', 'agent-loop.log');
  }

  // ── 日志记录方法 ──

  /** 记录迭代开始 */
  async logIterationStart(
    iteration: number,
    maxIterations: number,
    messageCount: number,
    hasPendingAppend: boolean,
  ): Promise<void> {
    const log: IterationStartLog = {
      timestamp: new Date().toISOString(),
      eventType: 'iteration_start',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      maxIterations,
      messageCount,
      hasPendingAppend,
    };
    await this.append(log);
  }

  /** 记录迭代结束 */
  async logIterationEnd(
    iteration: number,
    stopReason: string,
    toolCallCount: number,
    durationMs: number,
  ): Promise<void> {
    const log: IterationEndLog = {
      timestamp: new Date().toISOString(),
      eventType: 'iteration_end',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      stopReason,
      toolCallCount,
      durationMs,
    };
    await this.append(log);
  }

  /** 记录消息追加 */
  async logMessageAppend(
    iteration: number,
    message: string,
    interrupted: boolean,
    delayMs?: number,
  ): Promise<void> {
    const log: MessageAppendLog = {
      timestamp: new Date().toISOString(),
      eventType: 'message_append',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      message: this.sanitize(message),
      interrupted,
      delayMs,
    };
    await this.append(log);
  }

  /** 记录上下文压缩 */
  async logContextCompress(
    iteration: number,
    originalTokens: number,
    compressedTokens: number,
    compressionRatio: number,
    durationMs: number,
  ): Promise<void> {
    const log: ContextCompressLog = {
      timestamp: new Date().toISOString(),
      eventType: 'context_compress',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      originalTokens,
      compressedTokens,
      compressionRatio,
      durationMs,
    };
    await this.append(log);
  }

  /** 记录 LLM 请求 */
  async logLLMRequest(
    iteration: number,
    messageCount: number,
    toolCount: number,
    estimatedInputTokens?: number,
    maxTokens?: number,
    requestParams?: { temperature?: number; topP?: number; hasThinking?: boolean },
  ): Promise<void> {
    const log: LLMRequestLog = {
      timestamp: new Date().toISOString(),
      eventType: 'llm_request',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      messageCount,
      toolCount,
      estimatedInputTokens,
      maxTokens,
      requestParams: requestParams ?? {},
    };
    await this.append(log);
  }

  /** 记录 LLM 响应 */
  async logLLMResponse(
    iteration: number,
    stopReason: string,
    contentBlockCount: number,
    toolCallCount: number,
    usage: TokenUsage,
    durationMs: number,
    streamStats?: {
      totalEvents: number;
      textDeltaCount: number;
      toolUseCount: number;
      thinkingDeltaCount?: number;
    },
  ): Promise<void> {
    const log: LLMResponseLog = {
      timestamp: new Date().toISOString(),
      eventType: 'llm_response',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      stopReason,
      contentBlockCount,
      toolCallCount,
      usage,
      durationMs,
      streamStats,
    };
    await this.append(log);
  }

  /** 记录 LLM 重试 */
  async logLLMRetry(
    iteration: number,
    retryCount: number,
    reason: string,
    errorType?: string,
    errorMessage?: string,
    delayMs?: number,
  ): Promise<void> {
    const log: LLMRetryLog = {
      timestamp: new Date().toISOString(),
      eventType: 'llm_retry',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      retryCount,
      reason,
      errorType,
      errorMessage: errorMessage ? this.sanitize(errorMessage) : undefined,
      delayMs,
    };
    await this.append(log);
  }

  /** 记录工具分组 */
  async logToolGroup(
    iteration: number,
    parallelIds: string[],
    serialIds: string[],
  ): Promise<void> {
    const log: ToolGroupLog = {
      timestamp: new Date().toISOString(),
      eventType: 'tool_group',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      parallelIds,
      serialIds,
      totalTools: parallelIds.length + serialIds.length,
    };
    await this.append(log);
  }

  /** 记录工具执行 */
  async logToolExecute(
    iteration: number,
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    isParallel: boolean,
  ): Promise<void> {
    const log: ToolExecuteLog = {
      timestamp: new Date().toISOString(),
      eventType: 'tool_execute',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      toolCallId,
      toolName,
      input: this.sanitizeInput(input),
      isParallel,
    };
    await this.append(log);
  }

  /** 记录工具结果 */
  async logToolResult(
    iteration: number,
    toolCallId: string,
    toolName: string,
    success: boolean,
    resultLength: number,
    durationMs: number,
    errorMessage?: string,
  ): Promise<void> {
    const log: ToolResultLog = {
      timestamp: new Date().toISOString(),
      eventType: 'tool_result',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      toolCallId,
      toolName,
      success,
      errorMessage: errorMessage ? this.sanitize(errorMessage) : undefined,
      resultLength,
      durationMs,
    };
    await this.append(log);
  }

  /** 记录异常捕获 */
  async logErrorCaught(
    iteration: number,
    error: Error,
    context: {
      running: boolean;
      messageCount: number;
      pendingAppend: boolean;
      interrupted: boolean;
      lastStopReason?: string;
    },
    recoverable: boolean,
  ): Promise<void> {
    const log: ErrorCaughtLog = {
      timestamp: new Date().toISOString(),
      eventType: 'error_caught',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      errorName: error.name,
      errorMessage: this.sanitize(error.message),
      errorStack: error.stack,
      context,
      recoverable,
    };
    await this.append(log);
  }

  /** 记录错误恢复 */
  async logErrorRecovery(
    iteration: number,
    originalError: string,
    recoveryStrategy: string,
    success: boolean,
    durationMs?: number,
  ): Promise<void> {
    const log: ErrorRecoveryLog = {
      timestamp: new Date().toISOString(),
      eventType: 'error_recovery',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      originalError,
      recoveryStrategy,
      success,
      durationMs,
    };
    await this.append(log);
  }

  /** 记录用户中断 */
  async logInterrupt(
    iteration: number,
    reason: 'user_stop' | 'user_interrupt' | 'max_iterations',
    appendMessage?: string,
    streamActive: boolean = false,
    activeTools: string[] = [],
  ): Promise<void> {
    const log: InterruptLog = {
      timestamp: new Date().toISOString(),
      eventType: 'interrupt',
      sessionId: this.sessionId,
      iteration,
      model: this.model,
      reason,
      appendMessage: appendMessage ? this.sanitize(appendMessage) : undefined,
      streamActive,
      activeTools,
    };
    await this.append(log);
  }

  /** 记录会话完成 */
  async logSessionComplete(
    totalIterations: number,
    totalUsage: TokenUsage,
    totalCost: number,
    toolStats: Array<{
      name: string;
      count: number;
      totalDurationMs: number;
      errorCount: number;
    }>,
    status: 'completed' | 'stopped' | 'error' | 'max_iterations',
  ): Promise<void> {
    const log: SessionCompleteLog = {
      timestamp: new Date().toISOString(),
      eventType: 'session_complete',
      sessionId: this.sessionId,
      iteration: totalIterations,
      model: this.model,
      totalIterations,
      totalDurationMs: Date.now() - this.startTime,
      totalUsage,
      totalCost,
      toolStats,
      status,
    };
    await this.append(log);
  }

  // ── 查询方法 ──

  /**
   * 查询日志记录
   */
  static async query(filter?: AgentLoopLogFilter, filePath?: string): Promise<AgentLoopLog[]> {
    const path = filePath ?? join(homedir(), '.xuanji', 'logs', 'agent-loop.log');

    try {
      if (!existsSync(path)) {
        return [];
      }

      const text = await readFile(path, 'utf-8');
      const lines = text.split('\n').filter((l) => l.trim());
      let logs: AgentLoopLog[] = [];

      for (const line of lines) {
        try {
          logs.push(JSON.parse(line) as AgentLoopLog);
        } catch {
          // 跳过格式错误的行
        }
      }

      // 应用过滤器
      if (filter) {
        logs = this.applyFilter(logs, filter);
      }

      return logs;
    } catch {
      return [];
    }
  }

  /**
   * 获取会话摘要统计
   */
  static async getSessionSummary(
    sessionId: string,
    filePath?: string,
  ): Promise<{
    sessionId: string;
    totalIterations: number;
    totalDurationMs: number;
    totalTokens: number;
    totalCost: number;
    errorCount: number;
    toolCallCount: number;
    events: { [K in AgentLoopEventType]?: number };
  } | null> {
    const logs = await this.query({ sessionId }, filePath);
    if (logs.length === 0) return null;

    const events: { [K in AgentLoopEventType]?: number } = {};
    let totalIterations = 0;
    let totalDurationMs = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let errorCount = 0;
    let toolCallCount = 0;

    for (const log of logs) {
      // 统计事件类型
      events[log.eventType] = (events[log.eventType] ?? 0) + 1;

      // 统计迭代
      if (log.iteration > totalIterations) {
        totalIterations = log.iteration;
      }

      // 统计错误
      if (log.eventType === 'error_caught') {
        errorCount++;
      }

      // 统计工具调用
      if (log.eventType === 'tool_execute') {
        toolCallCount++;
      }

      // 统计会话完成信息
      if (log.eventType === 'session_complete') {
        totalDurationMs = log.totalDurationMs;
        totalTokens = log.totalUsage.input + log.totalUsage.output;
        totalCost = log.totalCost;
      }
    }

    return {
      sessionId,
      totalIterations,
      totalDurationMs,
      totalTokens,
      totalCost,
      errorCount,
      toolCallCount,
      events,
    };
  }

  // ── 私有方法 ──

  /** 追加日志到 JSONL 文件 */
  private async append(log: AgentLoopLog): Promise<void> {
    try {
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });
      const line = JSON.stringify(log) + '\n';
      await appendFile(this.filePath, line, 'utf-8');
    } catch {
      // 静默失败，不影响主流程
    }
  }

  /** 脱敏文本 */
  private sanitize(text: string): string {
    if (text.length <= MAX_SANITIZE_LENGTH) return text;
    return text.slice(0, MAX_SANITIZE_LENGTH) + '...[truncated]';
  }

  /** 脱敏输入参数 */
  private sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        sanitized[key] = this.sanitize(value);
      } else if (typeof value === 'object' && value !== null) {
        // 对象类型转为字符串并脱敏
        sanitized[key] = this.sanitize(JSON.stringify(value));
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /** 应用查询过滤器 */
  private static applyFilter(logs: AgentLoopLog[], filter: AgentLoopLogFilter): AgentLoopLog[] {
    let filtered = logs;

    if (filter.sessionId) {
      filtered = filtered.filter((l) => l.sessionId === filter.sessionId);
    }

    if (filter.eventType) {
      const types = Array.isArray(filter.eventType) ? filter.eventType : [filter.eventType];
      filtered = filtered.filter((l) => types.includes(l.eventType));
    }

    if (filter.iterationRange) {
      if (filter.iterationRange.min !== undefined) {
        filtered = filtered.filter((l) => l.iteration >= filter.iterationRange!.min!);
      }
      if (filter.iterationRange.max !== undefined) {
        filtered = filtered.filter((l) => l.iteration <= filter.iterationRange!.max!);
      }
    }

    if (filter.timeRange) {
      if (filter.timeRange.start) {
        filtered = filtered.filter((l) => l.timestamp >= filter.timeRange!.start!);
      }
      if (filter.timeRange.end) {
        filtered = filtered.filter((l) => l.timestamp <= filter.timeRange!.end!);
      }
    }

    if (filter.errorsOnly) {
      filtered = filtered.filter((l) =>
        l.eventType === 'error_caught' ||
        l.eventType === 'llm_retry' ||
        (l.eventType === 'tool_result' && !(l as ToolResultLog).success)
      );
    }

    if (filter.limit) {
      filtered = filtered.slice(-filter.limit);
    }

    return filtered;
  }
}
