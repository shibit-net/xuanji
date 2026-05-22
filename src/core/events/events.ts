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
  ASYNC_TASK_STARTED = 'async.task.started',
  ASYNC_TASK_PROGRESS = 'async.task.progress',
  ASYNC_TASK_COMPLETED = 'async.task.completed',
  ASYNC_TASK_FAILED = 'async.task.failed',

  // === Agent ===
  AGENT_CREATED = 'agent.created',
  AGENT_PROMPT_COMPONENTS = 'agent.prompt.components',
  AGENT_STARTED = 'agent.started',
  AGENT_TOOL_START = 'agent.tool.start',
  AGENT_TOOL_DELTA = 'agent.tool.delta',
  AGENT_TOOL_END = 'agent.tool.end',
  AGENT_TEXT_DELTA = 'agent.text.delta',
  AGENT_THINKING_DELTA = 'agent.thinking.delta',
  AGENT_FILE_CHANGES = 'agent.file.changes',
  AGENT_COMPLETED = 'agent.completed',
  AGENT_USAGE = 'agent.usage',
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

  // === Memory System ===
  MEMORY_STORED = 'memory:stored',
  MEMORY_SEARCHED = 'memory:searched',
  MEMORY_EXTRACTED = 'memory:extracted',
  MEMORY_MAINTENANCE = 'memory:maintenance',
  MEMORY_LEARNING_PROGRESS = 'memory:learning:progress',
  MEMORY_DELIVER_MESSAGE = 'deliver:message',

  // === Hook Bridge（每个 hook 类型独立 EventBus 事件）===
  HOOK_SUBAGENT_START = 'hook.subagent.start',
  HOOK_SUBAGENT_END = 'hook.subagent.end',
  HOOK_SUBAGENT_TEXT = 'hook.subagent.text',
  HOOK_TEAM_START = 'hook.team.start',
  HOOK_TEAM_END = 'hook.team.end',
  HOOK_TEAM_MEMBER_START = 'hook.team.member.start',
  HOOK_TEAM_MEMBER_END = 'hook.team.member.end',
  HOOK_TEAM_SUB_MEMBER_START = 'hook.team.submember.start',
  HOOK_TEAM_SUB_MEMBER_END = 'hook.team.submember.end',
  HOOK_TOOL_START = 'hook.tool.start',
  HOOK_TOOL_END = 'hook.tool.end',
  HOOK_AGENT_THINKING = 'hook.agent.thinking',
  HOOK_SKILL_START = 'hook.skill.start',
  HOOK_SKILL_END = 'hook.skill.end',
  HOOK_MEMORY_READ = 'hook.memory.read',
  HOOK_MEMORY_WRITE = 'hook.memory.write',
  HOOK_COMPACT_PRE = 'hook.compact.pre',
  HOOK_COMPACT_POST = 'hook.compact.post',
  HOOK_ERROR = 'hook.error',
  HOOK_MODEL_CLASSIFIER_START = 'hook.model-classifier.start',
  HOOK_MODEL_CLASSIFIER_END = 'hook.model-classifier.end',
  HOOK_INTENT_ANALYSIS_START = 'hook.intent-analysis.start',
  HOOK_INTENT_ANALYSIS_END = 'hook.intent-analysis.end',
  HOOK_TASK_PLANNING_START = 'hook.task-planning.start',
  HOOK_TASK_PLANNING_END = 'hook.task-planning.end',
  HOOK_TASK_EXECUTION_START = 'hook.task-execution.start',
  HOOK_TASK_EXECUTION_END = 'hook.task-execution.end',
  HOOK_RESULT_AGGREGATION_START = 'hook.result-aggregation.start',
  HOOK_RESULT_AGGREGATION_END = 'hook.result-aggregation.end',

  // === Platform Integration ===
  PLATFORM_MESSAGE_RECEIVED = 'platform.message.received',
  PLATFORM_MESSAGE_SENT = 'platform.message.sent',
  PLATFORM_STATUS_CHANGED = 'platform.status.changed',
  PLATFORM_ERROR = 'platform.error',
  PLATFORM_HEALTH_CHECK = 'platform.health.check',
  PLATFORM_SESSION_UPDATED = 'platform.session.updated',
}
