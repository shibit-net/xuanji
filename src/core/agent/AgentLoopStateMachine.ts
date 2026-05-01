// ============================================================
// AgentLoopStateMachine — Agent 循环显式状态机
// ============================================================
//
// 替代 AgentLoop 中分散的 10+ 个可变状态字段：
//   running, _interrupted, _pendingAppendMessage, _abortController,
//   _currentStream, currentIteration
//
// 提供原子状态转换、合法性校验、语义化转换方法。

import type { AgentStatus, AgentState } from '@/core/types';

// ============================================================
// 状态枚举
// ============================================================

/** Agent 循环状态 */
export enum LoopState {
  /** 空闲（初始/重置后） */
  IDLE = 'idle',
  /** 主循环活跃 */
  RUNNING = 'running',
  /** 子状态：等待下一轮消费 pendingAppend（中断后） */
  INTERRUPTING = 'interrupting',
  /** 瞬态：正在清理资源 */
  STOPPING = 'stopping',
  /** 终态：用户停止 */
  STOPPED = 'stopped',
  /** 终态：循环正常结束 */
  COMPLETED = 'completed',
}

// ============================================================
// 合法转换表
// ============================================================

const VALID_TRANSITIONS: Record<LoopState, readonly LoopState[]> = {
  [LoopState.IDLE]:          [LoopState.RUNNING],
  [LoopState.RUNNING]:       [LoopState.INTERRUPTING, LoopState.STOPPING, LoopState.COMPLETED],
  [LoopState.INTERRUPTING]:  [LoopState.RUNNING, LoopState.STOPPING],
  [LoopState.STOPPING]:      [LoopState.STOPPED],
  [LoopState.STOPPED]:       [LoopState.IDLE],
  [LoopState.COMPLETED]:     [LoopState.IDLE],
};

// ============================================================
// 状态上下文
// ============================================================

export interface LoopContext {
  state: LoopState;
  iteration: number;
  pendingAppendMessage: string | null;
  abortController: AbortController | null;
  activeStreamRef: WeakRef<AsyncIterable<unknown>> | null;
}

// ============================================================
// 自定义错误
// ============================================================

export class InvalidTransitionError extends Error {
  public readonly from: LoopState;
  public readonly to: LoopState;

  constructor(from: LoopState, to: LoopState) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

// ============================================================
// 状态机类
// ============================================================

export class AgentLoopStateMachine {
  private state: LoopState = LoopState.IDLE;
  private iteration: number = 0;
  private pendingAppendMessage: string | null = null;
  private abortController: AbortController | null = null;
  private activeStreamRef: WeakRef<AsyncIterable<unknown>> | null = null;

  // ============================================================
  // 原子状态转换
  // ============================================================

  /**
   * 原子状态转换（内部校验合法性，不合法抛 InvalidTransitionError）
   */
  transition(to: LoopState): void {
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed.includes(to)) {
      throw new InvalidTransitionError(this.state, to);
    }
    this.state = to;
  }

  /**
   * 检查是否可以转换到目标状态
   */
  canTransition(to: LoopState): boolean {
    const allowed = VALID_TRANSITIONS[this.state];
    return allowed.includes(to);
  }

  // ============================================================
  // 语义化转换方法
  // ============================================================

  /**
   * IDLE → RUNNING
   * 重置迭代计数器，创建新的 AbortController
   * @returns 新创建的 AbortController
   */
  startRun(): AbortController {
    this.transition(LoopState.RUNNING);
    this.iteration = 0;
    this.abortController = new AbortController();
    return this.abortController;
  }

  /**
   * RUNNING → INTERRUPTING
   * 记录待追加的用户消息
   */
  markInterrupting(message: string): void {
    this.transition(LoopState.INTERRUPTING);
    this.pendingAppendMessage = message;
  }

  /**
   * INTERRUPTING → RUNNING
   * 清除 pendingAppend 状态，恢复到主循环
   */
  resumeFromInterrupt(): void {
    this.transition(LoopState.RUNNING);
    this.pendingAppendMessage = null;
  }

  /**
   * RUNNING/INTERRUPTING → STOPPING
   * 进入清理阶段
   */
  markStopping(): void {
    this.transition(LoopState.STOPPING);
  }

  /**
   * STOPPING → STOPPED
   * 清理完成，标记为已停止
   */
  markStopped(): void {
    this.transition(LoopState.STOPPED);
  }

  /**
   * RUNNING → COMPLETED
   * 循环正常结束
   */
  markCompleted(): void {
    this.transition(LoopState.COMPLETED);
  }

  /**
   * STOPPED/COMPLETED → IDLE
   * 重置到空闲状态，清除所有中间状态
   */
  resetToIdle(): void {
    this.state = LoopState.IDLE;
    this.iteration = 0;
    this.pendingAppendMessage = null;
    this.activeStreamRef = null;
    // 注意：不清理 abortController，由 stop() 流程管理
  }

  // ============================================================
  // 查询方法
  // ============================================================

  getState(): LoopState {
    return this.state;
  }

  getIteration(): number {
    return this.iteration;
  }

  incrementIteration(): number {
    this.iteration++;
    return this.iteration;
  }

  getPendingAppend(): string | null {
    return this.pendingAppendMessage;
  }

  /** 获取并清空待追加消息（用于中断恢复） */
  consumePendingAppend(): string | null {
    const message = this.pendingAppendMessage;
    this.pendingAppendMessage = null;
    return message;
  }

  /** 仅清空 pendingAppend（不获取，用于 stop 流程） */
  clearPendingAppend(): void {
    this.pendingAppendMessage = null;
  }

  getAbortController(): AbortController | null {
    return this.abortController;
  }

  /** 中止并清除 AbortController */
  abortAndClear(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  setActiveStream(stream: AsyncIterable<unknown> | null): void {
    this.activeStreamRef = stream ? new WeakRef(stream) : null;
  }

  getActiveStream(): AsyncIterable<unknown> | null {
    return this.activeStreamRef?.deref() ?? null;
  }

  /**
   * 检查是否有待处理的追加消息
   */
  hasPendingAppend(): boolean {
    return this.pendingAppendMessage !== null;
  }

  // ============================================================
  // 状态映射
  // ============================================================

  /**
   * 从当前状态映射到 AgentStatus
   */
  toAgentStatus(): AgentStatus {
    switch (this.state) {
      case LoopState.IDLE:
        return 'idle';
      case LoopState.RUNNING:
        return 'thinking';
      case LoopState.INTERRUPTING:
        return 'thinking';
      case LoopState.STOPPING:
        return 'thinking';
      case LoopState.STOPPED:
        return 'idle';
      case LoopState.COMPLETED:
        return 'idle';
      default:
        return 'idle';
    }
  }

  /**
   * 从当前状态和迭代次数映射到 sessionStatus
   * 用于 finally 块中确定会话完成状态，替代 4 分支反推逻辑
   *
   * @param maxIterations 最大迭代次数（用于判断 max_iterations）
   * @param hasError 是否有未处理的异常（用于判断 error）
   */
  toSessionStatus(
    maxIterations: number,
    hasError: boolean = false,
  ): 'completed' | 'stopped' | 'error' | 'max_iterations' {
    // 达到最大迭代次数
    if (this.iteration >= maxIterations) {
      return 'max_iterations';
    }

    // 有未处理的异常
    if (hasError && this.state !== LoopState.STOPPING && this.state !== LoopState.STOPPED) {
      return 'error';
    }

    // 用户主动停止
    if (this.state === LoopState.STOPPED || this.state === LoopState.STOPPING) {
      return 'stopped';
    }

    // 正常完成或其他情况
    return 'completed';
  }

  // ============================================================
  // 调试
  // ============================================================

  /**
   * 获取状态机快照（用于调试/日志）
   */
  getSnapshot(): LoopContext {
    return {
      state: this.state,
      iteration: this.iteration,
      pendingAppendMessage: this.pendingAppendMessage,
      abortController: this.abortController,
      activeStreamRef: this.activeStreamRef,
    };
  }
}
