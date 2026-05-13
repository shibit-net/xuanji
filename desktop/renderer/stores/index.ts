// ============================================================
// Xuanji Desktop - Stores 统一导出
// ============================================================

export { useConfigStore } from './configStore';
export { useRuntimeStore } from './runtimeStore';
export { useHistoryStore } from './historyStore';
export { useChatStore } from './chatStore';
export { useMessageStore } from './messageStore';
export { useSessionInitStore } from './SessionInitStore';
export { useIntentRoutingStore } from './IntentRoutingStore';
export { useSessionStore } from './sessionStore';
export { useUnifiedLogStore } from './unifiedLogStore';

export type {
  Message,
  ToolCall,
  ChatStatus,
  SubAgentReference,
} from './messageStore';

export type { LogEntry } from '../types/models';

// 统一日志相关类型导出
export type {
  UnifiedLogRecord,
  UnifiedLogFilter,
  UnifiedQueryResult,
  LogStats,
  LokiClientConfig,
  LogSource,
} from '@root/src/core/logging/UnifiedLogManager';

export {
  LOG_SOURCE_COLORS,
  LOG_LEVEL_COLORS,
  getSourceStyle,
  getLevelStyle,
  formatTimestamp,
  formatLogRecord,
  filterLogs,
} from './unifiedLogStore';
