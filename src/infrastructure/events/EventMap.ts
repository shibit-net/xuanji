// ============================================================
// EventBus 类型映射 — 每个事件名称关联其 payload 类型
// 使用方式：
//   eventBus.on<EventMap['agent.text.delta']>(XuanjiEvent.AGENT_TEXT_DELTA, ...)
//   eventBus.emit(XuanjiEvent.AGENT_TEXT_DELTA, { text, agentId })
// ============================================================

import { XuanjiEvent } from '@/infrastructure/events/events';
import type { TaskCompletionResult } from '@/agent/task/types';

export interface XuanjiEventMap {
  [XuanjiEvent.CONVERSATION_STATE_CHANGED]: { from: string; to: string };
  [XuanjiEvent.USER_INPUT_RECEIVED]: { text: string; userId?: string };
  [XuanjiEvent.INTENT_ANALYZED]: { scene: string; complexity: string; confidence: number };

  // === 任务管理中心 ===
  [XuanjiEvent.ASYNC_TASK_STARTED]: { groupId: string; type: string };
  [XuanjiEvent.ASYNC_TASK_PROGRESS]: { groupId: string; progress: number };
  [XuanjiEvent.ASYNC_TASK_COMPLETED]: TaskCompletionResult;
  [XuanjiEvent.ASYNC_TASK_FAILED]: TaskCompletionResult;

  [XuanjiEvent.AGENT_CREATED]: { agentId: string; name: string };
  [XuanjiEvent.AGENT_STARTED]: { userId?: string; model: string };
  [XuanjiEvent.AGENT_TOOL_START]: { id: string; name: string; input: Record<string, unknown>; agentId?: string };
  [XuanjiEvent.AGENT_TOOL_DELTA]: { id: string; name: string; receivedBytes: number };
  [XuanjiEvent.AGENT_TOOL_END]: { id: string; name: string; result: string; isError: boolean; agentId?: string; sessionKey?: string; metadata?: any; contentBlocks?: import('@/shared/types/tools').ToolResult['contentBlocks'] };
  [XuanjiEvent.AGENT_TEXT_DELTA]: { text: string; agentId?: string };
  [XuanjiEvent.AGENT_THINKING_DELTA]: { content: string; agentId?: string };
  [XuanjiEvent.AGENT_FILE_CHANGES]: { changes: any[]; agentId?: string };
  [XuanjiEvent.AGENT_CONTENT_BLOCKS]: { contentBlocks: import('@/shared/types/agent').ContentBlock[]; agentId?: string; sessionKey?: string };
  [XuanjiEvent.AGENT_COMPLETED]: { userId?: string; iterations: number; tokenUsage: any };
  [XuanjiEvent.AGENT_ERROR]: { error: string; userId?: string };

  [XuanjiEvent.WORKSPACE_STATE_SNAPSHOT]: { nodes: any[]; edges: any[] };
  [XuanjiEvent.WORKSPACE_NODE_ADDED]: { node: any };
  [XuanjiEvent.WORKSPACE_NODE_UPDATED]: { nodeId: string; changes: any };
  [XuanjiEvent.WORKSPACE_NODE_REMOVED]: { nodeId: string };
  [XuanjiEvent.WORKSPACE_EDGE_ADDED]: { edge: any };
  [XuanjiEvent.WORKSPACE_EDGE_REMOVED]: { edgeId: string };

  [XuanjiEvent.PROVIDER_HEALTH_CHANGED]: { provider: string; healthy: boolean };
  [XuanjiEvent.PROVIDER_FALLBACK_TRIGGERED]: { from: string; to: string; reason: string };

  [XuanjiEvent.CONTEXT_COMPRESSION_STARTED]: { strategy: string; messageCount: number; originalTokens: number };
  [XuanjiEvent.CONTEXT_COMPRESSION_DONE]: { originalTokens: number; compressedTokens: number; compressionRatio: number };
  [XuanjiEvent.TOKEN_BUDGET_WARNING]: { level: string; usage: number };

  [XuanjiEvent.SESSION_SAVED]: { sessionId: string };
  [XuanjiEvent.SESSION_RESTORED]: { sessionId: string };
  [XuanjiEvent.SESSION_SWITCHED]: { sessionId: string };

  [XuanjiEvent.SYSTEM_ERROR]: { error: string; context?: any };

  // === Memory System ===
  [XuanjiEvent.MEMORY_STORED]: { type: 'entity' | 'fact' | 'event' | 'relation'; id: string; scene_tag: string };
  [XuanjiEvent.MEMORY_SEARCHED]: { query: string; type: string; resultCount: number };
  [XuanjiEvent.MEMORY_EXTRACTED]: { sessionId: string; entityCount: number; factCount: number; eventCount: number };
  [XuanjiEvent.MEMORY_MAINTENANCE]: { action: string; detail?: string };
  [XuanjiEvent.MEMORY_DELIVER_MESSAGE]: { userId: string; message: string; source: string };

  // Hook 事件 — 每个 hook 类型独立，payload = HookEventContext 展开
  [XuanjiEvent.HOOK_SUBAGENT_START]: { subAgentId: string; data: { task: string; depth: number; role: string; name: string; agentType: string; parentAgentId: string; streamToUser: boolean; scene?: string; executionMode: 'acp' | 'in-process' } };
  [XuanjiEvent.HOOK_SUBAGENT_END]: { subAgentId: string; data: { task: string; depth: number; duration: number; timedOut: boolean; success: boolean } };
  [XuanjiEvent.HOOK_SUBAGENT_TEXT]: { subAgentId: string; text: string };
  [XuanjiEvent.HOOK_TEAM_START]: { teamId: string; data: { name: string; goal?: string; strategy: string; memberCount: number; maxRounds?: number; members: any[] } };
  [XuanjiEvent.HOOK_TEAM_END]: { teamId: string; data: { name: string; success: boolean; duration: number; timedOut?: boolean; cancelled?: boolean; error?: string } };
  [XuanjiEvent.HOOK_TEAM_MEMBER_START]: { teamId: string; data: { memberId: string; subAgentId: string; name: string; role: string; task: string; agentType: string; scene?: string; executionMode?: string; strategy: string; teamName: string; stepIndex: number; totalSteps: number; currentRound?: number; maxRounds?: number; debateRole?: string; systemPromptHint?: string; recovered?: boolean } };
  [XuanjiEvent.HOOK_TEAM_MEMBER_END]: { teamId: string; data: { memberId: string; subAgentId: string; success: boolean; duration: number; resultSummary?: string; teamName?: string; retryCount?: number; failureReason?: string; recovered?: boolean } };
  [XuanjiEvent.HOOK_TEAM_SUB_MEMBER_START]: { teamId: string; parentMemberId: string; data: { memberId: string; subAgentId: string; name: string; role: string; task: string; agentType: string; scene?: string; executionMode?: string; strategy: string; teamName: string; stepIndex: number; totalSteps: number; systemPromptHint?: string } };
  [XuanjiEvent.HOOK_TEAM_SUB_MEMBER_END]: { teamId: string; parentMemberId: string; data: { memberId: string; subAgentId: string; memberName: string; success: boolean; duration: number; resultSummary?: string } };
  [XuanjiEvent.HOOK_TOOL_START]: { subAgentId: string; toolId: string; toolName: string; toolInput: Record<string, unknown> };
  [XuanjiEvent.HOOK_TOOL_END]: { subAgentId: string; toolId: string; toolName: string; toolResult: string; toolIsError: boolean };
  [XuanjiEvent.HOOK_AGENT_THINKING]: { subAgentId: string; thinkingContent: string };
  [XuanjiEvent.HOOK_SKILL_START]: { name: string };
  [XuanjiEvent.HOOK_SKILL_END]: { name: string; success: boolean };
  [XuanjiEvent.HOOK_MEMORY_READ]: { query: string; results: any[] };
  [XuanjiEvent.HOOK_MEMORY_WRITE]: { content: string };
  [XuanjiEvent.HOOK_COMPACT_PRE]: Record<string, never>;
  [XuanjiEvent.HOOK_COMPACT_POST]: { originalTokens: number; compressedTokens: number; compressionRatio: number };
  [XuanjiEvent.HOOK_BACKGROUND_TASK_START]: { taskId: string; taskType: string; name: string; model: string };
  [XuanjiEvent.HOOK_BACKGROUND_TASK_END]: { taskId: string; taskType: string; name: string; durationMs: number; success: boolean; timedOut: boolean; errorMessage?: string };
  [XuanjiEvent.HOOK_ERROR]: { errorMessage: string; errorStack?: string };
  [XuanjiEvent.HOOK_MODEL_CLASSIFIER_START]: { userInput: string; model: string };
  [XuanjiEvent.HOOK_MODEL_CLASSIFIER_END]: { userInput: string; model: string; scene: string; complexity: string; durationMs: number };
  [XuanjiEvent.HOOK_INTENT_ANALYSIS_START]: { userInput: string };
  [XuanjiEvent.HOOK_INTENT_ANALYSIS_END]: { userInput: string; scene: string; complexity: string; confidence: number; matchMethod: string; intentClassifier: string };
  [XuanjiEvent.HOOK_TASK_PLANNING_START]: { userInput: string; scene: string; complexity: string };
  [XuanjiEvent.HOOK_TASK_PLANNING_END]: { userInput: string; strategy: string; tasks: any[] };
  [XuanjiEvent.HOOK_TASK_EXECUTION_START]: { userInput: string };
  [XuanjiEvent.HOOK_TASK_EXECUTION_END]: { userInput: string; results: any[]; summary: string };
  [XuanjiEvent.HOOK_RESULT_AGGREGATION_START]: Record<string, never>;
  [XuanjiEvent.HOOK_RESULT_AGGREGATION_END]: { results: any[] };

  // === Platform Integration ===
  [XuanjiEvent.PLATFORM_MESSAGE_RECEIVED]: { sessionKey: string; platform: string; text: string; userId: string };
  [XuanjiEvent.PLATFORM_MESSAGE_SENT]: { sessionKey: string; platform: string; text: string };
  [XuanjiEvent.PLATFORM_STATUS_CHANGED]: { platform: string; status: 'online' | 'offline' | 'connecting' };
  [XuanjiEvent.PLATFORM_ERROR]: { platform: string; error: string; sessionKey?: string };
  [XuanjiEvent.PLATFORM_HEALTH_CHECK]: { results: import('@/platform/types.js').PlatformHealth[] };
  [XuanjiEvent.PLATFORM_SESSION_UPDATED]: { sessionKey: string; session: import('@/platform/types.js').RemoteSession };
}
