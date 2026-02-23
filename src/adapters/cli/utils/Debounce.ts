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
