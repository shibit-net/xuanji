// ============================================================
// M1 终端 UI — Spinner 全局状态管理
// ============================================================
// 优化目标: 将所有独立 Spinner interval 合并为单个全局 interval
// 收益: 从 N+1 个独立 interval 减少到 1 个，减少约 90% 渲染次数

import { useState, useEffect } from 'react';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL = 120; // ms（从 80ms 提高到 120ms，减少渲染频率）

// ============================================================
// 全局状态 (模块级单例)
// ============================================================

let globalFrame = 0;
let subscribers = new Set<(frame: number) => void>();
let timerId: NodeJS.Timeout | null = null;
let pauseCount = 0; // 暂停计数器（支持多层嵌套暂停）

/**
 * 启动全局 Spinner 动画
 */
function startGlobalSpinner() {
  if (timerId || pauseCount > 0) return; // 已启动或已暂停

  timerId = setInterval(() => {
    globalFrame = (globalFrame + 1) % SPINNER_FRAMES.length;
    // 通知所有订阅者
    subscribers.forEach((callback) => callback(globalFrame));
  }, FRAME_INTERVAL);
}

/**
 * 停止全局 Spinner 动画
 */
function stopGlobalSpinner() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

/**
 * 暂停全局 Spinner 动画（交互式组件活跃时调用，避免高频重绘导致闪烁）
 * 支持嵌套：多个组件同时暂停，需全部恢复后才重启
 */
export function pauseGlobalSpinner(): void {
  pauseCount++;
  stopGlobalSpinner();
}

/**
 * 恢复全局 Spinner 动画
 */
export function resumeGlobalSpinner(): void {
  pauseCount = Math.max(0, pauseCount - 1);
  if (pauseCount === 0 && subscribers.size > 0) {
    startGlobalSpinner();
  }
}

/**
 * 订阅全局 Spinner frame 变化
 * @param callback - frame 变化时的回调函数
 * @returns 取消订阅函数
 */
function subscribe(callback: (frame: number) => void): () => void {
  subscribers.add(callback);

  // 如果是第一个订阅者，启动全局动画
  if (subscribers.size === 1) {
    startGlobalSpinner();
  }

  // 返回取消订阅函数
  return () => {
    subscribers.delete(callback);
    // 如果没有订阅者了，停止全局动画
    if (subscribers.size === 0) {
      stopGlobalSpinner();
    }
  };
}

// ============================================================
// React Hook
// ============================================================

/**
 * useGlobalSpinnerFrame - 获取全局 Spinner frame
 *
 * 自动订阅/取消订阅全局动画，所有 Spinner 组件共享同一个 frame 状态
 *
 * @returns 当前 frame 索引 (0-9)
 */
export function useGlobalSpinnerFrame(): number {
  const [frame, setFrame] = useState(globalFrame);

  useEffect(() => {
    // 订阅全局 frame 变化
    const unsubscribe = subscribe(setFrame);

    // 组件卸载时取消订阅
    return unsubscribe;
  }, []);

  return frame;
}
