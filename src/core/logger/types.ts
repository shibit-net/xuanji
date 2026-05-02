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
 * 统一的日志抽象层，支持 child 机制传递 execId、depth 等上下文。
 * 当发生错误时，可以通过 execId 快速定位完整执行链路。
 */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;

  /**
   * 创建子 Logger（继承父级上下文）
   *
   * metadata 支持传递：
   * - module: 模块名称，如 'AgentLoop'
   * - execId: 执行追踪 ID，如 'exec-abc123'
   * - depth: 当前 agent 深度（0=主 agent, 1=子 agent, ...）
   *
   * 子 Logger 的每一行日志都会带上这些上下文。
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
  /** 日志级别（默认: debug） */
  level?: LogLevel;
  /** 日志目录路径（默认: .xuanji/logs） */
  file?: string;
  /** 命名空间 */
  namespace?: string;
  /** 执行追踪 ID（用于关联同一次执行的所有日志） */
  execId?: string;
  /** Agent 深度（0=主 agent, 1=子 agent, ...） */
  depth?: number;
}
