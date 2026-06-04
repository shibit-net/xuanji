// ============================================================
// Logger System — 工厂函数
// ============================================================

import path from 'path';
import { homedir } from 'node:os';
import type { ILogger, LogLevel, LoggerConfig, LogMetadata } from './types';
import { PinoLogger } from './implementations/PinoLogger';

function resolveLogDir(): string {
  return path.join(homedir(), '.xuanji', 'logs');
}

// ─── 测试环境轻量 Logger ─────────────────────────────

class TestLogger implements ILogger {
  private ns: string;
  private execId?: string;
  private depth?: number;
  private _level: LogLevel = 'debug';

  constructor(opts?: { namespace?: string; execId?: string; depth?: number }) {
    this.ns = opts?.namespace ?? 'xuanji';
    this.execId = opts?.execId;
    this.depth = opts?.depth;
  }

  private log(level: LogLevel, message: string, args: unknown[]): void {
    const prefix = [`[${level.toUpperCase()}]`, this.ns];
    if (this.execId) prefix.push(`[${this.execId}]`);
    if (this.depth !== undefined) prefix.push(`(depth=${this.depth})`);
    const fullMsg = prefix.join(' ') + ' ' + message;
    const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    method(fullMsg, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    if (this._level === 'debug') this.log('debug', message, args);
  }
  info(message: string, ...args: unknown[]): void {
    if (this._level !== 'error') this.log('info', message, args);
  }
  warn(message: string, ...args: unknown[]): void {
    if (this._level !== 'error') this.log('warn', message, args);
  }
  error(message: string, ...args: unknown[]): void {
    this.log('error', message, args);
  }

  child(metadata: LogMetadata): ILogger {
    return new TestLogger({
      namespace: (metadata.module as string) ? `${this.ns}:${metadata.module}` : this.ns,
      execId: (metadata.execId as string) || this.execId,
      depth: (metadata.depth as number) ?? this.depth,
    });
  }

  setLevel(level: LogLevel): void {
    this._level = level;
  }
}

/**
 * 创建 Logger 实例
 *
 * 测试环境使用轻量 console 实现（避免 pino thread-stream 与 vitest worker_threads 冲突）
 * 生产环境使用 pino 实现：
 * - 文件输出 JSONL 格式（`.xuanji/logs/xuanji.jsonl`），每行一个 JSON，便于 grep/分析
 * - 控制台输出可读格式
 * - child 机制传递 execId、depth 等上下文
 */
export function createLogger(config?: LoggerConfig): ILogger {
  if (process.env.VITEST) {
    return new TestLogger({
      namespace: config?.namespace,
      execId: config?.execId,
      depth: config?.depth,
    });
  }

  const namespace = config?.namespace || 'xuanji';
  return new PinoLogger({
    namespace,
    execId: config?.execId,
    depth: config?.depth,
    logDir: config?.file ? path.dirname(config.file) : resolveLogDir(),
  });
}
