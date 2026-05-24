// ============================================================
// Event Types - 统一的事件类型定义
// ============================================================

/**
 * 事件来源
 */
export type EventSource = 'main' | 'child' | 'renderer';

/**
 * 基础事件接口
 */
export interface BaseEvent {
  type: string;
  data: any;
  timestamp: number;
  source?: EventSource;
}

/**
 * Agent 相关事件类型
 */
export type AgentEventType =
  // 基础事件
  | 'agent:text'
  | 'agent:thinking'
  | 'agent:thinking-start'
  | 'agent:tool-start'
  | 'agent:tool-end'
  | 'agent:file-changes'
  | 'agent:usage'
  | 'agent:error'
  | 'agent:end'
  // SubAgent 事件
  | 'agent:subagent-start'
  | 'agent:subagent-end'
  // Team 事件
  | 'agent:team-start'
  | 'agent:team-member-start'
  | 'agent:team-member-end'
  | 'agent:team-member-text'
  | 'agent:team-member-thinking'
  | 'agent:team-end'
  // 压缩事件
  | 'agent:compress-start'
  | 'agent:compress-end'
  // 后台任务事件
  | 'agent:background-task-start'
  | 'agent:background-task-end'
  // Memory 事件
  | 'agent:memory-read'
  | 'agent:memory-write'
  // Skill 事件
  | 'agent:skill-start'
  | 'agent:skill-end';

/**
 * Workspace 相关事件类型
 */
export type WorkspaceEventType =
  | 'workspace:intent-analysis-start'
  | 'workspace:intent-analysis-end'
  | 'workspace:model-classifier-start'
  | 'workspace:model-classifier-end'
  | 'workspace:task-planning-start'
  | 'workspace:task-planning-end'
  | 'workspace:task-execution-start'
  | 'workspace:task-execution-end'
  | 'workspace:result-aggregation-start'
  | 'workspace:result-aggregation-end';

/**
 * 权限相关事件类型
 */
export type PermissionEventType =
  | 'permission:request'
  | 'permission:response';

/**
 * Plan 相关事件类型
 */
export type PlanEventType =
  | 'plan-review:request'
  | 'plan-review:response'
  | 'plan-mode:enter'
  | 'plan-mode:exit';

/**
 * Session 相关事件类型
 */
export type SessionEventType =
  | 'session:messages-restored'
  | 'session:resume-notification'
  | 'session:archive-notification'
  | 'session:boot-thinking'
  | 'session:boot-guide';

/**
 * 其他事件类型
 */
export type OtherEventType =
  | 'ask-user:request'
  | 'ask-user:response'
  | 'prompt:build-event'
  | 'project:info'
  | 'download:event'
  | 'child-ready'
  | 'config-result'
  | 'state-result'
  | 'update-config-result';

/**
 * 所有事件类型
 */
export type EventType =
  | AgentEventType
  | WorkspaceEventType
  | PermissionEventType
  | PlanEventType
  | SessionEventType
  | OtherEventType;

/**
 * 事件数据类型映射
 */
export interface EventDataMap {
  // Agent 事件
  'agent:text': { text: string };
  'agent:thinking': { thinking: string };
  'agent:tool-start': { id: string; name: string; input: Record<string, unknown>; agentId?: string };
  'agent:tool-end': { id: string; name: string; result: string; isError: boolean; agentId?: string };
  'agent:subagent-start': {
    subAgentId: string;
    name: string;
    role: string;
    task: string;
    agentType?: 'preset' | 'builtin' | 'custom' | 'temporary';
    parentId: string;
  };
  'agent:subagent-end': {
    subAgentId: string;
    success: boolean;
    duration?: number;
    error?: string;
  };
  'agent:background-task-start': {
    taskId: string;
    taskType: string;
    name: string;
    model: string;
  };
  'agent:background-task-end': {
    taskId: string;
    taskType: string;
    name: string;
    durationMs: number;
    success: boolean;
    timedOut: boolean;
    errorMessage?: string;
  };
  'agent:team-start': {
    teamId: string;
    name: string;
    strategy?: string;
    memberCount?: number;
    members?: Array<{
      id: string;
      name?: string;
      role?: string;
      capabilities?: string[];
      stepIndex?: number;
    }>;
  };
  'agent:team-member-start': {
    teamId: string;
    memberId: string;
    subAgentId?: string;
    name?: string;
    role?: string;
    task?: string;
    agentType?: 'preset' | 'builtin' | 'custom' | 'temporary';
    strategy?: string;
    teamName?: string;
    stepIndex?: number;
  };
  // ... 其他事件的数据类型
}

/**
 * 类型安全的事件接口
 */
export interface TypedEvent<T extends EventType> extends BaseEvent {
  type: T;
  data: T extends keyof EventDataMap ? EventDataMap[T] : any;
}
