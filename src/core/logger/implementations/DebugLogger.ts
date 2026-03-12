// ============================================================
// Logger System — debug 包实现（开发环境）
// ============================================================
//
// 特点:
// - 轻量（24.4 kB），零配置
// - 命名空间天然支持模块化（xuanji:core:agent）
// - DEBUG 环境变量控制输出（如 DEBUG=xuanji:*）
// - 未启用的命名空间几乎零开销
// - 同时写入日志文件（通过共享 FileWriter）
//

import createDebug from 'debug';
import type { ILogger, LogMetadata, LoggerConfig } from '../types';
import type { FileWriter } from './FileWriter';

/**
 * 基于 debug 包的 Logger 实现
 *
 * 适用于开发环境调试：
 * - 终端彩色输出到 stderr（debug 包）
 * - 同时写入日志文件（通过 FileWriter）
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

    // 仅在用户显式设置 DEBUG 环境变量时才输出到终端
    // 未设置时日志只写入文件（~/.xuanji/logs/core.log），不打扰用户

    // 创建不同级别的 debugger 实例
    // debug 包会自动根据 DEBUG 环境变量过滤
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
