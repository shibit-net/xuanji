/**
 * flowLogger — React Flow 调试日志工具。
 *
 * 同时输出到 console + 内存环形缓冲区 + 通过 IPC 写入日志文件。
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

function writeToFile(line: string): void {
  try {
    // 通过 IPC 异步写入 ~/.xuanji/logs/debug-remove-agent.log
    (window as any).electron?.debugLog?.(line);
  } catch {
    // IPC 不可用时静默忽略
  }
}

export const flowLogger = {
  log(tag: string, ...args: unknown[]): void {
    const line = formatLine(tag, ...args);
    console.log(line);
    buffer.push(line);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    writeToFile(line);
  },

  warn(tag: string, ...args: unknown[]): void {
    const line = formatLine(tag, ...args);
    console.warn(line);
    buffer.push(line);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    writeToFile(line);
  },

  error(tag: string, ...args: unknown[]): void {
    const line = formatLine(tag, ...args);
    console.error(line);
    buffer.push(line);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    writeToFile(line);
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
