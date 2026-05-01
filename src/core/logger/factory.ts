// ============================================================
// Logger System — 工厂函数
// ============================================================

import path from 'path';
import type { ILogger, LoggerConfig } from './types';
import { DebugLogger } from './implementations/DebugLogger';
import { ConsolaLogger } from './implementations/ConsolaLogger';
import { getFileWriter } from './implementations/FileWriter';

/**
 * 解析日志目录路径
 *
 * 固定使用 Xuanji 项目目录: ./.xuanji/logs
 */
function resolveLogDir(): string {
  return path.join(process.cwd(), '.xuanji', 'logs');
}

/**
 * 创建 Logger 实例
 *
 * 根据环境自动选择实现：
 * - 开发环境 → DebugLogger（debug 包，命名空间机制）
 * - 生产环境 → ConsolaLogger（consola 包，级别控制）
 *
 * 文件输出：
 * - 固定写入项目目录: ./.xuanji/logs/{debug,info,warn,error}.log
 */
export function createLogger(config?: LoggerConfig): ILogger {
  const type = process.env.XUANJI_LOGGER_TYPE ||
    (process.env.NODE_ENV === 'production' ? 'consola' : 'debug');

  const enableFile = config?.enableFile ?? true;
  const fileWriter = enableFile
    ? getFileWriter(resolveLogDir())
    : null;

  return type === 'consola'
    ? new ConsolaLogger(config, fileWriter)
    : new DebugLogger(config, fileWriter);
}
