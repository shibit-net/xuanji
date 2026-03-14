// ============================================================
// chatStore - 对话状态管理（真实 AgentLoop 集成）
// ============================================================

import { create } from 'zustand';
import type { PermissionRequestData, PlanReviewRequestData, AskUserRequestData } from '../global';

// 消息类型
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  thinking?: boolean;
  toolCalls?: ToolCall[];
}

// 工具调用
export interface ToolCall {
  id: string;
  name: string;
  status: 'pending' | 'success' | 'error';
  duration?: number;
  startTime?: number;
}

// 状态类型
export type ChatStatus = 'idle' | 'thinking' | 'executing';

// Store 类型
interface ChatStore {
  // 状态
  messages: Message[];
  status: ChatStatus;
  currentSkill: {
    name: string;
    icon: string;
  } | null;
  stats: {
    model: string;
    tokenUsage: {
      input: number;
      output: number;
    };
    cost: number;
  };

  // 当前流式消息
  currentStreamingId: string | null;
  currentStreamingText: string;
  activeToolCalls: Map<string, ToolCall>;

  // 权限交互状态
  permissionRequest: PermissionRequestData | null;
  planReviewRequest: PlanReviewRequestData | null;
  askUserRequest: AskUserRequestData | null;

  // 日志流
  logs: Array<{ timestamp: number; level: string; message: string }>;

  // 操作
  sendMessage: (content: string) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setStatus: (status: ChatStatus) => void;
  clearMessages: () => void;
  reset: () => void;

  // 权限交互操作
  setPermissionRequest: (request: PermissionRequestData | null) => void;
  setPlanReviewRequest: (request: PlanReviewRequestData | null) => void;
  setAskUserRequest: (request: AskUserRequestData | null) => void;

  // 日志操作
  addLog: (level: string, message: string) => void;
  clearLogs: () => void;

  // 内部方法
  _handleAgentText: (text: string) => void;
  _handleAgentThinking: (thinking: string) => void;
  _handleAgentToolStart: (data: { id: string; name: string; input: Record<string, unknown> }) => void;
  _handleAgentToolEnd: (data: { id: string; name: string; result: string; isError: boolean }) => void;
  _handleAgentUsage: (usage: any) => void;
  _handleAgentError: (error: string) => void;
  _handleAgentEnd: (state: any) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // 初始状态
  messages: [],
  status: 'idle',
  currentSkill: null,
  stats: {
    model: 'Claude Haiku 4',
    tokenUsage: {
      input: 0,
      output: 0,
    },
    cost: 0,
  },

  currentStreamingId: null,
  currentStreamingText: '',
  activeToolCalls: new Map(),

  // 权限交互状态
  permissionRequest: null,
  planReviewRequest: null,
  askUserRequest: null,

  // 日志流
  logs: [],

  // 操作
  sendMessage: async (content) => {
    // 添加用户消息
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      status: 'thinking',
    }));

    // 调用真实的 Agent
    try {
      const result = await window.electron.agentSendMessage(content);

      if (!result.success) {
        // 发送失败，添加错误消息
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `❌ 错误：${result.error || '未知错误'}`,
          timestamp: Date.now(),
        };

        set((state) => ({
          messages: [...state.messages, errorMessage],
          status: 'idle',
        }));
      }
    } catch (err) {
      // 调用失败
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ 错误：${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };

      set((state) => ({
        messages: [...state.messages, errorMessage],
        status: 'idle',
      }));
    }
  },

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    })),

  setStatus: (status) => set({ status }),

  clearMessages: () => set({ messages: [], status: 'idle' }),

  reset: async () => {
    await window.electron.agentReset();
    set({
      messages: [],
      status: 'idle',
      currentStreamingId: null,
      currentStreamingText: '',
      activeToolCalls: new Map(),
    });
  },

  // ============================================================
  // 权限交互操作
  // ============================================================

  setPermissionRequest: (request) => set({ permissionRequest: request }),
  setPlanReviewRequest: (request) => set({ planReviewRequest: request }),
  setAskUserRequest: (request) => set({ askUserRequest: request }),

  // ============================================================
  // 日志操作
  // ============================================================

  addLog: (level, message) =>
    set((state) => ({
      logs: [
        ...state.logs,
        { timestamp: Date.now(), level, message },
      ].slice(-100), // 最多保留 100 条
    })),

  clearLogs: () => set({ logs: [] }),

  // ============================================================
  // Agent 流式事件处理器
  // ============================================================

  _handleAgentText: (text) => {
    const { currentStreamingId, currentStreamingText } = get();

    // 如果还没有创建流式消息，创建一个
    if (!currentStreamingId) {
      const newId = `assistant-${Date.now()}`;
      const newMessage: Message = {
        id: newId,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        toolCalls: [],
      };

      set((state) => ({
        messages: [...state.messages, newMessage],
        currentStreamingId: newId,
        currentStreamingText: text,
      }));
    } else {
      // 追加文本到当前流式消息
      const updatedText = currentStreamingText + text;

      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === currentStreamingId
            ? { ...msg, content: updatedText }
            : msg
        ),
        currentStreamingText: updatedText,
      }));
    }
  },

  _handleAgentThinking: (thinking) => {
    set({ status: 'thinking' });
  },

  _handleAgentToolStart: (data) => {
    const { activeToolCalls, currentStreamingId } = get();

    const toolCall: ToolCall = {
      id: data.id,
      name: data.name,
      status: 'pending',
      startTime: Date.now(),
    };

    // 记录日志
    get().addLog('tool', `🔧 ${data.name} 开始执行`);

    // 更新活跃工具列表
    const newToolCalls = new Map(activeToolCalls);
    newToolCalls.set(data.id, toolCall);

    // 如果有当前流式消息，更新它的 toolCalls
    if (currentStreamingId) {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === currentStreamingId
            ? { ...msg, toolCalls: Array.from(newToolCalls.values()) }
            : msg
        ),
        activeToolCalls: newToolCalls,
        status: 'executing',
      }));
    } else {
      set({ activeToolCalls: newToolCalls, status: 'executing' });
    }
  },

  _handleAgentToolEnd: (data) => {
    const { activeToolCalls, currentStreamingId } = get();

    // 更新工具状态
    const newToolCalls = new Map(activeToolCalls);
    const toolCall = newToolCalls.get(data.id);

    if (toolCall) {
      toolCall.status = data.isError ? 'error' : 'success';
      // 计算 duration
      if (toolCall.startTime) {
        toolCall.duration = Date.now() - toolCall.startTime;
      }
      newToolCalls.set(data.id, toolCall);

      // 记录日志
      const statusIcon = data.isError ? '❌' : '✅';
      const durationText = toolCall.duration ? ` (${toolCall.duration}ms)` : '';
      get().addLog('tool', `${statusIcon} ${data.name} ${data.isError ? '执行失败' : '执行完成'}${durationText}`);
    }

    // 更新消息的 toolCalls
    if (currentStreamingId) {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === currentStreamingId
            ? { ...msg, toolCalls: Array.from(newToolCalls.values()) }
            : msg
        ),
        activeToolCalls: newToolCalls,
      }));
    } else {
      set({ activeToolCalls: newToolCalls });
    }
  },

  _handleAgentUsage: (usage) => {
    set((state) => ({
      stats: {
        ...state.stats,
        tokenUsage: usage,
      },
    }));
  },

  _handleAgentError: (error) => {
    // 添加错误消息
    const errorMessage: Message = {
      id: `error-${Date.now()}`,
      role: 'assistant',
      content: `❌ 错误：${error}`,
      timestamp: Date.now(),
    };

    // 添加到日志
    get().addLog('error', error);

    set((state) => ({
      messages: [...state.messages, errorMessage],
      status: 'idle',
      currentStreamingId: null,
      currentStreamingText: '',
      activeToolCalls: new Map(),
    }));
  },

  _handleAgentEnd: (state) => {
    set((prevState) => ({
      status: 'idle',
      currentStreamingId: null,
      currentStreamingText: '',
      activeToolCalls: new Map(),
      stats: {
        ...prevState.stats,
        model: state.model || prevState.stats.model,
        tokenUsage: state.tokenUsage,
        cost: state.cost,
      },
      // 更新当前 Skill
      currentSkill: state.currentSkill ? {
        name: state.currentSkill.name,
        icon: state.currentSkill.icon || '🛠️',
      } : prevState.currentSkill,
    }));
  },
}));

// ============================================================
// 初始化事件监听器
// ============================================================

if (typeof window !== 'undefined' && window.electron) {
  // 初始化时获取配置，更新 model 名称
  window.electron.agentInit().then((result) => {
    if (result.success && result.config?.model) {
      useChatStore.setState((state) => ({
        stats: { ...state.stats, model: result.config.model },
      }));
    }
  }).catch(() => {});

  // 绑定流式事件监听器
  window.electron.onAgentText((text) => {
    useChatStore.getState()._handleAgentText(text);
  });

  window.electron.onAgentThinking((thinking) => {
    useChatStore.getState()._handleAgentThinking(thinking);
  });

  window.electron.onAgentToolStart((data) => {
    useChatStore.getState()._handleAgentToolStart(data);
  });

  window.electron.onAgentToolEnd((data) => {
    useChatStore.getState()._handleAgentToolEnd(data);
  });

  window.electron.onAgentUsage((usage) => {
    useChatStore.getState()._handleAgentUsage(usage);
  });

  window.electron.onAgentError((error) => {
    useChatStore.getState()._handleAgentError(error);
  });

  window.electron.onAgentEnd((state) => {
    useChatStore.getState()._handleAgentEnd(state);
  });

  // 权限交互事件监听
  window.electron.onPermissionRequest((data) => {
    useChatStore.getState().setPermissionRequest(data);
  });

  window.electron.onPlanReviewRequest((data) => {
    useChatStore.getState().setPlanReviewRequest(data);
  });

  window.electron.onAskUserRequest((data) => {
    useChatStore.getState().setAskUserRequest(data);
  });
}
