/**
 * 简单的 debounce 实现
 * 用于批量更新流式文本，减少渲染频率
 */
export function createDebouncedUpdate<T>(
  callback: (value: T) => void,
  delayMs: number = 50
) {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingValue: T | null = null;

  return {
    update(value: T) {
      pendingValue = value;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        if (pendingValue !== null) {
          callback(pendingValue);
        }
        timeoutId = null;
      }, delayMs);
    },
    flush() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pendingValue !== null) {
        callback(pendingValue);
        pendingValue = null;
      }
    },
    cancel() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      pendingValue = null;
    },
  };
}

/**
 * Throttle 实现（leading + trailing）
 *
 * 与 debounce 的区别：
 * - debounce: 每次调用重置计时器，连续快速调用时 callback 不会执行
 * - throttle: 固定间隔执行，首次调用立即触发，后续按间隔触发，最后一次也保证触发
 *
 * 适合流式文本等持续高频更新的场景。
 */
export function createThrottledUpdate<T>(
  callback: (value: T) => void,
  intervalMs: number = 100
) {
  let lastCallTime = 0;
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingValue: T | null = null;

  return {
    update(value: T) {
      pendingValue = value;
      const now = Date.now();
      const elapsed = now - lastCallTime;

      if (elapsed >= intervalMs) {
        // 距上次触发已超过间隔，立即执行（leading edge）
        lastCallTime = now;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        callback(value);
      } else if (!timeoutId) {
        // 间隔内，安排一次 trailing edge 触发
        timeoutId = setTimeout(() => {
          lastCallTime = Date.now();
          if (pendingValue !== null) {
            callback(pendingValue);
          }
          timeoutId = null;
        }, intervalMs - elapsed);
      }
    },
    flush() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pendingValue !== null) {
        callback(pendingValue);
        pendingValue = null;
      }
      lastCallTime = 0;
    },
    cancel() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      pendingValue = null;
      lastCallTime = 0;
    },
  };
}
