/**
 * AgentLoop 与 SessionStateMachine 之间的解耦接口。
 * AgentLoop 通过此接口查询中断状态，不再直接持有 _pendingQueue 引用。
 */
export interface InterruptChecker {
  /** 当前迭代是否应停止（pendingQueue 非空且未输出文字）。inline checker 也会检查此方法，用于中断流。 */
  shouldStop(): boolean;
  /** 是否应立即终止（用户点了停止）。inline checker + checkpoint 都会检查。 */
  shouldAbort(): boolean;
  /** 延迟打断：仅在 checkpoint A/B 检查，不中断流。用于"等待流/工具完成后停止"的场景。 */
  shouldStopAtCheckpoint?(): boolean;
}
