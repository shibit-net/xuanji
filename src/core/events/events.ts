/**
 * XuanjiEvent — 全局事件枚举
 *
 * 模块间通过 EventBus 通信，所有事件类型集中定义在此。
 */

export enum XuanjiEvent {
  // === 对话管理中心 ===
  CONVERSATION_STATE_CHANGED = 'conv.state.changed',
  USER_INPUT_RECEIVED = 'conv.input.received',
  INTENT_ANALYZED = 'conv.intent.analyzed',
  RESPONSE_STARTED = 'conv.response.started',
  RESPONSE_COMPLETED = 'conv.response.completed',

  // === 任务管理中心 ===
  TASK_CREATED = 'task.created',
  TASK_QUEUED = 'task.queued',
  TASK_STARTED = 'task.started',
  TASK_STEP_STARTED = 'task.step.started',
  TASK_STEP_COMPLETED = 'task.step.completed',
  TASK_COMPLETED = 'task.completed',
  TASK_FAILED = 'task.failed',
  TASK_CANCELLED = 'task.cancelled',
  TASK_TERMINATED = 'task.terminated',
  ASYNC_TASK_STARTED = 'async.task.started',
  ASYNC_TASK_PROGRESS = 'async.task.progress',
  ASYNC_TASK_COMPLETED = 'async.task.completed',
  ASYNC_TASK_FAILED = 'async.task.failed',

  // === Agent ===
  AGENT_CREATED = 'agent.created',
  AGENT_STARTED = 'agent.started',
  AGENT_TOOL_START = 'agent.tool.start',
  AGENT_TOOL_DELTA = 'agent.tool.delta',
  AGENT_TOOL_END = 'agent.tool.end',
  AGENT_TEXT_DELTA = 'agent.text.delta',
  AGENT_THINKING_DELTA = 'agent.thinking.delta',
  AGENT_FILE_CHANGES = 'agent.file.changes',
  AGENT_COMPLETED = 'agent.completed',
  AGENT_ERROR = 'agent.error',

  // === Workspace Monitor ===
  WORKSPACE_STATE_SNAPSHOT = 'workspace.state.snapshot',
  WORKSPACE_NODE_ADDED = 'workspace.node.added',
  WORKSPACE_NODE_UPDATED = 'workspace.node.updated',
  WORKSPACE_NODE_REMOVED = 'workspace.node.removed',
  WORKSPACE_EDGE_ADDED = 'workspace.edge.added',
  WORKSPACE_EDGE_REMOVED = 'workspace.edge.removed',

  // === Provider ===
  PROVIDER_HEALTH_CHANGED = 'provider.health.changed',
  PROVIDER_FALLBACK_TRIGGERED = 'provider.fallback.triggered',

  // === Context ===
  CONTEXT_COMPRESSION_STARTED = 'context.compression.started',
  CONTEXT_COMPRESSION_DONE = 'context.compression.done',
  TOKEN_BUDGET_WARNING = 'context.token.warning',

  // === Session ===
  SESSION_SAVED = 'session.saved',
  SESSION_RESTORED = 'session.restored',
  SESSION_SWITCHED = 'session.switched',

  // === System ===
  SYSTEM_ERROR = 'system.error',
}
