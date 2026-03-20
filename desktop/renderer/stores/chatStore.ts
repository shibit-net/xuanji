// ============================================================
// chatStore - 对话状态管理（真实 AgentLoop 集成）
// ============================================================

import { create } from 'zustand';
import type { PermissionRequestData, PlanReviewRequestData, AskUserRequestData } from '../global';
import { useRuntimeStore } from './runtimeStore';
import { useExecutionStore } from './executionStore';

// 消息类型
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  thinking?: boolean;
  /** 拟人化状态提示（如 "回忆中..."、"思考中..."、"编写中..."） */
  statusHint?: string;
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

  // Plan Mode 状态
  isPlanMode: boolean;
  setPlanMode: (active: boolean) => void;

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
  _handleMessagesRestored: (messages: any[]) => void;
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

  // Plan Mode 状态
  isPlanMode: false,
  setPlanMode: (active) => set({ isPlanMode: active }),

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

    // 同步更新 runtimeStore
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setProcessing(true);
    runtimeStore.incrementIteration();
    runtimeStore.resetMessageStream();
    // 初始化 agentStatus
    runtimeStore.setAgentStatus({
      name: 'Xuanji',
      status: 'idle',
    });

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

        // 同步更新 runtimeStore
        useRuntimeStore.getState().setProcessing(false);

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

      // 同步更新 runtimeStore
      useRuntimeStore.getState().setProcessing(false);

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

    // 同步更新 runtimeStore
    useRuntimeStore.getState().appendStreamText(text);

    // 如果还没有创建流式消息，创建一个
    if (!currentStreamingId) {
      const newId = `assistant-${Date.now()}`;
      const newMessage: Message = {
        id: newId,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        statusHint: '✍️ 编写回复中...',
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
            ? { ...msg, content: updatedText, statusHint: '✍️ 编写回复中...' }
            : msg
        ),
        currentStreamingText: updatedText,
      }));
    }
  },

  _handleAgentThinking: (thinking) => {
    // 同步更新 runtimeStore - 累加 thinking 内容
    const runtimeStore = useRuntimeStore.getState();

    // 手动计算累加后的完整 thinking 内容
    const currentThinking = runtimeStore.messageStream?.thinking || '';
    const fullThinking = currentThinking + thinking;

    // 累加到 messageStream
    runtimeStore.appendStreamThinking(thinking);

    // 更新 agentStatus，设置完整的 thinking 内容
    runtimeStore.updateAgentStatus({
      status: 'thinking',
      currentThought: fullThinking,
    });
    runtimeStore.setProcessing(true);

    // 更新气泡状态提示
    const { currentStreamingId } = get();
    if (currentStreamingId) {
      set((state) => ({
        status: 'thinking',
        messages: state.messages.map((msg) =>
          msg.id === currentStreamingId
            ? { ...msg, statusHint: '💭 思考中...' }
            : msg
        ),
      }));
    } else {
      set({ status: 'thinking' });
    }
  },

  _handleAgentToolStart: (data) => {
    const { activeToolCalls, currentStreamingId } = get();

    const toolCall: ToolCall = {
      id: data.id,
      name: data.name,
      status: 'pending',
      startTime: Date.now(),
    };

    // 检测 Multi-Agent 工具并提取详细信息
    let multiAgent: any = undefined;

    if (data.name === 'orchestrate' || data.name === 'agent_team') {
      const input = data.input as any;
      multiAgent = {
        type: data.name as 'orchestrate' | 'agent_team',
        strategy: input.strategy,
        teamName: input.team_name,
        members: (input.members || []).map((m: any) => ({
          id: m.id,
          name: m.name || m.role,
          role: m.role,
          status: 'idle' as const,
          progress: 0,
        })),
        totalSteps: input.members?.length || 0,
      };
    } else if (data.name === 'pipeline') {
      const input = data.input as any;
      multiAgent = {
        type: 'pipeline',
        strategy: 'pipeline',
        steps: (input.chain || []).map((step: any, index: number) => ({
          id: `step-${index}`,
          name: step.description || step.agent_id,
          description: step.task_template?.slice(0, 100),
          status: 'pending' as const,
          progress: 0,
        })),
        currentStep: 0,
        totalSteps: input.chain?.length || 0,
      };
    } else if (data.name === 'quick_team') {
      const input = data.input as any;
      multiAgent = {
        type: 'quick_team',
        teamName: input.template,
        strategy: input.template === 'code-review' ? 'sequential' :
                  input.template === 'research' ? 'parallel' :
                  input.template === 'architecture-debate' ? 'debate' :
                  input.template === 'data-pipeline' ? 'pipeline' :
                  input.template === 'feature-development' ? 'hierarchical' : undefined,
      };
    } else if (data.name === 'delegate') {
      const input = data.input as any;
      multiAgent = {
        type: 'delegate',
        subagentType: input.subagent_type || 'general-purpose',
      };
    }

    // 同步更新 runtimeStore
    useRuntimeStore.getState().addToolCall({
      id: data.id,
      name: data.name,
      status: 'running',
      input: data.input,
      startTime: Date.now(),
      multiAgent,
    });
    useRuntimeStore.getState().updateAgentStatus({
      status: 'executing',
      currentTool: { name: data.name, status: 'running' },
    });

    // 记录日志
    get().addLog('tool', `🔧 ${data.name} 开始执行`);

    // 更新活跃工具列表
    const newToolCalls = new Map(activeToolCalls);
    newToolCalls.set(data.id, toolCall);

    // 根据工具名生成拟人化状态提示
    const toolStatusHint = (() => {
      const name = data.name;
      if (name === 'bash') return '💻 执行命令中...';
      if (name === 'read') return '📖 读取文件中...';
      if (name === 'write') return '📝 写入文件中...';
      if (name === 'edit' || name === 'multi_edit') return '✏️ 修改代码中...';
      if (name === 'glob') return '🔍 扫描目录中...';
      if (name === 'grep') return '🔎 搜索内容中...';
      if (name === 'memory_search') return '🧠 检索记忆中...';
      if (name === 'memory_store') return '💾 保存记忆中...';
      if (name === 'web_search' || name === 'web_fetch') return '🌐 联网搜索中...';
      if (name === 'delegate' || name === 'orchestrate') return '🤖 调度子 Agent...';
      if (name === 'pipeline') return '🔗 运行流水线...';
      if (name === 'quick_team' || name === 'agent_team') return '👥 协作处理中...';
      if (name.startsWith('todo_')) return '📋 更新任务列表...';
      return '⚙️ 执行工具中...';
    })();

    // 如果有当前流式消息，更新状态提示（不展示具体工具名，workspace 已展示）
    if (currentStreamingId) {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === currentStreamingId
            ? { ...msg, statusHint: toolStatusHint }
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

      // 同步更新 runtimeStore
      useRuntimeStore.getState().updateToolCall(data.id, {
        status: data.isError ? 'error' : 'success',
        result: data.result,
        duration: toolCall.duration,
      });

      // 解析 TODO_PROGRESS 标记并更新 executionStore
      if (!data.isError && data.result && data.result.includes('<!--TODO_PROGRESS:')) {
        const match = data.result.match(/<!--TODO_PROGRESS:(.+?)-->/);
        if (match) {
          try {
            const progressData = JSON.parse(match[1]);
            // progressData = { completed: 1, total: 3, items: [{ id, title, description, status, activeForm }] }

            const executionStore = useExecutionStore.getState();

            // 清空现有任务（TodoManager 返回的是完整列表）
            useExecutionStore.setState({ todos: [] });

            // 添加新任务
            if (progressData.items && Array.isArray(progressData.items)) {
              progressData.items.forEach((item: any) => {
                // 先添加任务（状态默认为 pending）
                executionStore.addTodo({
                  id: item.id,
                  subject: item.title,
                  description: item.description || '',
                  activeForm: item.activeForm,
                });

                // 如果状态不是 pending，更新状态
                if (item.status !== 'pending') {
                  executionStore.updateTodo({
                    id: item.id,
                    status: item.status,
                    activeForm: item.activeForm,
                  });
                }
              });
            }
          } catch (err) {
            console.error('[chatStore] 解析 TODO_PROGRESS 失败:', err);
          }
        }
      }

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
      // agent:end 已清空 currentStreamingId，回写到最后一条 assistant 消息
      set((state) => {
        const lastAssistantIdx = [...state.messages].reverse().findIndex((m) => m.role === 'assistant');
        if (lastAssistantIdx === -1) return { activeToolCalls: newToolCalls };
        const idx = state.messages.length - 1 - lastAssistantIdx;
        return {
          messages: state.messages.map((msg, i) =>
            i === idx
              ? { ...msg, toolCalls: Array.from(newToolCalls.values()) }
              : msg
          ),
          activeToolCalls: newToolCalls,
        };
      });
    }
  },

  _handleAgentUsage: (usage) => {
    // 同步更新 runtimeStore
    useRuntimeStore.getState().addTokenUsage(
      usage.input || 0,
      usage.output || 0,
      usage.cached || 0
    );

    set((state) => ({
      stats: {
        ...state.stats,
        tokenUsage: usage,
      },
    }));
  },

  _handleAgentError: (error) => {
    // 同步更新 runtimeStore
    useRuntimeStore.getState().setProcessing(false);
    useRuntimeStore.getState().updateAgentStatus({
      status: 'error',
    });

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
    // 同步更新 runtimeStore
    useRuntimeStore.getState().finishMessageStream();
    useRuntimeStore.getState().setProcessing(false);
    useRuntimeStore.getState().updateAgentStatus({
      status: 'done',
    });

    // 将所有仍在 pending 的工具标记为 success（防止 agent:end 先于 agent:tool-end 到达）
    const { activeToolCalls, currentStreamingId } = get();
    const finalizedToolCalls = Array.from(activeToolCalls.values()).map((tc) => {
      if (tc.status === 'pending') {
        return {
          ...tc,
          status: 'success' as const,
          duration: tc.startTime ? Date.now() - tc.startTime : undefined,
        };
      }
      return tc;
    });

    set((prevState) => ({
      status: 'idle',
      currentStreamingId: null,
      currentStreamingText: '',
      activeToolCalls: new Map(),
      // 清除 statusHint + 写入最终工具状态
      messages: currentStreamingId
        ? prevState.messages.map((msg) =>
            msg.id === currentStreamingId
              ? { ...msg, statusHint: undefined, toolCalls: finalizedToolCalls }
              : msg
          )
        : prevState.messages,
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

  _handleMessagesRestored: (messages) => {
    // 将 HistoryMessage[] 转换为 Message[]
    const restoredMessages: Message[] = messages.map((msg: any, index: number) => ({
      id: `restored-${msg.timestamp}-${index}`,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      toolCalls: msg.toolCalls?.map((tc: any) => ({
        id: tc.id,
        name: tc.name,
        status: tc.status === 'success' ? 'success' : 'error',
        startTime: msg.timestamp,
      })),
    }));

    // 替换当前消息列表（恢复会话时应该清空现有消息）
    set({
      messages: restoredMessages,
      status: 'idle',
    });

    // 记录日志
    get().addLog('info', `已恢复 ${restoredMessages.length} 条历史消息`);
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

  // Plan Mode 事件监听
  window.electron.onPlanModeEnter(() => {
    useChatStore.getState().setPlanMode(true);
  });

  window.electron.onPlanModeExit(() => {
    useChatStore.getState().setPlanMode(false);
  });

  // 会话事件监听
  window.electron.onSessionMessagesRestored((data) => {
    useChatStore.getState()._handleMessagesRestored(data.messages);
  });

  // 启动引导（防重复）
  let bootThinkingReceived = false;
  let bootGuideReceived = false;

  window.electron.on('session:boot-thinking', () => {
    if (bootThinkingReceived || bootGuideReceived) return;
    bootThinkingReceived = true;
    useChatStore.getState().addMessage({
      id: `boot-thinking-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      statusHint: '🧠 回忆往事中...',
    });
  });

  window.electron.on('session:boot-guide', (data: { message: string }) => {
    if (bootGuideReceived) return;
    bootGuideReceived = true;
    const state = useChatStore.getState();
    // 找到 thinking 占位消息，替换为实际内容
    const thinkingMsg = state.messages.find(m => m.id.startsWith('boot-thinking-'));
    if (thinkingMsg) {
      state.updateMessage(thinkingMsg.id, {
        content: data.message,
        statusHint: undefined,
      });
    } else {
      state.addMessage({
        id: `boot-guide-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        timestamp: Date.now(),
      });
    }
  });
}
