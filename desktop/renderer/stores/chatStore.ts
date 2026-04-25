// ============================================================
// chatStore - 对话状态管理（真实 AgentLoop 集成）
// ============================================================

import { create } from 'zustand';
import type { PermissionRequestData, PlanReviewRequestData, AskUserRequestData } from '../global';
import { useRuntimeStore } from './runtimeStore';
import { useExecutionStore } from './executionStore';
import { useActiveAgentStore } from './activeAgentStore';
import { messageBus } from '../utils/MessageBus'; // 🔧 导入 messageBus

// ============================================================
// 节流工具函数
// ============================================================
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
        if (lastArgs) {
          func(...lastArgs);
        }
        timeoutId = null;
        lastArgs = null;
      }, delay);
    }
  };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  return throttled;
}

// ============================================================
// 唯一 ID 生成器（解决 Date.now() 重复问题）
// ============================================================
let messageIdCounter = 0;
function generateMessageId(prefix = 'msg'): string {
  return `${prefix}-${Date.now()}-${++messageIdCounter}`;
}

// 消息类型
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  thinking?: boolean;
  /** 拟人化状态提示（如 "回忆中..."、"思考中..."、"编写中..."） */
  statusHint?: string;
  toolCalls?: ToolCall[];
  /** 标识为工具摘要消息（对话式展示文件操作等工具的执行结果） */
  toolSummary?: boolean;
}

// 工具调用
export interface ToolCall {
  id: string;
  name: string;
  status: 'pending' | 'success' | 'error';
  duration?: number;
  startTime?: number;
  input?: Record<string, unknown>;
  output?: string; // 工具执行结果
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
  _handleAgentToolStart: (data: { id: string; name: string; input: Record<string, unknown>; agentId?: string }) => void;
  _handleAgentToolEnd: (data: { id: string; name: string; result: string; isError: boolean; agentId?: string }) => void;
  _handleAgentUsage: (usage: any) => void;
  _handleAgentError: (error: string) => void;
  _handleAgentEnd: (state: any) => void;
  // Multi-Agent 成员状态动态更新
  _handleTeamStart: (data: {
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
  }) => void;
  _handleTeamMemberStart: (data: {
    teamId: string;
    memberId: string;
    name?: string;
    role?: string;
    task?: string;
    agentType?: 'preset' | 'builtin' | 'custom';
    strategy?: string;
    teamName?: string;
    stepIndex?: number;
    totalSteps?: number;
    currentRound?: number;
    maxRounds?: number;
    systemPromptHint?: string;
  }) => void;
  _handleTeamMemberEnd: (data: { teamId: string; memberId: string; success?: boolean; duration?: number; resultSummary?: string }) => void;
  _handleTeamEnd: (data: { teamId: string; name: string; success: boolean; duration?: number; error?: string }) => void;
  /** teamId → toolCallId 的映射，用于将 Hook 事件关联到 runtimeStore 中的 toolCall */
  _teamIdMap: Record<string, string>;
  /** teamId → parentAgentId 的映射，用于确定 agent_team 创建的子 Agent 应该挂在哪个父节点下 */
  _teamParentMap: Record<string, string>;
  /** task 工具的 subAgentId → parentAgentId 的映射，用于确定 task 创建的子 Agent 应该挂在哪个父节点下 */
  _taskParentMap: Record<string, string>;
}

// ============================================================
// 工具摘要生成函数
// ============================================================

/**
 * 生成文件变更的对话式摘要
 */
function generateFileChangeSummary(change: import('../global').FileChange): string {
  const { filePath, operation, stats, diffContent } = change;

  // 去除 ANSI 颜色码
  const cleanDiff = diffContent?.replace(/\x1b\[[0-9;]*m/g, '') || '';

  switch (operation) {
    case 'create':
      return `✅ **已创建文件** \`${filePath}\`\n\n` +
             `📊 共 ${stats.added} 行`;

    case 'edit':
    case 'overwrite':
      const operationText = operation === 'edit' ? '已编辑文件' : '已更新文件';
      return `✅ **${operationText}** \`${filePath}\`\n\n` +
             `📊 变更：+${stats.added} 行，-${stats.removed} 行\n\n` +
             (cleanDiff ? `\`\`\`diff\n${cleanDiff}\n\`\`\`` : '');

    default:
      return '';
  }
}

/**
 * 从工具结果中提取 diff 统计信息
 */
function extractDiffStats(result: string): { added: number; removed: number } | null {
  // 匹配 "统计: +X -Y" 格式
  const statsMatch = result.match(/统计:\s*\+(\d+)\s*-(\d+)/);
  if (statsMatch) {
    return {
      added: parseInt(statsMatch[1], 10),
      removed: parseInt(statsMatch[2], 10),
    };
  }
  return null;
}

/**
 * 从工具结果中提取 diff 内容（去除 ANSI 颜色码）
 */
function extractDiffContent(result: string): string | null {
  // 查找 diff 分隔线后的内容
  const lines = result.split('\n');
  const separatorIndex = lines.findIndex(line => line.includes('─'.repeat(10)));

  if (separatorIndex === -1) return null;

  // 提取 diff 内容并去除 ANSI 颜色码
  const diffLines = lines.slice(separatorIndex + 2); // 跳过分隔线和表头
  const cleanedDiff = diffLines
    .map(line => line.replace(/\x1b\[[0-9;]*m/g, '')) // 去除 ANSI 颜色码
    .join('\n')
    .trim();

  return cleanedDiff || null;
}

/**
 * 生成工具调用的对话式摘要
 */
function generateToolSummaryMessage(
  toolName: string,
  input: Record<string, unknown>,
  result: string
): string {
  const filePath = (input.path || input.file_path) as string | undefined;

  // 如果没有文件路径，返回空字符串（不生成摘要）
  if (!filePath) {
    return '';
  }

  switch (toolName) {
    case 'write_file': {
      const stats = extractDiffStats(result);
      const diffContent = extractDiffContent(result);

      console.log('[generateToolSummaryMessage] write_file - stats:', stats);
      console.log('[generateToolSummaryMessage] write_file - diffContent length:', diffContent?.length);

      // 如果有 diff（说明是覆盖已存在的文件）
      if (stats && diffContent) {
        const summary = `✅ **已更新文件** \`${filePath}\`\n\n` +
               `📊 变更：+${stats.added} 行，-${stats.removed} 行\n\n` +
               `\`\`\`diff\n${diffContent}\n\`\`\``;
        
        console.log('[generateToolSummaryMessage] write_file - 生成更新摘要成功');
        return summary;
      }

      // 新建文件
      console.log('[generateToolSummaryMessage] write_file - 新建文件');
      const content = input.content as string;
      const lines = content.split('\n').length;
      const preview = content.length > 200
        ? content.slice(0, 200) + '...'
        : content;

      return `✅ **已创建文件** \`${filePath}\`\n\n` +
             `📊 共 ${lines} 行\n\n` +
             `<details>\n<summary>查看内容预览</summary>\n\n` +
             `\`\`\`\n${preview}\n\`\`\`\n\n</details>`;
    }

    case 'edit_file': {
      const stats = extractDiffStats(result);
      const diffContent = extractDiffContent(result);

      console.log('[generateToolSummaryMessage] edit_file - stats:', stats);
      console.log('[generateToolSummaryMessage] edit_file - diffContent length:', diffContent?.length);
      console.log('[generateToolSummaryMessage] edit_file - diffContent preview:', diffContent?.slice(0, 100));

      if (stats && diffContent) {
        const replaceAll = input.replace_all as boolean;
        const countInfo = replaceAll ? '（批量替换）' : '';

        const summary = `✅ **已编辑文件** \`${filePath}\`${countInfo}\n\n` +
               `📊 变更：+${stats.added} 行，-${stats.removed} 行\n\n` +
               `\`\`\`diff\n${diffContent}\n\`\`\``;
        
        console.log('[generateToolSummaryMessage] edit_file - 生成摘要成功，长度:', summary.length);
        return summary;
      }

      // 降级方案：显示输入参数
      console.log('[generateToolSummaryMessage] edit_file - 使用降级方案');
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

export const useChatStore = create<ChatStore>((set, get) => {
  // 流式文本更新的节流版本（150ms）
  let streamTextBuffer = '';
  let streamingMessageId: string | null = null;
  let isAgentEnded = false; // 标记 agent 是否已结束

  const flushStreamText = () => {
    if (!streamingMessageId || !streamTextBuffer) return;

    const messageId = streamingMessageId;
    const text = streamTextBuffer;

    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              content: text,
              // 如果 agent 已结束，不设置 statusHint
              statusHint: isAgentEnded ? undefined : '✍️ 编写回复中...'
            }
          : msg
      ),
      currentStreamingText: text,
    }));
  };

  const throttledFlushStreamText = throttle(flushStreamText, 150);

  return {
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
    // 重置 agent 结束标记和流式缓冲区
    isAgentEnded = false;
    streamTextBuffer = '';
    streamingMessageId = null;

    // 添加用户消息
    const userMessage: Message = {
      id: generateMessageId('user'),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    // 同步更新 runtimeStore
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setProcessing(true);
    runtimeStore.incrementIteration();
    runtimeStore.resetMessageStream();
    runtimeStore.setRunStartTime(Date.now());
    // 初始化 agentStatus
    runtimeStore.setAgentStatus({
      id: 'main',
      name: 'Xuanji',
      status: 'idle',
    });

    // 启动主 Agent（activeAgentStore）
    // 🔧 传递 agentId，默认为 'xuanji'
    useActiveAgentStore.getState().startMainAgent('Xuanji', 'xuanji');

    set((state) => ({
      messages: [...state.messages, userMessage],
      status: 'thinking',
    }));

    // 调用真实的 Agent
    try {
      const result = await window.electron.agentSendMessage(content);

      // 注意：无论成功还是失败，agent:end 事件都会触发并设置状态
      // 这里只处理明确的错误情况（如会话未初始化等）
      if (!result.success) {
        // 发送失败，添加错误消息
        const errorMessage: Message = {
          id: generateMessageId('error'),
          role: 'assistant',
          content: `❌ 错误：${result.error || '未知错误'}`,
          timestamp: Date.now(),
        };

        // 同步更新 runtimeStore（确保状态被重置）
        useRuntimeStore.getState().setProcessing(false);

        set((state) => ({
          messages: [...state.messages, errorMessage],
          status: 'idle',
        }));
      }
      // 成功情况：状态由 agent:end 事件处理，这里不需要额外操作
    } catch (err) {
      // 调用失败
      const errorMessage: Message = {
        id: generateMessageId('error'),
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

  clearMessages: () => {
    streamTextBuffer = '';
    streamingMessageId = null;
    set({ messages: [], status: 'idle' });
  },

  reset: async () => {
    await window.electron.agentReset();

    // 清空流式缓冲区
    streamTextBuffer = '';
    streamingMessageId = null;

    // 清空前端 todos 显示状态（不清空后端持久化任务）
    // xuanji 是记忆驱动的 agent，任务是工作状态，不应随会话重置而清空
    useExecutionStore.setState({ todos: [] });

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
    const { currentStreamingId } = get();

    // Agent 开始输出文本时，清除所有 prompt 构建相关的 moment 状态
    const runtimeStore = useRuntimeStore.getState();
    const agentId = 'main';
    const currentMoment = runtimeStore.agentActivity.currentMoments[agentId];
    if (currentMoment && currentMoment.type === 'thinking') {
      // 清除当前的 thinking moment（prompt 构建阶段的状态）
      runtimeStore.finishAgentMoment(agentId, 'success');
    }

    // 同步更新 runtimeStore
    runtimeStore.appendStreamText(text);

    // 如果还没有创建流式消息，创建一个
    if (!currentStreamingId) {
      const newId = generateMessageId('assistant');
      const newMessage: Message = {
        id: newId,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        statusHint: '✍️ 编写回复中...',
        toolCalls: [],
      };

      streamingMessageId = newId;
      streamTextBuffer = text;

      set((state) => ({
        messages: [...state.messages, newMessage],
        currentStreamingId: newId,
        currentStreamingText: text,
      }));
    } else {
      // 追加文本到缓冲区，使用节流更新
      streamTextBuffer += text;
      throttledFlushStreamText();
    }
  },

  _handleAgentThinking: (thinking) => {
    console.log('[chatStore] _handleAgentThinking 触发，内容长度:', thinking.length, '前50字符:', thinking.slice(0, 50));

    // 同步更新 runtimeStore - 累加 thinking 内容
    const runtimeStore = useRuntimeStore.getState();

    // 手动计算累加后的完整 thinking 内容
    const currentThinking = runtimeStore.messageStream?.thinking || '';
    const fullThinking = currentThinking + thinking;

    console.log('[chatStore] 累加后的完整 thinking 长度:', fullThinking.length, '前50字符:', fullThinking.slice(0, 50));

    // 累加到 messageStream
    runtimeStore.appendStreamThinking(thinking);

    // 更新 agentStatus，设置完整的 thinking 内容
    runtimeStore.updateAgentStatus({
      status: 'thinking',
      currentThought: fullThinking,
    });
    runtimeStore.setProcessing(true);

    console.log('[chatStore] 已更新 agentStatus.currentThought:', fullThinking.slice(0, 50));

    // 更新 activeAgentStore - 只更新主 Agent 的思考
    // Sub-agent 的思考通过 agent:thinking-start 事件单独更新
    const activeAgentStore = useActiveAgentStore.getState();
    const currentAgentId = activeAgentStore.currentActiveAgentId;
    const isMainAgent = !currentAgentId || currentAgentId === activeAgentStore.mainAgent?.id;

    // 只更新主 Agent（避免覆盖 sub-agent 的思考）
    if (isMainAgent && activeAgentStore.mainAgent) {
      activeAgentStore.setAgentThought(activeAgentStore.mainAgent.id, fullThinking);
    }

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

    // 检查是否是重复事件（后端可能发送两次 tool-start，第一次 input 为空，第二次有完整 input）
    const isDuplicate = activeToolCalls.has(data.id);

    if (isDuplicate) {
      // 重复事件：只更新 runtimeStore 的 multiAgent 数据（补充完整 input），不重复设置 UI
      if (data.name === 'agent_team') {
        const input = data.input as any;
        // 🔧 确保 members 是数组
        const members = Array.isArray(input.members) ? input.members : [];
        const multiAgent = {
          type: 'agent_team',
          strategy: input.strategy,
          teamName: input.team_name,
          members: members.map((m: any) => ({
            id: m.id,
            name: m.name || m.role,
            role: m.role,
            status: 'idle' as const,
            progress: 0,
          })),
          totalSteps: members.length,
        };
        useRuntimeStore.getState().addToolCall({
          id: data.id,
          name: data.name,
          status: 'running',
          input: data.input,
          startTime: Date.now(),
          multiAgent,
        });
      }
      return;
    }

    // 🔧 清理同名工具的旧调用（防止失败后重试时出现重复标签）
    // 例如：agent_team 失败 → 降级到 task → 再次尝试 agent_team
    const oldToolCallsToRemove: string[] = [];
    activeToolCalls.forEach((tc, id) => {
      if (tc.name === data.name && (tc.status === 'error' || tc.status === 'success')) {
        oldToolCallsToRemove.push(id);
      }
    });
    oldToolCallsToRemove.forEach(id => {
      activeToolCalls.delete(id);
      // 同时从 runtimeStore 中移除
      useRuntimeStore.getState().removeToolCall(id);
    });

    const toolCall: ToolCall = {
      id: data.id,
      name: data.name,
      status: 'pending',
      startTime: Date.now(),
      input: data.input, // 保存工具输入参数
    };

    // 检测 Multi-Agent 工具并提取详细信息
    let multiAgent: any = undefined;

    if (data.name === 'agent_team') {
      const input = data.input as any;
      // 🔧 确保 members 是数组
      const members = Array.isArray(input.members) ? input.members : [];
      multiAgent = {
        type: 'agent_team',
        strategy: input.strategy,
        teamName: input.team_name,
        members: members.map((m: any) => ({
          id: m.id,
          name: m.name || m.role,
          role: m.role,
          status: 'idle' as const,
          progress: 0,
        })),
        totalSteps: members.length,
      };
    }
    // task 工具不需要 multiAgent 标记，它创建单个子 agent

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

    // 更新 activeAgentStore - 使用事件中的 agentId（来自 Hook）
    const activeAgentStore = useActiveAgentStore.getState();
    // 🔧 优先使用事件中的 agentId，如果没有则使用 currentActiveAgentId
    const targetAgentId = data.agentId || activeAgentStore.currentActiveAgentId;
    if (targetAgentId) {
      activeAgentStore.addAgentTool(targetAgentId, {
        id: data.id,
        name: data.name,
        input: data.input,
        status: 'running',
        startTime: Date.now(),
      });
    }

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
      if (name === 'web_search' || name === 'web_fetch') return '🌐 联网搜索中...';
      if (name === 'task') return '🤖 启动子任务...';
      if (name === 'agent_team') return '👥 团队协作中...';
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

    // 更新 WorkspaceMonitor activity（工具调用 → 动作标签 + 时间条）
    {
      const actStore = useRuntimeStore.getState();
      const activeAgentStore = useActiveAgentStore.getState();

      // 优先使用事件中的 agentId，如果没有则从 activeAgentStore 获取
      let currentAgentId: string;
      if (data.agentId) {
        // 事件中有 agentId（来自子 Agent 的 Hook）
        currentAgentId = data.agentId;
      } else {
        // 事件中没有 agentId（来自主 Agent 的回调）
        const rawAgentId = activeAgentStore.currentActiveAgentId;
        const isMainAgent = !rawAgentId || rawAgentId === activeAgentStore.mainAgent?.id;
        // 🔧 使用实际的 mainAgent.id，而不是硬编码 'main'
        currentAgentId = isMainAgent ? (activeAgentStore.mainAgent?.id || 'xuanji') : rawAgentId;
      }
      const agentName = activeAgentStore.mainAgent?.name || 'Xuanji';

      console.log('[chatStore] _handleAgentToolStart - data.agentId:', data.agentId);
      console.log('[chatStore] _handleAgentToolStart - currentActiveAgentId:', activeAgentStore.currentActiveAgentId);
      console.log('[chatStore] _handleAgentToolStart - 最终 agentId:', currentAgentId);
      console.log('[chatStore] _handleAgentToolStart - 工具名称:', data.name);
      console.log('[chatStore] _handleAgentToolStart - 工具 ID:', data.id);

      const momentType = (() => {
        const n = data.name;
        if (n === 'bash') return { type: 'bash' as const, icon: '⚡' };
        if (n === 'read_file' || n === 'write_file' || n === 'edit_file' || n === 'multi_edit' || n === 'glob' || n === 'grep') return { type: 'file' as const, icon: '🗂' };
        if (n === 'task') return { type: 'bash' as const, icon: '🤖' };
        if (n === 'agent_team') return { type: 'bash' as const, icon: '👥' };
        return { type: 'bash' as const, icon: '⚙️' };
      })();

      console.log('[chatStore] _handleAgentToolStart - momentType:', momentType);

      // 如果是 agent_team 或 task 工具，记录调用者（用于后续确定子 Agent 的父节点）
      if (data.name === 'agent_team' || data.name === 'task') {
        // 使用 toolCallId 作为 key，因为后续 _handleTeamStart 会建立 teamId → toolCallId 的映射
        get()._teamParentMap[data.id] = currentAgentId;
        console.log('[chatStore] _handleAgentToolStart - 记录工具调用者:', data.name, data.id, '→', currentAgentId);
      }

      // 🔧 工具调用统一使用 timelineEvents 展示，不再使用 currentMoment
      // currentMoment 只用于瞬时动作（thinking、memory等）
      actStore.addTimelineEvent(currentAgentId, {
        id: data.id,
        icon: momentType.icon,
        label: data.name.slice(0, 12),
        status: 'running',
        startTime: Date.now(),  // ✅ 添加开始时间
      });
      actStore.addRecentEvent({
        agentName,
        description: `${data.name}: ${JSON.stringify(data.input).slice(0, 40)}`,
        icon: momentType.icon,
      });
    }
  },

  _handleAgentToolEnd: (data) => {
    console.log('[chatStore] ===== _handleAgentToolEnd 触发 =====');
    console.log('[chatStore] 工具 ID:', data.id);
    console.log('[chatStore] 工具名称:', data.name);
    console.log('[chatStore] 是否错误:', data.isError);
    console.log('[chatStore] data.agentId:', data.agentId);

    const { activeToolCalls, currentStreamingId } = get();

    // 更新工具状态
    const newToolCalls = new Map(activeToolCalls);
    const toolCall = newToolCalls.get(data.id);

    if (toolCall) {
      toolCall.status = data.isError ? 'error' : 'success';
      toolCall.output = data.result; // 保存工具输出
      // 计算 duration
      if (toolCall.startTime) {
        toolCall.duration = Date.now() - toolCall.startTime;
      }
      newToolCalls.set(data.id, toolCall);

      // 同步更新 runtimeStore
      console.log('[chatStore] 准备调用 runtimeStore.updateToolCall');
      console.log('[chatStore] 更新参数:', {
        id: data.id,
        status: data.isError ? 'error' : 'success',
        duration: toolCall.duration,
      });

      useRuntimeStore.getState().updateToolCall(data.id, {
        status: data.isError ? 'error' : 'success',
        output: data.result,
        duration: toolCall.duration,
      });

      // 🔧 优先使用事件中的 agentId，如果没有则从 activeAgentStore 获取
      const activeAgentStore = useActiveAgentStore.getState();
      let currentAgentId: string;
      if (data.agentId) {
        // 事件中有 agentId（来自子 Agent 的 Hook）
        currentAgentId = data.agentId === 'main' ? 'main' : data.agentId;
      } else {
        // 事件中没有 agentId（来自主 Agent 的回调）
        const rawAgentId = activeAgentStore.currentActiveAgentId;
        const isMainAgent = !rawAgentId || rawAgentId === activeAgentStore.mainAgent?.id;
        currentAgentId = isMainAgent ? 'main' : rawAgentId;
      }

      console.log('[chatStore] _handleAgentToolEnd - 最终 agentId:', currentAgentId);

      if (currentAgentId) {
        activeAgentStore.updateAgentTool(currentAgentId, data.id, {
          status: data.isError ? 'error' : 'success',
          output: data.result,
          duration: toolCall.duration,
          endTime: Date.now(),
        });

        // 🔧 完成子 agent 的 timeline 事件
        const runtimeStore = useRuntimeStore.getState();
        runtimeStore.finishTimelineEvent(
          currentAgentId,
          data.id,
          toolCall.duration || 0,
          data.isError ? 'error' : 'success'
        );
      }

      // 解析 TODO_PROGRESS 标记并更新 executionStore
      if (!data.isError && data.result && data.result.includes('<!--TODO_PROGRESS:')) {
        // 🔧 找到标记的起始和结束位置，提取 JSON 内容
        const startMarker = '<!--TODO_PROGRESS:';
        const endMarker = '-->';
        const startIndex = data.result.indexOf(startMarker);
        if (startIndex !== -1) {
          const jsonStart = startIndex + startMarker.length;
          // 🔧 先找到结束标记 -->，确保在正确的范围内提取
          const endIndex = data.result.indexOf(endMarker, jsonStart);
          if (endIndex !== -1) {
            // 提取标记之间的内容
            const jsonStr = data.result.substring(jsonStart, endIndex).trim();
            console.log('[chatStore] 提取的 JSON 字符串:', jsonStr.substring(0, 200));
            try {
              const progressData = JSON.parse(jsonStr);
              // progressData = { completed: 1, total: 3, items: [{ id, title, description, status, activeForm }] }

              console.log('[chatStore] 收到 TODO_PROGRESS，原始数据:', JSON.stringify(progressData, null, 2));

              // 🆕 原子性地更新所有任务，避免中间状态导致的 UI 闪烁
              if (progressData.items && Array.isArray(progressData.items)) {
                const newTodos = progressData.items.map((item: any) => {
                  console.log(`[chatStore] 处理任务: id=${item.id}, title=${item.title}, status=${item.status}`);
                  return {
                    id: item.id,
                    subject: item.title,
                    description: item.description || '',
                    status: item.status || 'pending',
                    activeForm: item.activeForm,
                    createdAt: Date.now(),
                    startedAt: item.status === 'in_progress' ? Date.now() : undefined,
                    completedAt: (item.status === 'completed' || item.status === 'failed') ? Date.now() : undefined,
                  };
                });

                console.log('[chatStore] 即将更新 todos，新任务列表:', newTodos.map(t => ({ id: t.id, status: t.status, subject: t.subject })));

                // 一次性替换所有任务，避免多次 setState 导致的竞态条件
                useExecutionStore.setState({ todos: newTodos });

                console.log('[chatStore] todos 更新完成');
              }
            } catch (err) {
              console.error('[chatStore] 解析 TODO_PROGRESS 失败:', err);
              console.error('[chatStore] 原始 result 内容:', data.result.substring(0, 500));
            }
          }
        }
      }

      // 记录日志
      const statusIcon = data.isError ? '❌' : '✅';
      const durationText = toolCall.duration ? ` (${toolCall.duration}ms)` : '';
      get().addLog('tool', `${statusIcon} ${data.name} ${data.isError ? '执行失败' : '执行完成'}${durationText}`);
    }

    // 检查是否还有活跃工具
    const hasActiveTools = Array.from(newToolCalls.values()).some(tc => tc.status === 'pending');
    
    // 更新消息的 toolCalls 和状态提示
    if (currentStreamingId) {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === currentStreamingId
            ? {
                ...msg, 
                toolCalls: Array.from(newToolCalls.values()),
                // 如果没有活跃工具，恢复到编写回复状态
                statusHint: hasActiveTools ? msg.statusHint : '✍️ 编写回复中...'
              }
            : msg
        ),
        activeToolCalls: newToolCalls,
        status: hasActiveTools ? 'executing' : 'thinking',
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

    // 更新 WorkspaceMonitor activity（工具完成 → 完成 moment + 完成时间条事件）
    {
      const actStore = useRuntimeStore.getState();
      const activeAgentStore = useActiveAgentStore.getState();

      // 优先使用事件中的 agentId，如果没有则从 activeAgentStore 获取
      let currentAgentId: string;
      if (data.agentId) {
        // 事件中有 agentId（来自子 Agent 的 Hook）
        currentAgentId = data.agentId;
      } else {
        // 事件中没有 agentId（来自主 Agent 的回调）
        const rawAgentId = activeAgentStore.currentActiveAgentId;
        const isMainAgent = !rawAgentId || rawAgentId === activeAgentStore.mainAgent?.id;
        // 🔧 使用实际的 mainAgent.id，而不是硬编码 'main'
        currentAgentId = isMainAgent ? (activeAgentStore.mainAgent?.id || 'xuanji') : rawAgentId;
      }

      const status = data.isError ? 'error' : 'success';
      // 🔧 工具调用统一使用 timelineEvents，不再使用 currentMoment
      // 所以不需要 finishAgentMoment
      const toolCallDuration = activeToolCalls.get(data.id)?.duration;
      actStore.finishTimelineEvent(currentAgentId, data.id, toolCallDuration ?? 0, status);
    }

    // ✅ 新增：为文件操作工具生成对话式摘要消息
    const FILE_OPERATION_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit']);

    if (FILE_OPERATION_TOOLS.has(data.name) && !data.isError) {
      console.log('[chatStore] 检测到文件操作工具:', data.name);
      const toolCall = newToolCalls.get(data.id);
      if (toolCall && toolCall.input) {
        console.log('[chatStore] 生成工具摘要，工具名称:', data.name);
        console.log('[chatStore] 工具输入:', toolCall.input);
        console.log('[chatStore] 工具结果（前200字符）:', data.result.slice(0, 200));
        
        const summary = generateToolSummaryMessage(data.name, toolCall.input, data.result);

        if (summary) {
          console.log('[chatStore] 生成的摘要内容（前200字符）:', summary.slice(0, 200));
          const summaryMessage: Message = {
            id: generateMessageId('tool-summary'),
            role: 'assistant',
            content: summary,
            timestamp: Date.now(),
            toolSummary: true,
          };

          set((state) => ({
            messages: [...state.messages, summaryMessage],
          }));
          console.log('[chatStore] 已添加工具摘要消息到对话中');
        } else {
          console.log('[chatStore] 摘要内容为空，未添加消息');
        }
      } else {
        console.log('[chatStore] 未找到工具调用信息或输入参数');
      }
    }
  },

  _handleAgentUsage: (usage) => {
    // 同步更新 runtimeStore
    useRuntimeStore.getState().addTokenUsage(
      usage.input || 0,
      usage.output || 0,
      usage.cached || 0
    );

    // 记录本次 LLM call 的最新 token 用量（用于 per-agent 统计展示）
    useRuntimeStore.getState().setCurrentCallTokens({
      input: usage.input || 0,
      output: usage.output || 0,
      cached: usage.cached || 0,
    });

    // 更新 activeAgentStore
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
    console.log('[chatStore] _handleAgentError: 收到错误', error);

    // 标记 agent 已结束
    isAgentEnded = true;

    // 取消节流函数的待执行任务
    throttledFlushStreamText.cancel();

    // 刷新流式文本缓冲区（如果有未完成的消息）
    const { currentStreamingId, currentStreamingText } = get();
    if (currentStreamingId && currentStreamingText) {
      flushStreamText();
    }

    // 同步更新 runtimeStore
    useRuntimeStore.getState().setProcessing(false);
    useRuntimeStore.getState().updateAgentStatus({
      status: 'error',
    });

    // 添加错误消息气泡
    const errorMessage: Message = {
      id: generateMessageId('error'),
      role: 'assistant',
      content: error,
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
    console.log('[chatStore] _handleAgentEnd: 收到 agent:end 事件，准备结束当前消息气泡');

    // 标记 agent 已结束，防止后续的 flushStreamText 设置 statusHint
    isAgentEnded = true;

    // 取消节流函数的待执行任务，防止在清除 statusHint 后又被设置回来
    throttledFlushStreamText.cancel();

    // 刷新流式文本缓冲区，确保最后的内容显示（此时 isAgentEnded = true，不会设置 statusHint）
    flushStreamText();

    // 同步更新 runtimeStore
    useRuntimeStore.getState().finishMessageStream();
    useRuntimeStore.getState().setProcessing(false);
    useRuntimeStore.getState().updateAgentStatus({
      status: 'done',
    });
    // 清空进行中的动作标签（run 结束）
    useRuntimeStore.setState((s) => ({
      agentActivity: { ...s.agentActivity, currentMoments: {} },
    }));

    // 将所有仍在 pending 的工具标记为 success（防止 agent:end 先于 agent:tool-end 到达）
    const { activeToolCalls, currentStreamingId } = get();
    console.log('[chatStore] _handleAgentEnd: currentStreamingId =', currentStreamingId);
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

    // 将仍在 in_progress 的 TODO 标记为 failed（Agent 已停止，任务不会继续）
    const executionState = useExecutionStore.getState();
    const hasActiveTodos = executionState.todos.some(
      (t) => t.status === 'in_progress'
    );
    if (hasActiveTodos) {
      useExecutionStore.setState({
        todos: executionState.todos.map((t) =>
          t.status === 'in_progress'
            ? { ...t, status: 'failed' as const, completedAt: t.completedAt || Date.now() }
            : t
        ),
      });
    }

    // 完成主 Agent（activeAgentStore）
    useActiveAgentStore.getState().finishMainAgent();

    // 完成主 Agent（activeAgentStore）
    useActiveAgentStore.getState().finishMainAgent();

    set((prevState) => ({
      status: 'idle',
      currentStreamingId: null,
      currentStreamingText: '',
      activeToolCalls: new Map(),
      // 清除所有消息的 statusHint + 写入最终工具状态
      messages: prevState.messages.map((msg) => {
        if (msg.id === currentStreamingId) {
          // 当前流式消息：清除 statusHint + 写入最终工具状态
          return { ...msg, statusHint: undefined, toolCalls: finalizedToolCalls };
        } else if (msg.statusHint) {
          // 其他有 statusHint 的消息：清除 statusHint
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
      // 更新当前 Skill
      currentSkill: state.currentSkill ? {
        name: state.currentSkill.name,
        icon: state.currentSkill.icon || '🛠️',
      } : prevState.currentSkill,
    }));
    
    console.log('[chatStore] _handleAgentEnd: 已清空流式状态，下一条回复将在新气泡中显示');
  },

  // ── Multi-Agent 成员状态动态更新 ──────────────────────────
  _teamIdMap: {},
  _teamParentMap: {},
  _taskParentMap: {},

  _handleTeamStart: (data) => {
    console.log('[chatStore] _handleTeamStart 被调用');
    console.log('[chatStore] 当前 messageStream:', useRuntimeStore.getState().messageStream);

    // 通过 teamName 找到对应的 toolCall，建立 teamId → toolCallId 映射
    const stream = useRuntimeStore.getState().messageStream;
    if (!stream) {
      console.log('[chatStore] _handleTeamStart: messageStream 为空，无法建立映射');
      return;
    }

    console.log('[chatStore] _handleTeamStart: toolCalls 数量:', stream.toolCalls.length);

    // 尝试多种匹配策略：
    // 1. 通过 teamName 精确匹配
    let toolCall = stream.toolCalls.find(
      (tc) => tc.status === 'running' && tc.multiAgent?.teamName === data.name
    );

    // 2. 如果没找到，尝试通过 strategy 匹配
    if (!toolCall && data.strategy) {
      console.log('[chatStore] _handleTeamStart: teamName 未匹配，尝试通过 strategy 匹配:', data.strategy);
      toolCall = stream.toolCalls.find(
        (tc) => tc.status === 'running' && tc.name === 'agent_team' && tc.multiAgent?.strategy === data.strategy
      );
    }

    // 3. 如果还没找到，使用最近的 running 状态的 agent_team 工具
    if (!toolCall) {
      console.log('[chatStore] _handleTeamStart: strategy 未匹配，使用最近的 agent_team 工具');
      const agentTeamCalls = stream.toolCalls.filter(
        (tc) => tc.status === 'running' && tc.name === 'agent_team'
      );
      // 找到还没有被映射的 agent_team 工具
      const existingToolCallIds = new Set(Object.values(get()._teamIdMap));
      toolCall = agentTeamCalls.find((tc) => !existingToolCallIds.has(tc.id));
    }

    if (toolCall) {
      console.log('[chatStore] _handleTeamStart: 找到匹配的 toolCall:', toolCall.id);
      console.log('[chatStore] _handleTeamStart: toolCall.multiAgent:', toolCall.multiAgent);
      console.log('[chatStore] _handleTeamStart: 建立映射 teamId -> toolCallId:', data.teamId, '->', toolCall.id);
      set((state) => ({
        _teamIdMap: { ...state._teamIdMap, [data.teamId]: toolCall.id },
      }));
      console.log('[chatStore] _handleTeamStart: 映射建立完成，当前 _teamIdMap:', { ...get()._teamIdMap, [data.teamId]: toolCall.id });

      // 🆕 预先创建所有团队成员的占位符
      if (data.members && Array.isArray(data.members)) {
        console.log('[chatStore] _handleTeamStart: 预先创建', data.members.length, '个团队成员占位符');

        const activeAgentStore = useActiveAgentStore.getState();
        const mainAgent = activeAgentStore.mainAgent;
        const parentAgentId = mainAgent?.id;

        console.log('[chatStore] _handleTeamStart: 创建前 mainAgent:', mainAgent);
        console.log('[chatStore] _handleTeamStart: 创建前 mainAgent.subAgents:', mainAgent?.subAgents);

        if (parentAgentId) {
          data.members.forEach((member: any) => {
            const subAgentId = member.id;
            console.log('[chatStore] _handleTeamStart: 创建占位符 ->', subAgentId, member.name);

            activeAgentStore.addSubAgent(parentAgentId, {
              id: subAgentId,
              name: member.name || member.role || member.id,
              status: 'idle', // 初始状态为 idle
              currentTools: [],
              subAgents: [],
              agentType: 'temporary',
              stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
              multiAgent: {
                type: 'agent_team',
                strategy: data.strategy,
                teamName: data.name,
                stepIndex: member.stepIndex,
                totalSteps: data.members.length,
              },
            });
          });

          // 记录父节点映射
          set((state) => ({
            _teamParentMap: { ...state._teamParentMap, [toolCall.id]: parentAgentId },
          }));

          // 🔧 添加调试日志：检查创建后的状态
          const updatedMainAgent = activeAgentStore.mainAgent;
          console.log('[chatStore] _handleTeamStart: 创建后 mainAgent:', updatedMainAgent);
          console.log('[chatStore] _handleTeamStart: 创建后 mainAgent.subAgents:', updatedMainAgent?.subAgents);
          console.log('[chatStore] _handleTeamStart: 创建后 subAgents 数量:', updatedMainAgent?.subAgents?.length);
        }
      }
    } else {
      console.log('[chatStore] _handleTeamStart: 未找到匹配的 toolCall');
      console.log('[chatStore] _handleTeamStart: 所有 toolCalls:', stream.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        status: tc.status,
        multiAgent: tc.multiAgent,
      })));
    }
  },

  _handleTeamMemberStart: (data) => {
    console.log('[chatStore] _handleTeamMemberStart 被调用');
    console.log('[chatStore] teamId:', data.teamId);
    console.log('[chatStore] memberId:', data.memberId);
    console.log('[chatStore] name:', data.name);
    console.log('[chatStore] _teamIdMap:', get()._teamIdMap);

    // ✅ 特殊处理 task 工具创建的子 agent（teamId: 'delegate'）
    // task 工具不需要复合 ID，直接使用 memberId 即可
    const isTaskAgent = data.teamId === 'task';

    if (!isTaskAgent) {
      // agent_team 工具：直接使用 memberId（即后端的 subAgentId）
      const toolCallId = get()._teamIdMap[data.teamId];
      if (!toolCallId) {
        console.log('[chatStore] _handleTeamMemberStart: 未找到 toolCallId，teamId:', data.teamId);
        return;
      }

      console.log('[chatStore] _handleTeamMemberStart: 找到 toolCallId:', toolCallId);

      // 从 _teamParentMap 中获取父 Agent ID
      const parentAgentId = get()._teamParentMap[toolCallId];
      console.log('[chatStore] _handleTeamMemberStart: 父 Agent ID:', parentAgentId);

      useRuntimeStore.getState().updateToolCallMember(toolCallId, data.memberId, {
        status: 'running',
      });

      // 直接使用 memberId（即后端的 subAgentId），不再构建复合 ID
      const subAgentId = data.memberId;
      console.log('[chatStore] _handleTeamMemberStart: 使用 subAgentId:', subAgentId);

      // 检查 sub-agent 是否已存在（TeamStart 时预先创建的占位符）
      const activeAgentStore = useActiveAgentStore.getState();
      const mainAgent = activeAgentStore.mainAgent;

      // 使用记录的父 Agent ID，如果没有则使用主 Agent
      // 注意：如果 parentAgentId 是 'main'，需要转换为 mainAgent.id
      let targetParentId = parentAgentId || mainAgent?.id;
      if (targetParentId === 'main' && mainAgent) {
        targetParentId = mainAgent.id;
      }

      // 检查 agent 是否已存在
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

      // 🔧 解析 debateRole（从 systemPromptHint 中提取 [debate_role:xxx] 标签）
      let debateRole: 'affirmative' | 'negative' | 'judge' | undefined;
      if (data.systemPromptHint) {
        const match = data.systemPromptHint.match(/\[debate_role:(affirmative|negative|judge)\]/i);
        if (match) {
          debateRole = match[1].toLowerCase() as 'affirmative' | 'negative' | 'judge';
        }
      }

      if (agentExists) {
        // Agent 已存在（TeamStart 时创建的占位符），只更新状态
        console.log('[chatStore] _handleTeamMemberStart: Agent 已存在，更新状态 ->', subAgentId);
        activeAgentStore.setAgentStatus(subAgentId, 'thinking');
        // 保存任务信息
        if (data.task) {
          activeAgentStore.setAgentTask(subAgentId, data.task);
        }
        // 更新 multiAgent 信息（轮次 + debateRole）
        activeAgentStore.updateAgentMultiAgent(subAgentId, {
          currentRound: data.currentRound,
          maxRounds: data.maxRounds,
          debateRole,
        });
      } else {
        // Agent 不存在，创建新的（兼容旧逻辑）
        console.log('[chatStore] _handleTeamMemberStart: Agent 不存在，创建新的 ->', subAgentId);

        if (mainAgent && targetParentId) {
          activeAgentStore.addSubAgent(targetParentId, {
            id: subAgentId,
            name: data.name || data.role || data.memberId,
            status: 'thinking',
            currentTools: [],
            subAgents: [],
            // 🔧 团队成员默认为临时agent，除非明确指定类型
            agentType: data.agentType || 'temporary',
            stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
            // 添加 multiAgent 信息
            multiAgent: {
              type: 'agent_team',
              strategy: data.strategy,
              teamName: data.teamName,
              stepIndex: data.stepIndex,
              totalSteps: data.totalSteps,
              // 辩论信息
              currentRound: data.currentRound,
              maxRounds: data.maxRounds,
              debateRole,
            },
          });
        }
      }

      // 为子 agent 初始化 WorkspaceMonitor activity
      const runtimeStore = useRuntimeStore.getState();
      console.log('[chatStore] _handleTeamMemberStart: 设置 WorkspaceMonitor activity');
      // 🔧 子agent不使用currentMoment，只使用timeline展示工具调用
      // currentMoment只用于主agent的后台操作（如compress）
      runtimeStore.addRecentEvent({
        agentName: data.role || data.memberId,
        description: `Team member started: ${data.task?.slice(0, 50) || 'processing'}`,
        icon: '🤖',
      });
    } else {
      // ✅ task 工具：直接使用 memberId（subAgentId）
      const subAgentId = data.memberId;
      console.log('[chatStore] _handleTeamMemberStart (task): 使用 subAgentId:', subAgentId);

      // 添加 sub-agent（使用 subAgentId）
      const activeAgentStore = useActiveAgentStore.getState();
      const mainAgent = activeAgentStore.mainAgent;

      // 检查子 Agent 是否已经存在（避免重复添加）
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

      if (findAgent(mainAgent, subAgentId)) {
        console.log('[chatStore] _handleTeamMemberStart (task): 子 Agent 已存在，跳过:', subAgentId);
        return;
      }

      // 查找最近的 task 工具调用，获取调用者
      // 遍历 _teamParentMap，找到最近记录的 task 工具调用
      let parentAgentId: string | undefined;
      const taskToolCalls = Object.entries(get()._teamParentMap).filter(([toolId]) => {
        // 检查这个 toolId 是否是 task 工具
        const runtimeStore = useRuntimeStore.getState();
        const toolCall = runtimeStore.messageStream?.toolCalls.find(tc => tc.id === toolId);
        return toolCall?.name === 'task';
      });

      if (taskToolCalls.length > 0) {
        // 使用最近的一个（最后一个）
        parentAgentId = taskToolCalls[taskToolCalls.length - 1][1];
        console.log('[chatStore] _handleTeamMemberStart (task): 从 _teamParentMap 获取父 Agent:', parentAgentId);
      } else {
        // 如果没有找到，使用 currentActiveAgentId 或 mainAgent
        parentAgentId = activeAgentStore.currentActiveAgentId || mainAgent?.id;
        console.log('[chatStore] _handleTeamMemberStart (task): 使用 currentActiveAgentId:', parentAgentId);
      }

      if (mainAgent && parentAgentId) {
        console.log('[chatStore] _handleTeamMemberStart (task): 添加到父 Agent:', parentAgentId);

        activeAgentStore.addSubAgent(parentAgentId, {
          id: subAgentId,
          name: data.name || data.role || 'Sub-agent', // 优先使用 name，其次 role
          status: 'thinking',
          currentTools: [],
          subAgents: [],
          // 🔧 优先使用agentType字段，其次判断builtin，最后默认为temporary
          agentType: data.agentType || (data.builtin ? 'builtin' : 'temporary'),
          stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
        });
        // 切换到子 agent
        activeAgentStore.setCurrentActiveAgent(subAgentId);
      }

      // 为子 agent 初始化 WorkspaceMonitor activity
      const runtimeStore = useRuntimeStore.getState();
      // 🔧 子agent不使用currentMoment，只使用timeline展示工具调用
      // currentMoment只用于主agent的后台操作（如compress）
      runtimeStore.addRecentEvent({
        agentName: data.role || 'Sub-agent',
        description: `Task started: ${data.task?.slice(0, 50) || 'processing'}`,
        icon: '🤖',
      });
    }
  },

  _handleTeamMemberEnd: (data) => {
    // ✅ 特殊处理 task 工具创建的子 agent（teamId: 'task'）
    const isTaskAgent = data.teamId === 'task';

    if (!isTaskAgent) {
      // agent_team 工具：直接使用 memberId（与 _handleTeamMemberStart 保持一致）
      const toolCallId = get()._teamIdMap[data.teamId];
      if (!toolCallId) return;

      useRuntimeStore.getState().updateToolCallMember(toolCallId, data.memberId, {
        status: data.success !== false ? 'success' : 'error',
        duration: data.duration,
      });

      // 直接使用 memberId（与 _handleTeamMemberStart 保持一致）
      const subAgentId = data.memberId;

      // 标记 sub-agent 完成
      const activeAgentStore = useActiveAgentStore.getState();
      const finalStatus = data.success !== false ? 'success' : 'error';

      // 只更新状态，不移除 Agent（等待 TeamEnd 统一清理）
      activeAgentStore.setAgentStatus(subAgentId, finalStatus);

      // 🔧 如果有 resultSummary，更新 agent 的 task（显示发言结论）
      if (data.resultSummary) {
        activeAgentStore.setAgentTask(subAgentId, data.resultSummary);
      }

      console.log('[chatStore] _handleTeamMemberEnd: 成员完成，状态更新为:', finalStatus, 'Agent ID:', subAgentId);

      // 完成子 agent 的 WorkspaceMonitor activity
      const runtimeStore = useRuntimeStore.getState();
      const status = data.success !== false ? 'success' : 'error';
      runtimeStore.finishAgentMoment(subAgentId, status);
      runtimeStore.addRecentEvent({
        agentName: data.memberId,
        description: `Team member ${status === 'success' ? 'completed' : 'failed'} (${data.duration}ms)`,
        icon: status === 'success' ? '✅' : '❌',
      });
    } else {
      // ✅ task 工具：直接使用 memberId（subAgentId）
      const subAgentId = data.memberId;

      // 标记 sub-agent 完成
      const activeAgentStore = useActiveAgentStore.getState();
      const finalStatus = data.success !== false ? 'success' : 'error';

      // 更新 Agent 状态
      activeAgentStore.setAgentStatus(subAgentId, finalStatus);

      // 获取父 Agent ID（task 工具创建的子 Agent 的父节点）
      // 需要从 activeAgentStore 中查找
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

      const parentAgentId = findParentId(activeAgentStore.mainAgent, subAgentId);

      // 移除已完成的子 Agent（让它消失）
      if (parentAgentId) {
        console.log('[chatStore] _handleTeamMemberEnd (task): 移除子 Agent:', subAgentId, '从父节点:', parentAgentId);
        activeAgentStore.removeSubAgent(parentAgentId, subAgentId);
      }

      // 切回父 Agent
      if (parentAgentId) {
        activeAgentStore.setCurrentActiveAgent(parentAgentId);
      }

      // 完成子 agent 的 WorkspaceMonitor activity
      const runtimeStore = useRuntimeStore.getState();
      const status = data.success !== false ? 'success' : 'error';
      runtimeStore.finishAgentMoment(subAgentId, status);
      runtimeStore.addRecentEvent({
        agentName: 'Sub-agent',
        description: `Task ${status === 'success' ? 'completed' : 'failed'} (${data.duration}ms)`,
        icon: status === 'success' ? '✅' : '❌',
      });
    }
  },

  _handleTeamEnd: (data) => {
    console.log('[chatStore] _handleTeamEnd 被调用');
    console.log('[chatStore] teamId:', data.teamId);
    console.log('[chatStore] name:', data.name);
    console.log('[chatStore] success:', data.success);
    console.log('[chatStore] error:', data.error);

    const toolCallId = get()._teamIdMap[data.teamId];
    if (!toolCallId) {
      console.log('[chatStore] _handleTeamEnd: 未找到 toolCallId，teamId:', data.teamId);
      return;
    }

    const activeAgentStore = useActiveAgentStore.getState();
    const parentAgentId = get()._teamParentMap[toolCallId] || activeAgentStore.mainAgent?.id;

    // 🔧 延迟清理团队成员，让虚线框保持可见 3 秒
    if (parentAgentId) {
      console.log('[chatStore] _handleTeamEnd: 团队结束，3秒后清理所有成员');

      // 递归查找所有属于该团队的子 Agent
      const findTeamMembers = (agent: any): string[] => {
        if (!agent || !agent.subAgents) return [];

        const members: string[] = [];
        for (const sub of agent.subAgents) {
          // 检查是否属于该团队（通过 multiAgent.teamName 匹配）
          if (sub.multiAgent?.teamName === data.name) {
            members.push(sub.id);
          }
          // 递归查找嵌套的子 Agent
          members.push(...findTeamMembers(sub));
        }
        return members;
      };

      const teamMemberIds = findTeamMembers(activeAgentStore.mainAgent);
      console.log('[chatStore] _handleTeamEnd: 找到团队成员:', teamMemberIds);

      // 如果失败，立即标记所有成员为 error 状态
      if (!data.success) {
        teamMemberIds.forEach(memberId => {
          activeAgentStore.setAgentStatus(memberId, 'error');
        });
      }

      // 延迟 3 秒后移除所有团队成员
      setTimeout(() => {
        console.log('[chatStore] _handleTeamEnd: 延迟清理开始');
        teamMemberIds.forEach(memberId => {
          // 从父节点移除
          console.log('[chatStore] _handleTeamEnd: 移除团队成员:', memberId);
          activeAgentStore.removeSubAgent(parentAgentId, memberId);

          // 清理 WorkspaceMonitor activity
          const runtimeStore = useRuntimeStore.getState();
          runtimeStore.finishAgentMoment(memberId, data.success ? 'success' : 'error');
        });
      }, 3000);

      // 添加事件
      const runtimeStore = useRuntimeStore.getState();
      runtimeStore.addRecentEvent({
        agentName: data.name,
        description: data.success
          ? `Team completed successfully`
          : `Team failed: ${data.error || 'Unknown error'}`,
        icon: data.success ? '✅' : '❌',
      });
    }

    // 清理映射
    const newTeamIdMap = { ...get()._teamIdMap };
    delete newTeamIdMap[data.teamId];
    const newTeamParentMap = { ...get()._teamParentMap };
    delete newTeamParentMap[toolCallId];

    set({
      _teamIdMap: newTeamIdMap,
      _teamParentMap: newTeamParentMap,
    });

    console.log('[chatStore] _handleTeamEnd: 清理完成');
  },
};
});

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

  // 先清除所有旧监听器，防止 HMR 热更新时重复注册导致事件触发多次
  const agentChannels = [
    'agent:text', 'agent:thinking', 'agent:tool-start', 'agent:tool-end',
    'agent:file-changes', 'agent:usage', 'agent:error', 'agent:end',
    'agent:team-start', 'agent:team-member-start', 'agent:team-member-end',
    'agent:subagent-start', 'agent:subagent-end', // 🔧 添加 subagent 事件
    'permission:request', 'plan-review:request', 'plan-mode:enter', 'plan-mode:exit',
    'ask-user:request', 'session:messages-restored', 'session:resume-notification',
    'session:archive-notification', 'prompt:build-event', 'project:info',
  ];
  // 🔧 使用 MessageBus 统一订阅所有事件（不再需要 removeAllListeners）

  // ========== Agent 基础事件 ==========
  messageBus.on('agent:text', (text: string) => {
    useChatStore.getState()._handleAgentText(text);
  });

  messageBus.on('agent:thinking', (thinking: string) => {
    useChatStore.getState()._handleAgentThinking(thinking);
  });

  messageBus.on('agent:tool-start', (data: { id: string; name: string; input: Record<string, unknown>; agentId?: string }) => {
    useChatStore.getState()._handleAgentToolStart(data);
  });

  messageBus.on('agent:tool-end', (data: { id: string; name: string; result: string; isError: boolean; agentId?: string }) => {
    useChatStore.getState()._handleAgentToolEnd(data);
  });

  messageBus.on('agent:file-changes', (data: { changes: any[] }) => {
    console.log('[chatStore] 收到文件变更事件，变更数量:', data.changes.length);
    // 为每个文件变更生成一条对话式摘要消息
    data.changes.forEach((change) => {
      const summary = generateFileChangeSummary(change);
      if (summary) {
        const summaryMessage: Message = {
          id: generateMessageId('file-change'),
          role: 'assistant',
          content: summary,
          timestamp: Date.now(),
          toolSummary: true,
        };
        useChatStore.getState().addMessage(summaryMessage);
      }
    });
  });

  messageBus.on('agent:usage', (usage: any) => {
    useChatStore.getState()._handleAgentUsage(usage);
  });

  messageBus.on('agent:error', (error: string) => {
    useChatStore.getState()._handleAgentError(error);
  });

  messageBus.on('agent:end', (state: any) => {
    useChatStore.getState()._handleAgentEnd(state);
  });

  // Multi-Agent 成员状态事件（来自 HookRegistry 转发）
  messageBus.on('agent:team-start', (data: {
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
  }) => {
    console.log('[chatStore] ===== agent:team-start 事件接收 =====');
    console.log('[chatStore] teamId:', data.teamId);
    console.log('[chatStore] name:', data.name);
    console.log('[chatStore] strategy:', data.strategy);
    console.log('[chatStore] memberCount:', data.memberCount);
    console.log('[chatStore] members:', data.members);
    useChatStore.getState()._handleTeamStart(data);
  });

  messageBus.on('agent:team-member-start', (data: {
    teamId: string;
    memberId: string;
    name?: string;
    role?: string;
    task?: string;
    agentType?: 'preset' | 'builtin' | 'custom' | 'temporary';
    strategy?: string;
    teamName?: string;
    stepIndex?: number;
    totalSteps?: number;
    currentRound?: number;
    maxRounds?: number;
    systemPromptHint?: string;
  }) => {
    console.log('[chatStore] ===== agent:team-member-start 事件接收 =====');
    console.log('[chatStore] teamId:', data.teamId);
    console.log('[chatStore] memberId:', data.memberId);
    console.log('[chatStore] name:', data.name);
    console.log('[chatStore] role:', data.role);
    console.log('[chatStore] task:', data.task);
    console.log('[chatStore] strategy:', data.strategy);
    console.log('[chatStore] teamName:', data.teamName);
    console.log('[chatStore] stepIndex:', data.stepIndex);
    console.log('[chatStore] totalSteps:', data.totalSteps);
    useChatStore.getState()._handleTeamMemberStart(data);
  });

  messageBus.on('agent:team-member-end', (data: { teamId: string; memberId: string; success?: boolean; duration?: number; resultSummary?: string }) => {
    console.log('[chatStore] ===== agent:team-member-end 事件接收 =====');
    console.log('[chatStore] teamId:', data.teamId);
    console.log('[chatStore] memberId:', data.memberId);
    console.log('[chatStore] success:', data.success);
    console.log('[chatStore] duration:', data.duration);
    useChatStore.getState()._handleTeamMemberEnd(data);
  });

  messageBus.on('agent:team-end', (data: { teamId: string; name: string; success: boolean; duration?: number; error?: string }) => {
    console.log('[chatStore] ===== agent:team-end 事件接收 =====');
    console.log('[chatStore] teamId:', data.teamId);
    console.log('[chatStore] name:', data.name);
    console.log('[chatStore] success:', data.success);
    console.log('[chatStore] duration:', data.duration);
    console.log('[chatStore] error:', data.error);
    useChatStore.getState()._handleTeamEnd(data);
  });

  // 🔧 内置系统 SubAgent 事件（如 memory-extractor）
  console.log('[chatStore] 注册 agent:subagent-start 监听器');
  messageBus.on('agent:subagent-start', (data: {
    subAgentId: string;
    name: string;
    role: string;
    task: string;
    agentType?: 'preset' | 'builtin' | 'custom' | 'temporary';
    parentId: string;
  }) => {
    console.log('[chatStore] ===== agent:subagent-start 事件接收 =====');
    console.log('[chatStore] subAgentId:', data.subAgentId);
    console.log('[chatStore] name:', data.name);
    console.log('[chatStore] role:', data.role);
    console.log('[chatStore] parentId:', data.parentId); // 🔧 添加 parentId 日志
    console.log('[chatStore] agentType:', data.agentType);

    const activeAgentStore = useActiveAgentStore.getState();
    console.log('[chatStore] mainAgent:', activeAgentStore.mainAgent); // 🔧 检查 mainAgent 状态
    console.log('[chatStore] mainAgent.id:', activeAgentStore.mainAgent?.id); // 🔧 检查 mainAgent.id

    // 添加子 Agent 到 activeAgentStore
    console.log('[chatStore] 调用 addSubAgent, parentId:', data.parentId); // 🔧 添加调用日志
    activeAgentStore.addSubAgent(data.parentId, {
      id: data.subAgentId,
      name: data.name,
      status: 'thinking',
      currentThought: data.task,
      currentTask: data.task,
      currentTools: [],
      subAgents: [],
      // 🔧 优先使用agentType字段，其次判断builtin，最后默认为temporary
      agentType: data.agentType || (data.builtin ? 'builtin' : 'temporary'),
      stats: {
        tokenUsage: {
          input: 0,
          output: 0,
          cached: 0,
        },
        cost: 0,
        toolCount: 0,
      },
    });

    // 🔧 子agent不需要timeline展示，只在activeAgentStore中记录状态
  });

  messageBus.on('agent:subagent-end', (data: {
    subAgentId: string;
    success: boolean;
    duration?: number;
  }) => {
    console.log('[chatStore] ===== agent:subagent-end 事件接收 =====');
    console.log('[chatStore] subAgentId:', data.subAgentId);
    console.log('[chatStore] success:', data.success);
    console.log('[chatStore] duration:', data.duration);

    const activeAgentStore = useActiveAgentStore.getState();

    // 更新子 Agent 状态
    activeAgentStore.updateSubAgent(data.subAgentId, {
      status: data.success ? 'success' : 'error',
      endTime: Date.now(),
      duration: data.duration,
    });

    // 完成 timeline 事件
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.finishTimelineEvent(
      data.subAgentId,
      `${data.subAgentId}-start`,
      data.duration || 0,
      data.success ? 'success' : 'error'
    );
  });

  // ─── 可视化监控新事件监听 ──────────────────────────────────
  messageBus.on('agent:thinking-start', (data: { agentId: string; content: string }) => {
    // 🔧 思考状态只展示在思考气泡中，不需要 currentMoment
    // 更新 activeAgentStore 的 currentThought（支持 sub-agent）
    const activeAgentStore = useActiveAgentStore.getState();
    if (data.agentId && data.content) {
      activeAgentStore.setAgentThought(data.agentId, data.content);
    }
  });

  messageBus.on('agent:skill-start', (data: { agentId: string; skillName: string; input?: any }) => {
    const id = `skill-${Date.now()}`;
    const store = useRuntimeStore.getState();

    // 🔧 Skill 执行统一使用 timelineEvents 展示，不再使用 currentMoment
    store.addTimelineEvent(data.agentId, {
      id,
      icon: '✨',
      label: data.skillName.slice(0, 12),
      status: 'running',
      startTime: Date.now(),
    });
    store.addRecentEvent({
      agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
      description: `执行 Skill: ${data.skillName}`,
      icon: '✨',
    });
  });

  messageBus.on('agent:skill-end', (data: { agentId: string; skillName: string; duration?: number; success?: boolean }) => {
    // 🔧 Skill 完成时，只需要更新 timelineEvent，不需要 finishAgentMoment
    // 因为 skill 不再使用 currentMoment 展示
  });

  messageBus.on('agent:memory-read', (data: { agentId: string; hitCount?: number; layersSearched?: number }) => {
    const store = useRuntimeStore.getState();
    const eventId = `memory-read-${Date.now()}`;

    // 🔧 记忆读取统一使用 timelineEvents 展示
    store.addTimelineEvent(data.agentId, {
      id: eventId,
      icon: '📖',
      label: `回忆${data.hitCount ?? 0}条`,
      status: 'running',
      startTime: Date.now(),
    });

    store.addRecentEvent({
      agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
      description: `记忆检索: ${data.hitCount ?? 0} 条命中`,
      icon: '📖',
    });

    // 记忆读取是瞬时的，300ms 后标记为完成
    setTimeout(() => {
      store.finishTimelineEvent(data.agentId, eventId, 300, 'success');
    }, 300);
  });

  messageBus.on('agent:memory-write', (data: { agentId: string; scope?: string; summary?: string }) => {
    const store = useRuntimeStore.getState();
    const eventId = `memory-write-${Date.now()}`;

    // 🔧 记忆写入统一使用 timelineEvents 展示
    store.addTimelineEvent(data.agentId, {
      id: eventId,
      icon: '💾',
      label: (data.summary || '写入记忆').slice(0, 12),
      status: 'running',
      startTime: Date.now(),
    });

    store.addRecentEvent({
      agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
      description: `记忆写入: ${data.summary || data.scope || ''}`,
      icon: '💾',
    });

    // 记忆写入是瞬时的，500ms 后标记为完成
    setTimeout(() => {
      store.finishTimelineEvent(data.agentId, eventId, 500, 'success');
    }, 500);
  });

  messageBus.on('agent:compress-start', (data: { agentId: string; originalTokens?: number }) => {
    const store = useRuntimeStore.getState();

    // 🔧 压缩上下文使用 currentMoment 展示（后台操作，不需要在timeline中）
    store.setAgentMoment(data.agentId, {
      type: 'thinking',
      icon: '🗜️',
      label: '压缩上下文中...',
      durationMs: 0,
      status: 'running',
    });

    store.addRecentEvent({
      agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
      description: `开始压缩上下文 (${data.originalTokens ?? 0} tokens)`,
      icon: '🗜️',
    });
  });

  messageBus.on('agent:compress-end', (data: { agentId: string; originalTokens?: number; compressedTokens?: number; compressionRatio?: number; duration?: number }) => {
    const store = useRuntimeStore.getState();
    const ratio = data.compressionRatio ? Math.round(data.compressionRatio * 100) : 0;
    store.finishAgentMoment(data.agentId, 'success');
    store.addRecentEvent({
      agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
      description: `上下文已压缩: ${data.originalTokens ?? 0} → ${data.compressedTokens ?? 0} tokens (${ratio}%)`,
      icon: '✅',
    });

    // 在聊天框中添加系统提示消息
    if (data.agentId === 'main') {
      useChatStore.getState().addMessage({
        id: generateMessageId('compress'),
        role: 'system',
        content: `🗜️ 上下文已自动压缩：${data.originalTokens ?? 0} → ${data.compressedTokens ?? 0} tokens (减少 ${ratio}%)\n\n为了保持对话流畅，历史消息已被智能压缩。您的完整对话历史仍然保留在界面中。`,
        timestamp: Date.now(),
      });
    }
  });

  // 权限交互事件监听
  messageBus.on('permission:request', (data) => {
    useChatStore.getState().setPermissionRequest(data);
  });

  messageBus.on('plan:review-request', (data) => {
    useChatStore.getState().setPlanReviewRequest(data);
  });

  messageBus.on('ask-user:request', (data) => {
    useChatStore.getState().setAskUserRequest(data);
  });

  // Plan Mode 事件监听
  messageBus.on('plan:mode-enter', () => {
    useChatStore.getState().setPlanMode(true);
  });

  messageBus.on('plan:mode-exit', () => {
    useChatStore.getState().setPlanMode(false);
  });

  // 监听 prompt 构建事件，更新 runtimeStore 和 WorkspaceMonitor
  console.log('[chatStore] 正在注册 prompt:build-event 监听器');

  // 每个 moment 至少展示 500ms 的队列机制
  const momentQueue: Array<{ agentId: string; moment: Parameters<ReturnType<typeof useRuntimeStore>['setAgentMoment']>[1] }> = [];
  let momentQueueRunning = false;
  const MOMENT_MIN_DISPLAY_MS = 500;

  function enqueueMoment(agentId: string, moment: Parameters<ReturnType<typeof useRuntimeStore>['setAgentMoment']>[1]) {
    momentQueue.push({ agentId, moment });
    if (!momentQueueRunning) {
      drainMomentQueue();
    }
  }

  function drainMomentQueue() {
    if (momentQueue.length === 0) {
      momentQueueRunning = false;
      return;
    }
    momentQueueRunning = true;
    const { agentId, moment } = momentQueue.shift()!;
    useRuntimeStore.getState().setAgentMoment(agentId, moment);
    setTimeout(drainMomentQueue, MOMENT_MIN_DISPLAY_MS);
  }

  messageBus.on('prompt:build-event', (event: { type: string; timestamp: number; agentId: string; data?: any }) => {
    console.log('[chatStore] 收到 prompt:build-event:', event);
    const runtimeStore = useRuntimeStore.getState();
    // 主 agent (xuanji) 在 WorkspaceMonitor 中的 id 是 'main'
    const agentId = (event.agentId === 'xuanji' || !event.agentId) ? 'main' : event.agentId;
    console.log('[chatStore] 映射后的 agentId:', agentId);

    switch (event.type) {
      case 'build:start':
        runtimeStore.startPromptBuild();
        // 不展示"开始构建"状态
        break;
      case 'intent:match':
        // 处理意图匹配过程事件（关键词/Embedding 策略尝试）
        console.log('[chatStore] intent:match - event.data:', event.data);
        const matchData = event.data;
        if (matchData.type === 'match:trying') {
          const methodLabel = matchData.method === 'keyword' ? '关键词' :
                              matchData.method === 'embedding' ? 'Embedding' : matchData.method;
          console.log('[chatStore] intent:match - match:trying, 设置 moment label:', methodLabel);
          enqueueMoment(agentId, {
            type: 'thinking',
            icon: '🔍',
            label: methodLabel,
            durationMs: 0,
            status: 'running',
          });
        } else if (matchData.type === 'match:success') {
          const methodLabel = matchData.method === 'keyword' ? '关键词' :
                              matchData.method === 'embedding' ? 'Embedding' : matchData.method;
          console.log('[chatStore] intent:match - match:success, 设置 moment label:', methodLabel);
          enqueueMoment(agentId, {
            type: 'thinking',
            icon: '✅',
            label: methodLabel,
            durationMs: 0,
            status: 'success',
          });
        } else if (matchData.type === 'match:failed') {
          const methodLabel = matchData.method === 'keyword' ? '关键词' :
                              matchData.method === 'embedding' ? 'Embedding' : matchData.method;
          console.log('[chatStore] intent:match - match:failed, 设置 moment label:', methodLabel);
          enqueueMoment(agentId, {
            type: 'thinking',
            icon: '❌',
            label: methodLabel,
            durationMs: 0,
            status: 'error',
          });
        }
        break;
      case 'intent:analyzing':
        // 显示正在分析意图
        enqueueMoment(agentId, {
          type: 'thinking',
          icon: '🔍',
          label: '分析意图',
          durationMs: 0,
          status: 'running',
        });
        break;
      case 'intent:analyzed':
        console.log('[chatStore] intent:analyzed - event.data:', event.data);
        runtimeStore.setPromptIntent({
          scene: event.data?.scene || 'coding',
          complexity: event.data?.complexity || 'standard',
          confidence: event.data?.confidence || 1,
        });
        // 显示场景
        const sceneLabel = event.data?.scene || 'coding';
        console.log('[chatStore] intent:analyzed - 设置 moment label:', sceneLabel);
        enqueueMoment(agentId, {
          type: 'thinking',
          icon: '🎯',
          label: sceneLabel,
          durationMs: 0,
          status: 'running',
        });
        break;
      case 'components:selected':
        console.log('[chatStore] components:selected - event.data:', event.data);
        if (event.data?.components) {
          for (const c of event.data.components) {
            runtimeStore.addPromptComponent({
              id: c.id,
              name: c.name,
              layer: parseInt((c.layer || 'L0').replace('L', ''), 10),
              source: c.source || 'builtin',
            });
          }

          // 显示组件名称，用换行符分隔，最多显示前 3 个
          const componentNames = event.data.components.map((c: any) => c.name).slice(0, 3);
          const displayText = componentNames.join('\n') +
            (event.data.components.length > 3 ? '\n...' : '');
          console.log('[chatStore] components:selected - 设置 moment label:', displayText);

          enqueueMoment(agentId, {
            type: 'thinking',
            icon: '🧩',
            label: displayText,
            durationMs: 0,
            status: 'running',
          });
        }
        break;
      case 'build:complete':
        runtimeStore.finishPromptBuild(event.data?.layers
          ? { layers: event.data.layers, totalTokens: event.data.estimatedTokens }
          : undefined,
        );
        // 🔧 清理 prompt 构建过程中的 currentMoment（如意图匹配、规则加载等）
        runtimeStore.finishAgentMoment(agentId);
        // 不展示"构建完成"状态
        break;
    }
  });

  // 监听 ModelClassifier 事件（IntentClassifier 内部触发）
  messageBus.on('workspace:model-classifier-start', (data: any) => {
    console.log('[chatStore] ModelClassifier 开始:', data);
    const activeAgentStore = useActiveAgentStore.getState();
    console.log('[chatStore] activeAgentStore.mainAgent:', activeAgentStore.mainAgent);

    if (activeAgentStore.mainAgent) {
      const classifierAgent: import('./activeAgentStore').AgentState = {
        id: 'intent-classifier',
        name: '意图分析',
        status: 'executing',
        currentThought: `正在使用 ${data.model} 分析意图...`,
        currentTools: [],
        subAgents: [],
        agentType: 'builtin',
        stats: {
          tokenUsage: { input: 0, output: 0, cached: 0 },
          cost: 0,
          toolCount: 0,
        },
      };
      console.log('[chatStore] 准备添加 intent-classifier 子 Agent');
      activeAgentStore.addSubAgent(activeAgentStore.mainAgent.id, classifierAgent);
      console.log('[chatStore] 添加完成，当前 subAgents:', activeAgentStore.mainAgent.subAgents);
    }
  });

  messageBus.on('workspace:model-classifier-end', (data: any) => {
    console.log('[chatStore] ModelClassifier 结束:', data);

    // 延迟 0.5s 后移除 intent-classifier 子 Agent
    setTimeout(() => {
      console.log('[chatStore] 延迟后准备移除 intent-classifier');
      const activeAgentStore = useActiveAgentStore.getState();
      console.log('[chatStore] activeAgentStore.mainAgent:', activeAgentStore.mainAgent);
      if (activeAgentStore.mainAgent) {
        console.log('[chatStore] 当前 subAgents:', activeAgentStore.mainAgent.subAgents);
        activeAgentStore.removeSubAgent(activeAgentStore.mainAgent.id, 'intent-classifier');
        console.log('[chatStore] 移除完成，剩余 subAgents:', activeAgentStore.mainAgent.subAgents);
      }
    }, 500);
  });

  // 监听项目信息事件
  messageBus.on('project:info', (data: { type: string; hasGit: boolean; rootPath: string; configFiles: string[]; gitBranch?: string }) => {
    console.log('[chatStore] 收到 project:info:', data);
    const runtimeStore = useRuntimeStore.getState();

    // 提取项目名称（从路径最后一段）
    const projectName = data.rootPath.split('/').pop() || data.rootPath;

    runtimeStore.setContextInfo({
      workingDirectory: data.rootPath,
      projectInfo: {
        name: projectName,
        type: data.type,
        hasGit: data.hasGit,
        rootPath: data.rootPath,
        gitBranch: data.gitBranch,
      },
    });

    console.log('[chatStore] 项目信息已更新:', projectName, data.type, data.gitBranch ? `(${data.gitBranch})` : '');
  });
};
