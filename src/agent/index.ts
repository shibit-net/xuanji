// ============================================================
// 向后兼容 — 转发到 core/agent
// ============================================================

export { AgentLoop, type AgentCallbacks } from '../core/agent/AgentLoop';
export { MessageManager, type IMessageManager } from '../core/agent/MessageManager';
export { StreamProcessor, type ProcessResult } from '../core/agent/StreamProcessor';
export { ToolDispatcher, type IToolDispatcher } from '../core/agent/ToolDispatcher';
export { TokenManager } from '../core/agent/TokenManager';
export { CostTracker } from '../core/agent/CostTracker';
export { ErrorRecovery } from '../core/agent/ErrorRecovery';
