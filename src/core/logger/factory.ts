// ============================================================
// Logger System — 工厂函数
// ============================================================

import path from 'path';
import os from 'os';
import type { ILogger, LoggerConfig } from './types';
import { DebugLogger } from './implementations/DebugLogger';
import { ConsolaLogger } from './implementations/ConsolaLogger';
import { getFileWriter } from './implementations/FileWriter';

/**
 * 解析日志文件路径
 *
 * 优先级：config.file > XUANJI_LOG_FILE > ~/.xuanji/logs/core.log
 */
function resolveLogFilePath(config?: LoggerConfig): string {
  return config?.file
    ?? process.env.XUANJI_LOG_FILE
    ?? path.join(os.homedir(), '.xuanji', 'logs', 'core.log');
}

/**
 * 创建 Logger 实例
 *
 * 根据环境自动选择实现：
 * - 开发环境 → DebugLogger（debug 包，命名空间机制）
 * - 生产环境 → ConsolaLogger（consola 包，级别控制）
 * - 可通过 XUANJI_LOGGER_TYPE 环境变量强制覆盖
 *
 * 文件输出：
 * - 默认启用，写入 ~/.xuanji/logs/core.log
 * - 通过 enableFile: false 禁用
 * - 通过 XUANJI_LOG_FILE 自定义路径
 */
export function createLogger(config?: LoggerConfig): ILogger {
  const type = process.env.XUANJI_LOGGER_TYPE
    ?? (process.env.NODE_ENV === 'production' ? 'consola' : 'debug');

  // 默认启用文件输出（所有环境）
  const enableFile = config?.enableFile ?? true;
  const fileWriter = enableFile
    ? getFileWriter(resolveLogFilePath(config))
    : null;

  return type === 'consola'
    ? new ConsolaLogger(config, fileWriter)
    : new DebugLogger(config, fileWriter);
}
