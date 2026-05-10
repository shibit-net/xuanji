/**
 * AgentLoop 与 SessionStateMachine 之间的解耦接口。
 * AgentLoop 通过此接口查询中断状态，不再直接持有 _pendingQueue 引用。
 */
export interface InterruptChecker {
  /** 当前迭代是否应停止（pendingQueue 非空且未输出文字） */
  shouldStop(): boolean;
  /** 是否应立即终止（用户点了停止或发起补充消息打断） */
  shouldAbort(): boolean;
}
