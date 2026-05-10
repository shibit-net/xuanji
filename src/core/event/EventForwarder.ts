/**
 * EventForwarder — 替代 agent-bridge.ts 中 registerHookEventBridge() 的 400+ 行。
 *
 * 声明式映射表：EventBus Event → IPC channel，统一注册/注销。
 * - Agent 生命周期事件
 * - Hook 事件（subagent / team / skill / memory）
 * - AsyncTask 事件
 * - 合并 agent:thinking 和 agent:thinking-start
 * - 消除 team-exec- 前缀 hack，改用 taskType 字段
 */

import { eventBus, XuanjiEvent } from '@/core/events';
import { logger } from '@/core/logger';
import type { AsyncTaskStateMachine, AsyncTaskEvent } from '@/core/task/AsyncTaskStateMachine';

const log = logger.child({ module: 'EventForwarder' });

export type IpcSender = (channel: string, data: any) => void;

interface EventMapping {
  event: XuanjiEvent;
  channel: string;
  map: (payload: any) => any;
}

// ============================================================
// EventForwarder
// ============================================================

export class EventForwarder {
  private sender: IpcSender;
  private mappings: EventMapping[] = [];
  private asyncTaskStateMachine: AsyncTaskStateMachine | null = null;
  private unsubscribes: (() => void)[] = [];

  constructor(sender: IpcSender) {
    this.sender = sender;
  }

  /** 注入 AsyncTaskStateMachine 以监听其状态变更 */
  setAsyncTaskStateMachine(machine: AsyncTaskStateMachine): void {
    this.asyncTaskStateMachine = machine;
  }

  /** 注册所有事件映射 */
  register(): void {
    this.mappings = this.buildMappings();

    for (const { event, channel, map } of this.mappings) {
      const unsub = eventBus.on(event, (payload) => {
        try {
          const data = map(payload);
          this.safeSend(channel, data);
        } catch (err) {
          log.error(`EventForwarder map error [${event} → ${channel}]:`, err);
        }
      });
      this.unsubscribes.push(unsub);
    }

    // 注册 AsyncTaskStateMachine 回调
    if (this.asyncTaskStateMachine) {
      this.asyncTaskStateMachine.onTaskStateChanged((task, event) => {
        this.safeSend('agent:async-task-update', this.mapTaskState(task, event));
      });
    }

    log.info(`EventForwarder registered ${this.mappings.length} event mappings`);
  }

  /** 注销所有事件映射 */
  unregister(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.mappings = [];
    log.info('EventForwarder unregistered all mappings');
  }

  // ============================================================
  // 映射表定义
  // ============================================================

  private buildMappings(): EventMapping[] {
    return [
      // Session 级
      {
        event: XuanjiEvent.AGENT_STARTED,
        channel: 'agent:started',
        map: this.mapSession,
      },
      {
        event: XuanjiEvent.AGENT_COMPLETED,
        channel: 'agent:completed',
        map: this.mapSession,
      },
      {
        event: XuanjiEvent.CONVERSATION_STATE_CHANGED,
        channel: 'agent:conversation-state',
        map: (p) => p,
      },

      // Agent 生命周期
      {
        event: XuanjiEvent.HOOK_SUBAGENT_START,
        channel: 'agent:subagent-start',
        map: this.mapSubAgent,
      },
      {
        event: XuanjiEvent.HOOK_SUBAGENT_END,
        channel: 'agent:subagent-end',
        map: this.mapSubAgent,
      },
      {
        event: XuanjiEvent.HOOK_SUBAGENT_TEXT,
        channel: 'agent:subagent-text',
        map: (p) => ({ subAgentId: p.subAgentId, text: p.text }),
      },

      // Thinking（合并 thinking-start，两事件语义相同）
      {
        event: XuanjiEvent.AGENT_THINKING_DELTA,
        channel: 'agent:thinking',
        map: (p) => ({ content: p.content, agentId: p.agentId }),
      },
      {
        event: XuanjiEvent.HOOK_AGENT_THINKING,
        channel: 'agent:thinking',
        map: (p) => ({ content: p.thinkingContent, agentId: p.subAgentId }),
      },

      // Text
      {
        event: XuanjiEvent.AGENT_TEXT_DELTA,
        channel: 'agent:text',
        map: (p) => ({ text: p.text, agentId: p.agentId }),
      },

      // Tool
      {
        event: XuanjiEvent.AGENT_TOOL_START,
        channel: 'agent:tool-start',
        map: this.mapTool,
      },
      {
        event: XuanjiEvent.AGENT_TOOL_END,
        channel: 'agent:tool-end',
        map: this.mapTool,
      },

      // Team
      {
        event: XuanjiEvent.HOOK_TEAM_START,
        channel: 'agent:team-start',
        map: this.mapTeam,
      },
      {
        event: XuanjiEvent.HOOK_TEAM_MEMBER_START,
        channel: 'agent:team-member-start',
        map: this.mapTeamMember,
      },
      {
        event: XuanjiEvent.HOOK_TEAM_MEMBER_END,
        channel: 'agent:team-member-end',
        map: this.mapTeamMember,
      },
      {
        event: XuanjiEvent.HOOK_TEAM_END,
        channel: 'agent:team-end',
        map: this.mapTeam,
      },

      // Skill
      {
        event: XuanjiEvent.HOOK_SKILL_START,
        channel: 'agent:skill-start',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_SKILL_END,
        channel: 'agent:skill-end',
        map: (p) => p,
      },

      // Memory
      {
        event: XuanjiEvent.HOOK_MEMORY_READ,
        channel: 'agent:memory-read',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_MEMORY_WRITE,
        channel: 'agent:memory-write',
        map: (p) => p,
      },

      // Context compression
      {
        event: XuanjiEvent.HOOK_COMPACT_PRE,
        channel: 'agent:compress-start',
        map: () => ({}),
      },
      {
        event: XuanjiEvent.HOOK_COMPACT_POST,
        channel: 'agent:compress-end',
        map: (p) => p,
      },

      // Citation（事件源: AGENT_FILE_CHANGES）
      {
        event: XuanjiEvent.AGENT_FILE_CHANGES,
        channel: 'agent:citation',
        map: (p) => ({ changes: p.changes, agentId: p.agentId }),
      },

      // Error
      {
        event: XuanjiEvent.AGENT_ERROR,
        channel: 'agent:error',
        map: (p) => p,
      },
    ];
  }

  // ============================================================
  // payload 映射工具
  // ============================================================

  private mapSession = (p: any) => p;

  private mapSubAgent = (p: any) => ({
    subAgentId: p.subAgentId,
    ...p.data,
  });

  private mapTool = (p: any) => ({
    id: p.id,
    name: p.name,
    agentId: p.agentId,
    ...(p.input ? { input: p.input } : {}),
    ...(p.result !== undefined ? { result: p.result, isError: p.isError } : {}),
  });

  private mapTeam = (p: any) => ({
    taskType: 'team',
    teamId: p.teamId,
    ...p.data,
  });

  private mapTeamMember = (p: any) => ({
    taskType: 'team',
    teamId: p.teamId,
    ...p.data,
  });

  private mapTaskState = (task: any, event: AsyncTaskEvent) => ({
    taskId: task.taskId,
    taskType: task.taskType,
    name: task.name,
    status: task.status,
    parentAgentId: task.parentAgentId,
    subAgentIds: [...task.subAgentIds],
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    error: task.error,
    eventType: event.type,
  });

  // ============================================================
  // 安全发送
  // ============================================================

  private safeSend(channel: string, data: any): void {
    try {
      this.sender(channel, data);
    } catch (err) {
      log.error(`EventForwarder send error [${channel}]:`, err);
    }
  }
}
