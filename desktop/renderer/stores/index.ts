// ============================================================
// Xuanji Desktop - Stores 统一导出
// ============================================================

export { useConfigStore } from './configStore';
export { useRuntimeStore } from './runtimeStore';
export { useHistoryStore } from './historyStore';
export { useChatStore } from './chatStore';

export { useActiveAgentStore } from './activeAgentStore';

export type {
  Message,
  ToolCall,
  ChatStatus,
} from './chatStore';

export type { LogEntry } from '../types/models';

export type {
  AgentState,
  AgentStatus,
  ToolExecution as ActiveToolExecution,
} from './activeAgentStore';
