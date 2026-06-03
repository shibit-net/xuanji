/**
 * EventForwarder — 声明式 EventBus → IPC 事件转发器。
 *
 * 替代 agent-bridge.ts 中 registerHookEventBridge() 的 260+ 行命令式代码。
 * 提供统一的注册/注销机制，支持 agentId 自动映射。
 */

import { eventBus, XuanjiEvent } from '@/infrastructure/events';
import { logger } from '@/infrastructure/logger';

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
  private getCurrentUserId: () => string | null;
  private getRoutedAgentId: () => string;
  private mappings: EventMapping[] = [];
  private unsubscribes: (() => void)[] = [];

  constructor(sender: IpcSender, getCurrentUserId: () => string | null, getRoutedAgentId: () => string) {
    this.sender = sender;
    this.getCurrentUserId = getCurrentUserId;
    this.getRoutedAgentId = getRoutedAgentId;
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
  // agentId 映射
  // ============================================================

  /**
   * 将 EventBus 事件中的 agentId/userId 映射到正确值：
   * - 根 agent 的 AgentLoop._userId === currentUserId，替换为 routedAgentId
   * - 子 agent 的 AgentLoop._userId 是其 subAgentId，保留原值
   */
  private mapAgentId(agentId?: string): string {
    const cu = this.getCurrentUserId();
    const ra = this.getRoutedAgentId();
    const result = (agentId && agentId !== cu) ? agentId : ra;
    if (agentId !== result) {
      log.info(`[DIAG] mapAgentId: input=${agentId} currentUserId=${cu} routedAgentId=${ra} → mapped=${result}`);
    }
    return result;
  }

  // ============================================================
  // 映射表定义
  // ============================================================

  private buildMappings(): EventMapping[] {
    return [
      // ── Session 级 ──
      {
        event: XuanjiEvent.AGENT_STARTED,
        channel: 'agent:started',
        map: (p) => ({
          model: p.model,
          agentId: this.mapAgentId(p.userId),
          isForeground: !p.userId || p.userId === this.getCurrentUserId(),
          sessionKey: p.sessionKey,
        }),
      },
      {
        event: XuanjiEvent.AGENT_COMPLETED,
        channel: 'agent:end',
        map: (p) => ({
          tokenUsage: p.tokenUsage,
          agentId: p.userId || this.getRoutedAgentId(),
          sessionKey: p.sessionKey,
        }),
      },
      {
        event: XuanjiEvent.CONVERSATION_STATE_CHANGED,
        channel: 'agent:conversation-state',
        map: (p) => ({ from: p.from, to: p.to }),
      },

      // ── Agent 生命周期 ──
      {
        event: XuanjiEvent.HOOK_SUBAGENT_START,
        channel: 'agent:subagent-start',
        map: (p) => ({
          subAgentId: p.subAgentId,
          ...p.data,
        }),
      },
      {
        event: XuanjiEvent.HOOK_SUBAGENT_END,
        channel: 'agent:subagent-end',
        map: (p) => ({
          subAgentId: p.subAgentId,
          ...p.data,
        }),
      },
      {
        event: XuanjiEvent.HOOK_SUBAGENT_TEXT,
        channel: 'agent:subagent-text',
        map: (p) => ({ agentId: p.subAgentId, subAgentId: p.subAgentId, text: p.text }),
      },

      // ── Thinking（合并 HOOK_AGENT_THINKING 到同一 channel） ──
      {
        event: XuanjiEvent.AGENT_THINKING_DELTA,
        channel: 'agent:thinking',
        map: (p) => ({ content: p.content, agentId: this.mapAgentId(p.agentId), sessionKey: p.sessionKey }),
      },
      {
        event: XuanjiEvent.HOOK_AGENT_THINKING,
        channel: 'agent:thinking',
        map: (p) => ({ content: p.thinkingContent, agentId: p.subAgentId }),
      },

      // ── Text ──
      {
        event: XuanjiEvent.AGENT_TEXT_DELTA,
        channel: 'agent:text',
        map: (p) => ({ text: p.text, agentId: this.mapAgentId(p.agentId), sessionKey: p.sessionKey }),
      },

      // ── Content Blocks（模型原生内容块：图像/音频/视频） ──
      {
        event: XuanjiEvent.AGENT_CONTENT_BLOCKS,
        channel: 'agent:content-blocks',
        map: (p) => ({ contentBlocks: p.contentBlocks, agentId: this.mapAgentId(p.agentId), sessionKey: p.sessionKey }),
      },

      // ── Tool ──
      {
        event: XuanjiEvent.AGENT_TOOL_START,
        channel: 'agent:tool-start',
        map: (p) => ({ id: p.id, name: p.name, input: p.input, agentId: this.mapAgentId(p.agentId), sessionKey: p.sessionKey }),
      },
      {
        event: XuanjiEvent.AGENT_TOOL_END,
        channel: 'agent:tool-end',
        map: (p) => ({
          id: p.id, name: p.name,
          result: p.result, isError: p.isError,
          agentId: this.mapAgentId(p.agentId),
          metadata: p.metadata,
          contentBlocks: p.contentBlocks,
          sessionKey: p.sessionKey,
        }),
      },

      // ── Team ──
      {
        event: XuanjiEvent.HOOK_TEAM_START,
        channel: 'agent:team-start',
        map: (p) => ({ taskType: 'team', teamId: p.teamId, ...p.data }),
      },
      {
        event: XuanjiEvent.HOOK_TEAM_MEMBER_START,
        channel: 'agent:team-member-start',
        map: (p) => ({ taskType: 'team', teamId: p.teamId, ...p.data }),
      },
      {
        event: XuanjiEvent.HOOK_TEAM_MEMBER_END,
        channel: 'agent:team-member-end',
        map: (p) => ({ taskType: 'team', teamId: p.teamId, ...p.data }),
      },
      {
        event: XuanjiEvent.HOOK_TEAM_SUB_MEMBER_START,
        channel: 'agent:team-submember-start',
        map: (p) => ({ taskType: 'team', teamId: p.teamId, ...p.data }),
      },
      {
        event: XuanjiEvent.HOOK_TEAM_SUB_MEMBER_END,
        channel: 'agent:team-submember-end',
        map: (p) => ({ taskType: 'team', teamId: p.teamId, ...p.data }),
      },
      {
        event: XuanjiEvent.HOOK_TEAM_END,
        channel: 'agent:team-end',
        map: (p) => ({ taskType: 'team', teamId: p.teamId, ...p.data }),
      },

      // ── Skill ──
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

      // ── Memory ──
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

      // ── Context compression ──
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

      // ── Background task lifecycle ──
      {
        event: XuanjiEvent.HOOK_BACKGROUND_TASK_START,
        channel: 'agent:background-task-start',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_BACKGROUND_TASK_END,
        channel: 'agent:background-task-end',
        map: (p) => p,
      },

      // ── File changes（事件源: AGENT_FILE_CHANGES） ──
      {
        event: XuanjiEvent.AGENT_FILE_CHANGES,
        channel: 'agent:file-changes',
        map: (p) => ({ changes: p.changes, sessionKey: p.sessionKey }),
      },

      // ── Token usage ──
      {
        event: XuanjiEvent.AGENT_USAGE,
        channel: 'agent:usage',
        map: (p) => ({ tokenUsage: p.tokenUsage, agentId: this.mapAgentId(p.userId), sessionKey: p.sessionKey }),
      },

      // ── Error ──
      {
        event: XuanjiEvent.AGENT_ERROR,
        channel: 'agent:error',
        map: (p) => p.error,
      },

      // ── Prompt components ──
      {
        event: XuanjiEvent.AGENT_PROMPT_COMPONENTS,
        channel: 'agent:prompt-components',
        map: (p) => p,
      },

      // ── Async task ──
      {
        event: XuanjiEvent.ASYNC_TASK_FAILED,
        channel: 'agent:task-failed',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.ASYNC_TASK_COMPLETED,
        channel: 'agent:task-completed',
        map: (p) => p,
      },

      // ── Workspace 流程事件 ──
      {
        event: XuanjiEvent.HOOK_MODEL_CLASSIFIER_START,
        channel: 'workspace:model-classifier-start',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_MODEL_CLASSIFIER_END,
        channel: 'workspace:model-classifier-end',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_INTENT_ANALYSIS_START,
        channel: 'workspace:intent-analysis-start',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_INTENT_ANALYSIS_END,
        channel: 'workspace:intent-analysis-end',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_TASK_PLANNING_START,
        channel: 'workspace:task-planning-start',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_TASK_PLANNING_END,
        channel: 'workspace:task-planning-end',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_TASK_EXECUTION_START,
        channel: 'workspace:task-execution-start',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_TASK_EXECUTION_END,
        channel: 'workspace:task-execution-end',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_RESULT_AGGREGATION_START,
        channel: 'workspace:result-aggregation-start',
        map: (p) => p,
      },
      {
        event: XuanjiEvent.HOOK_RESULT_AGGREGATION_END,
        channel: 'workspace:result-aggregation-end',
        map: (p) => p,
      },
    ];
  }

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
