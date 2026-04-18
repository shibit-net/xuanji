// ============================================================
// M1 终端 UI — App 根组件
// ============================================================

import React, { useState, useCallback, useRef, useEffect, useMemo, useReducer } from 'react';
import { Box, Text, useInput, useApp, useStdin, Static } from 'ink';
import type { AgentState, TokenUsage, UITheme, UILanguage } from '@/core/types';
import type { AgentCallbacks } from '@/core/agent/AgentLoop';
import { t, setLanguage, getLanguage } from '@/core/i18n';
import { createDebouncedUpdate, createThrottledUpdate } from './utils/Debounce';
import { parseCSIu } from './utils/KittyKeyboard';
import { renderMarkdownSimple } from './MarkdownRenderer';
import { parseSlashCommand } from './SlashCommands';
import { SlashCommandRegistry } from './SlashCommandRegistry';
import { RegistryClient, MCPInstaller, SkillInstaller } from '@/tiangong';
import { handleSearch, handleInstall, handleList, handleUninstall } from '@/tiangong/commands';
import { AuthManager } from '@/auth';
import { GLOBAL_CONFIG_DIR } from '@/core/config/GlobalConfig';
import { getTodoManager } from '@/core/tools/TodoTool';
import { LoginPrompt } from './auth/LoginPrompt';
import { WhoamiDisplay } from './auth/WhoamiDisplay';
import { AccountPanel } from './auth/AccountPanel';
import { InputHandler } from './InputHandler';
import { Spinner } from './Spinner';
import { pauseGlobalSpinner, resumeGlobalSpinner } from './components/SpinnerManager';
import { CollapsibleToolResult, formatToolCommand, formatToolName } from './CollapsibleToolResult';
import { ParallelToolGroupCompact, ParallelToolGroup } from './ParallelToolGroup';
import { TodoPanel, parseTodoProgress } from './TodoPanel';
import type { TodoProgressData } from './TodoPanel';
import { StatusBar } from './StatusBar';
import { SubAgentProgress } from './SubAgentProgress';
import { SettingsMode } from './settings/SettingsMode';
import { LogsMode } from './LogsMode';
import { BotsMode } from './BotsMode';
import { QuickActions } from './QuickActions';
import type { QuickAction } from './QuickActions';
import { SessionPanel } from './SessionPanel';
import { ConfigManager } from './utils/ConfigManager';
import { LogSystem } from './utils/LogSystem';
import { BotManager } from './utils/BotManager';
import { getTheme } from './Theme';
import { ProjectConfigWriter } from '@/core/config';
import type { ChatMessage, AppMode, PendingUserInput, ParallelToolGroupItem } from './types';
import type { PermissionRequest, GuardCheckResult, UserConfirmation, ConfirmationHandler, PlanReviewResult, PlanReviewHandler } from '@/permission/types';
import { PermissionPrompt } from '@/permission/ui/PermissionPrompt';
import { PlanReview } from '@/permission/ui/PlanReview';
import { PlanConfirm } from './PlanConfirm';
import { AskUserPrompt } from './AskUserPrompt';
import { UsageStatsRecorder } from '@/core/telemetry';
import { DailyUsageStats } from '@/core/telemetry/DailyUsageStats';
import { PricingResolver } from '@/core/agent/PricingResolver';
import { formatUsageStats } from './utils/FormatStats';
import {
  formatDailyStats,
  formatCostTrend,
  formatTopTools,
  formatModelSummary,
} from './StatsFormatter';

// ============================================================
// App 组件属性
// ============================================================

export interface AppProps {
  agentLoop: {
    run: (input: string) => Promise<void>;
    stop: () => void;
    interrupt: (appendMessage: string) => void;
    appendMessage: (message: string) => void;
    reset: () => void;
    getState: () => AgentState;
    on: (callbacks: AgentCallbacks) => void;
    compact: (customInstruction?: string) => Promise<{ originalTokens: number; compressedTokens: number; compressionRatio: number } | null>;
  };
  model: string;
  /** ChatSession 实例（用于访问 MemoryManager 等） */
  session?: import('@/core/chat/ChatSession').ChatSession;
  /** 权限确认处理器注册回调 (由 ChatSession 提供) */
  onPermissionSetup?: (handler: ConfirmationHandler) => void;
  /** 计划审查处理器注册回调 (由 ChatSession 提供) */
  onPlanReviewSetup?: (handler: PlanReviewHandler) => void;
  /** 执行计划确认处理器注册回调 (由 ChatSession 提供) */
  onPlanConfirmSetup?: (handler: (plan: import('@/core/routing/types').ExecutionPlan) => Promise<boolean>) => void;
  /** 模型切换回调 (返回新模型名) */
  onModelChange?: (model: string) => Promise<string>;
  /** 记忆查询回调 (返回格式化的记忆条目) */
  onMemoryQuery?: (query?: string) => Promise<string>;
  /** Agent 查询回调 (返回格式化的 Agent 信息) */
  onAgentQuery?: (args: string) => Promise<string>;
  /** Template 查询回调 (返回格式化的模板信息) */
  onTemplateQuery?: (args: string) => Promise<string>;
  /** AskUser 处理器注册回调 (由 ChatSession 提供) */
  onAskUserSetup?: (handler: (request: { question: string; options?: string[]; multiSelect?: boolean; default?: string }) => Promise<string>) => void;
  // ─── 会话持久化回调 ─────────────────────────────────────
  /** 保存当前会话 */
  onSessionSave?: (name?: string, historyMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }>) => Promise<string>;
  /** 恢复会话 */
  onSessionResume?: (sessionId: string) => Promise<{ sessionId: string; messageCount: number; usage: { input: number; output: number; cost: number }; historyMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }> }>;
  /** 列出会话 */
  onSessionList?: () => Promise<Array<{ id: string; name: string; updatedAt: number; messageCount: number; preview?: string }>>;
  /** 删除会话 */
  onSessionDelete?: (sessionId: string) => Promise<void>;
  /** 创建 checkpoint */
  onCheckpointCreate?: (label?: string) => Promise<string>;
  /** 回滚到 checkpoint */
  onCheckpointRewind?: (checkpointId: string) => Promise<number>;
  /** 列出 checkpoints */
  onCheckpointList?: () => Promise<Array<{ id: string; label: string; createdAt: number; messageCount: number }>>;
  /** Plan Mode 控制（由 ChatSession 提供） */
  onPlanModeEnter?: () => void;
  onPlanModeExit?: () => void;
  isPlanMode?: () => boolean;
  /** SubAgent 事件绑定回调 (由 index.ts 触发) */
  onSubAgentSetup?: (callbacks: SubAgentUICallbacks) => void;
  /** 系统诊断查询回调 (由 ChatSession 提供) */
  onDoctorQuery?: () => Promise<string>;
  // ─── 连续会话回调 ─────────────────────────────────────
  /** 恢复会话通知 */
  onResumeNotification?: (summary: string, memoryCount: number) => void;
  /** 归档完成通知 */
  onArchiveNotification?: (result: { archivedCount: number; memoriesExtracted: number; summary?: string }) => void;
}

/** SubAgent 进度回调（App.tsx 提供给 index.ts 注册到 HookRegistry） */
export interface SubAgentUICallbacks {
  onStart: (info: { subAgentId: string; task: string; depth: number; role: string }) => void;
  onToolUse: (info: { subAgentId: string; toolName: string }) => void;
  onEnd: (info: { subAgentId: string; result?: string }) => void;
}

// ============================================================
// Write 工具 input 截断 (避免大文件内容存储在 state 中)
// ============================================================
// 只截断 UI 展示用的 input，不影响工具实际执行

const WRITE_CONTENT_PREVIEW_LIMIT = 500;

// ============================================================
// 工具结果截断限制
// ============================================================
// 工具执行结果存入 ChatMessage.content (UI State) 的最大字符数。
// 过大的 content 会导致 Ink 的 <Static> 渲染时 process.stdout.write
// 写入过多内容，触发 backpressure 甚至终端异常，进而终止进程。
// 注意：此截断仅影响 UI 展示，不影响发给 LLM 的 tool_result。

const TOOL_RESULT_CONTENT_LIMIT = 100_000;

// ============================================================
// 流式文本缓冲模式阈值
// ============================================================
// 当流式文本行数超过此阈值时，停止实时渲染 Markdown，
// 改为显示 Spinner + 行数进度，完成后一次性放入 Static。
// 终端视口通常 30-50 行，超出后实时渲染无意义且引起闪烁。

// 降低到 30 行：更早进入缓冲模式，减少 scrollback buffer 堆积
const STREAM_BUFFER_THRESHOLD = 30;

// ============================================================
// 🆕 追加队列配置
// ============================================================
// 流式文本更新节流间隔（降低到 50ms，更流畅）

const STREAM_TEXT_THROTTLE_MS = 50;

function truncateToolInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === 'write_file' && typeof input.content === 'string') {
    const content = input.content;
    if (content.length > WRITE_CONTENT_PREVIEW_LIMIT) {
      return {
        ...input,
        content: content.slice(0, WRITE_CONTENT_PREVIEW_LIMIT)
          + `\n... (共 ${content.length} 字符，已省略 ${content.length - WRITE_CONTENT_PREVIEW_LIMIT} 字符)`,
      };
    }
  }
  return input;
}

/**
 * 截断过长的工具结果内容（仅影响 UI 展示，不影响 LLM 消息）
 */
function truncateToolResult(result: string): string {
  if (result.length <= TOOL_RESULT_CONTENT_LIMIT) return result;
  const lineCount = result.split('\n').length;
  return result.slice(0, TOOL_RESULT_CONTENT_LIMIT)
    + `\n... (共 ${lineCount} 行 / ${result.length} 字符，UI 展示已截断)`;
}

// ============================================================
// SubAgent 状态跟踪（用于进度显示）
// ============================================================

export interface SubAgentState {
  subAgentId: string;
  task: string;           // 任务描述（传给 /task 的 prompt）
  depth: number;          // 嵌套深度（1, 2, 3）
  role: string;           // 角色类型（explore/plan/coder/general-purpose）
  startTime: number;      // 开始时间戳
  toolCount: number;      // 已执行工具数
  lastToolName?: string;  // 当前/最后一个工具名
  recentTools: string[];  // 最近 5 个工具（用于显示历史）
}

// ============================================================
// 工具状态 Reducer (批量状态更新优化)
// ============================================================
// 将 status、activeTools 合并到单个 reducer，
// 确保 onToolStart/onToolEnd 等回调中的多个状态变化只触发一次渲染

interface ToolStateShape {
  status: 'idle' | 'thinking' | 'tool';
  activeTools: Map<string, { name: string; input: Record<string, unknown>; receivedBytes?: number; parallel?: boolean }>;
  /** 当前并行组的工具 ID 集合（用于 UI 分组展示） */
  parallelIds: Set<string>;
  /** 活跃的 SubAgent 状态 Map */
  activeSubAgents: Map<string, SubAgentState>;
  /** 🆕 当前批次的并行工具组（用于合并展示） */
  currentParallelGroup: Map<string, ParallelToolGroupItem>;
}

type ToolAction =
  | { type: 'SET_THINKING' }
  | { type: 'TOOL_START'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'TOOL_DELTA'; id: string; receivedBytes: number }
  | { type: 'TOOL_REMOVE'; id: string }
  | { type: 'TOOL_GROUPED'; parallelIds: string[] }
  | { type: 'TOOL_GROUP_ADD'; id: string; item: ParallelToolGroupItem }
  | { type: 'TOOL_GROUP_CLEAR' }
  | { type: 'RESET_IDLE' }
  | { type: 'CLEAR_ALL' }
  | { type: 'START_TURN' }
  | { type: 'SUBAGENT_START'; payload: { subAgentId: string; task: string; depth: number; role: string } }
  | { type: 'SUBAGENT_TOOL_USE'; payload: { subAgentId: string; toolName: string } }
  | { type: 'SUBAGENT_END'; payload: { subAgentId: string; result?: string } };

const INITIAL_TOOL_STATE: ToolStateShape = {
  status: 'idle',
  activeTools: new Map(),
  parallelIds: new Set(),
  activeSubAgents: new Map(),
  currentParallelGroup: new Map(),
};

function toolReducer(state: ToolStateShape, action: ToolAction): ToolStateShape {
  switch (action.type) {
    case 'SET_THINKING':
      return { ...state, status: 'thinking' };

    case 'TOOL_START': {
      const next = new Map(state.activeTools);
      const isParallel = state.parallelIds.has(action.id);
      next.set(action.id, { name: action.name, input: action.input, parallel: isParallel });
      return { ...state, status: 'tool', activeTools: next };
    }

    case 'TOOL_DELTA': {
      const existing = state.activeTools.get(action.id);
      if (!existing) return state;
      const next = new Map(state.activeTools);
      next.set(action.id, { ...existing, receivedBytes: action.receivedBytes });
      return { ...state, activeTools: next };
    }

    case 'TOOL_REMOVE': {
      const next = new Map(state.activeTools);
      next.delete(action.id);
      return { ...state, activeTools: next };
    }

    case 'TOOL_GROUPED': {
      const ids = new Set(action.parallelIds);
      // 同时更新已有 activeTools 中的 parallel 标记
      const next = new Map(state.activeTools);
      for (const [id, tool] of next) {
        if (ids.has(id)) {
          next.set(id, { ...tool, parallel: true });
        }
      }
      return { ...state, parallelIds: ids, activeTools: next };
    }

    case 'TOOL_GROUP_ADD': {
      const next = new Map(state.currentParallelGroup);
      next.set(action.id, action.item);
      return { ...state, currentParallelGroup: next };
    }

    case 'TOOL_GROUP_CLEAR': {
      return { ...state, currentParallelGroup: new Map() };
    }

    case 'RESET_IDLE':
      return { ...state, status: 'idle', activeTools: new Map(), parallelIds: new Set(), currentParallelGroup: new Map() };

    case 'CLEAR_ALL':
      return { status: 'idle', activeTools: new Map(), parallelIds: new Set(), activeSubAgents: new Map(), currentParallelGroup: new Map() };

    case 'START_TURN':
      return { ...state, status: 'thinking', parallelIds: new Set(), currentParallelGroup: new Map() };

    case 'SUBAGENT_START': {
      const newMap = new Map(state.activeSubAgents);
      newMap.set(action.payload.subAgentId, {
        subAgentId: action.payload.subAgentId,
        task: action.payload.task,
        depth: action.payload.depth,
        role: action.payload.role,
        startTime: Date.now(),
        toolCount: 0,
        recentTools: [],
      });
      return { ...state, activeSubAgents: newMap };
    }

    case 'SUBAGENT_TOOL_USE': {
      const newMap = new Map(state.activeSubAgents);
      const existing = newMap.get(action.payload.subAgentId);
      if (existing) {
        const newRecent = [action.payload.toolName, ...existing.recentTools].slice(0, 5);
        newMap.set(action.payload.subAgentId, {
          ...existing,
          toolCount: existing.toolCount + 1,
          lastToolName: action.payload.toolName,
          recentTools: newRecent,
        });
      }
      return { ...state, activeSubAgents: newMap };
    }

    case 'SUBAGENT_END': {
      // 完成后直接从 activeSubAgents 中移除（不再在动态区域保留 2 秒）
      // 避免动态区域频繁重渲染导致 Ink 终端输出堆积
      const newMap = new Map(state.activeSubAgents);
      newMap.delete(action.payload.subAgentId);
      return { ...state, activeSubAgents: newMap };
    }
  }
}

// ============================================================
// App 主组件
// ============================================================

export function App({ agentLoop, model, onPermissionSetup, onPlanReviewSetup, onPlanConfirmSetup, onModelChange, onMemoryQuery, onAgentQuery, onTemplateQuery, onAskUserSetup, onSessionSave, onSessionResume, onSessionList, onSessionDelete, onCheckpointCreate, onCheckpointRewind, onCheckpointList, onPlanModeEnter, onPlanModeExit, isPlanMode, onSubAgentSetup, onDoctorQuery }: AppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<AppMode>('chat');
  // 使用 useReducer 合并 status/activeTools，避免多次 setState 导致多次渲染
  const [toolState, dispatchTool] = useReducer(toolReducer, INITIAL_TOOL_STATE);
  const { status, activeTools, activeSubAgents } = toolState;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamText, setStreamText] = useState('');
  const [usage, setUsage] = useState<TokenUsage>({ input: 0, output: 0 });
  const [cost, setCost] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<UITheme>('auto');
  // 工具导航状态
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedToolIndex, setSelectedToolIndex] = useState(-1);
  const [expandedToolIds, setExpandedToolIds] = useState<Set<number>>(new Set());
  // 本轮结束后的统计信息（非 Static 区域展示）
  const [turnStats, setTurnStats] = useState<string>('');
  // 权限确认状态
  const [pendingPermission, setPendingPermission] = useState<{
    request: PermissionRequest;
    guardResult: GuardCheckResult;
    resolve: (confirmation: UserConfirmation) => void;
  } | null>(null);
  // 计划审查状态
  const [pendingPlanReview, setPendingPlanReview] = useState<{
    plan: string;
    resolve: (result: PlanReviewResult) => void;
  } | null>(null);
  // 执行计划确认状态
  const [pendingPlanConfirm, setPendingPlanConfirm] = useState<{
    plan: import('@/core/routing/types').ExecutionPlan;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  // AskUser 状态（Agent 向用户提问）
  const [pendingUserQuestion, setPendingUserQuestion] = useState<{
    question: string;
    options?: string[];
    multiSelect?: boolean;
    resolve: (answer: string) => void;
  } | null>(null);

  // 稳定回调引用：避免交互对话框在 App 其他 state 变化时被 React.memo 跳过后又因 callback 引用变化而重渲染
  const pendingPermissionRef = useRef(pendingPermission);
  pendingPermissionRef.current = pendingPermission;
  const pendingPlanReviewRef = useRef(pendingPlanReview);
  pendingPlanReviewRef.current = pendingPlanReview;
  const pendingPlanConfirmRef = useRef(pendingPlanConfirm);
  pendingPlanConfirmRef.current = pendingPlanConfirm;
  const pendingUserQuestionRef = useRef(pendingUserQuestion);
  pendingUserQuestionRef.current = pendingUserQuestion;

  const handlePermissionConfirm = useCallback((confirmation: UserConfirmation) => {
    const resolve = pendingPermissionRef.current?.resolve;
    if (resolve && (resolve as any).__timeoutId) {
      clearTimeout((resolve as any).__timeoutId);
    }
    pendingPermissionRef.current?.resolve(confirmation);
    setPendingPermission(null);
  }, []);
  const handlePlanDecision = useCallback((result: PlanReviewResult) => {
    const resolve = pendingPlanReviewRef.current?.resolve;
    if (resolve && (resolve as any).__timeoutId) {
      clearTimeout((resolve as any).__timeoutId);
    }
    pendingPlanReviewRef.current?.resolve(result);
    setPendingPlanReview(null);
  }, []);
  const handlePlanConfirm = useCallback((confirmed: boolean) => {
    const resolve = pendingPlanConfirmRef.current?.resolve;
    if (resolve && (resolve as any).__timeoutId) {
      clearTimeout((resolve as any).__timeoutId);
    }
    pendingPlanConfirmRef.current?.resolve(confirmed);
    setPendingPlanConfirm(null);
  }, []);
  const handleUserAnswer = useCallback((answer: string) => {
    const resolve = pendingUserQuestionRef.current?.resolve;
    if (resolve && (resolve as any).__timeoutId) {
      clearTimeout((resolve as any).__timeoutId);
    }
    pendingUserQuestionRef.current?.resolve(answer);
    setPendingUserQuestion(null);
  }, []);

  // Plan Mode 状态跟踪（用于 StatusBar 持久显示）
  const [planModeActive, setPlanModeActive] = useState(false);
  const msgIdRef = useRef(0);
  const toolInfoRef = useRef<Map<string, {
    startTime: number;
    input: Record<string, unknown>;
  }>>(new Map());

  // 使用 ref 追踪最新的流式文本，避免闭包问题
  const streamTextRef = useRef('');
  // ★ 流式归档：追踪当前回合的 assistant 消息 ID（用于追加内容） ★
  const currentAssistantMsgIdRef = useRef<number | null>(null);
  // ★ 忽略 onText 标志：补充输入时暂停追加，等待新流开始 ★
  const ignoreStreamTextRef = useRef(false);
  // 缓冲模式：流式输出过长时停止实时渲染，只显示行数进度
  const streamBufferedRef = useRef(false);
  const [streamProgress, setStreamProgress] = useState(0);
  // 保存上一轮的统计信息，延迟到下一轮 handleSubmit 时搬到 Static
  const lastTurnStatsRef = useRef<{
    tokenUsage: TokenUsage;
    totalDuration: number;
  } | null>(null);
  // 保存 debounce updater 引用，用于 Ctrl+C 时清理
  const streamTextUpdaterRef = useRef<ReturnType<typeof createThrottledUpdate<string>> | null>(null);
  // 追踪当前 usage，避免闭包问题
  const usageRef = useRef<TokenUsage>({ input: 0, output: 0 });
  // 追踪对话轮次的开始时间
  const turnStartTimeRef = useRef<number>(0);

  // 工具结果批量缓冲：收集同一 tick 内的多个 onToolEnd，合并为一次 setMessages
  // 避免大量 Write 工具连续完成时频繁触发 Static 渲染 → stdout.write 累积 → 进程异常
  const pendingToolMsgsRef = useRef<ChatMessage[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TODO 进度：动态区域唯一渲染，避免 Static 中每次工具调用都重复渲染 TodoPanel
  const [todoProgress, setTodoProgress] = useState<TodoProgressData | null>(null);
  const todoProgressRef = useRef<TodoProgressData | null>(null);
  // TODO 批量更新定时器：合并短时间内的多次 todo_create/todo_update，减少 UI 刷新
  const todoBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // TODO 工具结果批量缓冲：暂存 TODO 工具的结果消息，延迟显示以实现合并展示
  const pendingTodoMsgsRef = useRef<ChatMessage[]>([]);

  /**
   * 合并多个 TODO 工具消息为单条摘要
   */
  const mergeTodoMessages = useCallback((todoMsgs: ChatMessage[]): ChatMessage | null => {
    if (todoMsgs.length === 0) return null;

    // 按操作类型分组
    const createMsgs = todoMsgs.filter(m => m.toolName === 'todo_create');
    const updateMsgs = todoMsgs.filter(m => m.toolName === 'todo_update');
    const listMsgs = todoMsgs.filter(m => m.toolName === 'todo_list');

    // 构建摘要
    const summaryParts: string[] = [];

    if (createMsgs.length > 0) {
      const taskNames = createMsgs.map(m => {
        const match = m.content.match(/已创建:\s*([^(]+)/);
        return match ? match[1].trim() : '';
      }).filter(Boolean);

      if (createMsgs.length === 1) {
        summaryParts.push(`✅ 已创建: ${taskNames[0]}`);
      } else {
        summaryParts.push(`✅ 已创建 ${createMsgs.length} 个任务: ${taskNames.join('、')}`);
      }
    }

    if (updateMsgs.length > 0) {
      const taskNames = updateMsgs.map(m => {
        const match = m.content.match(/(?:已完成|开始执行|已更新):\s*([^(]+)/);
        return match ? match[1].trim() : '';
      }).filter(Boolean);

      if (updateMsgs.length === 1) {
        summaryParts.push(updateMsgs[0].content.split('\n')[0]);
      } else {
        summaryParts.push(`📝 已更新 ${updateMsgs.length} 个任务: ${taskNames.join('、')}`);
      }
    }

    if (listMsgs.length > 0) {
      summaryParts.push(listMsgs[0].content);
    }

    return {
      id: ++msgIdRef.current,
      role: 'tool',
      content: summaryParts.join('\n'),
      toolName: 'todo_batch',
      toolInput: {},
      toolIsError: false,
      toolDuration: 0,
      toolParallel: false,
      timestamp: Date.now(),
    };
  }, []);

  // 共享工具实例
  const configManager = useMemo(() => new ConfigManager(), []);
  const logSystem = useMemo(() => new LogSystem(), []);
  const botManager = useMemo(() => new BotManager(logSystem), [logSystem]);
  const authManager = useMemo(() => new AuthManager(GLOBAL_CONFIG_DIR), []);
  // 登录状态
  const [authUsername, setAuthUsername] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false); // 登录完成前阻塞主界面
  // 登录/用户信息 UI 状态
  const [pendingLogin, setPendingLogin] = useState<{
    initialEmail?: string;
    resolve: (result: { success: boolean }) => void;
  } | null>(null);
  const [showWhoami, setShowWhoami] = useState(false);
  // 交互面板状态
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(false);

  // 获取当前主题颜色
  const theme = useMemo(() => getTheme(currentTheme), [currentTheme]);

  // 保护 stdout.write: 注册 error handler 防止 EPIPE 等写入错误终止进程
  useEffect(() => {
    const handleStdoutError = (err: NodeJS.ErrnoException) => {
      // 忽略 EPIPE（pipe 断开）、ENXIO 等终端写入错误
      if (err.code === 'EPIPE' || err.code === 'ENXIO' || err.code === 'ERR_STREAM_DESTROYED') return;
    };
    process.stdout.on('error', handleStdoutError);
    return () => { process.stdout.removeListener('error', handleStdoutError); };
  }, []);

  // 初始化 ConfigManager
  useEffect(() => {
    const init = async () => {
      try {
        const config = await configManager.load();
        setCurrentTheme(config.ui.theme);

        // 初始化语言：优先使用保存的语言，否则使用英文作为默认
        const language = config.ui.language || 'en';
        setLanguage(language);

        // 如果配置中没有语言设置，则保存英文为默认值
        if (!config.ui.language) {
          await configManager.save({
            ui: { ...config.ui, language: 'en' }
          });
        }

        await logSystem.info('System', t('cli.started'));
        // 恢复登录状态：已登录→直接进入；未登录→启动时要求登录
        if (authManager.isAuthenticated()) {
          setAuthUsername(authManager.getCachedUsername());
          setAuthReady(true);
        }
        // 未登录时 authReady 保持 false，由下方 useEffect 自动弹出登录
      } catch (error) {
        // 配置加载失败，使用默认值（英文）
        setLanguage('en');
      }
    };
    init();
  }, [configManager, logSystem]);

  // 启动时强制登录：配置加载完成后，如果未登录则自动弹出登录界面
  useEffect(() => {
    // 已登录 → 跳过
    if (authReady) return;
    // 已有登录弹窗 → 跳过
    if (pendingLogin) return;

    // 延迟一下确保 ConfigManager 初始化完成后再弹
    const timer = setTimeout(() => {
      if (!authManager.isAuthenticated() && !pendingLogin) {
        setPendingLogin({
          resolve: (result) => {
            if (result.success) {
              setAuthUsername(authManager.getCachedUsername());
              setAuthReady(true);
            }
            // 登录失败/取消 → 再次弹出（不允许跳过）
          },
        });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [authReady, authManager, pendingLogin]);

  // 注册权限确认处理器（含超时逻辑）
  useEffect(() => {
    if (!onPermissionSetup) return;
    const handler: ConfirmationHandler = async (request, guardResult) => {
      return new Promise<UserConfirmation>((resolve) => {
        setPendingPermission({ request, guardResult, resolve });

        // 超时自动拒绝（60 秒）
        const timeoutId = setTimeout(() => {
          setPendingPermission(null);
          resolve({ allowed: false, remember: false });
        }, 60_000);
        (resolve as any).__timeoutId = timeoutId;
      });
    };
    onPermissionSetup(handler);
  }, [onPermissionSetup]);

  // 注册计划审查处理器（含超时逻辑）
  useEffect(() => {
    if (!onPlanReviewSetup) return;
    const handler: PlanReviewHandler = async (plan) => {
      return new Promise<PlanReviewResult>((resolve) => {
        setPendingPlanReview({ plan, resolve });

        // 超时自动拒绝（180 秒，用户需要阅读 + 可能输入补充文本）
        const timeoutId = setTimeout(() => {
          setPendingPlanReview(null);
          resolve({ decision: 'reject' });
        }, 180_000);
        (resolve as any).__timeoutId = timeoutId;
      });
    };
    onPlanReviewSetup(handler);
  }, [onPlanReviewSetup]);

  // 注册执行计划确认处理器（含超时逻辑）
  useEffect(() => {
    if (!onPlanConfirmSetup) return;
    const handler = async (plan: import('@/core/routing/types').ExecutionPlan): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        setPendingPlanConfirm({ plan, resolve });

        // 超时自动拒绝（120 秒）
        const timeoutId = setTimeout(() => {
          setPendingPlanConfirm(null);
          resolve(false);
        }, 120_000);
        (resolve as any).__timeoutId = timeoutId;
      });
    };
    onPlanConfirmSetup(handler);
  }, [onPlanConfirmSetup]);

  // 注册 AskUser 处理器（含超时逻辑）
  useEffect(() => {
    if (!onAskUserSetup) return;
    const handler = async (request: { question: string; options?: string[]; multiSelect?: boolean; default?: string }): Promise<string> => {
      return new Promise<string>((resolve) => {
        setPendingUserQuestion({
          question: request.question,
          options: request.options,
          multiSelect: request.multiSelect,
          resolve,
        });

        // 超时自动返回默认值（180 秒，与 Plan Review 对齐）
        const timeoutId = setTimeout(() => {
          setPendingUserQuestion(null);
          resolve(request.default || '');
        }, 180_000);
        (resolve as any).__timeoutId = timeoutId;
      });
    };
    onAskUserSetup(handler);
  }, [onAskUserSetup]);

  // ─── 交互式组件活跃时暂停 Spinner 动画（防止高频重绘导致闪烁）─────
  const hasInteractiveUI = !!(pendingPlanReview || pendingUserQuestion || pendingPermission);
  useEffect(() => {
    if (hasInteractiveUI) {
      pauseGlobalSpinner();
      return () => resumeGlobalSpinner();
    }
  }, [hasInteractiveUI]);

  // ─── SubAgent 进度事件订阅 ─────────────────────────────
  const subAgentToolBatchRef = useRef<Map<string, string>>(new Map());
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchToolRef = useRef(dispatchTool);
  dispatchToolRef.current = dispatchTool;
  // 追踪最新的 toolState，用于异步回调中访问 currentParallelGroup 和 parallelIds
  const toolStateRef = useRef(toolState);
  toolStateRef.current = toolState;

  useEffect(() => {
    if (!onSubAgentSetup) return;

    const flushBatch = () => {
      subAgentToolBatchRef.current.forEach((toolName, subAgentId) => {
        dispatchToolRef.current({ type: 'SUBAGENT_TOOL_USE', payload: { subAgentId, toolName } });
      });
      subAgentToolBatchRef.current.clear();
      batchTimerRef.current = null;
    };

    onSubAgentSetup({
      onStart: ({ subAgentId, task, depth, role }) => {
        dispatchToolRef.current({ type: 'SUBAGENT_START', payload: { subAgentId, task, depth, role } });
      },
      onToolUse: ({ subAgentId, toolName }) => {
        // 200ms 批处理：合并同一 subAgent 的工具更新，防止渲染风暴
        subAgentToolBatchRef.current.set(subAgentId, toolName);
        if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(flushBatch, 200);
        }
        // 批处理溢出保护：超过 50 条立即 flush
        if (subAgentToolBatchRef.current.size > 50) {
          if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
          flushBatch();
        }
      },
      onEnd: ({ subAgentId, result }) => {
        // flush 未处理的批次
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current);
          subAgentToolBatchRef.current.forEach((toolName, id) => {
            dispatchToolRef.current({ type: 'SUBAGENT_TOOL_USE', payload: { subAgentId: id, toolName } });
          });
          subAgentToolBatchRef.current.clear();
          batchTimerRef.current = null;
        }
        dispatchToolRef.current({ type: 'SUBAGENT_END', payload: { subAgentId, result } });
      },
    });

    return () => {
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    };
  }, [onSubAgentSetup]);

  // ─── SubAgent 僵尸条目清理（2 分钟超时） ────────────────
  useEffect(() => {
    const STALE_TIMEOUT = 2 * 60 * 1000; // 2 分钟
    const timer = setInterval(() => {
      const now = Date.now();
      // 通过 toolState ref 间接读取，避免将 activeSubAgents 作为依赖
      // （否则每次 dispatch 都会重建 interval）
      const agents = toolState.activeSubAgents;
      agents.forEach((agent) => {
        if (now - agent.startTime > STALE_TIMEOUT) {
          dispatchToolRef.current({ type: 'SUBAGENT_END', payload: { subAgentId: agent.subAgentId } });
        }
      });
    }, 30_000); // 每 30 秒检查一次
    return () => clearInterval(timer);
  }, [activeSubAgents]);

  // 监听 raw stdin 处理 Ctrl+C（Kitty 协议启用后 Ctrl+C = \x1b[99;5u）
  const { internal_eventEmitter } = useStdin();
  useEffect(() => {
    if (!internal_eventEmitter) return;

    const handleCtrlC = (data: string) => {
      // 传统 Ctrl+C
      if (data === '\x03') {
        if (mode !== 'chat') {
          setMode('chat');
          return;
        }
        if (status !== 'idle') {
          handleInterrupt();
        } else {
          exit();
        }
        return;
      }

      // CSI u Ctrl+C (Kitty 协议下 Ctrl+C 的格式：name='char', char='c', ctrl=true)
      const csiKey = parseCSIu(data);
      if (csiKey && csiKey.name === 'char' && csiKey.char === 'c' && csiKey.ctrl) {
        if (mode !== 'chat') {
          setMode('chat');
          return;
        }
        if (status !== 'idle') {
          handleInterrupt();
        } else {
          exit();
        }
      }
    };

    internal_eventEmitter.on('input', handleCtrlC);
    return () => {
      internal_eventEmitter.removeListener('input', handleCtrlC);
    };
  }, [internal_eventEmitter, mode, status, exit]);

  /**
   * 统一归档流式文本到 Static 消息历史。
   * 所有需要归档 streamText 的地方统一调用此函数，
   * 避免归档逻辑分散在 handleSubmit、handleStop、handleInterrupt、onThinking、onEnd 中。
   *
   * @returns 是否有内容被归档
   */
  /**
   * 统一归档流式文本到 Static 消息历史。
   * 所有需要归档 streamText 的地方统一调用此函数，
   * 避免归档逻辑分散在 handleSubmit、handleStop、handleInterrupt、onThinking、onEnd 中。
   *
   * @returns 是否有内容被归档
   */
  const archiveStreamText = useCallback((): boolean => {
    const text = streamTextRef.current;
    if (!text) {
      // 无文本，但仍需清理缓冲模式状态
      streamBufferedRef.current = false;
      setStreamProgress(0);
      currentAssistantMsgIdRef.current = null;
      return false;
    }

    // 归档完整内容到 Static
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, {
      id,
      role: 'assistant' as const,
      content: text,
      timestamp: Date.now(),
    }]);

    // 清理状态
    streamTextRef.current = '';
    streamBufferedRef.current = false;
    setStreamText('');
    setStreamProgress(0);
    currentAssistantMsgIdRef.current = null;
    return true;
  }, []);

  // Ctrl+C 中断处理逻辑（抽取为函数，供 useInput 和 raw stdin 共用）
  const handleInterrupt = useCallback(() => {
    // 取消所有 pending 的 throttle 更新
    if (streamTextUpdaterRef.current) {
      // flush 而不是 cancel，保留中断前的最新文本
      streamTextUpdaterRef.current.flush();
    }
    // 归档流式文本到 Static（统一路径）
    archiveStreamText();
    // 停止 Agent 执行
    agentLoop.stop();
    // flush 缓冲的工具结果消息
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // flush 缓冲的 TODO 更新
    if (todoBatchTimerRef.current) {
      clearTimeout(todoBatchTimerRef.current);
      todoBatchTimerRef.current = null;
      // 立即更新最新的 TODO 进度
      const todoManager = getTodoManager();
      const progressStr = todoManager.formatProgress();
      if (progressStr) {
        const progress = parseTodoProgress(progressStr);
        if (progress) {
          todoProgressRef.current = progress;
          setTodoProgress(progress);
        }
      }
      // 立即合并并 flush 所有 pending 的 TODO 工具结果
      const pendingTodoMsgs = pendingTodoMsgsRef.current;
      if (pendingTodoMsgs.length > 0) {
        pendingTodoMsgsRef.current = [];
        const mergedMsg = mergeTodoMessages(pendingTodoMsgs);
        if (mergedMsg) {
          pendingToolMsgsRef.current.push(mergedMsg);
        }
      }
    }
    const pendingMsgs = pendingToolMsgsRef.current;
    pendingToolMsgsRef.current = [];
    // 切换为 idle
    dispatchTool({ type: 'RESET_IDLE' });
    toolInfoRef.current.clear();
    turnStartTimeRef.current = 0;
    lastTurnStatsRef.current = null;
    // ★ 重置忽略标志 ★
    ignoreStreamTextRef.current = false;
    // 退出导航模式
    setIsNavigating(false);
    setSelectedToolIndex(-1);
    // 解析 pending 对话框（防止 Ctrl+C 时 UI 状态残留）
    if (pendingPermission) {
      if ((pendingPermission.resolve as any).__timeoutId) {
        clearTimeout((pendingPermission.resolve as any).__timeoutId);
      }
      pendingPermission.resolve({ allowed: false, remember: false });
      setPendingPermission(null);
    }
    if (pendingPlanReview) {
      if ((pendingPlanReview.resolve as any).__timeoutId) {
        clearTimeout((pendingPlanReview.resolve as any).__timeoutId);
      }
      pendingPlanReview.resolve({ decision: 'reject' });
      setPendingPlanReview(null);
    }
    if (pendingUserQuestion) {
      if ((pendingUserQuestion.resolve as any).__timeoutId) {
        clearTimeout((pendingUserQuestion.resolve as any).__timeoutId);
      }
      pendingUserQuestion.resolve('[Interrupted]');
      setPendingUserQuestion(null);
    }

    // 显示中断提示（合并 pending 工具消息一起 flush）
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, ...pendingMsgs, {
      id,
      role: 'system',
      content: `⏸️  ${t('chat.session_interrupted')}`,
      timestamp: Date.now(),
    }]);
  }, [agentLoop, archiveStreamText, pendingPermission, pendingPlanReview, pendingUserQuestion]);

  // 计算仅包含 tool 和 tool_group 消息的数组（用于导航）
  const toolMessages = useMemo(
    () => messages.filter((m) => m.role === 'tool' || m.role === 'tool_group'),
    [messages]
  );

  // 将标题栏作为 Static 首项，避免动态区域重绘导致重复输出
  const titleItem: ChatMessage = useMemo(() => ({
    id: -1, role: 'system' as const, content: '', timestamp: Date.now(),
  }), []);
  const messagesWithTitle = useMemo(
    () => [titleItem, ...messages],
    [titleItem, messages]
  );

  // Ctrl+C 处理（Fallback for 传统 useInput，CSI u 下走 raw stdin 监听器）
  // 同时处理工具导航快捷键
  useInput(useCallback((input, key) => {
    // Ctrl+C: 中断执行或退出
    if (key.ctrl && input === 'c') {
      if (mode !== 'chat') {
        setMode('chat');
        return;
      }
      if (status !== 'idle') {
        handleInterrupt();
      } else {
        exit();
      }
      return;
    }

    // 导航模式切换
    if (!isNavigating) {
      // 未导航状态：Tab 进入导航模式
      if (key.tab && toolMessages.length > 0 && status === 'idle') {
        setIsNavigating(true);
        setSelectedToolIndex(0);
        return;
      }

      // ── 空闲状态全局快捷键 ──
      // 通过 InputHandler 的 onQuickAction 回调处理 '?' 键
      // useInput 中不再处理 '?' 以避免与 InputHandler 竞争

      return; // 其他按键交给 InputHandler
    }

    // 导航模式激活：处理导航按键
    if (input === 'q' || input === 'Q' || key.escape) {
      // q / Esc: 退出导航模式
      setIsNavigating(false);
      setSelectedToolIndex(-1);
      return;
    }

    if (key.upArrow) {
      // ↑: 上一个工具
      setSelectedToolIndex((prev) => {
        if (prev <= 0) return toolMessages.length - 1; // 循环到末尾
        return prev - 1;
      });
      return;
    }

    if (key.downArrow) {
      // ↓: 下一个工具
      setSelectedToolIndex((prev) => {
        if (prev >= toolMessages.length - 1) return 0; // 循环到开头
        return prev + 1;
      });
      return;
    }

    if (key.tab) {
      // Tab: 下一个工具（同 ↓）
      setSelectedToolIndex((prev) => {
        if (prev >= toolMessages.length - 1) return 0;
        return prev + 1;
      });
      return;
    }

    if (key.return) {
      // Enter: 展开/折叠当前工具
      const selectedMsg = toolMessages[selectedToolIndex];
      if (!selectedMsg) return; // 索引越界，忽略
      setExpandedToolIds((prev) => {
        const next = new Set(prev);
        if (next.has(selectedMsg.id)) {
          next.delete(selectedMsg.id); // 已展开 → 折叠
        } else {
          next.add(selectedMsg.id); // 已折叠 → 展开
        }
        return next;
      });
      return;
    }
  }, [mode, status, handleInterrupt, exit, isNavigating, toolMessages, selectedToolIndex]));

  // 注册 AgentLoop 回调
  useEffect(() => {
    // 创建 throttled 更新器，100ms 间隔固定刷新流式文本
    // 注意：用 throttle 而不是 debounce，确保持续输出时也能定期更新 UI
    const streamTextUpdater = createThrottledUpdate<string>(
      (text) => {
        const lineCount = text.split('\n').length;
        if (lineCount > STREAM_BUFFER_THRESHOLD) {
          // 缓冲模式：停止实时更新 Markdown 渲染，只更新行数进度
          // 保留已渲染的流式文本（不清空 streamText），用户仍可看到之前的内容
          if (!streamBufferedRef.current) {
            streamBufferedRef.current = true;
          }
          setStreamProgress(lineCount);
        } else {
          setStreamText(text);
        }
      },
      100
    );
    // 保存到 ref 以便 Ctrl+C 时使用
    streamTextUpdaterRef.current = streamTextUpdater;

    // 创建 debounced 更新器，token 使用也采用 1000ms 间隔
    const usageUpdater = createDebouncedUpdate<TokenUsage>(
      (usage) => setUsage(usage),
      1000
    );

    agentLoop.on({
      onText: (text: string) => {
        // ★ 如果正在等待新流（补充输入已清除 streamText），忽略旧流的 onText ★
        if (ignoreStreamTextRef.current) {
          return;
        }
        streamTextRef.current += text;

        // throttled 更新 state，实时展示流式文本（dynamic area）
        streamTextUpdater.update(streamTextRef.current);
      },
      onThinking: (_thinking: string) => {
        // 工具调用后重新进入 thinking：将已有的流式文本归档到 Static
        // 这样 thinking spinner 的 !streamText 条件才能满足
        if (streamTextRef.current) {
          // 先 flush pending 的 throttle 更新，确保拿到最新文本
          streamTextUpdater.flush();
          archiveStreamText();
        }
        // ★ 重置流式归档状态：新一轮思考开始 ★
        currentAssistantMsgIdRef.current = null;
        // ★ 重置忽略标志，允许新流追加内容 ★
        ignoreStreamTextRef.current = false;
        // 单次 dispatch 设置 thinking 状态
        dispatchTool({ type: 'SET_THINKING' });
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        // 记录该工具的开始时间和原始 input（ref 存原始数据，不进入 React state）
        toolInfoRef.current.set(id, {
          startTime: Date.now(),
          input,
        });
        // 对 Write 工具的大文件 input 截断后再存入 state（仅影响 UI 展示）
        const displayInput = truncateToolInput(name, input);
        // 单次 dispatch 同时设置 status='tool' + 添加到 activeTools
        dispatchTool({ type: 'TOOL_START', id, name, input: displayInput });
      },
      onToolDelta: (id: string, _name: string, receivedBytes: number) => {
        dispatchTool({ type: 'TOOL_DELTA', id, receivedBytes });
      },
      onToolGrouped: (groups: { parallelIds: string[]; serialIds: string[] }) => {
        // 通知 reducer 标记并行工具
        dispatchTool({ type: 'TOOL_GROUPED', parallelIds: groups.parallelIds });
        // 记录并行标记到 ref，供 onToolEnd 时读取（用于 Static 区域的并行标识）
        for (const id of groups.parallelIds) {
          toolInfoRef.current.set('__parallel_' + id, { startTime: 0, input: {} });
        }
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        // 查找该工具的信息
        const toolInfo = toolInfoRef.current.get(id);
        const startTime = toolInfo?.startTime ?? Date.now();
        const originalInput = toolInfo?.input ?? {};
        const duration = Date.now() - startTime;

        // 删除该工具的信息
        toolInfoRef.current.delete(id);

        // 对 Write 工具的 input 截断后存入（仅影响 UI 展示）
        const displayInput = truncateToolInput(name, originalInput);

        // 截断过长的工具结果（避免 stdout.write 过多内容导致终端异常）
        const displayResult = truncateToolResult(result);

        // 检查该工具是否属于并行组
        const isParallel = toolInfoRef.current.has('__parallel_' + id);
        toolInfoRef.current.delete('__parallel_' + id);

        // 🆕 并行工具处理：添加到 currentParallelGroup，等待所有并行工具完成后一起展示
        if (isParallel) {
          // 添加到并行组
          dispatchTool({
            type: 'TOOL_GROUP_ADD',
            id,
            item: {
              id,
              name,
              input: displayInput,
              result: displayResult,
              isError,
              duration,
            },
          });

          // 检查是否所有并行工具都已完成
          // 获取当前并行组的大小（通过 toolState.currentParallelGroup）
          // 注意：我们需要等待下一个 tick 才能读取更新后的 state
          setTimeout(() => {
            const currentGroup = toolStateRef.current.currentParallelGroup;
            const parallelIds = toolStateRef.current.parallelIds;
            
            // 如果并行组已满（所有并行工具都完成）
            if (currentGroup.size === parallelIds.size && parallelIds.size > 0) {
              // 创建并行工具组消息
              const msgId = ++msgIdRef.current;
              const groupItems = Array.from(currentGroup.values());
              
              setMessages((prev) => [...prev, {
                id: msgId,
                role: 'tool_group',
                content: '', // 内容由 toolGroupItems 提供
                toolGroupItems: groupItems,
                timestamp: Date.now(),
              }]);

              // 清空并行组
              dispatchTool({ type: 'TOOL_GROUP_CLEAR' });
            }
          }, 0);
        } else {
          // 非并行工具：检查是否为 TODO 工具
          const TODO_TOOL_NAMES = ['todo_create', 'todo_update', 'todo_list'];
          const isTodoTool = TODO_TOOL_NAMES.includes(name);

          const msgId = ++msgIdRef.current;
          const toolMsg: ChatMessage = {
            id: msgId,
            role: 'tool',
            content: displayResult,
            toolName: name,
            toolInput: displayInput,
            toolIsError: isError,
            toolDuration: duration,
            toolParallel: false,
            timestamp: Date.now(),
          };

          if (isTodoTool && !isError) {
            // TODO 工具：暂存到 pendingTodoMsgsRef，延迟显示
            pendingTodoMsgsRef.current.push(toolMsg);
          } else {
            // 普通工具：正常处理
            pendingToolMsgsRef.current.push(toolMsg);

            // 🆕 Write/Edit 工具自动展开：让用户直接看到文件内容
            const AUTO_EXPAND_TOOLS = ['write_file', 'edit_file', 'multi_edit_file'];
            if (AUTO_EXPAND_TOOLS.includes(name) && !isError) {
              setExpandedToolIds((prev) => new Set(prev).add(msgId));
            }

            // 延迟 flush：同一 tick 内的多个 onToolEnd 只触发一次 setMessages
            if (!flushTimerRef.current) {
              flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                const pending = pendingToolMsgsRef.current;
                if (pending.length === 0) return;
                pendingToolMsgsRef.current = [];
                setMessages((prev) => [...prev, ...pending]);
              }, 0);
            }
          }
        }

        // TODO 工具：批量延迟更新进度数据（合并短时间内的多次创建/更新）
        const TODO_TOOL_NAMES = ['todo_create', 'todo_update', 'todo_list'];
        if (TODO_TOOL_NAMES.includes(name) && !isError) {
          // 清除之前的定时器，重置延迟
          if (todoBatchTimerRef.current) {
            clearTimeout(todoBatchTimerRef.current);
          }
          // 延迟 150ms 后批量更新（如果期间又有 TODO 工具完成，会重置延迟）
          todoBatchTimerRef.current = setTimeout(() => {
            todoBatchTimerRef.current = null;
            // 从 TodoManager 读取最新状态
            const todoManager = getTodoManager();
            const progressStr = todoManager.formatProgress();
            if (progressStr) {
              const progress = parseTodoProgress(progressStr);
              if (progress) {
                todoProgressRef.current = progress;
                setTodoProgress(progress);
              }
            }
            // 合并 TODO 工具结果为单条摘要消息
            const pendingTodoMsgs = pendingTodoMsgsRef.current;
            if (pendingTodoMsgs.length > 0) {
              pendingTodoMsgsRef.current = [];
              const mergedMsg = mergeTodoMessages(pendingTodoMsgs);
              if (mergedMsg) {
                setMessages((prev) => [...prev, mergedMsg]);
              }
            }
          }, 150);
        }

        // 仅从 activeTools 中移除（即时更新 Spinner 状态）
        dispatchTool({ type: 'TOOL_REMOVE', id });
      },
      onUsage: (u: TokenUsage) => {
        usageRef.current = {
          input: usageRef.current.input + u.input,
          output: usageRef.current.output + u.output,
        };
        // 使用 debounced 更新避免频繁 re-render
        usageUpdater.update(usageRef.current);
      },
      onInfo: (message: string) => {
        // 非致命提示信息（如 max_tokens 自动分段写入）
        const id = ++msgIdRef.current;
        setMessages((prev) => [...prev, {
          id,
          role: 'system',
          content: message,
          timestamp: Date.now(),
        }]);
      },
      onError: (err: Error) => {
        // 刷新所有 pending 的流式文本和 usage
        streamTextUpdater.flush();
        usageUpdater.flush();

        const id = ++msgIdRef.current;
        setMessages((prev) => [...prev, {
          id,
          role: 'system',
          content: `❌ ${err.message}`,
          timestamp: Date.now(),
        }]);
        logSystem.error('Chat', err.message);
        // 停止 loading 状态并清理（单次 dispatch）
        dispatchTool({ type: 'RESET_IDLE' });
        // 注意：不清空 streamText，让它继续显示
        streamTextRef.current = '';
        currentAssistantMsgIdRef.current = null;
        // ★ 重置忽略标志 ★
        ignoreStreamTextRef.current = false;
        // 注意：不清空工具结果，onToolEnd 已归档到 Static
        toolInfoRef.current.clear();
        turnStartTimeRef.current = 0;  // 重置开始时间
      },
      onEnd: (state: AgentState) => {
        // 刷新所有 pending 的流式文本和 usage
        streamTextUpdater.flush();
        usageUpdater.flush();

        // ★ 缓冲模式：强制刷新完整文本到 UI ★
        // flush() 仍然受缓冲判断影响，需手动设置 streamText
        if (streamBufferedRef.current && streamTextRef.current) {
          setStreamText(streamTextRef.current);
        }

        // 计算整体耗时，保存到 ref 供下一轮 handleSubmit 时使用
        const totalDuration = turnStartTimeRef.current > 0
          ? Date.now() - turnStartTimeRef.current
          : 0;

        // 保存本轮统计信息到 ref，延迟到下一轮再搬到 Static
        lastTurnStatsRef.current = {
          tokenUsage: state.tokenUsage,
          totalDuration,
        };

        // ★ 立即归档到 Static，避免长内容在 scrollback buffer 残留导致重复显示 ★
        // 长回答会滚出终端可视区，下次 flushTurnToHistory 归档时 Ink 的 eraseLines 无法清除
        // scrollback 中的旧内容，导致重复。所以必须在 onEnd 立即归档并清空 dynamic area
        archiveStreamText();

        dispatchTool({ type: 'RESET_IDLE' });
        setCost(state.cost);
        toolInfoRef.current.clear();
        turnStartTimeRef.current = 0;
        // ★ 重置忽略标志（确保下一轮可以正常追加）★
        ignoreStreamTextRef.current = false;

        // flush 缓冲的 TODO 更新（确保最终状态被归档）
        if (todoBatchTimerRef.current) {
          clearTimeout(todoBatchTimerRef.current);
          todoBatchTimerRef.current = null;
          // 立即读取最新的 TODO 进度
          const todoManager = getTodoManager();
          const progressStr = todoManager.formatProgress();
          if (progressStr) {
            const progress = parseTodoProgress(progressStr);
            if (progress) {
              todoProgressRef.current = progress;
              // 不调用 setTodoProgress，因为下面会归档到 Static
            }
          }
          // 立即合并并 flush 所有 pending 的 TODO 工具结果到历史
          const pendingTodoMsgs = pendingTodoMsgsRef.current;
          if (pendingTodoMsgs.length > 0) {
            pendingTodoMsgsRef.current = [];
            const mergedMsg = mergeTodoMessages(pendingTodoMsgs);
            if (mergedMsg) {
              setMessages((prev) => [...prev, mergedMsg]);
            }
          }
        }

        // 归档 TODO 进度到 Static（从动态区域移入历史消息）
        const finalTodoProgress = todoProgressRef.current;
        if (finalTodoProgress) {
          const todoMsgId = ++msgIdRef.current;
          setMessages((prev) => [...prev, {
            id: todoMsgId,
            role: 'system',
            content: '',
            todoData: finalTodoProgress,
            timestamp: Date.now(),
          }]);
          todoProgressRef.current = null;
          setTodoProgress(null);
        }

        // 在非 Static 区域展示本轮统计
        if (totalDuration > 0) {
          const tokenTotal = state.tokenUsage.input + state.tokenUsage.output;
          const parts = [
            `⏱️  ${(totalDuration / 1000).toFixed(2)}s`,
            `📊 ↑${state.tokenUsage.input} ↓${state.tokenUsage.output} (${tokenTotal})`,
            state.tokenUsage.cacheRead && state.tokenUsage.cacheRead > 0
              ? `⚡ cache: ${state.tokenUsage.cacheRead}`
              : null,
          ].filter(Boolean).join(' | ');
          setTurnStats(parts);
        }

        // turnStats 保持显示，直到用户下一次提交时由 flushTurnToHistory 归档到 Static
        // 不要在这里清空 turnStats：清空会导致动态区域突然收缩，
        // Ink 不会自动滚动到底部，造成输入框上方大片留白
      },
    });
  }, []);

  // 添加系统消息
  const addSystemMessage = useCallback((content: string) => {
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, {
      id,
      role: 'system',
      content,
      timestamp: Date.now(),
    }]);
  }, []);

  /**
   * 将上一轮的非 Static 内容（streamText + 统计信息）搬运到 Static 历史消息。
   * 工具结果已在 onToolEnd 时逐个归档到 Static，这里只处理文本和统计。
   * 在下一轮 handleSubmit 时调用。
   */
  const flushTurnToHistory = useCallback(() => {
    const stats = lastTurnStatsRef.current;

    // 1. ★ 流式文本已在 onEnd 时归档到 Static，此处只需清理状态 ★
    // 防御性检查：如果 ref 中仍有内容（异常情况），归档它
    if (streamTextRef.current) {
      archiveStreamText();
    }

    // 2. 统计信息归档到 Static
    if (stats && stats.totalDuration > 0) {
      const id = ++msgIdRef.current;
      const tokenTotal = stats.tokenUsage.input + stats.tokenUsage.output;
      const statsMsg = [
        `⏱️  ${(stats.totalDuration / 1000).toFixed(2)}s`,
        `📊 ↑${stats.tokenUsage.input} ↓${stats.tokenUsage.output} (${tokenTotal})`,
        stats.tokenUsage.cacheRead && stats.tokenUsage.cacheRead > 0
          ? `⚡ cache: ${stats.tokenUsage.cacheRead}`
          : null,
      ].filter(Boolean).join(' | ');

      setMessages((prev) => [...prev, {
        id,
        role: 'system',
        content: statsMsg,
        timestamp: Date.now(),
      }]);
    }

    // 清空统计和 UI 状态
    lastTurnStatsRef.current = null;
    setTurnStats('');
    dispatchTool({ type: 'CLEAR_ALL' });
  }, []);

  // 语言切换
  const cycleLanguage = useCallback(async () => {
    const currentLang = getLanguage();
    const nextLang: UILanguage = currentLang === 'zh' ? 'en' : 'zh';

    // 立即切换语言
    setLanguage(nextLang);

    try {
      // 保存到配置
      const currentConfig = configManager.getConfig();
      await configManager.save({ ui: { ...currentConfig.ui, language: nextLang } });
    } catch (err) {
      // 保存失败，但内存中已切换成功
      await logSystem.error('Config', `Failed to save language: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 获取语言标签
    const langLabels: Record<UILanguage, string> = {
      zh: t('ui.lang_zh'),
      en: t('ui.lang_en'),
    };

    // 显示切换成功的消息
    addSystemMessage(t('ui.language_changed', { lang: langLabels[nextLang] }));
    await logSystem.info('Config', `Language switched to ${nextLang}`);
  }, [configManager, addSystemMessage, logSystem]);

  // 重置项目配置为默认模板
  const handleInitCommand = useCallback(async () => {
    const language = getLanguage();
    const writer = new ProjectConfigWriter();
    try {
      await writer.initProjectConfig({
        language,
        overwrite: true,
        generateFullConfig: true,
      });
      addSystemMessage(t('chat.init_reset'));
      await logSystem.info('Config', t('chat.init_reset'));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addSystemMessage(t('chat.init_failed', { error: errMsg }));
      await logSystem.error('Config', errMsg);
    }
  }, [addSystemMessage, logSystem]);

  // ─── 斜杠命令注册表 ─────────────────────────────────────
  // 使用 SlashCommandRegistry 替代硬编码 switch-case
  const slashRegistryRef = useRef<SlashCommandRegistry>(new SlashCommandRegistry());

  // 将 props 和闭包变量存入 ref，让稳定的命令处理器能访问最新值
  const propsRef = useRef({
    agentLoop, model, exit, addSystemMessage, logSystem,
    onModelChange, onMemoryQuery, onAgentQuery, onTemplateQuery,
    onSessionSave, onSessionResume, onSessionList, onSessionDelete,
    onCheckpointCreate, onCheckpointRewind, onCheckpointList,
    cycleLanguage, handleInitCommand,
    onPlanModeEnter, onPlanModeExit, isPlanMode,
    authManager, setAuthUsername, setAuthReady, setPendingLogin, setShowWhoami,
    setShowQuickActions, setShowSessionPanel, setShowAccountPanel,
    onDoctorQuery,
  });
  propsRef.current = {
    agentLoop, model, exit, addSystemMessage, logSystem,
    onModelChange, onMemoryQuery, onAgentQuery, onTemplateQuery,
    onSessionSave, onSessionResume, onSessionList, onSessionDelete,
    onCheckpointCreate, onCheckpointRewind, onCheckpointList,
    cycleLanguage, handleInitCommand,
    onPlanModeEnter, onPlanModeExit, isPlanMode,
    authManager, setAuthUsername, setAuthReady, setPendingLogin, setShowWhoami,
    setShowQuickActions, setShowSessionPanel, setShowAccountPanel,
    onDoctorQuery,
  };

  // 注册内置斜杠命令（仅初始化一次）
  useEffect(() => {
    const registry = slashRegistryRef.current;
    const p = () => propsRef.current; // 每次调用获取最新 props

    registry.registerBulk([
      {
        name: '/exit',
        description: t('help.exit'),
        handler: async () => {
          await p().logSystem.info('System', t('cli.exit'));
          p().exit();
        },
      },
      {
        name: '/quit',
        description: t('help.exit'),
        handler: async () => {
          await p().logSystem.info('System', t('cli.exit'));
          p().exit();
        },
      },
      {
        name: '/clear',
        description: t('help.clear'),
        handler: async () => {
          setMessages([]);
          streamTextRef.current = '';
          currentAssistantMsgIdRef.current = null;
          lastTurnStatsRef.current = null;
          setStreamText('');
          setTurnStats('');
          dispatchTool({ type: 'CLEAR_ALL' });
          setExpandedToolIds(new Set());
          setIsNavigating(false);
          setSelectedToolIndex(-1);
          // 清理 TODO 批量更新定时器
          if (todoBatchTimerRef.current) {
            clearTimeout(todoBatchTimerRef.current);
            todoBatchTimerRef.current = null;
          }
          todoProgressRef.current = null;
          setTodoProgress(null);
          pendingTodoMsgsRef.current = [];
        },
      },
      {
        name: '/reset',
        description: t('help.reset'),
        handler: async () => {
          p().agentLoop.reset();
          setMessages([]);
          streamTextRef.current = '';
          currentAssistantMsgIdRef.current = null;
          lastTurnStatsRef.current = null;
          setStreamText('');
          setTurnStats('');
          dispatchTool({ type: 'CLEAR_ALL' });
          setUsage({ input: 0, output: 0 });
          setCost(0);
          setExpandedToolIds(new Set());
          setIsNavigating(false);
          setSelectedToolIndex(-1);
          // 清理 TODO 批量更新定时器
          if (todoBatchTimerRef.current) {
            clearTimeout(todoBatchTimerRef.current);
            todoBatchTimerRef.current = null;
          }
          todoProgressRef.current = null;
          setTodoProgress(null);
          pendingTodoMsgsRef.current = [];
          p().addSystemMessage(t('chat.session_reset'));
          await p().logSystem.info('Chat', t('chat.session_reset'));
        },
      },
      {
        name: '/cost',
        description: t('help.cost'),
        handler: async () => {
          const state = p().agentLoop.getState();
          const sessionInfo = `${t('chat.token_label')}: ${state.tokenUsage.input + state.tokenUsage.output}`;
          try {
            const recorder = new UsageStatsRecorder();
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
            const stats = await recorder.aggregate({
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
            });
            const output = formatUsageStats(stats, 7);
            p().addSystemMessage(`${sessionInfo}\n\n${output}`);
          } catch {
            p().addSystemMessage(sessionInfo);
          }
        },
      },
      {
        name: '/stats',
        description: '查看使用统计',
        group: '统计',
        usage: '/stats [today|week|month|model|tools|update|YYYY-MM-DD]',
        handler: async (args: string) => {
          const subCmd = args.trim().toLowerCase();
          try {
            const recorder = new UsageStatsRecorder();
            const pricingResolver = new PricingResolver();
            const stats = new DailyUsageStats(pricingResolver, recorder);

            switch (subCmd) {
              case '':
              case 'today': {
                const today = new Date().toISOString().split('T')[0]!;
                const records = await stats.getDaily(today);
                p().addSystemMessage(formatDailyStats(records));
                break;
              }

              case 'week': {
                const trend = await stats.getCostTrend(7);
                p().addSystemMessage(formatCostTrend(trend, 7));
                break;
              }

              case 'month': {
                const trend = await stats.getCostTrend(30);
                p().addSystemMessage(formatCostTrend(trend, 30));
                break;
              }

              case 'model': {
                const endDate = new Date().toISOString().split('T')[0]!;
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
                const startStr = startDate.toISOString().split('T')[0]!;
                const records = await stats.getRange(startStr, endDate);
                p().addSystemMessage(formatModelSummary(records));
                break;
              }

              case 'tools': {
                const topTools = await stats.getTopTools(10);
                p().addSystemMessage(formatTopTools(topTools, 10));
                break;
              }

              case 'update': {
                p().addSystemMessage('正在聚合统计数据...');
                await stats.aggregateAndSave();
                p().addSystemMessage('✅ 统计数据已更新');
                break;
              }

              default: {
                // 尝试作为日期解析
                if (/^\d{4}-\d{2}-\d{2}$/.test(subCmd)) {
                  const records = await stats.getDaily(subCmd);
                  p().addSystemMessage(formatDailyStats(records));
                } else {
                  p().addSystemMessage([
                    '未知子命令。可用命令:',
                    '  /stats          查看今日统计',
                    '  /stats today    查看今日统计',
                    '  /stats week     查看最近 7 天趋势',
                    '  /stats month    查看最近 30 天趋势',
                    '  /stats model    查看模型使用汇总',
                    '  /stats tools    查看最常用工具 Top 10',
                    '  /stats update   重新聚合统计数据',
                    '  /stats 2026-03-09  查看指定日期统计',
                  ].join('\n'));
                }
                break;
              }
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(`统计查询失败: ${errMsg}`);
          }
        },
      },
      {
        name: '/help',
        description: t('help.help'),
        handler: async () => {
          // 动态生成帮助：包含所有已注册命令
          const registeredHelp = slashRegistryRef.current.formatHelp();
          p().addSystemMessage([
            t('help.title'),
            registeredHelp,
            '',
            t('help.shortcuts_title'),
            t('help.shortcut_ctrlc'),
            t('help.shortcut_shift_enter'),
            t('help.shortcut_tab'),
          ].join('\n'));
        },
      },
      {
        name: '/settings',
        description: t('help.settings'),
        handler: async () => {
          setMode('settings');
          await p().logSystem.info('System', t('settings.enter'));
        },
      },
      {
        name: '/logs',
        description: t('help.logs'),
        handler: async () => { setMode('logs'); },
      },
      {
        name: '/bots',
        description: t('help.bots'),
        handler: async () => {
          setMode('bots');
          await p().logSystem.info('System', t('bots.enter'));
        },
      },
      {
        name: '/lang',
        description: t('help.lang'),
        handler: async () => { await p().cycleLanguage(); },
      },
      {
        name: '/init',
        description: t('help.init'),
        handler: async () => { await p().handleInitCommand(); },
      },
      {
        name: '/compact',
        description: t('help.compact'),
        handler: async (args?: string) => {
          const customInstruction = args?.trim() || undefined;
          const compactResult = await p().agentLoop.compact(customInstruction);
          if (compactResult) {
            p().addSystemMessage(t('chat.compact_done', {
              original: String(compactResult.originalTokens),
              compressed: String(compactResult.compressedTokens),
              ratio: String(Math.round(compactResult.compressionRatio * 100)),
            }));
          } else {
            p().addSystemMessage(t('chat.compact_skip'));
          }
        },
      },
      {
        name: '/model',
        description: t('help.model'),
        handler: async (args) => {
          if (!args) {
            p().addSystemMessage(t('chat.model_current', { model: p().model }));
          } else if (p().onModelChange) {
            try {
              const newModel = await p().onModelChange!(args);
              p().addSystemMessage(t('chat.model_changed', { model: newModel }));
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              p().addSystemMessage(t('chat.model_change_failed', { error: errMsg }));
            }
          } else {
            p().addSystemMessage(t('chat.model_current', { model: p().model }));
          }
        },
      },
      {
        name: '/memory',
        description: t('help.memory'),
        handler: async (args) => {
          if (!p().onMemoryQuery) {
            p().addSystemMessage(t('chat.memory_disabled'));
            return;
          }
          try {
            const result = await p().onMemoryQuery!(args || undefined);
            p().addSystemMessage(result || t('chat.memory_empty'));
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(t('chat.memory_error', { error: errMsg }));
          }
        },
      },
      {
        name: '/agent',
        description: '管理 Multi-Agent 系统',
        group: '系统',
        icon: '🤖',
        handler: async (args) => {
          if (!p().onAgentQuery) {
            p().addSystemMessage('❌ Multi-Agent 系统未启用\n提示: 在配置中设置 agents.enabled = true');
            return;
          }
          try {
            const result = await p().onAgentQuery!(args || '');
            p().addSystemMessage(result);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(`❌ Agent 命令执行失败: ${errMsg}`);
          }
        },
      },
      {
        name: '/template',
        description: '管理 MCP Prompts 模板',
        group: '系统',
        icon: '📝',
        handler: async (args) => {
          if (!p().onTemplateQuery) {
            p().addSystemMessage('❌ 模板系统未启用\n提示: 请确保 MCP 系统已配置');
            return;
          }
          try {
            const result = await p().onTemplateQuery!(args || '');
            p().addSystemMessage(result);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(`❌ Template 命令执行失败: ${errMsg}`);
          }
        },
      },
      // ─── 会话持久化命令 ──────────────────────────────
      {
        name: '/save',
        description: t('help.save'),
        handler: async (args) => {
          if (!p().onSessionSave) {
            p().addSystemMessage(t('session.save_unavailable'));
            return;
          }
          try {
            const name = args?.trim() || undefined;
            // 将当前 UI 消息转换为 historyMessages（过滤掉工具消息）
            const historyMessages = messages
              .filter(msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')
              .map(msg => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                timestamp: msg.timestamp,
              }));
            const sessionId = await p().onSessionSave!(name, historyMessages);
            p().addSystemMessage(t('session.saved', { id: sessionId.slice(0, 8) + '...' }));
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(t('session.save_failed', { error: errMsg }));
          }
        },
      },
      {
        name: '/resume',
        description: t('help.resume'),
        handler: async (args) => {
          if (!p().onSessionList || !p().onSessionResume) {
            p().addSystemMessage(t('session.resume_unavailable'));
            return;
          }
          try {
            const sessions = await p().onSessionList!();
            if (sessions.length === 0) {
              p().addSystemMessage(t('session.no_sessions'));
              return;
            }
            if (args?.trim()) {
              const targetId = args.trim();
              const match = sessions.find(s => s.id.startsWith(targetId));
              if (!match) {
                p().addSystemMessage(t('session.not_found', { id: targetId }));
                return;
              }
              const result = await p().onSessionResume!(match.id);
              // 恢复 UI 状态：usage、cost、historyMessages
              if (result.usage) {
                usageRef.current = { input: result.usage.input, output: result.usage.output };
                setUsage(usageRef.current);
                setCost(result.usage.cost);
              }
              if (result.historyMessages && result.historyMessages.length > 0) {
                const historyMsgs: ChatMessage[] = result.historyMessages.map((m) => ({
                  id: ++msgIdRef.current,
                  role: m.role as 'user' | 'assistant' | 'system',
                  content: m.content,
                  timestamp: m.timestamp,
                }));
                setMessages((prev) => [...prev, ...historyMsgs]);
              }
              p().addSystemMessage(t('session.resumed', { name: match.name, count: String(result.messageCount) }));
              return;
            }
            const listText = sessions.slice(0, 10).map((s, i) => {
              const date = new Date(s.updatedAt).toLocaleString('zh-CN');
              return `  ${i + 1}. [${s.id.slice(0, 8)}] ${s.name} (${t('session.msg_count', { count: String(s.messageCount) })}, ${date})`;
            }).join('\n');
            p().addSystemMessage(
              `${t('session.list_title')}:\n${listText}\n\n` +
              t('session.list_hint')
            );
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(t('session.resume_failed', { error: errMsg }));
          }
        },
      },
      {
        name: '/sessions',
        description: t('help.sessions'),
        handler: async (args) => {
          if (!p().onSessionList) {
            p().addSystemMessage(t('session.manage_unavailable'));
            return;
          }
          try {
            const subCmd = args?.trim().split(/\s+/);
            if (subCmd && subCmd[0] === 'delete' && subCmd[1]) {
              if (!p().onSessionDelete) {
                p().addSystemMessage(t('session.delete_unavailable'));
                return;
              }
              const sessions = await p().onSessionList!();
              const match = sessions.find(s => s.id.startsWith(subCmd[1]));
              if (!match) {
                p().addSystemMessage(t('session.not_found', { id: subCmd[1] }));
                return;
              }
              await p().onSessionDelete!(match.id);
              p().addSystemMessage(t('session.deleted', { name: match.name }));
              return;
            }
            const sessions = await p().onSessionList!();
            if (sessions.length === 0) {
              p().addSystemMessage(t('session.no_sessions'));
              return;
            }
            const listText = sessions.map((s, i) => {
              const date = new Date(s.updatedAt).toLocaleString('zh-CN');
              return `  ${i + 1}. [${s.id.slice(0, 8)}] ${s.name} (${t('session.msg_count', { count: String(s.messageCount) })}, ${date})`;
            }).join('\n');
            p().addSystemMessage(`${t('session.list_title')} (${sessions.length}):\n${listText}`);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(t('session.operation_failed', { error: errMsg }));
          }
        },
      },
      {
        name: '/checkpoint',
        description: t('help.checkpoint'),
        handler: async (args) => {
          if (!p().onCheckpointCreate) {
            p().addSystemMessage(t('session.checkpoint_unavailable'));
            return;
          }
          try {
            const label = args?.trim() || undefined;
            const checkpointId = await p().onCheckpointCreate!(label);
            p().addSystemMessage(t('session.checkpoint_created', { id: checkpointId.slice(0, 8) + '...' }));
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(t('session.checkpoint_create_failed', { error: errMsg }));
          }
        },
      },
      {
        name: '/rewind',
        description: t('help.rewind'),
        handler: async (args) => {
          if (!p().onCheckpointList || !p().onCheckpointRewind) {
            p().addSystemMessage(t('session.rewind_unavailable'));
            return;
          }
          try {
            const checkpoints = await p().onCheckpointList!();
            if (checkpoints.length === 0) {
              p().addSystemMessage(t('session.no_checkpoints'));
              return;
            }
            if (args?.trim()) {
              const targetId = args.trim();
              const match = checkpoints.find(cp => cp.id.startsWith(targetId));
              if (!match) {
                p().addSystemMessage(t('session.checkpoint_not_found', { id: targetId }));
                return;
              }
              const msgCount = await p().onCheckpointRewind!(match.id);
              p().addSystemMessage(
                t('session.rewound', { label: match.label, count: String(msgCount) }) + '\n' +
                t('session.rewind_warning')
              );
              return;
            }
            const listText = checkpoints.map((cp, i) => {
              const date = new Date(cp.createdAt).toLocaleString('zh-CN');
              return `  ${i + 1}. [${cp.id.slice(0, 8)}] ${cp.label} (${t('session.msg_count', { count: String(cp.messageCount) })}, ${date})`;
            }).join('\n');
            p().addSystemMessage(
              `${t('session.checkpoints_title')}:\n${listText}\n\n` +
              t('session.rewind_hint')
            );
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(t('session.rewind_failed', { error: errMsg }));
          }
        },
      },
      // ─── Plan Mode 命令 ──────────────────────────────
      {
        name: '/plan',
        description: '进入 Plan Mode（只读模式）',
        handler: async () => {
          if (p().onPlanModeEnter) {
            p().onPlanModeEnter!();
            setPlanModeActive(true);
            p().addSystemMessage('✅ 已进入 Plan Mode，所有写操作将被禁止。使用 /exit-plan 退出。');
          } else {
            p().addSystemMessage('Plan Mode 不可用');
          }
        },
      },
      {
        name: '/exit-plan',
        description: '退出 Plan Mode',
        handler: async () => {
          if (p().onPlanModeExit) {
            p().onPlanModeExit!();
            setPlanModeActive(false);
            p().addSystemMessage('✅ 已退出 Plan Mode');
          } else {
            p().addSystemMessage('Plan Mode 不可用');
          }
        },
      },
      // ─── 系统诊断命令 ──────────────────────────────
      {
        name: '/doctor',
        description: t('help.doctor'),
        handler: async () => {
          if (!p().onDoctorQuery) {
            p().addSystemMessage('诊断功能不可用');
            return;
          }
          try {
            const report = await p().onDoctorQuery!();
            p().addSystemMessage(report);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(`诊断失败: ${errMsg}`);
          }
        },
      },
      // ─── 天工坊命令 ──────────────────────────────
      {
        name: '/tiangong',
        description: '天工坊 — 开源插件社区 (search/install/list/uninstall)',
        handler: async (args) => {
          // 已登录时自动创建带认证的 RegistryClient
          const authFetch = p().authManager.isAuthenticated()
            ? p().authManager.getAuthenticatedFetch()
            : null;
          const registryClient = new RegistryClient(undefined, undefined, authFetch ?? undefined);
          const mcpInstaller = new MCPInstaller(registryClient);
          const skillInstaller = new SkillInstaller(registryClient);

          const parts = (args || '').trim().split(/\s+/);
          const subCmd = parts[0] || '';
          const subArgs = parts.slice(1).join(' ');

          try {
            let result: string;
            switch (subCmd) {
              case 'search':
                result = await handleSearch(registryClient, subArgs);
                break;
              case 'install':
                result = await handleInstall(registryClient, mcpInstaller, skillInstaller, subArgs);
                break;
              case 'list':
                result = handleList(mcpInstaller, skillInstaller);
                break;
              case 'uninstall':
                result = handleUninstall(mcpInstaller, skillInstaller, subArgs);
                break;
              default:
                result = [
                  '天工坊 — 开源 Skill & MCP 插件社区',
                  '',
                  '用法:',
                  '  /tiangong search <关键词>     搜索插件',
                  '  /tiangong install <包名>      安装插件',
                  '  /tiangong list                已安装列表',
                  '  /tiangong uninstall <包名>    卸载插件',
                ].join('\n');
            }
            p().addSystemMessage(result);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(`天工坊错误: ${errMsg}`);
          }
        },
      },
      // ─── 认证命令 ──────────────────────────────
      {
        name: '/login',
        description: '登录 Shibit 账号',
        handler: async (args) => {
          if (p().authManager.isAuthenticated()) {
            p().addSystemMessage(`已登录为 ${p().authManager.getCachedUsername()}。使用 /logout 退出后重新登录。`);
            return;
          }
          const email = args?.trim() || undefined;
          return new Promise<void>((resolve) => {
            p().setPendingLogin({
              initialEmail: email,
              resolve: (result) => {
                if (result.success) {
                  p().setAuthUsername(p().authManager.getCachedUsername());
                  p().setAuthReady(true);
                }
                resolve();
              },
            });
          });
        },
      },
      {
        name: '/logout',
        description: '退出 Shibit 账号',
        handler: async () => {
          if (!p().authManager.isAuthenticated()) {
            p().addSystemMessage('当前未登录。');
            return;
          }
          try {
            await p().authManager.logout();
            p().setAuthUsername(null);
            p().addSystemMessage('✓ 已退出登录');
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(`退出登录失败: ${errMsg}`);
          }
        },
      },
      {
        name: '/whoami',
        description: '查看当前登录用户信息',
        handler: async () => {
          return new Promise<void>((resolve) => {
            p().setShowWhoami(true);
            // WhoamiDisplay 完成后通过 onComplete 回调
            // 延迟 resolve 让组件有时间渲染
            const checkDone = () => {
              setTimeout(() => resolve(), 100);
            };
            checkDone();
          });
        },
      },
      // ─── 记忆系统 3.0 命令 ──────────────────────────────
      {
        name: '/identity',
        description: '身份记忆管理 (set-title/set-name/clear)',
        handler: async (args) => {
          const memoryManager = p().session?.getMemoryManager();
          if (!memoryManager) {
            p().addSystemMessage('❌ 记忆系统未初始化');
            return;
          }

          const constraintManager = memoryManager.getConstraintManager();
          if (!constraintManager) {
            p().addSystemMessage('❌ 约束管理器未初始化');
            return;
          }

          try {
            const { handleIdentity } = await import('@/memory/commands/IdentityCommand');
            const parts = (args || '').trim().split(/\s+/);
            const result = await handleIdentity(constraintManager, parts);
            p().addSystemMessage(result);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(`❌ Identity 命令执行失败: ${errMsg}`);
          }
        },
      },
      {
        name: '/dream',
        description: '做梦机制 (run/status/dry-run)',
        handler: async (args) => {
          const memoryManager = p().session?.getMemoryManager();
          if (!memoryManager) {
            p().addSystemMessage('❌ 记忆系统未初始化');
            return;
          }

          const dreamScheduler = memoryManager.getDreamScheduler();
          if (!dreamScheduler) {
            p().addSystemMessage('❌ 做梦调度器未初始化');
            return;
          }

          try {
            const { handleDream } = await import('@/memory/commands/DreamCommand');
            const parts = (args || '').trim().split(/\s+/);
            const result = await handleDream(dreamScheduler, parts);
            p().addSystemMessage(result);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            p().addSystemMessage(`❌ Dream 命令执行失败: ${errMsg}`);
          }
        },
      },
      {
        name: '/rules',
        description: '管理核心安全规则 (list/delete/disable/enable)',
        group: '记忆管理',
        usage: '/rules [list|delete <id>|disable <id>|enable <id>]',
        handler: async (args) => {
          const memoryManager = p().session?.getMemoryManager();
          if (!memoryManager) {
            p().addSystemMessage('❌ 记忆系统未初始化');
            return;
          }

          const coreRuleStore = memoryManager.getCoreRuleStore();
          const parts = (args || '').trim().split(/\s+/);
          const subCommand = parts[0] || 'list';

          if (subCommand === 'list' || subCommand === '') {
            // 查看所有规则
            const rules = coreRuleStore.getAllRules();
            if (rules.length === 0) {
              p().addSystemMessage('📋 暂无核心规则');
              return;
            }

            const lines = ['📋 核心安全规则：\n'];
            for (const rule of rules) {
              const status = rule.active ? '✅' : '⏸️';
              const category = rule.category === 'custom' ? '' : `[${rule.category}] `;
              lines.push(`${status} ${rule.id}: ${category}${rule.rule}`);
            }
            p().addSystemMessage(lines.join('\n'));

          } else if (subCommand === 'delete') {
            // 删除规则
            const id = parts[1];
            if (!id) {
              p().addSystemMessage('❌ 请指定规则 ID，例如：/rules delete rule_abc123');
              return;
            }

            const rule = coreRuleStore.getRule(id);
            if (!rule) {
              p().addSystemMessage(`❌ 规则不存在：${id}`);
              return;
            }

            const success = coreRuleStore.delete(id);
            if (success) {
              p().addSystemMessage(`✅ 已删除规则：${rule.rule}`);
            } else {
              p().addSystemMessage(`❌ 删除失败：${id}`);
            }

          } else if (subCommand === 'disable') {
            // 停用规则
            const id = parts[1];
            if (!id) {
              p().addSystemMessage('❌ 请指定规则 ID，例如：/rules disable rule_abc123');
              return;
            }

            const success = coreRuleStore.setActive(id, false);
            if (success) {
              p().addSystemMessage(`⏸️ 已停用规则：${id}`);
            } else {
              p().addSystemMessage(`❌ 规则不存在：${id}`);
            }

          } else if (subCommand === 'enable') {
            // 启用规则
            const id = parts[1];
            if (!id) {
              p().addSystemMessage('❌ 请指定规则 ID，例如：/rules enable rule_abc123');
              return;
            }

            const success = coreRuleStore.setActive(id, true);
            if (success) {
              p().addSystemMessage(`✅ 已启用规则：${id}`);
            } else {
              p().addSystemMessage(`❌ 规则不存在：${id}`);
            }

          } else {
            p().addSystemMessage(`❌ 未知子命令：${subCommand}\n用法：/rules [list|delete <id>|disable <id>|enable <id>]`);
          }
        },
      },
    ]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 提交用户输入
  const handleSubmit = useCallback(async (input: string) => {
    // 斜杠命令 — 通过 SlashCommandRegistry 动态查找执行
    const cmd = parseSlashCommand(input);
    if (cmd) {
      // ★ 先归档流式文本，避免斜杠命令输出在流式文本上方 ★
      flushTurnToHistory();

      const registry = slashRegistryRef.current;
      if (registry.has(cmd.name)) {
        try {
          await registry.execute(cmd.name, cmd.args);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          addSystemMessage(errMsg);
        }
        return;
      }
      // 未注册的命令
      addSystemMessage(t('chat.unknown_command', { name: cmd.name }));
      return;
    }

    // ── 执行中打断并追加输入 ──
    // 如果 Agent 正在执行（流式输出或工具调用），用户输入会立即中断并追加
    // LLM 会基于完整对话历史自己判断是补充还是新任务
    const hasStreamContent = streamText.length > 0 || streamTextRef.current.length > 0;
    const isAgentBusy = status !== 'idle' || hasStreamContent;

    if (isAgentBusy) {
      // ★ 检查 AgentLoop 是否真的在运行 ★
      if (agentLoop.getState().status === 'idle') {
        // UI 状态未更新但 AgentLoop 已停止 → 作为正常提交处理
        // （继续执行下面的正常提交逻辑）
      } else {
        // ★ 添加用户新输入到历史（显示在 UI 中）★
        const uid = ++msgIdRef.current;
        setMessages((prev) => [...prev, {
          id: uid,
          role: 'user',
          content: input,
          timestamp: Date.now(),
        }]);

        // ★ 根据当前状态选择中断方式 ★
        if (status === 'tool') {
          // 工具执行中 → 不中断，等待工具完成后自动将新输入传给 LLM
          // 这样可以保留工具执行结果
          agentLoop.appendMessage(input);
        } else {
          // thinking 状态（流式输出中）→ 立即中断
          // 归档当前已输出的内容，基于完整上下文重新生成
          if (streamTextUpdaterRef.current) {
            streamTextUpdaterRef.current.flush();
          }
          archiveStreamText();

          agentLoop.interrupt(input);
        }
        return;
      }
    }

    // ── 正常提交（idle 状态） ──

    // 先将上一轮的内容搬到 Static 历史
    flushTurnToHistory();

    // 添加用户消息
    const uid = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id: uid, role: 'user', content: input, timestamp: Date.now() }]);

    // 记录日志
    const preview = input.slice(0, 100) + (input.length > 100 ? '...' : '');
    await logSystem.info('Chat', t('chat.user_log', { preview }));

    // 调用 Agent
    turnStartTimeRef.current = Date.now();  // 记录开始时间
    // 单次 dispatch 设置 status='thinking' + 清空遗留 activeTools
    dispatchTool({ type: 'START_TURN' });
    setStreamText('');
    setTurnStats('');
    // 重置 TODO 进度：
    // 如果有未完成的 TODO（pending/in_progress），说明用户可能在延续当前任务，
    // 保留 TODO 数据和 UI 显示，让 LLM 继续使用现有的 TODO 列表。
    // 如果所有 TODO 都已完成或无 TODO，则重置（全新任务）。
    const todoManager = getTodoManager();
    if (todoManager.hasActiveTodos()) {
      // 延续模式：保留 TODO 数据，立即从 TodoManager 恢复动态 TodoPanel
      // （onEnd 可能已将 todoProgress 归档到 Static 并清空动态区域）
      const progressStr = todoManager.formatProgress();
      if (progressStr) {
        const progress = parseTodoProgress(progressStr);
        if (progress) {
          todoProgressRef.current = progress;
          setTodoProgress(progress);
        }
      }
    } else {
      // 全新任务模式：清空 TODO 数据和 UI
      todoProgressRef.current = null;
      setTodoProgress(null);
      todoManager.startTurn().catch(() => {});
    }
    try {
      await agentLoop.run(input);
    } catch (err) {
      // 错误已由 onError 回调显示并清理状态，此处仅做防御性兜底
      // 注意：不读取闭包中的 status（可能是陈旧值），通过 getState() 获取实时状态
      if (agentLoop.getState().status !== 'idle') {
        dispatchTool({ type: 'RESET_IDLE' });
      }
      turnStartTimeRef.current = 0;
    }
  }, [agentLoop, addSystemMessage, flushTurnToHistory, logSystem, status, archiveStreamText]);

  // 从设置/日志/机器人模式返回对话模式
  const handleModeExit = useCallback(() => {
    setMode('chat');
  }, []);

  // 流式文本 Markdown 渲染结果缓存
  // useMemo 防止无关 re-render（如 toolState dispatch）时重复计算
  // ⚠️ 必须在条件 return 之前调用，确保 hooks 顺序一致
  const renderedStreamLines = useMemo(() => {
    if (!streamText) return null;
    return renderMarkdownSimple(streamText);
  }, [streamText]);

  // ★ Agent 繁忙状态判断（用于补充输入和提示显示）★
  // 修复：增加 streamText 判断 + 时间窗口判断，解决 status 变 idle 但用户想补充的问题
  const hasStreamContent = useMemo(() => {
    return streamText.length > 0 || streamTextRef.current.length > 0;
  }, [streamText]); // streamTextRef 不作为依赖，因为它只在 handleSubmit 中读取

  const isAgentBusy = useMemo(() => {
    return status !== 'idle' || hasStreamContent;
  }, [status, hasStreamContent]);

  // 渲染非对话模式
  if (mode === 'settings') {
    return (
      <Box flexDirection="column">
        <SettingsMode onExit={handleModeExit} configManager={configManager} />
      </Box>
    );
  }

  if (mode === 'logs') {
    return (
      <Box flexDirection="column">
        <LogsMode onExit={handleModeExit} logSystem={logSystem} />
      </Box>
    );
  }

  if (mode === 'bots') {
    return (
      <Box flexDirection="column">
        <BotsMode onExit={handleModeExit} botManager={botManager} />
      </Box>
    );
  }

  // 对话模式
  return (
    <Box flexDirection="column">
      {/* 历史消息 (Static 保证滚出屏幕的不重绘) */}
      {/* 标题栏作为首个 Static 项，确保只输出一次 */}
      <Static items={messagesWithTitle}>
        {(item) => {
          if (item.id === -1) {
            return (
              <Box key="__title__" marginBottom={0}>
                <Text bold color={theme.primary}>{t('cli.title')}</Text>
                <Text color={theme.dim}>  {t('cli.help_hint')}</Text>
              </Box>
            );
          }
          const msg = item;
          return (
          <Box key={msg.id} flexDirection="column" marginBottom={0}>
            {msg.role === 'user' && (
              <Box>
                <Text color={theme.primary} bold>❯ </Text>
                <Text bold>{msg.content}</Text>
              </Box>
            )}
            {msg.role === 'tool' && msg.toolName && (() => {
              // 计算当前 tool 消息在 toolMessages 中的索引
              const toolIndex = toolMessages.findIndex((tm) => tm.id === msg.id);
              return (
                <CollapsibleToolResult
                  name={msg.toolName}
                  input={msg.toolInput ?? {}}
                  result={msg.content}
                  isError={msg.toolIsError ?? false}
                  duration={msg.toolDuration ?? 0}
                  index={toolIndex}
                  expanded={expandedToolIds.has(msg.id)}
                  isSelected={isNavigating && selectedToolIndex === toolIndex}
                  onToggleExpand={() => {
                    setExpandedToolIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(msg.id)) {
                        next.delete(msg.id);
                      } else {
                        next.add(msg.id);
                      }
                      return next;
                    });
                  }}
                  parallel={msg.toolParallel}
                />
              );
            })()}
            {msg.role === 'tool_group' && msg.toolGroupItems && (() => {
              // 并行工具组：使用树状结构展示
              const toolIndex = toolMessages.findIndex((tm) => tm.id === msg.id);
              const tools = msg.toolGroupItems.map(item => ({
                ...item,
                completed: true,
              }));
              return (
                <ParallelToolGroupCompact
                  tools={tools}
                  isSelected={isNavigating && selectedToolIndex === toolIndex}
                  expanded={expandedToolIds.has(msg.id)}
                  onToggleExpand={() => {
                    setExpandedToolIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(msg.id)) {
                        next.delete(msg.id);
                      } else {
                        next.add(msg.id);
                      }
                      return next;
                    });
                  }}
                />
              );
            })()}
            {msg.role === 'assistant' && (
              <Box marginLeft={2} flexDirection="column">
                {renderMarkdownSimple(msg.content).map((line, i) => (
                  <Box key={i}>
                    <Text>{line}</Text>
                  </Box>
                ))}
              </Box>
            )}
            {msg.role === 'system' && msg.todoData && (
              <TodoPanel data={msg.todoData} />
            )}
            {msg.role === 'system' && !msg.todoData && (
              <Box>
                <Text color={theme.dim} italic>{msg.content}</Text>
              </Box>
            )}
          </Box>
          );
        }}
      </Static>

      {/* SubAgent 执行进度 - idle 时隐藏避免占据空白 */}
      {status !== 'idle' && <SubAgentProgress agents={activeSubAgents} />}

      {/* TODO 任务进度：动态区域唯一实例，idle 时隐藏避免占据空白 */}
      {todoProgress && status !== 'idle' && (
        <TodoPanel data={todoProgress} />
      )}

      {/* 当前执行的工具：展示工具名 + 指令摘要 + 接收进度 */}
      {/* pendingUserQuestion/pendingPermission/pendingPlanReview 时隐藏 spinner，避免与交互组件同时显示 */}
      {!pendingUserQuestion && !pendingPermission && !pendingPlanReview && (() => {
        const entries = Array.from(activeTools.entries());
        const parallelTools = entries.filter(([, tool]) => tool.parallel);
        const serialTools = entries.filter(([, tool]) => !tool.parallel);
        const hasParallel = parallelTools.length > 0;

        // 如果有并行工具，使用树状结构展示
        if (hasParallel) {
          const parallelToolItems = parallelTools.map(([id, tool]) => ({
            id,
            name: tool.name,
            input: tool.input,
            receivedBytes: tool.receivedBytes,
            completed: false,
          }));

          return (
            <>
              {/* 并行工具组：树状结构 */}
              <ParallelToolGroup
                tools={parallelToolItems}
                completed={false}
                collapsed={false}
              />
              {/* 串行工具：正常展示 */}
              {serialTools.map(([id, tool]) => {
                const displayName = formatToolName(tool.name, tool.input);
                const cmd = formatToolCommand(tool.name, tool.input);
                let progressSuffix = '';
                if (tool.receivedBytes && tool.receivedBytes > 0) {
                  const kb = (tool.receivedBytes / 1024).toFixed(1);
                  progressSuffix = ` (${kb}KB)`;
                }
                const label = cmd
                  ? `${displayName} ${cmd}${progressSuffix}`
                  : `${displayName}${progressSuffix}`;
                return (
                  <Box key={id} marginLeft={2}>
                    <Spinner label={label} />
                  </Box>
                );
              })}
            </>
          );
        }

        // 没有并行工具，正常展示串行工具
        return (
          <>
            {serialTools.map(([id, tool]) => {
              const displayName = formatToolName(tool.name, tool.input);
              const cmd = formatToolCommand(tool.name, tool.input);
              let progressSuffix = '';
              if (tool.receivedBytes && tool.receivedBytes > 0) {
                const kb = (tool.receivedBytes / 1024).toFixed(1);
                progressSuffix = ` (${kb}KB)`;
              }
              const label = cmd
                ? `${displayName} ${cmd}${progressSuffix}`
                : `${displayName}${progressSuffix}`;
              return (
                <Box key={id} marginLeft={2}>
                  <Spinner label={label} />
                </Box>
              );
            })}
          </>
        );
      })()}

      {/* 思考中（没有工具在执行、还没有流式文本时显示）*/}
      {status === 'thinking' && activeTools.size === 0 && !streamText && !streamProgress && !pendingPermission && !pendingPlanReview && !pendingUserQuestion && (
        <Spinner label={t('cli.thinking')} />
      )}

      {/* 权限确认对话框 */}
      {pendingPermission && (
        <PermissionPrompt
          request={pendingPermission.request}
          guardResult={pendingPermission.guardResult}
          onConfirm={handlePermissionConfirm}
        />
      )}

      {/* 计划审查对话框 */}
      {pendingPlanReview && (
        <PlanReview
          plan={pendingPlanReview.plan}
          onDecision={handlePlanDecision}
        />
      )}

      {/* 执行计划确认对话框 */}
      {pendingPlanConfirm && (
        <PlanConfirm
          plan={pendingPlanConfirm.plan}
          onConfirm={handlePlanConfirm}
        />
      )}

      {/* Agent 提问对话框 */}
      {pendingUserQuestion && (
        <AskUserPrompt
          question={pendingUserQuestion.question}
          options={pendingUserQuestion.options}
          multiSelect={pendingUserQuestion.multiSelect}
          onAnswer={handleUserAnswer}
        />
      )}

      {/* 登录对话框 */}
      {pendingLogin && (
        <LoginPrompt
          authManager={authManager}
          initialEmail={pendingLogin.initialEmail}
          onComplete={(result) => {
            pendingLogin.resolve(result);
            setPendingLogin(null);
            // 启动时强制登录场景：失败/取消后会由 useEffect 重新弹出
          }}
        />
      )}

      {/* 用户信息展示（旧版，保留兼容） */}
      {showWhoami && (
        <WhoamiDisplay
          authManager={authManager}
          onComplete={() => setShowWhoami(false)}
        />
      )}

      {/* 账号面板 */}
      {showAccountPanel && (
        <AccountPanel
          authManager={authManager}
          onClose={() => setShowAccountPanel(false)}
          onLogout={async () => {
            try {
              await authManager.logout();
              setAuthUsername(null);
              setShowAccountPanel(false);
              addSystemMessage('✓ 已退出登录');
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              addSystemMessage(`退出登录失败: ${errMsg}`);
              setShowAccountPanel(false);
            }
          }}
          onSwitchAccount={() => {
            setShowAccountPanel(false);
            authManager.logout().catch(() => {});
            setAuthUsername(null);
            setPendingLogin({
              resolve: (result) => {
                if (result.success) {
                  setAuthUsername(authManager.getCachedUsername());
                  setAuthReady(true);
                }
              },
            });
          }}
        />
      )}

      {/* 会话管理面板 */}
      {showSessionPanel && onSessionList && onSessionResume && (
        <SessionPanel
          onList={onSessionList}
          onResume={async (id) => {
            const result = await onSessionResume(id);
            // 同步 UI 状态
            if (result.usage) {
              usageRef.current = { input: result.usage.input, output: result.usage.output };
              setUsage(usageRef.current);
              setCost(result.usage.cost);
            }
            // 恢复历史消息到聊天框
            if (result.historyMessages && result.historyMessages.length > 0) {
              const historyMsgs: ChatMessage[] = result.historyMessages.map((m) => ({
                id: ++msgIdRef.current,
                role: m.role as 'user' | 'assistant' | 'system',
                content: m.content,
                timestamp: m.timestamp,
              }));
              setMessages((prev) => [...prev, ...historyMsgs]);
            }
            setShowSessionPanel(false);
            return result.messageCount;
          }}
          onSave={onSessionSave ? async (name?: string) => {
            // 将当前 UI 消息转换为 historyMessages（过滤掉工具消息）
            const historyMessages = messages
              .filter(msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')
              .map(msg => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                timestamp: msg.timestamp,
              }));
            return onSessionSave(name, historyMessages);
          } : undefined}
          onDelete={onSessionDelete}
          onClose={() => setShowSessionPanel(false)}
        />
      )}

      {/* 快捷操作面板 */}
      {showQuickActions && (
        <QuickActions
          actions={(() => {
            const actions: QuickAction[] = [
              // 会话管理组
              { key: 'R', label: '恢复会话', description: '浏览和恢复历史会话', group: '会话', action: () => { setShowQuickActions(false); setShowSessionPanel(true); } },
              { key: 'S', label: '保存会话', description: '保存当前对话', group: '会话', action: () => { setShowQuickActions(false); onSessionSave?.(); addSystemMessage('会话已保存'); }, disabled: !onSessionSave },
              { key: 'K', label: '创建检查点', description: '为当前对话创建快照', group: '会话', action: () => { setShowQuickActions(false); onCheckpointCreate?.().then(id => addSystemMessage(`检查点已创建 (${id.slice(0, 8)}...)`)); }, disabled: !onCheckpointCreate },
              // 系统组
              { key: 'A', label: '账号信息', description: '查看账号和余额', group: '系统', action: () => { setShowQuickActions(false); setShowAccountPanel(true); } },
              { key: 'E', label: '设置', description: '模型、主题、语言配置', group: '系统', action: () => { setShowQuickActions(false); setMode('settings'); } },
              { key: 'L', label: '日志', description: '查看系统日志', group: '系统', action: () => { setShowQuickActions(false); setMode('logs'); } },
              { key: 'B', label: '机器人', description: '管理 IM 机器人', group: '系统', action: () => { setShowQuickActions(false); setMode('bots'); } },
              // 对话组
              { key: 'C', label: '压缩上下文', description: '压缩对话减少 Token', group: '对话', action: () => { setShowQuickActions(false); agentLoop.compact().then(r => { if (r) addSystemMessage(`已压缩: ${r.originalTokens} → ${r.compressedTokens} tokens`); }); } },
              { key: 'P', label: 'Plan 模式', description: '切换只读规划模式', group: '对话', action: () => { setShowQuickActions(false); if (planModeActive) { onPlanModeExit?.(); setPlanModeActive(false); addSystemMessage('已退出 Plan Mode'); } else { onPlanModeEnter?.(); setPlanModeActive(true); addSystemMessage('已进入 Plan Mode'); } } },
            ];
            return actions;
          })()}
          onClose={() => setShowQuickActions(false)}
        />
      )}

      {/* 流式文本实时展示（streaming/tool 状态，idle 时已归档到 Static） */}
      {/* 在 pending 对话框（权限确认/计划审查/用户提问）时隐藏，避免信息冗余 */}
      {renderedStreamLines && status !== 'idle' && !pendingPermission && !pendingPlanReview && !pendingUserQuestion && (
        <Box marginLeft={2} flexDirection="column">
          {renderedStreamLines.map((line, i) => (
            <Box key={i}>
              <Text>{line}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* 缓冲模式：流式输出过长，显示 Spinner + 行数进度 */}
      {streamProgress > 0 && status !== 'idle' && (
        <Box marginLeft={2}>
          <Spinner label={t('cli.stream_buffered', { lines: String(streamProgress) })} />
        </Box>
      )}

      {/* 本轮统计信息（总耗时 + Token） */}
      {turnStats && status === 'idle' && (
        <Box>
          <Text color="gray" dimColor>{turnStats}</Text>
        </Box>
      )}

      {/* 导航模式：在动态区域渲染选中工具的详情 */}
      {/* Static 不支持重渲染，所以导航交互必须在动态区域完成 */}
      {isNavigating && (() => {
        const selectedMsg = toolMessages[selectedToolIndex];
        if (!selectedMsg) return null;
        return (
          <Box flexDirection="column" marginTop={1}>
            {/* 导航位置指示 */}
            <Box>
              <Text color="#FBBF24" bold>📍 工具导航 </Text>
              <Text color="#FBBF24">[{selectedToolIndex + 1}/{toolMessages.length}]</Text>
              <Text color="gray" dimColor> — ↑↓ 切换 · Enter 展开/折叠 · q 退出</Text>
            </Box>
            {/* 当前选中工具的渲染（可交互） */}
            {selectedMsg.role === 'tool' && selectedMsg.toolName && (
              <CollapsibleToolResult
                name={selectedMsg.toolName}
                input={selectedMsg.toolInput ?? {}}
                result={selectedMsg.content}
                isError={selectedMsg.toolIsError ?? false}
                duration={selectedMsg.toolDuration ?? 0}
                index={selectedToolIndex}
                expanded={expandedToolIds.has(selectedMsg.id)}
                isSelected={true}
                onToggleExpand={() => {
                  setExpandedToolIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(selectedMsg.id)) {
                      next.delete(selectedMsg.id);
                    } else {
                      next.add(selectedMsg.id);
                    }
                    return next;
                  });
                }}
                parallel={selectedMsg.toolParallel}
              />
            )}
            {selectedMsg.role === 'tool_group' && selectedMsg.toolGroupItems && (() => {
              const tools = selectedMsg.toolGroupItems.map(item => ({
                ...item,
                completed: true,
              }));
              return (
                <ParallelToolGroupCompact
                  tools={tools}
                  isSelected={true}
                  expanded={expandedToolIds.has(selectedMsg.id)}
                  onToggleExpand={() => {
                    setExpandedToolIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(selectedMsg.id)) {
                        next.delete(selectedMsg.id);
                      } else {
                        next.add(selectedMsg.id);
                      }
                      return next;
                    });
                  }}
                />
              );
            })()}
          </Box>
        );
      })()}

      {/* 非导航模式且有工具时，提示可进入导航 */}
      {!isNavigating && status === 'idle' && toolMessages.length > 0 && (
        <Box>
          <Text color="gray" dimColor>
            {t('cli.tool_nav_enter')}
          </Text>
        </Box>
      )}

      {/* 状态栏 - 始终显示在输入框上方（交互对话框时隐藏）*/}
      {!hasInteractiveUI && (usage.input > 0 || usage.output > 0) && (
        <StatusBar model={model} usage={usage} cost={cost} username={authUsername} isPlanMode={planModeActive} />
      )}

      {/* 输入框 — 面板显示时禁用，交互对话框激活时隐藏渲染输出（减少动态区域行数，避免 Ink 重绘闪烁） */}
      <InputHandler
        onSubmit={handleSubmit}
        isActive={authReady && !isNavigating && !showQuickActions && !showSessionPanel && !showAccountPanel && !pendingPermission && !pendingPlanReview && !pendingUserQuestion}
        interruptMode={status !== 'idle'}
        onQuickAction={() => setShowQuickActions(true)}
        hidden={hasInteractiveUI}
      />
    </Box>
  );
}
