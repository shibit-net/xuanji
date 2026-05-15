/**
 * flowLogger — React Flow 内存环形缓冲区日志工具。
 *
 * 用于 ExecutionFlow 内部调试，输出到 console + 内存缓冲区。
 */

const MAX_BUFFER = 2000;
const buffer: string[] = [];

function formatLine(tag: string, ...args: unknown[]): string {
  const ts = new Date().toISOString();
  const message = args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  return `[${ts}] [${tag}] ${message}`;
}

export const flowLogger = {
  log(tag: string, ...args: unknown[]): void {
    const line = formatLine(tag, ...args);
    console.log(line);
    buffer.push(line);
    if (buffer.length > MAX_BUFFER) buffer.shift();
  },

  warn(tag: string, ...args: unknown[]): void {
    const line = formatLine(tag, ...args);
    console.warn(line);
    buffer.push(line);
    if (buffer.length > MAX_BUFFER) buffer.shift();
  },

  error(tag: string, ...args: unknown[]): void {
    const line = formatLine(tag, ...args);
    console.error(line);
    buffer.push(line);
    if (buffer.length > MAX_BUFFER) buffer.shift();
  },

  /** 获取最近 N 条日志 */
  getRecent(n: number = 100): string[] {
    return buffer.slice(-n);
  },

  /** 导出全部日志为文本 */
  dump(): string {
    return buffer.join('\n');
  },

  /** 清空缓冲区 */
  clear(): void {
    buffer.length = 0;
  },
};
