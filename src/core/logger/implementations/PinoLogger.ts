/**
 * PinoLogger — 基于 pino 的日志实现
 *
 * 功能：
 * - JSONL 格式输出到文件（每行一个 JSON，便于 grep/sed 分析）
 * - 控制台可读输出
 * - child 机制传递 execId、depth、module 等上下文
 * - 按 execId 过滤可拿到完整执行链路
 *
 * 文件格式（JSONL）：
 *   {"time":"2026-05-02T10:00:00.000Z","level":"info","ns":"xuanji:AgentLoop","msg":"agent started","execId":"exec-abc","depth":1}
 */

import pino from 'pino';
import path from 'path';
import { homedir } from 'node:os';
import fs from 'fs';
import { Writable } from 'node:stream';
import type { ILogger, LogMetadata } from '../types';
import { RotatingFileStream } from './RotatingFileStream';

// ─── 控制台可读输出流 ─────────────────────────────

const LEVEL_COLORS: Record<string, string> = {
  debug: '\x1b[36m',   // cyan
  info: '\x1b[32m',    // green
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

/**
 * 将 pino JSON 日志格式化为人类可读的控制台输出
 */
function formatLogLine(obj: Record<string, unknown>): string {
  const time = (obj.time as string)?.replace('T', ' ').replace('Z', '') ?? '';
  const level = (obj.level as string || 'info').toUpperCase().padEnd(5);
  const color = LEVEL_COLORS[obj.level as string] || '';
  const ns = (obj.ns as string) || '';
  const execId = obj.execId ? ` [${obj.execId}]` : '';
  const depth = obj.depth !== undefined ? ` (depth=${obj.depth})` : '';
  const msg = obj.msg || '';
  const err = obj.err as { message?: string; stack?: string } | undefined;

  let line = `${DIM}${time}${RESET} ${color}${level}${RESET}`;
  if (ns) line += ` ${ns}`;
  line += ` ${execId}${depth} ${msg}`;
  if (err?.message) line += `\n       ${color}${err.message}${RESET}`;

  return line;
}

/**
 * 创建控制台可读输出流，替代 pino-pretty（避免 worker thread 兼容问题）
 * 同时输出到 console.log，确保在 Electron 主进程和 DevTools 中都能看到
 */
function createConsoleStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const line = chunk.toString().trim();
      if (!line) return callback();

      try {
        const obj = JSON.parse(line);
        const formatted = formatLogLine(obj);
        const level = obj.level as string || 'info';

        // 同时写入 stdout（兼容重定向）和 console 方法（Electron DevTools 可见）
        process.stdout.write(formatted + '\n');

        // 错误级别也输出到 console.error，方便在 DevTools 中筛选
        if (level === 'error') {
          if (obj.err && typeof obj.err === 'object') {
            console.error(formatted);
            const errStack = (obj.err as any).stack;
            if (errStack) console.error(errStack);
          } else {
            console.error(formatted);
          }
        } else if (level === 'warn') {
          console.warn(formatted);
        } else {
          console.log(formatted);
        }
      } catch {
        // 非 JSON 行直接输出
        process.stdout.write(line + '\n');
        console.log(line);
      }

      callback();
    },
  });
}

// ─── 全局执行追踪上下文 ─────────────────────────────

/** 当前执行追踪 ID，由 ChatSession.run() 设置 */
let currentExecId: string | undefined;

/** 当前 Agent 深度 */
let currentDepth: number | undefined;

/**
 * 设置全局执行追踪上下文。
 * 所有后续日志（包括已创建的 logger 实例）都会自动带上 execId 和 depth。
 */
export function setLogContext(ctx: { execId?: string; depth?: number }): void {
  if (ctx.execId !== undefined) currentExecId = ctx.execId;
  if (ctx.depth !== undefined) currentDepth = ctx.depth;
}

/**
 * 获取当前执行追踪上下文
 */
export function getLogContext(): { execId?: string; depth?: number } {
  return { execId: currentExecId, depth: currentDepth };
}

// ─── PinoLogger ──────────────────────────────────────

export class PinoLogger implements ILogger {
  private pino: pino.Logger;
  private ns: string;
  private execId?: string;
  private depth?: number;

  constructor(opts?: {
    namespace?: string;
    execId?: string;
    depth?: number;
    logDir?: string;
  }) {
    this.ns = opts?.namespace ?? 'xuanji';
    this.execId = opts?.execId;
    this.depth = opts?.depth;

    const logDir = opts?.logDir ?? path.join(homedir(), '.xuanji', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const rotatingStream = new RotatingFileStream(logDir);

    this.pino = pino(
      {
        level: process.env.XUANJI_LOG_LEVEL || 'debug',
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level(label) {
            return { level: label };
          },
        },
        base: undefined,
      },
      pino.multistream([
        {
          stream: rotatingStream as any,
          level: 'debug',
        },
        {
          stream: createConsoleStream() as any,
          level: process.env.XUANJI_LOG_LEVEL || 'debug',
        },
      ]),
    );
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, args: unknown[]): void {
    const bindings: Record<string, unknown> = { ns: this.ns };

    // 优先使用实例级别的 execId/depth，其次使用全局上下文
    const effectiveExecId = this.execId || currentExecId;
    const effectiveDepth = this.depth !== undefined ? this.depth : currentDepth;
    if (effectiveExecId) bindings.execId = effectiveExecId;
    if (effectiveDepth !== undefined) bindings.depth = effectiveDepth;

    // 提取 args 中的 Error 对象
    let errorObj: Error | undefined;
    const cleanArgs: string[] = [];
    for (const a of args) {
      if (a instanceof Error) {
        errorObj = a;
      } else if (typeof a === 'string') {
        cleanArgs.push(a);
      } else {
        try { cleanArgs.push(JSON.stringify(a)); } catch { cleanArgs.push(String(a)); }
      }
    }

    const logger = this.pino.child(bindings);
    if (errorObj) {
      (logger[level] as any)({ err: errorObj }, message, ...cleanArgs);
    } else {
      (logger[level] as any)(message, ...cleanArgs);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, args);
  }

  /**
   * 创建子 Logger
   *
   * 合并父级的 execId、depth，子 Logger 可以覆盖或新增。
   * module 会被追加到命名空间链上：xuanji → xuanji:AgentLoop
   */
  child(metadata: LogMetadata): ILogger {
    const module = metadata.module as string | undefined;
    const childNs = module ? `${this.ns}:${module}` : this.ns;
    const childExecId = (metadata.execId as string) || this.execId;
    const childDepth = (metadata.depth as number) ?? this.depth;

    return new PinoLogger({
      namespace: childNs,
      execId: childExecId,
      depth: childDepth,
    });
  }
}
