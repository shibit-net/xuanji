// ============================================================
// Xuanji Desktop - 运行时 Store (Runtime Store)
// ============================================================
// 职责：
// - 管理 Agent 执行的运行时状态
// - 流式消息状态
// - Token 使用统计
// - 成本计算
// - 所有数据易失，不持久化
// ============================================================

import { create } from 'zustand';
import type {
  AgentStatus,
  MessageStreamState,
  TokenUsage,
  RuntimeState,
  ToolCallState,
  ContextInfo,
  LogEntry,
  PromptBuildState,
  PromptComponent,
} from '../types/models';
import type { AgentMoment, HistoryDot, TimelineEvent, RecentEvent } from '../components/WorkspaceMonitor/types';

// ─── 活动事件（供 WorkspaceMonitor 消费）─────────────────────

export interface ActivityEvent {
  agentId: string;      // 'main' 或子 agent id
  moment: AgentMoment;
}

interface AgentActivityState {
  /** 当前正在进行的动作，keyed by agentId */
  currentMoments: Record<string, AgentMoment>;
  /** 历史点阵，keyed by agentId，最多8条 */
  momentHistories: Record<string, HistoryDot[]>;
  /** 时间条事件，keyed by agentId，最多5条 */
  timelineEvents: Record<string, TimelineEvent[]>;
  /** 左下角事件流，最多20条 */
  recentEvents: RecentEvent[];
  /** 运行开始时间 */
  runStartTime: number | null;
}

interface RuntimeStoreState extends RuntimeState {
  // ========== Agent 状态操作 ==========
  setAgentStatus: (status: AgentStatus | null) => void;
  updateAgentStatus: (updates: Partial<AgentStatus>) => void;

  // ========== 消息流操作 ==========
  updateMessageStream: (stream: Partial<MessageStreamState>) => void;
  appendStreamText: (text: string) => void;
  appendStreamThinking: (thinking: string) => void;
  addToolCall: (toolCall: ToolCallState) => void;
  updateToolCall: (id: string, updates: Partial<ToolCallState>) => void;
  removeToolCall: (id: string) => void;
  /** 更新 multiAgent 工具调用中某个成员的状态（用于 TeamMember 事件动态更新） */
  updateToolCallMember: (toolCallId: string, memberId: string, updates: {
    status?: 'idle' | 'running' | 'success' | 'error';
    duration?: number;
    tokenUsage?: number;
    progress?: number;
  }) => void;
  finishMessageStream: () => void;
  resetMessageStream: () => void;

  // ========== Token 和成本操作 ==========
  updateTokenUsage: (usage: Partial<TokenUsage>) => void;
  addTokenUsage: (input: number, output: number, cached?: number) => void;
  setCost: (cost: number) => void;
  addCost: (cost: number) => void;

  // ========== 执行状态操作 ==========
  setProcessing: (isProcessing: boolean) => void;
  incrementIteration: () => void;
  setIteration: (iteration: number) => void;

  // ========== 上下文操作 ==========
  setContextInfo: (context: ContextInfo | null) => void;
  updateContextInfo: (updates: Partial<ContextInfo>) => void;

  // ========== 日志操作 ==========
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;

  // ========== 每次 LLM call 的 token 增量 ==========
  /** 本轮 LLM call 的 token 增量（每次 onUsage 事件时更新，run 结束时清零） */
  currentCallTokens: TokenUsage;
  setCurrentCallTokens: (tokens: TokenUsage) => void;
  resetCurrentCallTokens: () => void;

  // ========== Agent 活动状态（Workspace Monitor 用）==========
  agentActivity: AgentActivityState;
  /** 设置某 agent 的当前动作 */
  setAgentMoment: (agentId: string, moment: AgentMoment) => void;
  /** 完成某 agent 的当前动作（记入历史，清空 current） */
  finishAgentMoment: (agentId: string, status: 'success' | 'error') => void;
  /** 添加时间条事件 */
  addTimelineEvent: (agentId: string, event: TimelineEvent) => void;
  /** 完成时间条事件 */
  finishTimelineEvent: (agentId: string, eventId: string, duration: number, status: 'success' | 'error') => void;
  /** 添加左下角事件流 */
  addRecentEvent: (event: Omit<RecentEvent, 'id' | 'timestamp'>) => void;
  /** 设置运行开始时间 */
  setRunStartTime: (t: number | null) => void;
  /** 清空 activity 状态 */
  resetActivity: () => void;

  // ========== Prompt 构建状态操作 ==========
  setPromptBuildState: (state: PromptBuildState | null) => void;
  updatePromptBuildState: (updates: Partial<PromptBuildState>) => void;
  startPromptBuild: () => void;
  setPromptIntent: (intent: PromptBuildState['intent']) => void;
  addPromptComponent: (component: PromptComponent) => void;
  finishPromptBuild: (finalStructure: PromptBuildState['finalStructure']) => void;
  resetPromptBuildState: () => void;

  // ========== 重置 ==========
  reset: () => void;
  resetAll: () => void;
}

const initialActivityState: AgentActivityState = {
  currentMoments: {},
  momentHistories: {},
  timelineEvents: {},
  recentEvents: [],
  runStartTime: null,
};

const initialState: RuntimeState & { currentCallTokens: TokenUsage; agentActivity: AgentActivityState } = {
  agentStatus: null,
  messageStream: null,
  tokenUsage: { input: 0, output: 0, cached: 0 },
  cost: 0,
  currentIteration: 0,
  isProcessing: false,
  contextInfo: null,
  logs: [],
  promptBuildState: null,
  currentCallTokens: { input: 0, output: 0, cached: 0 },
  agentActivity: initialActivityState,
};

const initialMessageStream: MessageStreamState = {
  text: '',
  thinking: '',
  toolCalls: [],
  finished: false,
};

export const useRuntimeStore = create<RuntimeStoreState>()((set) => ({
  ...initialState,
  // ========== Agent 状态操作 ==========
  setAgentStatus: (status) => set({ agentStatus: status }),

  updateAgentStatus: (updates) =>
    set((state) => ({
      agentStatus: state.agentStatus ? { ...state.agentStatus, ...updates } : null,
    })),

  // ========== 消息流操作 ==========
  updateMessageStream: (stream) =>
    set((state) => ({
      messageStream: state.messageStream
        ? { ...state.messageStream, ...stream }
        : { ...initialMessageStream, ...stream },
    })),

  appendStreamText: (text) =>
    set((state) => ({
      messageStream: state.messageStream
        ? { ...state.messageStream, text: state.messageStream.text + text }
        : { ...initialMessageStream, text },
    })),

  appendStreamThinking: (thinking) =>
    set((state) => ({
      messageStream: state.messageStream
        ? { ...state.messageStream, thinking: state.messageStream.thinking + thinking }
        : { ...initialMessageStream, thinking },
    })),

  addToolCall: (toolCall) =>
    set((state) => {
      console.log('[runtimeStore] ===== addToolCall 被调用 =====');
      console.log('[runtimeStore] 工具:', toolCall.name, '(', toolCall.id, ')');
      console.log('[runtimeStore] messageStream 存在:', !!state.messageStream);

      const currentStream = state.messageStream || initialMessageStream;

      // 检查是否已存在相同 ID 的工具调用
      const existingIndex = currentStream.toolCalls.findIndex((tc) => tc.id === toolCall.id);

      // 如果已存在，检查是否需要更新（新数据更完整）
      if (existingIndex !== -1) {
        const existing = currentStream.toolCalls[existingIndex];

        // 判断新数据是否更完整：有 multiAgent 且包含 members
        const hasMoreData = toolCall.multiAgent &&
                           toolCall.multiAgent.members &&
                           toolCall.multiAgent.members.length > 0;
        const existingHasLessData = !existing.multiAgent ||
                                   !existing.multiAgent.members ||
                                   existing.multiAgent.members.length === 0;

        if (hasMoreData && existingHasLessData) {
          console.log('[runtimeStore] 工具调用已存在但新数据更完整，更新:', toolCall.id);
          const newToolCalls = [...currentStream.toolCalls];
          newToolCalls[existingIndex] = { ...existing, ...toolCall };
          return {
            messageStream: {
              ...currentStream,
              toolCalls: newToolCalls,
            },
          };
        } else {
          console.warn('[runtimeStore] 工具调用 ID 已存在且无需更新，跳过:', toolCall.id);
          return {};
        }
      }

      console.log('[runtimeStore] 添加工具到 toolCalls 数组');
      console.log('[runtimeStore] 添加前 toolCalls 数量:', currentStream.toolCalls.length);

      const newToolCalls = [...currentStream.toolCalls, toolCall];
      console.log('[runtimeStore] 添加后 toolCalls 数量:', newToolCalls.length);

      return {
        messageStream: {
          ...currentStream,
          toolCalls: newToolCalls,
        },
      };
    }),

  updateToolCall: (id, updates) =>
    set((state) => {
      console.log('[runtimeStore] ===== updateToolCall 被调用 =====');
      console.log('[runtimeStore] 工具 ID:', id);
      console.log('[runtimeStore] 更新内容:', updates);
      console.log('[runtimeStore] messageStream 存在:', !!state.messageStream);

      if (!state.messageStream) {
        console.log('[runtimeStore] messageStream 为 null，跳过更新');
        return {};
      }

      console.log('[runtimeStore] 更新前的 toolCalls:', state.messageStream.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        status: tc.status,
      })));

      const toolCalls = state.messageStream.toolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...updates } : tc
      );

      console.log('[runtimeStore] 更新后的 toolCalls:', toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        status: tc.status,
      })));

      return {
        messageStream: {
          ...state.messageStream,
          toolCalls,
        },
      };
    }),

  removeToolCall: (id) =>
    set((state) => {
      console.log('[runtimeStore] ===== removeToolCall 被调用 =====');
      console.log('[runtimeStore] 工具 ID:', id);

      if (!state.messageStream) {
        console.log('[runtimeStore] messageStream 为 null，跳过移除');
        return {};
      }

      const toolCalls = state.messageStream.toolCalls.filter((tc) => tc.id !== id);

      console.log('[runtimeStore] 移除后的 toolCalls 数量:', toolCalls.length);

      return {
        messageStream: {
          ...state.messageStream,
          toolCalls,
        },
      };
    }),

  updateToolCallMember: (toolCallId, memberId, updates) =>
    set((state) => {
      if (!state.messageStream) return {};
      const toolCalls = state.messageStream.toolCalls.map((tc) => {
        if (tc.id !== toolCallId || !tc.multiAgent?.members) return tc;
        return {
          ...tc,
          multiAgent: {
            ...tc.multiAgent,
            members: tc.multiAgent.members.map((m) =>
              m.id === memberId ? { ...m, ...updates } : m
            ),
          },
        };
      });
      return { messageStream: { ...state.messageStream, toolCalls } };
    }),

  finishMessageStream: () =>
    set((state) => {
      if (!state.messageStream) return {};
      // 将所有仍在 running 的工具标记为 success（防止 agent:end 先于 agent:tool-end 到达）
      const toolCalls = state.messageStream.toolCalls.map((tc) =>
        tc.status === 'running'
          ? { ...tc, status: 'success' as const, duration: tc.startTime ? Date.now() - tc.startTime : undefined }
          : tc
      );
      return {
        messageStream: { ...state.messageStream, toolCalls, finished: true },
      };
    }),

  resetMessageStream: () => set({ messageStream: null }),

  // ========== Token 和成本操作 ==========
  updateTokenUsage: (usage) =>
    set((state) => ({
      tokenUsage: { ...state.tokenUsage, ...usage },
    })),

  addTokenUsage: (input, output, cached = 0) =>
    set((state) => ({
      tokenUsage: {
        input: state.tokenUsage.input + input,
        output: state.tokenUsage.output + output,
        cached: (state.tokenUsage.cached || 0) + cached,
      },
    })),

  setCost: (cost) => set({ cost }),

  addCost: (cost) => set((state) => ({ cost: state.cost + cost })),

  // ========== 执行状态操作 ==========
  setProcessing: (isProcessing) => set({ isProcessing }),

  incrementIteration: () =>
    set((state) => ({ currentIteration: state.currentIteration + 1 })),

  setIteration: (iteration) => set({ currentIteration: iteration }),

  // ========== 上下文操作 ==========
  setContextInfo: (context) => set({ contextInfo: context }),

  updateContextInfo: (updates) =>
    set((state) => ({
      contextInfo: state.contextInfo ? { ...state.contextInfo, ...updates } : null,
    })),

  // ========== 日志操作 ==========
  addLog: (log) =>
    set((state) => {
      const newLog: LogEntry = {
        ...log,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
      };
      // 保留最新 1000 条日志
      const logs = [...state.logs, newLog].slice(-1000);
      return { logs };
    }),

  clearLogs: () => set({ logs: [] }),

  // ========== 每次 LLM call 的 token 增量 ==========
  setCurrentCallTokens: (tokens) => set({ currentCallTokens: tokens }),
  resetCurrentCallTokens: () => set({ currentCallTokens: { input: 0, output: 0, cached: 0 } }),

  // ========== Agent 活动状态 ==========
  setAgentMoment: (agentId, moment) =>
    set((state) => {
      console.log('[runtimeStore] setAgentMoment 被调用:', { agentId, moment });
      console.log('[runtimeStore] setAgentMoment 之前的 currentMoments:', state.agentActivity.currentMoments);
      const newState = {
        agentActivity: {
          ...state.agentActivity,
          currentMoments: { ...state.agentActivity.currentMoments, [agentId]: moment },
        },
      };
      console.log('[runtimeStore] setAgentMoment 之后的 currentMoments:', newState.agentActivity.currentMoments);
      return newState;
    }),

  finishAgentMoment: (agentId, status) =>
    set((state) => {
      console.log('[runtimeStore] finishAgentMoment 被调用:', { agentId, status });
      console.log('[runtimeStore] finishAgentMoment 之前的 currentMoments:', state.agentActivity.currentMoments);
      const current = state.agentActivity.currentMoments[agentId];
      if (!current) {
        console.log('[runtimeStore] finishAgentMoment: 没有找到 currentMoment，跳过');
        return {};
      }

      // 清除 currentMoment（不需要历史记录）
      const newMoments = { ...state.agentActivity.currentMoments };
      delete newMoments[agentId];
      console.log('[runtimeStore] finishAgentMoment 之后的 currentMoments:', newMoments);

      return {
        agentActivity: {
          ...state.agentActivity,
          currentMoments: newMoments,
        },
      };
    }),

  addTimelineEvent: (agentId, event) =>
    set((state) => {
      console.log('[runtimeStore] addTimelineEvent 被调用:', { agentId, event });
      const prev = state.agentActivity.timelineEvents[agentId] || [];
      const newEvents = [...prev, event].slice(-5);
      console.log('[runtimeStore] 更新后的 timelineEvents:', newEvents);
      return {
        agentActivity: {
          ...state.agentActivity,
          timelineEvents: {
            ...state.agentActivity.timelineEvents,
            [agentId]: newEvents,
          },
        },
      };
    }),

  finishTimelineEvent: (agentId, eventId, duration, status) =>
    set((state) => {
      const prev = state.agentActivity.timelineEvents[agentId] || [];
      console.log('[runtimeStore] finishTimelineEvent called:', { agentId, eventId, duration, status });
      console.log('[runtimeStore] Current timeline events for agent:', prev);

      // 更新事件状态，而不是删除
      const updated = prev.map((e) =>
        e.id === eventId
          ? { ...e, status, duration, endTime: Date.now() }
          : e
      );
      console.log('[runtimeStore] After updating:', updated);

      return {
        agentActivity: {
          ...state.agentActivity,
          timelineEvents: {
            ...state.agentActivity.timelineEvents,
            [agentId]: updated,
          },
        },
      };
    }),

  addRecentEvent: (evt) =>
    set((state) => {
      const newEvt: RecentEvent = {
        ...evt,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
      };
      return {
        agentActivity: {
          ...state.agentActivity,
          recentEvents: [...state.agentActivity.recentEvents, newEvt].slice(-20),
        },
      };
    }),

  setRunStartTime: (t) =>
    set((state) => ({
      agentActivity: { ...state.agentActivity, runStartTime: t },
    })),

  resetActivity: () =>
    set({ agentActivity: initialActivityState }),

  // ========== Prompt 构建状态操作 ==========
  setPromptBuildState: (state) => set({ promptBuildState: state }),

  updatePromptBuildState: (updates) =>
    set((state) => ({
      promptBuildState: state.promptBuildState
        ? { ...state.promptBuildState, ...updates }
        : null,
    })),

  startPromptBuild: () =>
    set({
      promptBuildState: {
        status: 'analyzing',
        startTime: Date.now(),
        selectedComponents: [],
      },
    }),

  setPromptIntent: (intent) =>
    set((state) => ({
      promptBuildState: state.promptBuildState
        ? { ...state.promptBuildState, status: 'selecting', intent }
        : null,
    })),

  addPromptComponent: (component) =>
    set((state) => {
      if (!state.promptBuildState) return {};
      return {
        promptBuildState: {
          ...state.promptBuildState,
          status: 'building',
          selectedComponents: [...state.promptBuildState.selectedComponents, component],
        },
      };
    }),

  finishPromptBuild: (finalStructure) =>
    set((state) => ({
      promptBuildState: state.promptBuildState
        ? {
            ...state.promptBuildState,
            status: 'done',
            endTime: Date.now(),
            finalStructure,
          }
        : null,
    })),

  resetPromptBuildState: () => set({ promptBuildState: null }),

  // ========== 重置 ==========
  reset: () =>
    set({
      messageStream: null,
      agentStatus: null,
      isProcessing: false,
    }),

  resetAll: () => set(initialState),
}));
