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
import { InputHandler } from './InputHandler';
import { Spinner } from './Spinner';
import { CollapsibleToolResult, formatToolCommand, formatToolName } from './CollapsibleToolResult';
import { StatusBar } from './StatusBar';
import { SettingsMode } from './settings/SettingsMode';
import { LogsMode } from './LogsMode';
import { BotsMode } from './BotsMode';
import { ConfigManager } from './utils/ConfigManager';
import { LogSystem } from './utils/LogSystem';
import { BotManager } from './utils/BotManager';
import { getTheme } from './Theme';
import { ProjectConfigWriter } from '@/core/config';
import type { ChatMessage, ToolResultDisplay, AppMode } from './types';
import type { PermissionRequest, GuardCheckResult, UserConfirmation, ConfirmationHandler, PlanReviewResult, PlanReviewHandler } from '@/permission/types';
import { PermissionPrompt } from '@/permission/ui/PermissionPrompt';
import { PlanReview } from '@/permission/ui/PlanReview';
import { UsageStatsRecorder } from '@/core/telemetry';
import { formatUsageStats } from './utils/FormatStats';

// ============================================================
// App 组件属性
// ============================================================

export interface AppProps {
  agentLoop: {
    run: (input: string) => Promise<void>;
    stop: () => void;
    reset: () => void;
    getState: () => AgentState;
    on: (callbacks: AgentCallbacks) => void;
    compact: () => { originalTokens: number; compressedTokens: number; compressionRatio: number } | null;
  };
  model: string;
  /** 权限确认处理器注册回调 (由 ChatSession 提供) */
  onPermissionSetup?: (handler: ConfirmationHandler) => void;
  /** 计划审查处理器注册回调 (由 ChatSession 提供) */
  onPlanReviewSetup?: (handler: PlanReviewHandler) => void;
  /** 模型切换回调 (返回新模型名) */
  onModelChange?: (model: string) => Promise<string>;
  /** 记忆查询回调 (返回格式化的记忆条目) */
  onMemoryQuery?: (query?: string) => Promise<string>;
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

const STREAM_BUFFER_THRESHOLD = 50;

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
// 工具状态 Reducer (批量状态更新优化)
// ============================================================
// 将 status、activeTools 合并到单个 reducer，
// 确保 onToolStart/onToolEnd 等回调中的多个状态变化只触发一次渲染

interface ToolStateShape {
  status: 'idle' | 'thinking' | 'tool';
  activeTools: Map<string, { name: string; input: Record<string, unknown>; receivedBytes?: number; parallel?: boolean }>;
  toolResults: ToolResultDisplay[];
  /** 当前并行组的工具 ID 集合（用于 UI 分组展示） */
  parallelIds: Set<string>;
}

type ToolAction =
  | { type: 'SET_THINKING' }
  | { type: 'TOOL_START'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'TOOL_DELTA'; id: string; receivedBytes: number }
  | { type: 'TOOL_END'; id: string; toolResult: ToolResultDisplay }
  | { type: 'TOOL_REMOVE'; id: string }
  | { type: 'TOOL_GROUPED'; parallelIds: string[] }
  | { type: 'RESET_IDLE' }
  | { type: 'CLEAR_ALL' }
  | { type: 'CLEAR_RESULTS' }
  | { type: 'START_TURN' };

const INITIAL_TOOL_STATE: ToolStateShape = {
  status: 'idle',
  activeTools: new Map(),
  toolResults: [],
  parallelIds: new Set(),
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

    case 'TOOL_END': {
      const next = new Map(state.activeTools);
      next.delete(action.id);
      return {
        ...state,
        activeTools: next,
        toolResults: [...state.toolResults, action.toolResult],
      };
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

    case 'RESET_IDLE':
      return { ...state, status: 'idle', activeTools: new Map(), parallelIds: new Set() };

    case 'CLEAR_ALL':
      return { status: 'idle', activeTools: new Map(), toolResults: [], parallelIds: new Set() };

    case 'CLEAR_RESULTS':
      return { ...state, toolResults: [] };

    case 'START_TURN':
      return { ...state, status: 'thinking', toolResults: [], parallelIds: new Set() };
  }
}

// ============================================================
// App 主组件
// ============================================================

export function App({ agentLoop, model, onPermissionSetup, onPlanReviewSetup, onModelChange, onMemoryQuery }: AppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<AppMode>('chat');
  // 使用 useReducer 合并 status/activeTools，避免多次 setState 导致多次渲染
  const [toolState, dispatchTool] = useReducer(toolReducer, INITIAL_TOOL_STATE);
  const { status, activeTools } = toolState;
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
  const msgIdRef = useRef(0);
  const toolInfoRef = useRef<Map<string, {
    startTime: number;
    input: Record<string, unknown>;
  }>>(new Map());

  // 使用 ref 追踪最新的流式文本，避免闭包问题
  const streamTextRef = useRef('');
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

  // 共享工具实例
  const configManager = useMemo(() => new ConfigManager(), []);
  const logSystem = useMemo(() => new LogSystem(), []);
  const botManager = useMemo(() => new BotManager(logSystem), [logSystem]);

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
      } catch (error) {
        // 配置加载失败，使用默认值（英文）
        setLanguage('en');
      }
    };
    init();
  }, [configManager, logSystem]);

  // 注册权限确认处理器
  useEffect(() => {
    if (!onPermissionSetup) return;
    const handler: ConfirmationHandler = async (request, guardResult) => {
      return new Promise<UserConfirmation>((resolve) => {
        setPendingPermission({ request, guardResult, resolve });
      });
    };
    onPermissionSetup(handler);
  }, [onPermissionSetup]);

  // 注册计划审查处理器
  useEffect(() => {
    if (!onPlanReviewSetup) return;
    const handler: PlanReviewHandler = async (plan) => {
      return new Promise<PlanReviewResult>((resolve) => {
        setPendingPlanReview({ plan, resolve });
      });
    };
    onPlanReviewSetup(handler);
  }, [onPlanReviewSetup]);

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

  // Ctrl+C 中断处理逻辑（抽取为函数，供 useInput 和 raw stdin 共用）
  const handleInterrupt = useCallback(() => {
    // 取消所有 pending 的 throttle 更新
    if (streamTextUpdaterRef.current) {
      // flush 而不是 cancel，保留中断前的最新文本
      streamTextUpdaterRef.current.flush();
    }
    // 缓冲模式中断：将已收到的文本放入 Static
    if (streamBufferedRef.current) {
      const fullText = streamTextRef.current;
      if (fullText) {
        const id = ++msgIdRef.current;
        setMessages((prev) => [...prev, {
          id,
          role: 'assistant' as const,
          content: fullText,
          timestamp: Date.now(),
        }]);
      }
      streamTextRef.current = '';
      streamBufferedRef.current = false;
      setStreamText('');
      setStreamProgress(0);
    }
    // 停止 Agent 执行
    agentLoop.stop();
    // flush 缓冲的工具结果消息
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pendingMsgs = pendingToolMsgsRef.current;
    pendingToolMsgsRef.current = [];
    // 切换为 idle（保留 streamText 继续显示）
    dispatchTool({ type: 'RESET_IDLE' });
    toolInfoRef.current.clear();
    turnStartTimeRef.current = 0;
    lastTurnStatsRef.current = null;
    // 退出导航模式
    setIsNavigating(false);
    setSelectedToolIndex(-1);
    // 显示中断提示（合并 pending 工具消息一起 flush）
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, ...pendingMsgs, {
      id,
      role: 'system',
      content: `⏸️  ${t('chat.session_interrupted')}`,
      timestamp: Date.now(),
    }]);
  }, [agentLoop]);

  // 计算仅包含 tool 消息的数组（用于导航）
  const toolMessages = useMemo(
    () => messages.filter((m) => m.role === 'tool'),
    [messages]
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
        streamTextRef.current += text;
        // debounced 更新 state，实时展示流式文本
        streamTextUpdater.update(streamTextRef.current);
      },
      onThinking: (_thinking: string) => {
        // 工具调用后重新进入 thinking：将已有的流式文本归档到 Static
        // 这样 thinking spinner 的 !streamText 条件才能满足
        if (streamTextRef.current) {
          // 先 flush pending 的 throttle 更新，确保拿到最新文本
          streamTextUpdater.flush();

          const fullText = streamTextRef.current;
          const id = ++msgIdRef.current;
          setMessages((prev) => [...prev, {
            id,
            role: 'assistant' as const,
            content: fullText,
            timestamp: Date.now(),
          }]);
          streamTextRef.current = '';
          streamBufferedRef.current = false;
          setStreamText('');
          setStreamProgress(0);
        }
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

        // 缓冲工具结果消息：同一 tick 内多个 onToolEnd 合并为一次 setMessages
        // 避免大量工具连续完成时频繁触发 Ink <Static> 重渲染 → fullStaticOutput 累积
        // → 每次 stdout.write 写入全部历史内容 → 终端异常/进程终止
        const msgId = ++msgIdRef.current;
        pendingToolMsgsRef.current.push({
          id: msgId,
          role: 'tool',
          content: displayResult,
          toolName: name,
          toolInput: displayInput,
          toolIsError: isError,
          toolDuration: duration,
          toolParallel: isParallel,
          timestamp: Date.now(),
        });

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
        // 注意：不清空工具结果，onToolEnd 已归档到 Static
        toolInfoRef.current.clear();
        turnStartTimeRef.current = 0;  // 重置开始时间
      },
      onEnd: (state: AgentState) => {
        // 刷新所有 pending 的流式文本和 usage
        streamTextUpdater.flush();
        usageUpdater.flush();

        // 计算整体耗时，保存到 ref 供下一轮 handleSubmit 时使用
        const totalDuration = turnStartTimeRef.current > 0
          ? Date.now() - turnStartTimeRef.current
          : 0;

        // 保存本轮统计信息到 ref，延迟到下一轮再搬到 Static
        lastTurnStatsRef.current = {
          tokenUsage: state.tokenUsage,
          totalDuration,
        };

        // 缓冲模式完成：将完整文本一次性放入 Static，跳过非 Static 区域渲染
        if (streamBufferedRef.current) {
          const fullText = streamTextRef.current;
          if (fullText) {
            const id = ++msgIdRef.current;
            setMessages((prev) => [...prev, {
              id,
              role: 'assistant' as const,
              content: fullText,
              timestamp: Date.now(),
            }]);
          }
          streamTextRef.current = '';
          streamBufferedRef.current = false;
          setStreamText('');
          setStreamProgress(0);
        }
        // 非缓冲模式：streamText 保留在非 Static 区域继续显示
        // 工具结果已在 onToolEnd 时逐个归档到 Static
        // 下一轮 handleSubmit 时再统一搬文本到 Static

        dispatchTool({ type: 'RESET_IDLE' });
        setCost(state.cost);
        toolInfoRef.current.clear();
        turnStartTimeRef.current = 0;

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
    const text = streamTextRef.current;
    const stats = lastTurnStatsRef.current;

    // 没有内容则跳过
    if (!text) return;

    const newMessages: ChatMessage[] = [];

    // 1. assistant 文本回复
    if (text) {
      const id = ++msgIdRef.current;
      newMessages.push({
        id,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
      });
    }

    // 2. 统计信息
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

      newMessages.push({
        id,
        role: 'system',
        content: statsMsg,
        timestamp: Date.now(),
      });
    }

    if (newMessages.length > 0) {
      setMessages((prev) => [...prev, ...newMessages]);
    }

    // 清空 ref 和 state
    streamTextRef.current = '';
    streamBufferedRef.current = false;
    lastTurnStatsRef.current = null;
    setStreamText('');
    setStreamProgress(0);
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

  // 提交用户输入
  const handleSubmit = useCallback(async (input: string) => {
    // 斜杠命令
    const cmd = parseSlashCommand(input);
    if (cmd) {
      switch (cmd.name) {
        case '/exit':
        case '/quit':
          await logSystem.info('System', t('cli.exit'));
          exit();
          return;

        case '/clear':
          setMessages([]);
          streamTextRef.current = '';
          lastTurnStatsRef.current = null;
          setStreamText('');
          setTurnStats('');
          dispatchTool({ type: 'CLEAR_ALL' });
          setExpandedToolIds(new Set());
          setIsNavigating(false);
          setSelectedToolIndex(-1);
          return;

        case '/reset':
          agentLoop.reset();
          setMessages([]);
          streamTextRef.current = '';
          lastTurnStatsRef.current = null;
          setStreamText('');
          setTurnStats('');
          dispatchTool({ type: 'CLEAR_ALL' });
          setUsage({ input: 0, output: 0 });
          setCost(0);
          setExpandedToolIds(new Set());
          setIsNavigating(false);
          setSelectedToolIndex(-1);
          addSystemMessage(t('chat.session_reset'));
          await logSystem.info('Chat', t('chat.session_reset'));
          return;

        case '/cost': {
          const state = agentLoop.getState();
          const sessionInfo = `${t('chat.token_label')}: ${state.tokenUsage.input + state.tokenUsage.output}`;

          // 尝试获取历史统计（最近 7 天）
          try {
            const recorder = new UsageStatsRecorder();
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
            const stats = await recorder.aggregate({
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
            });
            const output = formatUsageStats(stats, 7);
            addSystemMessage(`${sessionInfo}\n\n${output}`);
          } catch {
            // 聚合失败时仅显示当前会话 token
            addSystemMessage(sessionInfo);
          }
          return;
        }

        case '/help':
          addSystemMessage([
            t('help.title'),
            t('help.help'),
            t('help.clear'),
            t('help.reset'),
            t('help.cost'),
            t('help.compact'),
            t('help.model'),
            t('help.memory'),
            t('help.settings'),
            t('help.logs'),
            t('help.bots'),
            t('help.lang'),
            t('help.init'),
            t('help.exit'),
            '',
            t('help.shortcuts_title'),
            t('help.shortcut_ctrlc'),
            t('help.shortcut_shift_enter'),
            t('help.shortcut_tab'),
          ].join('\n'));
          return;

        case '/settings':
          setMode('settings');
          await logSystem.info('System', t('settings.enter'));
          return;

        case '/logs':
          setMode('logs');
          return;

        case '/bots':
          setMode('bots');
          await logSystem.info('System', t('bots.enter'));
          return;

        case '/lang':
          await cycleLanguage();
          return;

        case '/init':
          await handleInitCommand();
          return;

        case '/compact': {
          const compactResult = agentLoop.compact();
          if (compactResult) {
            addSystemMessage(t('chat.compact_done', {
              original: String(compactResult.originalTokens),
              compressed: String(compactResult.compressedTokens),
              ratio: String(Math.round(compactResult.compressionRatio * 100)),
            }));
          } else {
            addSystemMessage(t('chat.compact_skip'));
          }
          return;
        }

        case '/model': {
          if (!cmd.args) {
            // 无参数：显示当前模型
            addSystemMessage(t('chat.model_current', { model }));
          } else if (onModelChange) {
            try {
              const newModel = await onModelChange(cmd.args);
              addSystemMessage(t('chat.model_changed', { model: newModel }));
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              addSystemMessage(t('chat.model_change_failed', { error: errMsg }));
            }
          } else {
            addSystemMessage(t('chat.model_current', { model }));
          }
          return;
        }

        case '/memory': {
          if (!onMemoryQuery) {
            addSystemMessage(t('chat.memory_disabled'));
            return;
          }
          try {
            const result = await onMemoryQuery(cmd.args || undefined);
            addSystemMessage(result || t('chat.memory_empty'));
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addSystemMessage(t('chat.memory_error', { error: errMsg }));
          }
          return;
        }

        default:
          addSystemMessage(t('chat.unknown_command', { name: cmd.name }));
          return;
      }
    }

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
    try {
      await agentLoop.run(input);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addSystemMessage(`❌ ${errMsg}`);
      dispatchTool({ type: 'RESET_IDLE' });
      turnStartTimeRef.current = 0;  // 重置开始时间
      await logSystem.error('Chat', errMsg);
    }
  }, [agentLoop, model, exit, addSystemMessage, flushTurnToHistory, cycleLanguage, logSystem, onModelChange, onMemoryQuery]);

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
      {/* 标题栏 */}
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>{t('cli.title')}</Text>
        <Text color={theme.dim}>  {t('cli.help_hint')}</Text>
      </Box>

      {/* 历史消息 (Static 保证滚出屏幕的不重绘) */}
      <Static items={messages}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={msg.role === 'assistant' && !msg.partial ? 1 : 0}>
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
            {msg.role === 'assistant' && (
              <Box marginLeft={2} flexDirection="column">
                {renderMarkdownSimple(msg.content).map((line, i) => (
                  <Box key={i}>
                    <Text>{line}</Text>
                  </Box>
                ))}
              </Box>
            )}
            {msg.role === 'system' && (
              <Box>
                <Text color={theme.dim} italic>{msg.content}</Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* 当前执行的工具：展示工具名 + 指令摘要 + 接收进度 */}
      {(() => {
        const entries = Array.from(activeTools.entries());
        const parallelTools = entries.filter(([, tool]) => tool.parallel);
        const serialTools = entries.filter(([, tool]) => !tool.parallel);
        const hasParallel = parallelTools.length > 0;

        const renderToolSpinner = (id: string, tool: typeof entries[0][1], indent: number) => {
          const displayName = formatToolName(tool.name);
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
            <Box key={id} marginLeft={indent}>
              <Spinner label={label} />
            </Box>
          );
        };

        return (
          <>
            {/* 并行工具组：⚡ 标题 + 缩进展示 */}
            {hasParallel && (
              <Box marginLeft={2}>
                <Text color="cyan" bold>{'⚡ '}</Text>
                <Text color="cyan">{t('cli.parallel_tools', { count: String(parallelTools.length) })}</Text>
              </Box>
            )}
            {parallelTools.map(([id, tool]) => renderToolSpinner(id, tool, hasParallel ? 4 : 2))}
            {/* 串行工具：正常展示 */}
            {serialTools.map(([id, tool]) => renderToolSpinner(id, tool, 2))}
          </>
        );
      })()}

      {/* 思考中（没有工具在执行、还没有流式文本时显示）*/}
      {status === 'thinking' && activeTools.size === 0 && !streamText && !streamProgress && !pendingPermission && !pendingPlanReview && (
        <Spinner label={t('cli.thinking')} />
      )}

      {/* 权限确认对话框 */}
      {pendingPermission && (
        <PermissionPrompt
          request={pendingPermission.request}
          guardResult={pendingPermission.guardResult}
          onConfirm={(confirmation) => {
            pendingPermission.resolve(confirmation);
            setPendingPermission(null);
          }}
        />
      )}

      {/* 计划审查对话框 */}
      {pendingPlanReview && (
        <PlanReview
          plan={pendingPlanReview.plan}
          onDecision={(result) => {
            pendingPlanReview.resolve(result);
            setPendingPlanReview(null);
          }}
        />
      )}

      {/* 正常模式：流式文本实时展示（idle 时保留上一轮内容，下一轮开始时搬到 Static） */}
      {renderedStreamLines && (
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

      {/* 导航模式提示 */}
      {isNavigating && (
        <Box marginTop={1}>
          <Text color="#FBBF24" dimColor>
            {t('cli.tool_nav_mode')} — {t('cli.tool_nav_hint')}
          </Text>
        </Box>
      )}

      {/* 非导航模式且有工具时，提示可进入导航 */}
      {!isNavigating && status === 'idle' && toolMessages.length > 0 && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            {t('cli.tool_nav_enter')}
          </Text>
        </Box>
      )}

      {/* 输入框 */}
      <InputHandler onSubmit={handleSubmit} isActive={status === 'idle' && !isNavigating} />

      {/* 状态栏 - 显示实时 token 消耗（通过 debounce 避免闪烁） */}
      {(usage.input > 0 || usage.output > 0) && (
        <StatusBar model={model} usage={usage} cost={cost} />
      )}
    </Box>
  );
}
