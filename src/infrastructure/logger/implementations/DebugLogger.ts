// ============================================================
// Logger System — debug 包实现（开发环境）
// ============================================================
//
// 特点:
// - 轻量（24.4 kB），零配置
// - 命名空间天然支持模块化（xuanji:core:agent）
// - DEBUG 环境变量控制输出（如 DEBUG=xuanji:*）
// - 未启用的命名空间几乎零开销
// - 自动颜色区分（不同命名空间不同颜色）
// - 同时写入日志文件（通过共享 FileWriter）
//

import createDebug from 'debug';
import type { ILogger, LogMetadata, LoggerConfig } from '../types';
import type { FileWriter } from './FileWriter';

/**
 * 覆盖 debug 包的日期格式，使用可读的本地时间格式
 * 格式: 2026-04-26 15:27:52.797
 */
function readableDate(): string {
  const now = new Date();
  const Y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, '0');
  const D = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms} `;
}

const _origFormatArgs = (createDebug as any).formatArgs;
(createDebug as any).formatArgs = function (this: any, args: any[]) {
  const { useColors } = this;
  if (useColors) {
    _origFormatArgs.call(this, args);
  } else {
    args[0] = readableDate() + this.namespace + ' ' + args[0];
  }
};

/**
 * 基于 debug 包的 Logger 实现
 *
 * 适用于开发环境调试：
 * - 终端彩色输出到 stderr（debug 包自动为不同命名空间分配颜色）
 * - 同时写入日志文件（通过 FileWriter 按级别分文件）
 * - 支持命名空间过滤（DEBUG=xuanji:AgentLoop:*）
 */
export class DebugLogger implements ILogger {
  private debugFn: createDebug.Debugger;
  private infoFn: createDebug.Debugger;
  private warnFn: createDebug.Debugger;
  private errorFn: createDebug.Debugger;
  private namespace: string;
  private fileWriter: FileWriter | null;

  constructor(config?: LoggerConfig, fileWriter?: FileWriter | null) {
    this.namespace = config?.namespace ?? 'xuanji';
    this.fileWriter = fileWriter ?? null;

    // 如果未设置 DEBUG 环境变量，在开发环境下自动启用 xuanji:* 命名空间
    // 这样日志会同时输出到终端和文件，无需手动设置 DEBUG=xuanji:*
    if (!process.env.DEBUG && process.env.NODE_ENV !== 'production') {
      createDebug.enable('xuanji:*');
    }

    // 创建不同级别的 debugger 实例
    // debug 包会自动为每个命名空间分配不同的颜色
    this.debugFn = createDebug(`${this.namespace}:debug`);
    this.infoFn = createDebug(`${this.namespace}:info`);
    this.warnFn = createDebug(`${this.namespace}:warn`);
    this.errorFn = createDebug(`${this.namespace}:error`);
  }

  debug(message: string, ...args: unknown[]): void {
    this.debugFn(message, ...args);
    this.fileWriter?.write('debug', this.namespace, message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.infoFn(message, ...args);
    this.fileWriter?.write('info', this.namespace, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.warnFn(message, ...args);
    this.fileWriter?.write('warn', this.namespace, message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.errorFn(message, ...args);
    this.fileWriter?.write('error', this.namespace, message, args);
  }

  /**
   * 创建子 Logger
   *
   * 命名空间嵌套: xuanji → xuanji:AgentLoop
   * 子 Logger 共享父级的 FileWriter
   */
  child(metadata: LogMetadata): ILogger {
    const module = metadata.module as string | undefined;
    const childNamespace = module
      ? `${this.namespace}:${module}`
      : this.namespace;

    return new DebugLogger({ namespace: childNamespace }, this.fileWriter);
  }
}
