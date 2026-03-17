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
} from '../types/models';

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

  // ========== 重置 ==========
  reset: () => void;
  resetAll: () => void;
}

const initialState: RuntimeState = {
  agentStatus: null,
  messageStream: null,
  tokenUsage: { input: 0, output: 0, cached: 0 },
  cost: 0,
  currentIteration: 0,
  isProcessing: false,
  contextInfo: null,
  logs: [],
};

const initialMessageStream: MessageStreamState = {
  text: '',
  thinking: '',
  toolCalls: [],
  finished: false,
};

export const useRuntimeStore = create<RuntimeStoreState>()((set, get) => ({
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
      const currentStream = state.messageStream || initialMessageStream;

      // 检查是否已存在相同 ID 的工具调用
      const existingIndex = currentStream.toolCalls.findIndex((tc) => tc.id === toolCall.id);

      // 如果已存在，不重复添加（避免 React key 重复警告）
      if (existingIndex !== -1) {
        console.warn(`[addToolCall] 工具调用 ID 已存在: ${toolCall.id}，跳过添加`);
        return {};
      }

      return {
        messageStream: {
          ...currentStream,
          toolCalls: [...currentStream.toolCalls, toolCall],
        },
      };
    }),

  updateToolCall: (id, updates) =>
    set((state) => {
      if (!state.messageStream) return {};
      const toolCalls = state.messageStream.toolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...updates } : tc
      );
      return {
        messageStream: {
          ...state.messageStream,
          toolCalls,
        },
      };
    }),

  finishMessageStream: () =>
    set((state) => ({
      messageStream: state.messageStream
        ? { ...state.messageStream, finished: true }
        : null,
    })),

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

  // ========== 重置 ==========
  reset: () =>
    set({
      messageStream: null,
      agentStatus: null,
      isProcessing: false,
    }),

  resetAll: () => set(initialState),
}));
