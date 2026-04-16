// ============================================================
// Logger System — 类型定义
// ============================================================

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志元数据
 */
export interface LogMetadata {
  [key: string]: unknown;
}

/**
 * Logger 接口
 *
 * 统一的日志抽象层，支持多种实现（debug / consola）
 */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;

  /**
   * 创建子 Logger（带命名空间前缀）
   *
   * @example
   * const child = logger.child({ module: 'AgentLoop' });
   * child.debug('iteration started'); // → xuanji:AgentLoop iteration started
   */
  child(metadata: LogMetadata): ILogger;

  /**
   * 动态设置日志级别（仅 ConsolaLogger 支持）
   */
  setLevel?(level: LogLevel): void;
}

/**
 * Logger 配置
 */
export interface LoggerConfig {
  /** 日志级别（默认: dev=debug, prod=info） */
  level?: LogLevel;
  /** 日志目录路径（默认: ~/.xuanji/logs，按级别分文件） */
  file?: string;
  /** 是否启用文件输出（默认: true，所有环境启用） */
  enableFile?: boolean;
  /** 是否启用控制台输出（默认: true） */
  enableConsole?: boolean;
  /** 命名空间（用于 debug 包的命名空间机制） */
  namespace?: string;
}
