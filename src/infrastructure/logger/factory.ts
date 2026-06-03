// ============================================================
// Logger System — 工厂函数
// ============================================================

import path from 'path';
import { homedir } from 'node:os';
import type { ILogger, LoggerConfig } from './types';
import { PinoLogger } from './implementations/PinoLogger';

function resolveLogDir(): string {
  return path.join(homedir(), '.xuanji', 'logs');
}

/**
 * 创建 Logger 实例
 *
 * 使用 pino 实现：
 * - 文件输出 JSONL 格式（`.xuanji/logs/xuanji.jsonl`），每行一个 JSON，便于 grep/分析
 * - 控制台输出可读格式
 * - child 机制传递 execId、depth 等上下文
 */
export function createLogger(config?: LoggerConfig): ILogger {
  const namespace = config?.namespace || 'xuanji';
  return new PinoLogger({
    namespace,
    execId: config?.execId,
    depth: config?.depth,
    logDir: config?.file ? path.dirname(config.file) : resolveLogDir(),
  });
}
