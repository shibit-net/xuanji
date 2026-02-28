/**
 * 异步事件分发器
 *
 * 支持两种触发模式:
 * - emit(): 异步并行执行所有 listener（不阻塞主流程）
 * - emitSync(): 同步串行执行，任何 listener 返回 false 即停止
 */

import type { HookEvent, HookEventContext, HookHandlerResult } from './types.js';

export type HookListener = (
  context: HookEventContext,
) => Promise<HookHandlerResult>;

export class HookEventEmitter {
  private listeners: Map<HookEvent, HookListener[]> = new Map();
  private defaultTimeout: number;

  constructor(defaultTimeout = 5000) {
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * 注册事件监听器
   */
  on(event: HookEvent, listener: HookListener): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  /**
   * 移除事件监听器
   */
  off(event: HookEvent, listener: HookListener): void {
    const existing = this.listeners.get(event);
    if (!existing) return;
    const index = existing.indexOf(listener);
    if (index >= 0) {
      existing.splice(index, 1);
    }
  }

  /**
   * 移除指定事件的所有监听器
   */
  removeAllListeners(event?: HookEvent): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * 异步并行触发事件（PostToolUse 等异步事件）
   *
   * 所有 listener 并行执行，单个失败不影响其他。
   * 超时自动跳过。
   */
  async emit(
    event: HookEvent,
    context: HookEventContext,
  ): Promise<HookHandlerResult[]> {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.length === 0) {
      return [];
    }

    const results = await Promise.allSettled(
      eventListeners.map((listener) =>
        this.executeWithTimeout(listener, context, this.defaultTimeout),
      ),
    );

    return results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        success: false,
        error: result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      };
    });
  }

  /**
   * 同步串行触发事件（PreToolUse 等同步事件）
   *
   * 顺序执行 listener:
   * - 返回 blocked: true → 立即停止后续执行
   * - 抛出异常 → 立即停止后续执行
   * - 超时 → 跳过该 listener，继续执行下一个
   *
   * @returns 是否被阻塞（任一 listener 返回 blocked 或失败）
   */
  async emitSync(
    event: HookEvent,
    context: HookEventContext,
  ): Promise<{ blocked: boolean; results: HookHandlerResult[] }> {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.length === 0) {
      return { blocked: false, results: [] };
    }

    const results: HookHandlerResult[] = [];
    let blocked = false;

    for (const listener of eventListeners) {
      try {
        const result = await this.executeWithTimeout(
          listener,
          context,
          this.defaultTimeout,
        );
        results.push(result);

        if (result.blocked) {
          blocked = true;
          break;
        }
      } catch (error) {
        const errorResult: HookHandlerResult = {
          success: false,
          blocked: true,
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(errorResult);
        blocked = true;
        break;
      }
    }

    return { blocked, results };
  }

  /**
   * 检查事件是否有注册的监听器
   */
  hasListeners(event: HookEvent): boolean {
    const eventListeners = this.listeners.get(event);
    return !!eventListeners && eventListeners.length > 0;
  }

  /**
   * 获取事件的监听器数量
   */
  listenerCount(event: HookEvent): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 带超时保护的执行
   * 注意：超时后 listener 可能仍在后台运行（协作式取消），
   * 但其结果会被丢弃，不会影响调用方。
   */
  private executeWithTimeout(
    listener: HookListener,
    context: HookEventContext,
    timeout: number,
  ): Promise<HookHandlerResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const controller = new AbortController();

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          controller.abort();
          resolve({
            success: false,
            error: `Hook timeout after ${timeout}ms (listener may still be running in background)`,
            duration: timeout,
          });
        }
      }, timeout);

      // 将 signal 注入 context，供 Hook 实现者检测取消
      const enrichedContext = { ...context, signal: controller.signal };

      listener(enrichedContext)
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
          // 如果已超时，丢弃结果
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
          // 如果已超时，丢弃错误
        });
    });
  }
}
