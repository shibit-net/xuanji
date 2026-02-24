// ============================================================
// Logger System — consola 包实现（生产环境）
// ============================================================
//
// 特点:
// - UnJS 生态（Nuxt 团队维护）
// - CLI 友好的美化输出
// - 支持日志级别过滤
// - 通过共享 FileWriter 支持文件持久化
//

import { createConsola, LogLevels, type ConsolaInstance } from 'consola';
import type { ILogger, LogMetadata, LoggerConfig, LogLevel } from '../types';
import type { FileWriter } from './FileWriter';

/** 日志级别到 consola LogLevels 的映射 */
const LEVEL_MAP: Record<LogLevel, number> = {
  error: LogLevels.error,
  warn: LogLevels.warn,
  info: LogLevels.info,
  debug: LogLevels.debug,
};

/**
 * 基于 consola 的 Logger 实现
 *
 * 适用于生产环境：
 * - 支持日志级别过滤（XUANJI_LOG_LEVEL）
 * - 通过 FileWriter 文件持久化（异步追加写入）
 * - CLI 友好的格式化输出
 */
export class ConsolaLogger implements ILogger {
  private consola: ConsolaInstance;
  private namespace: string;
  private fileWriter: FileWriter | null;
  private config: LoggerConfig;

  constructor(config?: LoggerConfig, fileWriter?: FileWriter | null) {
    this.config = config ?? {};
    this.namespace = config?.namespace ?? 'xuanji';
    this.fileWriter = fileWriter ?? null;

    // 解析日志级别
    const level = config?.level
      ?? (process.env.XUANJI_LOG_LEVEL as LogLevel | undefined)
      ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

    // 创建 consola 实例
    this.consola = createConsola({
      level: LEVEL_MAP[level] ?? LogLevels.info,
      defaults: {
        tag: this.namespace,
      },
    });
  }

  debug(message: string, ...args: unknown[]): void {
    this.consola.debug(message, ...args);
    this.fileWriter?.write('debug', this.namespace, message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.consola.info(message, ...args);
    this.fileWriter?.write('info', this.namespace, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.consola.warn(message, ...args);
    this.fileWriter?.write('warn', this.namespace, message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.consola.error(message, ...args);
    this.fileWriter?.write('error', this.namespace, message, args);
  }

  /**
   * 动态设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.consola.level = LEVEL_MAP[level] ?? LogLevels.info;
  }

  /**
   * 创建子 Logger
   * 子 Logger 共享父级的 FileWriter
   */
  child(metadata: LogMetadata): ILogger {
    const module = metadata.module as string | undefined;
    const childNamespace = module
      ? `${this.namespace}:${module}`
      : this.namespace;

    return new ConsolaLogger(
      { ...this.config, namespace: childNamespace },
      this.fileWriter,
    );
  }

  /**
   * 销毁 Logger（向后兼容，实际关闭由 closeFileWriter 处理）
   */
  async destroy(): Promise<void> {
    // FileWriter 的生命周期由全局管理，此处仅保留接口兼容
  }
}
