// ============================================================
// Unified Logging - 统一日志模块导出
// ============================================================

import { ColorUtil } from './UnifiedLogManager';

export {
  UnifiedLogManager,
  getUnifiedLogManager,
  printLogs,
  getLogStats,
  type UnifiedLogRecord,
  type UnifiedLogFilter,
  type UnifiedQueryResult,
  type LogStats,
  type LogSource,
  LOG_SOURCE_COLORS,
  LOG_LEVEL_COLORS,
  ColorUtil,
  type LogColorConfig,
} from './UnifiedLogManager';

export {
  LokiClient,
  getLokiClient,
  logToLoki,
  type LokiLogEntry,
  type LokiStreamLabels,
  type LokiStream,
  type LokiPushRequest,
  type LokiClientConfig,
} from './LokiClient';

export {
  AgentLoopLogAdapter,
  getAgentLoopLogAdapter,
  logAgentLoop,
  logAgentLoopStart,
  logAgentLoopEnd,
  logAgentLoopToolCall,
  logAgentLoopToolResult,
  logAgentLoopError,
  type AgentLoopEventType,
} from './AgentLoopLogAdapter';

// ============================================================
// Quick Start - 快速开始
// ============================================================

/**
 * 快速开始使用统一日志
 */
export async function setupUnifiedLogging(
  options: {
    logDir?: string;
    loki?: LokiClientConfig;
  } = {}
) {
  // 初始化统一日志管理器
  const manager = getUnifiedLogManager();

  // 如果配置了 Loki，启用它
  if (options.loki) {
    manager.setLokiClient(options.loki);
  }

  // 打印欢迎信息
  console.log(ColorUtil.colorize('📝 统一日志系统已启动', ColorUtil.ANSI_CODES.green));

  return manager;
}

/**
 * 快速添加一条日志记录
 */
export function addUnifiedLog(
  source: LogSource,
  level: string,
  message: string,
  data?: unknown,
  namespace?: string
) {
  const manager = getUnifiedLogManager();
  manager.addLog({
    timestamp: new Date().toISOString(), // 保持 ISO 格式用于存储和传输
    source,
    level,
    message,
    data,
    namespace,
  });
}

/**
 * 便捷函数：快速添加 info 日志
 */
export function logInfo(source: LogSource, message: string, data?: unknown, namespace?: string) {
  addUnifiedLog(source, 'info', message, data, namespace);
}

/**
 * 便捷函数：快速添加 error 日志
 */
export function logError(source: LogSource, message: string, data?: unknown, namespace?: string) {
  addUnifiedLog(source, 'error', message, data, namespace);
}

/**
 * 便捷函数：快速添加 warn 日志
 */
export function logWarn(source: LogSource, message: string, data?: unknown, namespace?: string) {
  addUnifiedLog(source, 'warn', message, data, namespace);
}

/**
 * 便捷函数：快速添加 debug 日志
 */
export function logDebug(source: LogSource, message: string, data?: unknown, namespace?: string) {
  addUnifiedLog(source, 'debug', message, data, namespace);
}
