// ============================================================
// M10 日志与遥测 — 占位 (P1+ 阶段实现)
// ============================================================

// P0 阶段暂不实现，P1 阶段 (W8) 实现日志基础
// 包括: Logger, Metrics, ErrorReporter

/**
 * 简易日志 (P0 临时方案)
 */
export function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  switch (level) {
    case 'debug':
      if (process.env.DEBUG) console.debug(prefix, message, ...args);
      break;
    case 'info':
      console.info(prefix, message, ...args);
      break;
    case 'warn':
      console.warn(prefix, message, ...args);
      break;
    case 'error':
      console.error(prefix, message, ...args);
      break;
  }
}
