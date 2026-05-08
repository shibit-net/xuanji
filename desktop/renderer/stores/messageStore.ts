// ============================================================
// messageStore - 消息与流式处理状态管理
// 包含所有消息流式处理、团队编排、子Agent 生命周期逻辑
// ============================================================

import { create } from 'zustand';
import { useRuntimeStore } from './runtimeStore';
import { useActiveAgentStore } from './activeAgentStore';
import { useExecutionStore } from './executionStore';
import { useSessionStore } from './sessionStore';

// ── 消息数量上限（防止 OOM）──
const MAX_MESSAGES = 500;
const MAX_CITATIONS_PER_AGENT = 50;

function trimMessages(messages: Message[]): Message[] {
  if (messages.length > MAX_MESSAGES) {
    return messages.slice(-Math.floor(MAX_MESSAGES / 2));
  }
  return messages;
}

// ── 任务文本最小展示时间（3 秒）──
export const TASK_DISPLAY_MIN_MS = 3000;
export const agentTaskDisplayStart: Record<string, number> = {};
export const agentThinkingBuffer: Record<string, string> = {};

/** 记录子 agent 任务文本开始展示的时间，供 thinking handler 做缓冲 */
export function markTaskDisplayStart(agentId: string): void {
  agentTaskDisplayStart[agentId] = Date.now();
  agentThinkingBuffer[agentId] = '';
}


// ============================================================
// 工具函数
// ============================================================

/** 工具名称格式化：write_file → Write file */
function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function throttle<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = (...args: Parameters<T>) => {
    lastArgs = args;
    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        if (lastArgs) { func(...lastArgs); }
        timeoutId = null;
        lastArgs = null;
      }, delay);
    }
  };

  throttled.cancel = () => {
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; lastArgs = null; }
  };

  return throttled;
}

// ============================================================
// 类型定义
// ============================================================

let messageIdCounter = 0;
export function generateMessageId(prefix = 'msg'): string {
  return `${prefix}-${Date.now()}-${++messageIdCounter}`;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  thinking?: boolean;
  statusHint?: string;
  toolCalls?: ToolCall[];
  toolSummary?: boolean;
  duration?: number;
  tokensUsed?: { input: number; output: number };
  agentId?: string;
}

export interface SubAgentReference {
  agentName: string;
  originalOutput: string;
  duration: number;
  tokensUsed: { input: number; output: number };
}

interface PendingSubAgent {
  subAgentId: string;
  name: string;
  role: string;
  task: string;
  agentType: 'preset' | 'builtin' | 'custom' | 'temporary';
  parentId: string;
  streamToUser: boolean;
  scene: string | undefined;
  startTime: number;
  executionMode: 'acp' | 'in-process';
}

export interface ToolCall {
  id: string;
  name: string;
  status: 'pending' | 'success' | 'error' | 'running';
  duration?: number;
  startTime?: number;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export type ChatStatus = 'idle' | 'thinking' | 'executing';

// ============================================================
// 工具摘要生成
// ============================================================

function cleanDiffContent(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map(line => line.replace(/^\s*\d+\s*│\s*/, ''))
    .join('\n')
    .trim();
}

function extractDiffStats(result: string): { added: number; removed: number } | null {
  const statsMatch = result.match(/统计:\s*\+(\d+)\s*-(\d+)/);
  if (statsMatch) {
    return { added: parseInt(statsMatch[1], 10), removed: parseInt(statsMatch[2], 10) };
  }
  return null;
}

function extractDiffContent(result: string): string | null {
  const lines = result.split('\n');
  const separatorIndex = lines.findIndex(line => line.includes('─'.repeat(10)));
  if (separatorIndex === -1) return null;
  const diffLines = lines.slice(separatorIndex + 2);
  const cleanedDiff = cleanDiffContent(diffLines.join('\n'));
  return cleanedDiff || null;
}

function generateToolSummaryMessage(
  toolName: string,
  input: Record<string, unknown>,
  result: string
): string {
  const filePath = (input.path || input.file_path) as string | undefined;
  if (!filePath) return '';

  switch (toolName) {
    case 'write_file': {
      const stats = extractDiffStats(result);
      const diffContent = extractDiffContent(result);
      if (stats && diffContent) {
        return `✅ **已更新文件** \`${filePath}\`\n\n` +
               `📊 变更：+${stats.added} 行，-${stats.removed} 行\n\n` +
               `\`\`\`diff\n${diffContent}\n\`\`\``;
      }
      const content = input.content as string;
      const lines = content.split('\n').length;
      const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
      return `✅ **已创建文件** \`${filePath}\`\n\n` +
             `📊 共 ${lines} 行\n\n` +
             `<details>\n<summary>查看内容预览</summary>\n\n` +
             `\`\`\`\n${preview}\n\`\`\`\n\n</details>`;
    }
    case 'edit_file': {
      const stats = extractDiffStats(result);
      const diffContent = extractDiffContent(result);
      if (stats && diffContent) {
        const replaceAll = input.replace_all as boolean;
        const countInfo = replaceAll ? '（批量替换）' : '';
        return `✅ **已编辑文件** \`${filePath}\`${countInfo}\n\n` +
               `📊 变更：+${stats.added} 行，-${stats.removed} 行\n\n` +
               `\`\`\`diff\n${diffContent}\n\`\`\``;
      }
      const oldString = (input.old_string as string || '').slice(0, 100);
      const newString = (input.new_string as string || '').slice(0, 100);
      return `✅ **已编辑文件** \`${filePath}\`\n\n` +
             `<details>\n<summary>查看修改详情</summary>\n\n` +
             `**原内容：**\n\`\`\`\n${oldString}${oldString.length >= 100 ? '...' : ''}\n\`\`\`\n\n` +
             `**新内容：**\n\`\`\`\n${newString}${newString.length >= 100 ? '...' : ''}\n\`\`\`\n\n</details>`;
    }
    case 'multi_edit': {
      const edits = input.edits as Array<any>;
      if (!edits || edits.length === 0) return '';
      const fileCount = new Set(edits.map(e => e.file_path)).size;
      const totalEdits = edits.length;
      const editList = edits.slice(0, 3).map(e =>
        `- \`${e.file_path}\`：${(e.old_string || '').slice(0, 30)}... → ${(e.new_string || '').slice(0, 30)}...`
      ).join('\n');
      return `✅ **批量编辑完成**\n\n` +
             `📁 涉及 ${fileCount} 个文件，共 ${totalEdits} 处修改\n\n` +
             `<details>\n<summary>查看修改列表</summary>\n\n${editList}\n\n` +
             (edits.length > 3 ? `... 还有 ${edits.length - 3} 处修改\n\n` : '') +
             `</details>`;
    }
    default:
      return '';
  }
}

// ============================================================
// 子 agent 流式输出：每个子 agent 独立的消息气泡
// 模块级作用域，同时供 create 内部方法和外部 EventBridge 访问
// ============================================================
const subAgentStreamState: Record<string, { messageId: string; agentName: string; buffer: string }> = {};

// ============================================================
// Store 接口
// ============================================================

interface MessageStore {
  messages: Message[];
  status: ChatStatus;
  currentStreamingId: string | null;
  currentStreamingText: string;
  activeToolCalls: Map<string, ToolCall>;
  citationOutputs: Record<string, SubAgentReference[]>;
  stats: { model: string; tokenUsage: { input: number; output: number }; cost: number };
  currentSkill: { name: string; icon: string } | null;

  // 编排状态
  _teamIdMap: Record<string, string>;
  _teamParentMap: Record<string, string>;
  _taskParentMap: Record<string, { toolId: string; agentId: string }>;
  _streamToUserMap: Record<string, string>;
  _subAgentStreams: Record<string, string>;
  _pendingSubAgents: Record<string, PendingSubAgent>;
  _autoSummarizeActive: boolean;
  _conversationState: string;

  // 操作
  sendMessage: (content: string) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setStatus: (status: ChatStatus) => void;
  clearMessages: () => void;
  reset: () => void;
  getCitationOutput: (agentName: string) => SubAgentReference | null;

  // 内部方法
  _handleAgentText: (text: string) => void;
  _handleAgentThinking: (thinking: string) => void;
  _handleAgentToolStart: (data: { id: string; name: string; input: Record<string, unknown>; agentId?: string }) => void;
  _handleAgentToolEnd: (data: { id: string; name: string; result: string; isError: boolean; agentId?: string }) => void;
  _handleAgentUsage: (usage: any) => void;
  _handleAgentError: (error: string) => void;
  _handleAgentEnd: (state: any) => void;
  _handleSubAgentText: (agentId: string, agentName: string, text: string) => void;
  _handleTeamStart: (data: {
    teamId: string; name: string; strategy?: string; memberCount?: number;
    members?: Array<{ id: string; name?: string; role?: string; capabilities?: string[]; stepIndex?: number }>;
  }) => void;
  _handleTeamMemberStart: (data: {
    teamId: string; memberId: string; name?: string; role?: string; task?: string;
    agentType?: 'preset' | 'builtin' | 'custom'; strategy?: string; teamName?: string;
    stepIndex?: number; totalSteps?: number; currentRound?: number; maxRounds?: number;
    systemPromptHint?: string;
  }) => void;
  _handleTeamMemberEnd: (data: { teamId: string; memberId: string; success?: boolean; duration?: number; resultSummary?: string }) => void;
  _handleTeamEnd: (data: { teamId: string; name: string; success: boolean; duration?: number; error?: string }) => void;
  _promoteSubAgent: (subAgentId: string) => void;
}

// ============================================================
// Store 实现
// ============================================================

export const useMessageStore = create<MessageStore>((set, get) => {
  // ── 流式文本缓冲 ──────────────────────────────
  let streamTextBuffer = '';
  let streamingMessageId: string | null = null;
  let isAgentEnded = false;

  const flushStreamText = () => {
    if (!streamingMessageId || !streamTextBuffer) {
      if (!streamingMessageId && streamTextBuffer) {
        console.warn('[messageStore] flushStreamText: streamingMessageId 为 null 但有缓冲文本，丢弃:', streamTextBuffer.substring(0, 100));
      }
      return;
    }
    const messageId = streamingMessageId;
    const text = streamTextBuffer;
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? { ...msg, content: text, statusHint: isAgentEnded ? undefined : '✍️ 编写回复中...' }
          : msg
      ),
      currentStreamingText: text,
    }));
  };

  const throttledFlushStreamText = throttle(flushStreamText, 150);

  const flushSubAgentStreams = () => {
    const entries = Object.entries(subAgentStreamState);
    if (entries.length === 0) return;
    set((state) => ({
      messages: state.messages.map((msg) => {
        for (const [, st] of entries) {
          if (msg.id === st.messageId && st.buffer) {
            return { ...msg, content: st.buffer, statusHint: '✍️ ' + st.agentName + ' 编写中...' };
          }
        }
        return msg;
      }),
    }));
  };

  const throttledFlushSubAgentStreams = throttle(flushSubAgentStreams, 150);

  return {
    // ── 初始状态 ──────────────────────────────
    messages: [],
    status: 'idle',
    currentSkill: null,
    stats: { model: 'Claude Haiku 4', tokenUsage: { input: 0, output: 0 }, cost: 0 },
    currentStreamingId: null,
    currentStreamingText: '',
    activeToolCalls: new Map(),
    citationOutputs: {},

    _teamIdMap: {},
    _teamParentMap: {},
    _taskParentMap: {},
    _streamToUserMap: {},
    _subAgentStreams: {},
    _pendingSubAgents: {},
    _autoSummarizeActive: false,
    _conversationState: 'idle',

    // ── 操作 ──────────────────────────────────

    sendMessage: async (content) => {
      const convState = get()._conversationState;
      const isRunning = convState === 'executing' || convState === 'outputting';

      // ── 流式输出中追加消息：先封口当前气泡，新回复开新气泡 ──
      if (isRunning) {
        flushStreamText();
        const finalizedId = streamingMessageId;
        streamTextBuffer = '';
        streamingMessageId = null;
        isAgentEnded = false;
        for (const key of Object.keys(subAgentStreamState)) {
          delete subAgentStreamState[key];
        }
        if (finalizedId) {
          set((s) => ({
            messages: s.messages.map((msg) =>
              msg.id === finalizedId ? { ...msg, statusHint: undefined } : msg
            ),
            currentStreamingId: null,
            currentStreamingText: '',
            _subAgentStreams: {},
          }));
        }
      } else {
        isAgentEnded = false;
        streamTextBuffer = '';
        streamingMessageId = null;
        for (const key of Object.keys(subAgentStreamState)) {
          delete subAgentStreamState[key];
        }
      }

      const userMessage: Message = {
        id: generateMessageId('user'),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      if (!isRunning) {
        const runtimeStore = useRuntimeStore.getState();
        runtimeStore.setProcessing(true);
        runtimeStore.incrementIteration();
        runtimeStore.resetMessageStream();
        runtimeStore.setRunStartTime(Date.now());
        runtimeStore.setAgentStatus({ id: 'main', name: 'Xuanji', status: 'idle' });

        const currentMain = useActiveAgentStore.getState().mainAgent;
        if (!currentMain) {
          useActiveAgentStore.getState().startMainAgent('Xuanji', 'xuanji');
        } else {
          useActiveAgentStore.getState().setAgentStatus(currentMain.id, 'thinking');
        }
      }

      set((state) => ({
        messages: trimMessages([...state.messages, userMessage]),
        status: isRunning ? state.status : 'thinking',
      }));

      try {
        const result = await window.electron.agentSendMessage(content);
        if (!result.success) {
          const errorMessage: Message = {
            id: generateMessageId('error'),
            role: 'assistant',
            content: `❌ 错误：${(result as any).error || '未知错误'}`,
            timestamp: Date.now(),
          };
          useRuntimeStore.getState().setProcessing(false);
          set((state) => ({
            messages: trimMessages([...state.messages, errorMessage]),
            status: 'idle',
          }));
        }
      } catch (err) {
        const errorMessage: Message = {
          id: generateMessageId('error'),
          role: 'assistant',
          content: `❌ 错误：${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        };
        useRuntimeStore.getState().setProcessing(false);
        set((state) => ({
          messages: trimMessages([...state.messages, errorMessage]),
          status: 'idle',
        }));
      }
    },

    addMessage: (message) =>
      set((state) => ({ messages: trimMessages([...state.messages, message]) })),

    updateMessage: (id, updates) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === id ? { ...msg, ...updates } : msg
        ),
      })),

    setStatus: (status) => set({ status }),

    clearMessages: () => {
      streamTextBuffer = '';
      streamingMessageId = null;
      for (const key of Object.keys(subAgentStreamState)) delete subAgentStreamState[key];
      set({ messages: [], status: 'idle', _subAgentStreams: {} });
    },

    reset: async () => {
      await window.electron.agentReset();
      streamTextBuffer = '';
      streamingMessageId = null;
      for (const key of Object.keys(subAgentStreamState)) delete subAgentStreamState[key];
      useExecutionStore.setState({ todos: [] });
      set({
        messages: [], status: 'idle', currentStreamingId: null,
        currentStreamingText: '', activeToolCalls: new Map(), citationOutputs: {},
      });
    },

    getCitationOutput: (agentName: string): SubAgentReference | null => {
      const list = get().citationOutputs[agentName];
      if (!list || list.length === 0) return null;
      return list[list.length - 1];
    },

    // ============================================================
    // Agent 流式事件处理器
    // ============================================================

    _handleAgentText: (text) => {
      const { currentStreamingId } = get();
      const runtimeStore = useRuntimeStore.getState();
      const agentId = useActiveAgentStore.getState().mainAgent?.id || 'xuanji';
      const currentMoment = runtimeStore.agentActivity.currentMoments[agentId];
      if (currentMoment && currentMoment.type === 'thinking') {
        runtimeStore.finishAgentMoment(agentId, 'success');
      }
      if (!currentStreamingId) {
        const prevMoment = runtimeStore.agentActivity.currentMoments[agentId];
        runtimeStore.setAgentMoment(agentId, {
          type: 'writing', icon: '✍️', label: '编写中', durationMs: 0, status: 'running',
          startTime: (prevMoment && prevMoment.type === 'writing') ? prevMoment.startTime : Date.now(),
        });
      }
      runtimeStore.appendStreamText(text);

      if (!currentStreamingId) {
        const newId = generateMessageId('assistant');
        const newMessage: Message = {
          id: newId, role: 'assistant', content: text,
          timestamp: Date.now(), statusHint: '✍️ 编写回复中...', toolCalls: [],
        };
        streamingMessageId = newId;
        streamTextBuffer = text;
        set((state) => ({
          messages: trimMessages([...state.messages, newMessage]),
          currentStreamingId: newId,
          currentStreamingText: text,
        }));
      } else {
        if (!streamingMessageId) {
          console.warn('[messageStore] streamingMessageId 为 null 但 currentStreamingId 存在，恢复同步:', currentStreamingId);
          streamingMessageId = currentStreamingId;
          streamTextBuffer = get().currentStreamingText || '';
        }
        streamTextBuffer += text;
        throttledFlushStreamText();
      }
    },

    _handleSubAgentText: (agentId, agentName, text) => {
      const existing = subAgentStreamState[agentId];
      if (!existing) {
        const msgId = generateMessageId(`assistant-${agentId}`);
        const newMessage: Message = {
          id: msgId, role: 'assistant', content: text,
          timestamp: Date.now(), statusHint: '✍️ ' + agentName + ' 编写中...', toolCalls: [],
        };
        subAgentStreamState[agentId] = { messageId: msgId, agentName, buffer: text };
        set((state) => ({
          messages: trimMessages([...state.messages, newMessage]),
          _subAgentStreams: { ...state._subAgentStreams, [agentId]: msgId },
        }));
      } else {
        existing.buffer += text;
        existing.agentName = agentName;
        throttledFlushSubAgentStreams();
      }
    },

    _handleAgentThinking: (thinking) => {
      if (!thinking) {
        const runtimeStore = useRuntimeStore.getState();
        runtimeStore.updateAgentStatus({ status: 'thinking', currentThought: '' });
        runtimeStore.setProcessing(true);
        const activeAgentStore = useActiveAgentStore.getState();
        if (activeAgentStore.mainAgent) {
          activeAgentStore.setAgentThought(activeAgentStore.mainAgent.id, '');
        }
        const agentId = activeAgentStore.mainAgent?.id || 'xuanji';
        runtimeStore.setAgentMoment(agentId, {
          type: 'thinking', icon: '💭', label: '思考中', durationMs: 0, status: 'running',
        });
        const { currentStreamingId } = get();
        if (currentStreamingId) {
          set((state) => ({
            status: 'thinking',
            messages: state.messages.map((msg) =>
              msg.id === currentStreamingId ? { ...msg, statusHint: '💭 思考中...' } : msg
            ),
          }));
        } else {
          set({ status: 'thinking' });
        }
        return;
      }

      const rtStore = useRuntimeStore.getState();
      const currentThinking = rtStore.messageStream?.thinking || '';
      const fullThinking = currentThinking + thinking;

      const mainAgentId = useActiveAgentStore.getState().mainAgent?.id || 'xuanji';
      const currentMomentVal = rtStore.agentActivity.currentMoments[mainAgentId];
      if (!currentMomentVal || currentMomentVal.type !== 'thinking') {
        rtStore.setAgentMoment(mainAgentId, {
          type: 'thinking', icon: '💭', label: '思考中', durationMs: 0, status: 'running',
        });
      }
      rtStore.appendStreamThinking(thinking);
      rtStore.updateAgentStatus({ status: 'thinking', currentThought: fullThinking });
      rtStore.setProcessing(true);

      const activeAgentStoreState = useActiveAgentStore.getState();
      const cAgentId = activeAgentStoreState.currentActiveAgentId;
      const isMain = !cAgentId || cAgentId === activeAgentStoreState.mainAgent?.id;
      if (isMain && activeAgentStoreState.mainAgent) {
        activeAgentStoreState.setAgentThought(activeAgentStoreState.mainAgent.id, fullThinking);
      } else if (cAgentId && !isMain) {
        activeAgentStoreState.setAgentThought(cAgentId, fullThinking);
      }

      const { currentStreamingId } = get();
      if (currentStreamingId) {
        set((state) => ({
          status: 'thinking',
          messages: state.messages.map((msg) =>
            msg.id === currentStreamingId ? { ...msg, statusHint: '💭 思考中...' } : msg
          ),
        }));
      } else {
        set({ status: 'thinking' });
      }
    },

    _handleAgentToolStart: (data) => {
      const { activeToolCalls, currentStreamingId } = get();
      const isDuplicate = activeToolCalls.has(data.id);

      if (isDuplicate) {
        if (data.name === 'agent_team') {
          const input = data.input as any;
          const members = Array.isArray(input.members) ? input.members : [];
          const multiAgent = {
            type: 'agent_team' as const,
            strategy: input.strategy,
            teamName: input.team_name,
            members: members.map((m: any) => ({
              id: m.id, name: m.name || m.role, role: m.role,
              status: 'idle' as const, progress: 0,
            })),
            totalSteps: members.length,
          };
          useRuntimeStore.getState().addToolCall({
            id: data.id, name: data.name, status: 'running',
            input: data.input, startTime: Date.now(), multiAgent,
          });
        }
        return;
      }

      // 清理同名工具的旧调用
      const oldToolCallsToRemove: string[] = [];
      activeToolCalls.forEach((tc, id) => {
        if (tc.name === data.name && (tc.status === 'error' || tc.status === 'success')) {
          oldToolCallsToRemove.push(id);
        }
      });
      oldToolCallsToRemove.forEach(id => {
        activeToolCalls.delete(id);
        useRuntimeStore.getState().removeToolCall(id);
      });

      const toolCall: ToolCall = {
        id: data.id, name: data.name, status: 'pending',
        startTime: Date.now(), input: data.input,
      };

      let multiAgent: any = undefined;
      if (data.name === 'agent_team') {
        const input = data.input as any;
        const members = Array.isArray(input.members) ? input.members : [];
        multiAgent = {
          type: 'agent_team',
          strategy: input.strategy,
          teamName: input.team_name,
          members: members.map((m: any) => ({
            id: m.id, name: m.name || m.role, role: m.role,
            status: 'idle' as const, progress: 0,
          })),
          totalSteps: members.length,
        };
      }

      useRuntimeStore.getState().addToolCall({
        id: data.id, name: data.name, status: 'running',
        input: data.input, startTime: Date.now(), multiAgent,
      });
      useRuntimeStore.getState().updateAgentStatus({
        status: 'executing', currentTool: { name: data.name, status: 'running' },
      });

      // 子 agent 的 tool-start 事件作为存活性证明，确保 agent 节点已创建
      if (data.agentId) {
        get()._promoteSubAgent(data.agentId);
      }

      const activeAgentStore = useActiveAgentStore.getState();
      const targetAgentId = data.agentId || activeAgentStore.currentActiveAgentId;
      if (targetAgentId) {
        activeAgentStore.addAgentTool(targetAgentId, {
          id: data.id, name: data.name, input: data.input,
          status: 'running', startTime: Date.now(),
        });
      }

      useSessionStore.getState().addLog('tool', `🔧 ${data.name} 开始执行`);

      const newToolCalls = new Map(activeToolCalls);
      newToolCalls.set(data.id, toolCall);

      const toolStatusHint = (() => {
        const name = data.name;
        if (name === 'bash') return '💻 执行命令中...';
        if (name === 'read') return '📖 读取文件中...';
        if (name === 'write') return '📝 写入文件中...';
        if (name === 'edit' || name === 'multi_edit') return '✏️ 修改代码中...';
        if (name === 'glob') return '🔍 扫描目录中...';
        if (name === 'grep') return '🔎 搜索内容中...';
        if (name === 'web_search' || name === 'web_fetch') return '🌐 联网搜索中...';
        if (name === 'task') return '🤖 启动子任务...';
        if (name === 'agent_team') return '👥 团队协作中...';
        if (name.startsWith('todo_')) return '📋 更新任务列表...';
        return '⚙️ 执行工具中...';
      })();

      if (currentStreamingId) {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === currentStreamingId ? { ...msg, statusHint: toolStatusHint } : msg
          ),
          activeToolCalls: newToolCalls,
          status: 'executing',
        }));
      } else {
        set({ activeToolCalls: newToolCalls, status: 'executing' });
      }

      // WorkspaceMonitor activity
      {
        const actStore = useRuntimeStore.getState();
        const activeAgentStore2 = useActiveAgentStore.getState();
        let currentAgentId: string;
        if (data.agentId) {
          currentAgentId = data.agentId;
        } else {
          const rawAgentId = activeAgentStore2.currentActiveAgentId;
          const isMainAgent = !rawAgentId || rawAgentId === activeAgentStore2.mainAgent?.id;
          currentAgentId = isMainAgent ? (activeAgentStore2.mainAgent?.id || 'xuanji') : rawAgentId;
        }
        const agentName = activeAgentStore2.mainAgent?.name || 'Xuanji';

        const momentType = (() => {
          const n = data.name;
          if (n === 'bash') return { type: 'bash' as const, icon: '⚡' };
          if (n === 'read_file' || n === 'write_file' || n === 'edit_file' || n === 'multi_edit' || n === 'glob' || n === 'grep') return { type: 'file' as const, icon: '🗂' };
          if (n === 'task') return { type: 'bash' as const, icon: '🤖' };
          if (n === 'agent_team') return { type: 'bash' as const, icon: '👥' };
          return { type: 'bash' as const, icon: '⚙️' };
        })();

        if (data.name === 'agent_team' || data.name === 'task') {
          set((s) => ({ _teamParentMap: { ...s._teamParentMap, [data.id]: currentAgentId } }));
        }
        actStore.addTimelineEvent(currentAgentId, {
          id: data.id, icon: momentType.icon, label: formatToolName(data.name),
          status: 'running', startTime: Date.now(),
        });
        actStore.addRecentEvent({
          agentName,
          description: `${data.name}: ${JSON.stringify(data.input).slice(0, 40)}`,
          icon: momentType.icon,
        });
      }
    },

    _handleAgentToolEnd: (data) => {
      const { activeToolCalls, currentStreamingId } = get();
      const activeAgentStore = useActiveAgentStore.getState();
      let currentAgentId: string;
      if (data.agentId) {
        currentAgentId = data.agentId === 'main' ? 'xuanji' : data.agentId;
      } else {
        const rawAgentId = activeAgentStore.currentActiveAgentId;
        const isMainAgent = !rawAgentId || rawAgentId === activeAgentStore.mainAgent?.id;
        currentAgentId = isMainAgent ? (activeAgentStore.mainAgent?.id || 'xuanji') : rawAgentId;
      }

      // 提取引用原文数据
      const metadata = (data as any).metadata as Record<string, unknown> | undefined;
      if (metadata && !data.isError) {
        if (data.name === 'task' && metadata.originalOutput) {
          const agentName = (metadata.agentName as string) || 'unknown-agent';
          const citation: SubAgentReference = {
            agentName,
            originalOutput: metadata.originalOutput as string,
            duration: (metadata.duration as number) || 0,
            tokensUsed: (metadata.tokensUsed as { input: number; output: number }) || { input: 0, output: 0 },
          };
          set((s) => {
            const existing = s.citationOutputs[agentName] || [];
            const updated = [...existing, citation];
            return { citationOutputs: { ...s.citationOutputs, [agentName]: updated.slice(-MAX_CITATIONS_PER_AGENT) } };
          });
        }
        if (data.name === 'agent_team' && Array.isArray(metadata.citations)) {
          const citationsData = metadata.citations as Array<{
            agentName: string; originalOutput: string; duration: number;
            tokensUsed: { input: number; output: number };
          }>;
          set((s) => {
            const updated = { ...s.citationOutputs };
            for (const c of citationsData) {
              if (c.agentName && c.originalOutput) {
                const existing = updated[c.agentName] || [];
                updated[c.agentName] = [...existing, c].slice(-MAX_CITATIONS_PER_AGENT);
              }
            }
            return { citationOutputs: updated };
          });
        }
      }

      const newToolCalls = new Map(activeToolCalls);
      const toolCall = newToolCalls.get(data.id);

      const isAsyncTask = (data.name === "task" || data.name === "agent_team") && !!((data as any).metadata)?.taskAsync;
      const subAgentId = ((data as any).metadata)?.subAgentId as string | undefined;

      if (toolCall) {
        if (isAsyncTask) {
          // 异步 task：保持 running 状态，等子 agent 结束再标记完成
          toolCall.status = 'running';
          toolCall.output = data.result;
          newToolCalls.set(data.id, toolCall);

          useRuntimeStore.getState().updateToolCall(data.id, {
            status: 'running',
            output: data.result,
          });

          if (subAgentId) {
            set((s) => ({
              _taskParentMap: { ...s._taskParentMap, [subAgentId]: { toolId: data.id, agentId: currentAgentId } },
            }));
          }
        } else {
          toolCall.status = data.isError ? 'error' : 'success';
          toolCall.output = data.result;
          if (toolCall.startTime) {
            toolCall.duration = Date.now() - toolCall.startTime;
          }
          newToolCalls.set(data.id, toolCall);

          useRuntimeStore.getState().updateToolCall(data.id, {
            status: data.isError ? 'error' : 'success',
            output: data.result,
            duration: toolCall.duration,
          });

          if (data.agentId) {
            currentAgentId = data.agentId === 'main' ? 'xuanji' : data.agentId;
          } else {
            const rawAgentId = activeAgentStore.currentActiveAgentId;
            const isMainAgent = !rawAgentId || rawAgentId === activeAgentStore.mainAgent?.id;
            currentAgentId = isMainAgent ? (activeAgentStore.mainAgent?.id || 'xuanji') : rawAgentId;
          }

          if (currentAgentId) {
            activeAgentStore.updateAgentTool(currentAgentId, data.id, {
              status: data.isError ? 'error' : 'success',
              output: data.result,
              duration: toolCall.duration,
              endTime: Date.now(),
            });
            const runtimeStore = useRuntimeStore.getState();
            runtimeStore.finishTimelineEvent(
              currentAgentId, data.id, toolCall.duration || 0,
              data.isError ? 'error' : 'success'
            );
          }
        }

        // 解析 TODO_PROGRESS 标记
        if (!data.isError && data.result && data.result.includes('<!--TODO_PROGRESS:')) {
          const startMarker = '<!--TODO_PROGRESS:';
          const endMarker = '-->';
          const startIndex = data.result.indexOf(startMarker);
          if (startIndex !== -1) {
            const jsonStart = startIndex + startMarker.length;
            const endIndex = data.result.indexOf(endMarker, jsonStart);
            if (endIndex !== -1) {
              const jsonStr = data.result.substring(jsonStart, endIndex).trim();
              try {
                const progressData = JSON.parse(jsonStr);
                if (progressData.items && Array.isArray(progressData.items)) {
                  const newTodos = progressData.items.map((item: any) => ({
                    id: item.id,
                    subject: item.title,
                    description: item.description || '',
                    status: item.status || 'pending',
                    activeForm: item.activeForm,
                    createdAt: Date.now(),
                    startedAt: item.status === 'in_progress' ? Date.now() : undefined,
                    completedAt: (item.status === 'completed' || item.status === 'failed') ? Date.now() : undefined,
                  }));
                  useExecutionStore.setState({ todos: newTodos });
                }
              } catch (err) {
                console.error('[messageStore] 解析 TODO_PROGRESS 失败:', err);
              }
            }
          }
        }

        const statusIcon = data.isError ? '❌' : '✅';
        const durationText = toolCall.duration ? ` (${toolCall.duration}ms)` : '';
        useSessionStore.getState().addLog('tool', `${statusIcon} ${data.name} ${data.isError ? '执行失败' : '执行完成'}${durationText}`);
      }

      const hasActiveTools = Array.from(newToolCalls.values()).some(tc => tc.status === 'pending');
      if (!hasActiveTools && currentAgentId) {
        const activeAgentStore2 = useActiveAgentStore.getState();
        if (!currentAgentId || currentAgentId === activeAgentStore2.mainAgent?.id) {
          activeAgentStore2.setAgentStatus(currentAgentId, 'thinking');
        }
      }

      if (currentStreamingId) {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === currentStreamingId
              ? { ...msg, toolCalls: Array.from(newToolCalls.values()), statusHint: hasActiveTools ? msg.statusHint : '✍️ 编写回复中...' }
              : msg
          ),
          activeToolCalls: newToolCalls,
          status: hasActiveTools ? 'executing' : 'thinking',
        }));
      } else {
        set((state) => {
          const lastAssistantIdx = [...state.messages].reverse().findIndex((m) => m.role === 'assistant');
          if (lastAssistantIdx === -1) return { activeToolCalls: newToolCalls };
          const idx = state.messages.length - 1 - lastAssistantIdx;
          return {
            messages: state.messages.map((msg, i) =>
              i === idx ? { ...msg, toolCalls: Array.from(newToolCalls.values()) } : msg
            ),
            activeToolCalls: newToolCalls,
          };
        });
      }

      // WorkspaceMonitor activity（异步 task 不在此结束 timeline）
      if (!isAsyncTask) {
        const actStore = useRuntimeStore.getState();
        const activeAgentStore3 = useActiveAgentStore.getState();
        let cAgentId: string;
        if (data.agentId) {
          cAgentId = data.agentId;
        } else {
          const rawAgentId = activeAgentStore3.currentActiveAgentId;
          const isMainAgent = !rawAgentId || rawAgentId === activeAgentStore3.mainAgent?.id;
          cAgentId = isMainAgent ? (activeAgentStore3.mainAgent?.id || 'xuanji') : rawAgentId;
        }
        const status = data.isError ? 'error' : 'success';
        const toolCallDuration = activeToolCalls.get(data.id)?.duration;
        actStore.finishTimelineEvent(cAgentId, data.id, toolCallDuration ?? 0, status);
      }

      // 文件操作工具 → 对话式摘要消息
      const FILE_OPERATION_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit']);
      if (FILE_OPERATION_TOOLS.has(data.name) && !data.isError) {
        const tc = newToolCalls.get(data.id);
        if (tc && tc.input) {
          const summary = generateToolSummaryMessage(data.name, tc.input, data.result);
          if (summary) {
            const summaryMessage: Message = {
              id: generateMessageId('tool-summary'),
              role: 'assistant',
              content: summary,
              timestamp: Date.now(),
              toolSummary: true,
            };
            set((state) => ({ messages: trimMessages([...state.messages, summaryMessage]) }));
          }
        }
      }
    },

    _handleAgentUsage: (usage) => {
      useRuntimeStore.getState().addTokenUsage(
        usage.input || 0, usage.output || 0, usage.cached || 0
      );
      useRuntimeStore.getState().setCurrentCallTokens({
        input: usage.input || 0, output: usage.output || 0, cached: usage.cached || 0,
      });
      const mainAgent = useActiveAgentStore.getState().mainAgent;
      if (mainAgent) {
        useActiveAgentStore.getState().updateAgentStats(mainAgent.id, {
          tokenUsage: {
            input: (mainAgent.stats.tokenUsage.input || 0) + (usage.input || 0),
            output: (mainAgent.stats.tokenUsage.output || 0) + (usage.output || 0),
            cached: (mainAgent.stats.tokenUsage.cached || 0) + (usage.cached || 0),
          },
        });
      }
      set((state) => ({
        stats: {
          ...state.stats,
          tokenUsage: {
            input: (state.stats.tokenUsage?.input || 0) + (usage.input || 0),
            output: (state.stats.tokenUsage?.output || 0) + (usage.output || 0),
          },
        },
      }));
    },

    _handleAgentError: (error) => {
      isAgentEnded = true;
      throttledFlushStreamText.cancel();
      const { currentStreamingId, currentStreamingText } = get();
      if (currentStreamingId && currentStreamingText) {
        flushStreamText();
      }
      useRuntimeStore.getState().setProcessing(false);
      useRuntimeStore.getState().updateAgentStatus({ status: 'error' });

      const errorMessage: Message = {
        id: generateMessageId('error'), role: 'assistant',
        content: error, timestamp: Date.now(),
      };
      useSessionStore.getState().addLog('error', error);
      set((state) => ({
        messages: trimMessages([...state.messages, errorMessage]),
        status: 'idle', currentStreamingId: null,
        currentStreamingText: '', activeToolCalls: new Map(),
      }));
    },

    _handleAgentEnd: (state) => {
      isAgentEnded = true;
      throttledFlushStreamText.cancel();

      flushStreamText();

      throttledFlushSubAgentStreams.cancel();
      flushSubAgentStreams();
      for (const key of Object.keys(subAgentStreamState)) delete subAgentStreamState[key];
      // 清理模块级 agent 记录，防止内存泄漏
      for (const key of Object.keys(agentTaskDisplayStart)) delete agentTaskDisplayStart[key];
      for (const key of Object.keys(agentThinkingBuffer)) delete agentThinkingBuffer[key];
      set({ _subAgentStreams: {}, _autoSummarizeActive: false });

      useRuntimeStore.getState().finishMessageStream();
      useRuntimeStore.getState().setProcessing(false);
      useRuntimeStore.getState().updateAgentStatus({ status: 'done' });

      const agentId = useActiveAgentStore.getState().mainAgent?.id;
      if (agentId) {
        const runtimeStore = useRuntimeStore.getState();
        runtimeStore.finishAgentMoment(agentId, 'success');
        setTimeout(() => {
          useRuntimeStore.setState((s) => ({
            agentActivity: { ...s.agentActivity, currentMoments: {} },
          }));
        }, 1500);
      } else {
        useRuntimeStore.setState((s) => ({
          agentActivity: { ...s.agentActivity, currentMoments: {} },
        }));
      }

      const { activeToolCalls, currentStreamingId } = get();
      const finalizedToolCalls = Array.from(activeToolCalls.values()).map((tc) => {
        if (tc.status === 'pending') {
          return { ...tc, status: 'success' as const, duration: tc.startTime ? Date.now() - tc.startTime : undefined };
        }
        return tc;
      });

      const activeAgentStore = useActiveAgentStore.getState();
      activeAgentStore.finishMainAgent();

      set((prevState) => ({
        status: 'idle',
        _conversationState: 'idle',
        currentStreamingId: null,
        currentStreamingText: '',
        activeToolCalls: new Map(),
        messages: prevState.messages.map((msg) => {
          if (msg.id === currentStreamingId) {
            const duration = msg.timestamp ? Date.now() - msg.timestamp : undefined;
            const tokensUsed = state.tokenUsage || prevState.stats.tokenUsage;
            return { ...msg, statusHint: undefined, toolCalls: finalizedToolCalls, duration, tokensUsed };
          } else if (msg.statusHint) {
            return { ...msg, statusHint: undefined };
          }
          return msg;
        }),
        stats: {
          ...prevState.stats,
          model: state.model || prevState.stats.model,
          tokenUsage: state.tokenUsage || prevState.stats.tokenUsage,
          cost: state.cost || prevState.stats.cost,
        },
        currentSkill: state.currentSkill ? {
          name: state.currentSkill.name,
          icon: state.currentSkill.icon || '🛠️',
        } : prevState.currentSkill,
      }));
    },

    // ============================================================
    // Multi-Agent / 子 Agent 编排
    // ============================================================

    _promoteSubAgent: (subAgentId: string) => {
      const pending = get()._pendingSubAgents[subAgentId];

      const activeAgentStore = useActiveAgentStore.getState();
      const mainAgentId = activeAgentStore.mainAgent?.id || 'xuanji';

      // 检查 agent 是否已存在于树中
      const findAgent = (agent: any, targetId: string): boolean => {
        if (!agent) return false;
        if (agent.id === targetId) return true;
        if (agent.subAgents) {
          for (const sub of agent.subAgents) {
            if (findAgent(sub, targetId)) return true;
          }
        }
        return false;
      };
      const alreadyExists = findAgent(activeAgentStore.mainAgent, subAgentId);

      if (!pending) {
        // 无 pending 条目时（thinking 事件先于 subagent-start 到达），用 subAgentId 派生名称
        if (alreadyExists) return;
        const derivedName = subAgentId.replace(/^subtask-/, '').replace(/^subagent-/, '').replace(/-[\d]+-[a-z0-9]+$/, '');
        activeAgentStore.addSubAgent(mainAgentId, {
          id: subAgentId,
          name: derivedName || subAgentId,
          status: 'thinking',
          currentTools: [],
          subAgents: [],
          agentType: 'temporary',
          stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
        });
        return;
      }

      const parentId = pending.parentId === 'main' || !pending.parentId
        ? mainAgentId
        : pending.parentId;
      activeAgentStore.addSubAgent(parentId, {
        id: pending.subAgentId,
        name: pending.name,
        status: 'thinking',
        currentTask: pending.task,
        currentTools: [],
        subAgents: [],
        agentType: pending.agentType,
        scene: pending.scene,
        executionMode: pending.executionMode,
        stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
      });
      // 进入时展示父 agent 分配的任务（通过 currentTask，黄色边框）
      markTaskDisplayStart(pending.subAgentId);

      if (pending.streamToUser) {
        set((s) => ({
          _streamToUserMap: { ...s._streamToUserMap, [pending.subAgentId]: pending.name },
        }));
      }

      set((s) => {
        const next = { ...s._pendingSubAgents };
        delete next[subAgentId];
        return { _pendingSubAgents: next };
      });
    },

    _handleTeamStart: (data) => {
      let toolCall: any = null;
      const stream = useRuntimeStore.getState().messageStream;
      if (stream) {
        toolCall = stream.toolCalls.find(
          (tc) => tc.status === 'running' && tc.multiAgent?.teamName === data.name
        );
        if (!toolCall && data.strategy) {
          toolCall = stream.toolCalls.find(
            (tc) => tc.status === 'running' && tc.name === 'agent_team' && tc.multiAgent?.strategy === data.strategy
          );
        }
        if (!toolCall) {
          const agentTeamCalls = stream.toolCalls.filter(
            (tc) => tc.status === 'running' && tc.name === 'agent_team'
          );
          const existingToolCallIds = new Set(Object.values(get()._teamIdMap));
          toolCall = agentTeamCalls.find((tc) => !existingToolCallIds.has(tc.id));
        }
      }

      if (toolCall) {
        set((state) => ({
          _teamIdMap: { ...state._teamIdMap, [data.teamId]: toolCall.id },
        }));
      }

      // 独立于 toolCall：只要 data.members 存在就创建团队成员
      if (data.members && Array.isArray(data.members)) {
        const activeAgentStore = useActiveAgentStore.getState();
        const mainAgent = activeAgentStore.mainAgent;
        const parentAgentId = mainAgent?.id;

        if (parentAgentId) {
          data.members.forEach((member: any) => {
            const subAgentId = member.subAgentId || member.id;
            const debateRole = member.debateRole;

            activeAgentStore.addSubAgent(parentAgentId, {
              id: subAgentId,
              name: member.name || member.role || member.id,
              status: 'idle',
              currentTask: member.task,
              currentTools: [],
              subAgents: [],
              agentType: member.agentType || 'temporary',
              scene: member.scene,
              executionMode: member.executionMode || 'acp',
              stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
              multiAgent: {
                type: 'agent_team', strategy: data.strategy, teamName: data.name,
                memberId: member.id, stepIndex: member.stepIndex, totalSteps: data.members!.length,
                debateRole, currentRound: 1, maxRounds: (data as any).maxRounds,
              },
            });

          });

          if (toolCall) {
            set((state) => ({
              _teamParentMap: { ...state._teamParentMap, [toolCall.id]: parentAgentId },
            }));
          }
        }
      }
    },

    _handleTeamMemberStart: (data) => {
      const isTaskAgent = data.teamId === 'task';

      if (!isTaskAgent) {
        const toolCallId = get()._teamIdMap[data.teamId];
        if (!toolCallId) return;

        const parentAgentId = get()._teamParentMap[toolCallId];
        useRuntimeStore.getState().updateToolCallMember(toolCallId, data.memberId, { status: 'running' });

        const subAgentId = (data as any).subAgentId || data.memberId;
        const activeAgentStore = useActiveAgentStore.getState();
        const mainAgent = activeAgentStore.mainAgent;

        let targetParentId = parentAgentId || mainAgent?.id;
        if (targetParentId === 'main' && mainAgent) { targetParentId = mainAgent.id; }

        const findAgent = (agent: any, targetId: string): boolean => {
          if (!agent) return false;
          if (agent.id === targetId) return true;
          if (agent.subAgents) {
            for (const sub of agent.subAgents) {
              if (findAgent(sub, targetId)) return true;
            }
          }
          return false;
        };

        const agentExists = findAgent(mainAgent, subAgentId);

        let debateRole: 'affirmative' | 'negative' | 'judge' | undefined;
        if ((data as any).debateRole) {
          debateRole = (data as any).debateRole;
        } else if (data.systemPromptHint) {
          const match = data.systemPromptHint.match(/\[debate_role:(affirmative|negative|judge)\]/i);
          if (match) { debateRole = match[1].toLowerCase() as 'affirmative' | 'negative' | 'judge'; }
        }

        if (agentExists) {
          activeAgentStore.setAgentStatus(subAgentId, 'thinking');
          activeAgentStore.setCurrentActiveAgent(subAgentId);
          if (data.task) {
            activeAgentStore.setAgentTask(subAgentId, data.task);
            markTaskDisplayStart(subAgentId);
          }
          if (data.agentType) { activeAgentStore.updateAgentType(subAgentId, data.agentType); }
          activeAgentStore.updateAgentMultiAgent(subAgentId, {
            currentRound: data.currentRound, maxRounds: data.maxRounds,
            debateRole, memberId: data.memberId,
          });
        } else {
          if (mainAgent && targetParentId) {
            activeAgentStore.addSubAgent(targetParentId, {
              id: subAgentId,
              name: data.name || data.role || data.memberId,
              status: 'thinking', currentTools: [], subAgents: [],
              agentType: data.agentType || 'temporary',
              scene: (data as any).scene,
              executionMode: (data as any).executionMode || 'acp',
              currentTask: data.task,
              stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
              multiAgent: {
                type: 'agent_team', strategy: data.strategy, teamName: data.teamName,
                memberId: data.memberId, stepIndex: data.stepIndex, totalSteps: data.totalSteps,
                currentRound: data.currentRound, maxRounds: data.maxRounds, debateRole,
              },
            });
            activeAgentStore.setCurrentActiveAgent(subAgentId);
            // 进入时展示父 agent 分配的任务（通过 currentTask，黄色边框）
            if (data.task) { markTaskDisplayStart(subAgentId); }
          }
        }

        useRuntimeStore.getState().addRecentEvent({
          agentName: data.role || data.memberId,
          description: `Team member started: ${data.task?.slice(0, 50) || 'processing'}`,
          icon: '🤖',
        });
      } else {
        // task 工具创建的子 agent
        const subAgentId = data.memberId;
        const activeAgentStore = useActiveAgentStore.getState();
        const mainAgent = activeAgentStore.mainAgent;

        const findAgent = (agent: any, targetId: string): boolean => {
          if (!agent) return false;
          if (agent.id === targetId) return true;
          if (agent.subAgents) {
            for (const sub of agent.subAgents) {
              if (findAgent(sub, targetId)) return true;
            }
          }
          return false;
        };

        if (findAgent(mainAgent, subAgentId)) return;

        let parentAgentId: string | undefined;
        const taskToolCalls = Object.entries(get()._teamParentMap).filter(([toolId]) => {
          const runtimeStore = useRuntimeStore.getState();
          const toolCall = runtimeStore.messageStream?.toolCalls.find(tc => tc.id === toolId);
          return toolCall?.name === 'task';
        });

        if (taskToolCalls.length > 0) {
          parentAgentId = taskToolCalls[taskToolCalls.length - 1][1];
        } else {
          parentAgentId = activeAgentStore.currentActiveAgentId || mainAgent?.id;
        }

        if (mainAgent && parentAgentId) {
          activeAgentStore.addSubAgent(parentAgentId, {
            id: subAgentId,
            name: data.name || data.role || 'Sub-agent',
            status: 'thinking',
            currentTask: data.task,
            currentTools: [],
            subAgents: [],
            agentType: data.agentType || 'temporary',
            scene: (data as any).scene,
            executionMode: (data as any).executionMode || 'acp',
            stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
          });
          activeAgentStore.setCurrentActiveAgent(subAgentId);
          // 进入时展示父 agent 分配的任务（通过 currentTask，黄色边框）
          if (data.task) { markTaskDisplayStart(subAgentId); }
        }

        useRuntimeStore.getState().addRecentEvent({
          agentName: data.role || 'Sub-agent',
          description: `Task started: ${data.task?.slice(0, 50) || 'processing'}`,
          icon: '🤖',
        });
      }
    },

    _handleTeamMemberEnd: (data) => {
      const isTaskAgent = data.teamId === 'task';

      if (!isTaskAgent) {
        const toolCallId = get()._teamIdMap[data.teamId];

        const subAgentId = (data as any).subAgentId || data.memberId;
        const activeAgentStore = useActiveAgentStore.getState();

        // 🔧 防止重试竞态：如果成员失败后已被重试（状态已回到 thinking/executing），
        // 说明这是一个过时的 TeamMemberEnd 事件，忽略它，避免覆盖重试后的正确状态
        if (data.success === false) {
          const currentAgent = activeAgentStore.findAgentById(subAgentId);
          if (currentAgent && (currentAgent.status === 'thinking' || currentAgent.status === 'executing')) {
            return;
          }
        }

        // 更新 tool call 成员状态（仅在 toolCallId 存在时）
        if (toolCallId) {
          useRuntimeStore.getState().updateToolCallMember(toolCallId, data.memberId, {
            status: data.success !== false ? 'success' : 'error',
            duration: data.duration,
          });
        }

        const finalStatus = data.success !== false ? 'success' : 'failed';
        activeAgentStore.setAgentStatus(subAgentId, finalStatus);

        if (data.resultSummary) {
          activeAgentStore.setAgentTask(subAgentId, data.resultSummary);
        }

        // 团队成员个体完成时不设置汇报 moment，由 _handleTeamEnd 统一处理
        const runtimeStore = useRuntimeStore.getState();
        const status = data.success !== false ? 'success' : 'error';

        runtimeStore.addRecentEvent({
          agentName: data.memberId,
          description: `Team member ${status === 'success' ? 'completed' : 'failed'} (${data.duration}ms)`,
          icon: status === 'success' ? '✅' : '❌',
        });

        delete agentTaskDisplayStart[subAgentId];
        delete agentThinkingBuffer[subAgentId];
      } else {
        // task 工具创建的子 agent
        const subAgentId = data.memberId;
        const activeAgentStore = useActiveAgentStore.getState();
        const finalStatus = data.success !== false ? 'success' : 'failed';
        activeAgentStore.setAgentStatus(subAgentId, finalStatus);

        const findParentId = (agent: any, targetId: string): string | null => {
          if (!agent) return null;
          if (agent.subAgents) {
            for (const sub of agent.subAgents) {
              if (sub.id === targetId) return agent.id;
              const found = findParentId(sub, targetId);
              if (found) return found;
            }
          }
          return null;
        };

        const runtimeStore = useRuntimeStore.getState();
        const status = data.success !== false ? 'success' : 'error';
        const taskCurrentMoment = runtimeStore.agentActivity.currentMoments[subAgentId];
        const taskTaskStartTime = taskCurrentMoment?.startTime || Date.now();
        runtimeStore.setAgentMoment(subAgentId, {
          type: 'reporting', icon: '📤', label: '汇报中',
          durationMs: 0, status: 'running', startTime: taskTaskStartTime,
        });
        runtimeStore.addRecentEvent({
          agentName: 'Sub-agent',
          description: `Task ${status === 'success' ? 'completed' : 'failed'} (${data.duration}ms)`,
          icon: status === 'success' ? '✅' : '❌',
        });

        delete agentTaskDisplayStart[subAgentId];
        delete agentThinkingBuffer[subAgentId];
      }
    },

    _handleTeamEnd: (data) => {
      const toolCallId = get()._teamIdMap[data.teamId];

      const activeAgentStore = useActiveAgentStore.getState();
      const parentAgentId = (toolCallId ? get()._teamParentMap[toolCallId] : null) || activeAgentStore.mainAgent?.id;

      if (parentAgentId) {
        const findTeamMembers = (agent: any): string[] => {
          if (!agent || !agent.subAgents) return [];
          const members: string[] = [];
          for (const sub of agent.subAgents) {
            if (sub.multiAgent?.teamName === data.name) { members.push(sub.id); }
            members.push(...findTeamMembers(sub));
          }
          return members;
        };

        const teamMemberIds = findTeamMembers(activeAgentStore.mainAgent);

        // 标记团队成员为终态（待汇报），类似 task 子 agent 的 subagent-end 逻辑
        const isCancelled = !!(data as any).cancelled;
        const finalStatus = isCancelled ? 'failed' : (data.success !== false ? 'success' : 'failed');
        teamMemberIds.forEach(memberId => {
          activeAgentStore.setAgentStatus(memberId, finalStatus);
          activeAgentStore.setAgentThought(memberId, '');
          markTaskDisplayStart(memberId);
          const runtimeStore2 = useRuntimeStore.getState();
          const currentMoment = runtimeStore2.agentActivity.currentMoments[memberId];
          runtimeStore2.setAgentMoment(memberId, {
            type: 'reporting',
            icon: isCancelled ? '🛑' : (data.success !== false ? '📤' : '⚠️'),
            label: isCancelled ? '已取消' : (data.success !== false ? '汇报中' : '执行失败'),
            durationMs: 0, status: 'running',
            startTime: currentMoment?.startTime || Date.now(),
          });
        });

        // 团队失败时，延迟清理 flow 中的成员节点（让用户看到失败状态后再移除）
        if (data.success === false && teamMemberIds.length > 0) {
          const mainAgent = activeAgentStore.mainAgent;
          if (mainAgent) {
            const findParentId = (agent: any, targetId: string): string | null => {
              if (!agent || !agent.subAgents) return null;
              for (const sub of agent.subAgents) {
                if (sub.id === targetId) return agent.id;
                const found = findParentId(sub, targetId);
                if (found) return found;
              }
              return null;
            };
            const parentId = findParentId(mainAgent, teamMemberIds[0]) || mainAgent.id;
            setTimeout(() => {
              const rtStore3 = useRuntimeStore.getState();
              teamMemberIds.forEach(memberId => {
                activeAgentStore.removeSubAgent(parentId, memberId);
                rtStore3.finishAgentMoment(memberId, 'error');
                rtStore3.clearAgentActivity(memberId);
              });
            }, 3000);
          }
        }

        const runtimeStore = useRuntimeStore.getState();
        runtimeStore.addRecentEvent({
          agentName: data.name,
          description: isCancelled
            ? 'Team cancelled'
            : data.success
            ? 'Team completed successfully'
            : `Team failed: ${data.error || 'Unknown error'}`,
          icon: isCancelled ? '🛑' : data.success ? '✅' : '❌',
        });

        // 结束主 agent timeline 上的 agent_team 工具执行标签
        if (toolCallId) {
          const rtStore2 = useRuntimeStore.getState();
          rtStore2.updateToolCall(toolCallId, {
            status: data.success !== false ? 'success' : 'error',
            duration: data.duration,
          });
          rtStore2.finishTimelineEvent(
            parentAgentId, toolCallId,
            data.duration || 0, data.success !== false ? 'success' : 'error',
          );
        }
      }

      if (toolCallId) {
        const newTeamIdMap = { ...get()._teamIdMap };
        delete newTeamIdMap[data.teamId];
        const newTeamParentMap = { ...get()._teamParentMap };
        delete newTeamParentMap[toolCallId];
        set({ _teamIdMap: newTeamIdMap, _teamParentMap: newTeamParentMap });
      }
    },
  };
});
