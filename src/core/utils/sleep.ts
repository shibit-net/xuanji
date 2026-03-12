/**
 * 异步睡眠函数
 * @param ms 毫秒数
 * @returns Promise（在指定时间后 resolve）
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
