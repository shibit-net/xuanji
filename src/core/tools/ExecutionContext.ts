/**
 * ExecutionContext — 工具执行上下文
 *
 * 封装工具执行时需要的上下文信息。
 */

export interface ToolExecutionContext {
  /** 调用方 agent ID */
  agentId: string;
  /** agent 名称 */
  agentName?: string;
  /** 嵌套深度 */
  depth?: number;
  /** 工作目录 */
  workingDir?: string;
  /** 中断信号 */
  signal?: AbortSignal;
  /** 会话 ID */
  sessionId?: string;
  /** 用户 ID */
  userId?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

export function createExecutionContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    agentId: overrides.agentId ?? 'unknown',
    agentName: overrides.agentName,
    depth: overrides.depth ?? 0,
    workingDir: overrides.workingDir ?? process.cwd(),
    signal: overrides.signal,
    sessionId: overrides.sessionId,
    userId: overrides.userId,
    metadata: overrides.metadata ?? {},
  };
}
