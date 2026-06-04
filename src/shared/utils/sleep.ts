/**
 * 异步睡眠函数
 * @param ms 毫秒数
 * @returns Promise（在指定时间后 resolve）
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Sleep aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Sleep aborted', 'AbortError'));
    }, { once: true });
  });
}
