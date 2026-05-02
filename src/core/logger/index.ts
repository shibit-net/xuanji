// ============================================================
// Logger System — 主导出
// ============================================================
//
// 使用方式:
//
//   import { logger } from '@/core/logger';
//
//   // 创建模块级 Logger
//   const log = logger.child({ module: 'MyModule' });
//   log.debug('调试信息', { data: 123 });
//   log.info('操作成功');
//   log.warn('警告信息');
//   log.error('错误信息', error);
//
// 环境变量控制:
//
//   DEBUG=xuanji:*             → 开发环境全部日志
//   DEBUG=xuanji:AgentLoop:*   → 仅 AgentLoop 模块
//   XUANJI_LOG_LEVEL=info      → 生产环境日志级别
//   XUANJI_LOG_DIR=/path       → 自定义日志目录
//   XUANJI_LOGGER_TYPE=consola → 强制使用 consola
//
// 日志文件:
//
//   默认写入 .xuanji/logs/{debug,info,warn,error}.log（按级别分文件）
//

export type { ILogger, LogLevel, LogMetadata, LoggerConfig } from './types';
export { createLogger } from './factory';
export { PinoLogger } from './implementations/PinoLogger';
export { closeFileWriter } from './implementations/FileWriter';
export { LogReader } from './LogReader';
export type { LogRecord, LogQuery, LogWatchCallback } from './LogReader';

// 全局默认 Logger 实例
import { createLogger } from './factory';

/**
 * 全局 Logger（根命名空间: xuanji）
 *
 * 核心模块通过 `logger.child({ module: '...' })` 创建子 Logger
 */
export const logger = createLogger({ namespace: 'xuanji' });
