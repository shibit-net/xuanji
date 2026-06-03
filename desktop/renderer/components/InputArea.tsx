// ============================================================
// InputArea - 输入区组件
// ============================================================
//
// 发送策略：前端统一走 sendMessage，后端 ChatSession.handleUserInput()
// 基于权威同步状态（StateTracker）决定路由：
//   idle/waiting_async → 直接执行
//   executing         → 中断当前 + 入队 + 排空队列
//   outputting        → 追加到队列，等当前 run 结束后消费
//
// 纯停止（无输入时按停止按钮）→ agentInterrupt() → agentLoop.stop()
//
// @ Agent 选择器：输入 "@" 触发 agent 下拉菜单，选择后以 chip 展示。
// 默认 xuanji（不显示 chip），选择其他 agent 时显示 chip。
// 意图分析开关仅影响意图分析执行，不影响 agent 选择。
// ============================================================

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Send, StopCircle, Archive, Brain, Loader2, X, FileText, Search, AlertTriangle, Clock } from 'lucide-react';
import type { FileAttachment } from '../global';
import { useAsyncTaskStore } from '../stores/AsyncTaskStore';
import { useMessageStore, generateMessageId } from '../stores/messageStore';
import { useSessionStore } from '../stores/sessionStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { t } from '@/core/i18n';

import { useToast } from './Toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useFileAttachments, MAX_FILE_COUNT } from '../hooks/useFileAttachments';

interface AgentListItem {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  color?: string;
  category?: string;
  metadata?: { category?: string };
}

interface SelectedAgent {
  id: string;
  name: string;
}

const DEFAULT_AGENT: SelectedAgent = { id: 'xuanji', name: 'xuanji' };

// 模块级变量：页面切换时保存/恢复输入状态
let savedInput = '';
let savedAttachments: FileAttachment[] = [];
let savedAgent: SelectedAgent | null = null;

interface InputAreaProps {
  /** 对话类型：本地直接对话 或 远端平台转发 */
  conversationType?: 'local' | 'remote';
  /** 远端会话的 sessionKey（仅 remote 时有效） */
  sessionKey?: string;
}

function InputArea({ conversationType = 'local', sessionKey }: InputAreaProps) {
  const isRemote = conversationType === 'remote';
  const [input, setInput] = useState(savedInput);
  const [isComposing, setIsComposing] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [contextUsage, setContextUsage = useState<{ estimatedTokens: number; maxInputTokens: number; usagePercent: number; messageCount: number } | null>(null);
  const [memoryStatus, setMemoryStatus] = useState<{ isExtracting: boolean; isCompressing: boolean }>({ isExtracting: false, isCompressing: false });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── @ Agent 选择器状态 ─────────────────────────────
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(savedAgent); // null = 默认 xuanji
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [agentList, setAgentList] = useState<AgentListItem[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const atTriggerPosRef = useRef<number>(-1); // "@" 在 input 中的位置

  const toast = useToast();

  // 防重入 ref：替代依赖 state 的 isSending 检查，避免 React 批处理下的双重发送
  const sendingRef = useRef(false);

  // 页面切换时保存/恢复输入状态
  const inputRef = useRef(input);
  inputRef.current = input;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const selectedAgentRef = useRef(selectedAgent);
  selectedAgentRef.current = selectedAgent;
  useEffect(() => {
    // 挂载时已通过 useState 初始值恢复
    // 卸载时保存当前状态到模块级变量
    return () => {
      savedInput = inputRef.current;
      savedAttachments = attachmentsRef.current;
      savedAgent = selectedAgentRef.current;
    };
  }, []);

  // ─── 状态判定：仅跟随前台 Agent 状态（单向数据流） ──
  //
  // isRunning = 前台 agent 自身活跃
  //           ∨ 有活跃子 agent（异步 task / team member）
  //           ∨ 有排队消息待消费
  //
  // 不再依赖 ConversationStore.conversationState，消除双 Store 竞态。
  const isRunning = useAgentStateMachine((s) => {
    const id = s.foregroundAgentId;
    if (!id) return false;
    const agent = s.agentMap[id];
    if (!agent || agent.executionMode === 'acp') return false;

    // 终态 → 真正空闲
    if (['success', 'failed', 'cancelled', 'cleared'].includes(agent.status)) return false;

    // 活跃态 → 运行中
    if (['thinking', 'executing', 'writing', 'reporting'].includes(agent.status)) return true;

    // pending：可能是等待子 agent / 排队消息，也可能是刚创建尚未启动
    if (agent.status === 'pending') {
      // 有排队消息 → 即将消费，视为运行中
      if (s.queuedMessageCount > 0) return true;
      // 有活跃子 agent（异步 task / team member）→ 等待中
      for (const [_childId, child] of Object.entries(s.agentMap)) {
        if (
          child.parentId === id &&
          !['success', 'failed', 'cancelled', 'cleared'].includes(child.status)
        ) {
          return true;
        }
      }
      // 无子 agent 且无排队 → 刚创建尚未启动，空闲
      return false;
    }

    return false;
  });

  const isIdle = !isRunning;

  // 从 agent status 派生 UI 细节提示
  const foregroundStatus = useAgentStateMachine((s) => {
    const id = s.foregroundAgentId;
    if (!id) return null;
    return s.agentMap[id]?.status ?? null;
  });
  const isOutputting = foregroundStatus === 'writing' || foregroundStatus === 'reporting';
  // isSending 统一由 handleSubmit 的 finally 块清退，不再依赖 convState

  // 前台 agent 从空闲变活跃 → 后端已开始处理消息，清退 isSending 恢复输入框
  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    if (!prevIsRunningRef.current && isRunning && isSending) {
      setIsSending(false);
      sendingRef.current = false;
    }
    prevIsRunningRef.current = isRunning;
  }, [isRunning, isSending]);

  // ─── Session 状态 ──────────────────────────────────────
  const sessionStatus = useSessionStore((s) => s.initStatus);
  const sessionError = useSessionStore((s) => s.initError);
  const isSessionReady = sessionStatus === 'ready';

  // ─── 加载 Agent 列表 ──────────────────────────────────
  useEffect(() => {
    let active = true;
    const loadAgents = async () => {
      try {
        const res = await window.electron.agentList();
        if (active && res.success && res.agents) {
          // 只显示启用的自定义和应用 agent
          const filtered = (res.agents as AgentListItem[]).filter(
            (a) => a.id !== 'xuanji' && a.enabled !== false && (a.metadata?.category === 'custom' || a.metadata?.category === 'app')
          );
          setAgentList(filtered);
        }
      } catch {
        // 忽略加载失败
      }
    };
    loadAgents();
    return () => { active = false; };
  }, [isSessionReady]);

  // ─── 点击外部关闭选择器 ──────────────────────────────
  useEffect(() => {
    if (!showAgentPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
        setAgentSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAgentPicker]);

  // ─── 键盘导航时滚动跟随 ──────────────────────────────
  useEffect(() => {
    if (!showAgentPicker || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-agent-item]');
    const highlighted = items[highlightIndex] as HTMLElement | undefined;
    if (highlighted) {
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex, showAgentPicker]);

  // ─── 过滤后的 agent 列表 ──────────────────────────────
  const filteredAgents = agentSearchQuery
    ? agentList.filter(
        (a) =>
          a.name.toLowerCase().includes(agentSearchQuery.toLowerCase()) ||
          a.id.toLowerCase().includes(agentSearchQuery.toLowerCase()) ||
          (a.description || '').toLowerCase().includes(agentSearchQuery.toLowerCase())
      )
    : agentList;

  // ─── 选择 Agent ──────────────────────────────────────
  const selectAgent = useCallback((agent: AgentListItem) => {
    setSelectedAgent({ id: agent.id, name: agent.name });
    setShowAgentPicker(false);
    setAgentSearchQuery('');

    // 移除 input 中的 "@" 及后续搜索文字
    const pos = atTriggerPosRef.current;
    if (pos >= 0) {
      setInput((prev) => {
        // 找到 "@" 之后下一个空格或结尾的位置
        const afterAt = prev.substring(pos);
        const spaceIdx = afterAt.indexOf(' ');
        const endPos = spaceIdx === -1 ? prev.length : pos + spaceIdx;
        return prev.substring(0, pos) + prev.substring(endPos);
      });
    }
    atTriggerPosRef.current = -1;
    textareaRef.current?.focus();
  }, []);

  // ─── 取消选择 ──────────────────────────────────────
  const clearSelectedAgent = useCallback(() => {
    setSelectedAgent(null); // 恢复默认 xuanji
  }, []);

  // ─── 处理输入变化 + @ 检测 ─────────────────────────
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInput(newValue);

    // IME 组合输入期间不触发 @ 检测
    if (isComposing) return;

    // 检测 @ 触发：查找最近的 @ 位置
    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = newValue.substring(0, cursorPos);

    // 找到光标前最近的 @ 字符（前面是空格、开头或换行）
    const atMatch = textBeforeCursor.match(/(?:^|[\s\n])@([^\s]*)$/);

    if (atMatch) {
      const atPos = cursorPos - atMatch[1].length - 1;
      atTriggerPosRef.current = atPos;
      setAgentSearchQuery(atMatch[1] || '');
      setShowAgentPicker(true);
      setHighlightIndex(0);
    } else {
      // 没有匹配的 @ → 关闭选择器
      if (showAgentPicker) {
        setShowAgentPicker(false);
        setAgentSearchQuery('');
        atTriggerPosRef.current = -1;
      }
    }
  }, [isComposing, showAgentPicker]);

  // ─── 键盘事件 ───────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // @ 选择器键盘导航
    if (showAgentPicker && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((prev) => (prev + 1) % filteredAgents.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((prev) => (prev - 1 + filteredAgents.length) % filteredAgents.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        selectAgent(filteredAgents[highlightIndex]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAgentPicker(false);
        setAgentSearchQuery('');
        atTriggerPosRef.current = -1;
        return;
      }
    }

    // 发送
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setInput('');
      textareaRef.current?.blur();
    }
    // Backspace：输入框为空且有选中 agent → 取消选择
    if (e.key === 'Backspace' && input === '' && selectedAgent) {
      e.preventDefault();
      clearSelectedAgent();
    }
  }, [showAgentPicker, filteredAgents, highlightIndex, selectAgent, isComposing, input, selectedAgent, clearSelectedAgent]);

  // ─── 自动调整 textarea 高度 ─────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      const baseScroll = textareaRef.current.scrollHeight;
      if (baseScroll <= 44) {
        textareaRef.current.style.height = '44px';
      } else {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
      }
    }
  }, [input]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
  }, []);

  // ─── 上下文字使用率轮询 ─────────────────────────────
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (!active || !isSessionReady) return;
      try {
        const res = await window.electron.contextStatus();
        if (active && res.success && res.data) {
          setContextUsage(res.data);
        }
      } catch {
        // 忽略轮询错误
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [isSessionReady]);

  // ─── 记忆状态轮询（提取/压缩竞态标记） ──────────────
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (!active || !isSessionReady) return;
      try {
        const res = await window.electron.memoryStatus();
        if (active && res.success) {
          setMemoryStatus({
            isExtracting: res.isExtracting ?? false,
            isCompressing: res.isCompressing ?? false,
          });
        }
      } catch {
        // 忽略轮询错误
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [isSessionReady]);

  // ─── 发送入口 ───────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const hasText = input.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    if ((!hasText && !hasAttachments) || sendingRef.current) return;

    // Session 未就绪时的 UX 反馈
    if (!isSessionReady) {
      const store = useSessionStore.getState();
      if (store.initStatus === 'uninitialized' || store.initStatus === 'failed') {
        store.triggerInit();
        toast.info(t('input.connect_service'));
      } else if (store.initStatus === 'initializing') {
        toast.info(t('input.initializing_service'));
      }
      return;
    }

    const content = input.trim();
    const currentAttachments = [...attachments];
    // 获取当前选中的 agent（默认 xuanji）
    const agentId = selectedAgent?.id || DEFAULT_AGENT.id;

    // 分离图片、音频、视频和非媒体附件
    const imageAttachments = currentAttachments.filter(a => a.mimeType?.startsWith('image/'));
    const audioAttachments = currentAttachments.filter(a => a.mimeType?.startsWith('audio/'));
    const videoAttachments = currentAttachments.filter(a => a.mimeType?.startsWith('video/'));
    const fileAttachments = currentAttachments.filter(a => !a.mimeType || (!a.mimeType.startsWith('image/') && !a.mimeType.startsWith('audio/') && !a.mimeType.startsWith('video/')));
    const imageBlocks = imageAttachments.length > 0
      ? imageAttachments.map(a => ({ data: a.content, mimeType: a.mimeType!, name: a.name }))
      : undefined;
    const audioBlocks = audioAttachments.length > 0
      ? audioAttachments.map(a => ({ data: a.content, mimeType: a.mimeType!, name: a.name }))
      : undefined;
    const videoBlocks = videoAttachments.length > 0
      ? videoAttachments.map(a => ({ data: a.content, mimeType: a.mimeType!, name: a.name }))
      : undefined;

    setInput('');
    setAttachments([]);
    setIsSending(true);
    sendingRef.current = true;

    // 立即渲染用户消息气泡
    useMessageStore.getState().addMessage({
      id: generateMessageId('user'),
      role: 'user',
      content,
      timestamp: Date.now(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    });

    try {
      if (isRemote && sessionKey) {
        await window.electron.platformSendReply({ sessionKey, text: content });
      } else {
        await window.electron.agentUserAction({
          type: 'SEND_MESSAGE',
          message: content,
          attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
          imageBlocks,
          audioBlocks,
          videoBlocks,
          agentId,
        });
      }
    } finally {
      setIsSending(false);
      sendingRef.current = false;
    }
  }, [input, isSessionReady, toast, attachments, selectedAgent, isRemote, sessionKey]);

  // ─── 纯停止（无输入时） ────────────────────────────
  const handleStop = useCallback(() => {
    window.electron.agentUserAction({ type: 'INTERRUPT' });
  }, []);

  // ─── 文件附件 ───────────────────────────────────────
  const {
    attachments,
    setAttachments,
    removeAttachment,
    isDragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
  } = useFileAttachments(savedAttachments, { toast });

  // ─── 工具栏 ─────────────────────────────────────────
  const autoCompressing = memoryStatus.isCompressing && !isCompacting;
  const autoExtracting = memoryStatus.isExtracting && !isFlushing;

  const handleCompact = useCallback(async () => {
    if (isCompacting || isRunning || memoryStatus.isCompressing) return;
    setIsCompacting(true);
    try {
      const result = await window.electron.compact({});
      if (result.success && result.result) {
        const ratio = (result.result.compressionRatio * 100).toFixed(1);
        toast.success(
          t('input.compact_done', { original: result.result.originalTokens, compressed: result.result.compressedTokens, ratio })
        );
        try {
          const status = await window.electron.contextStatus();
          if (status.success && status.data) setContextUsage(status.data);
        } catch { /* ignore */ }
      } else if (result.success) {
        toast.success(t('input.compact_skip'));
      } else {
        toast.error(t('input.compact_failed', { error: result.error }));
      }
    } catch (error) {
      toast.error(t('input.compact_failed', { error: error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, isRunning, memoryStatus.isCompressing, toast]);

  const handleMemoryFlush = useCallback(async () => {
    if (isFlushing || isRunning || memoryStatus.isExtracting) return;
    setIsFlushing(true);
    try {
      const result = await window.electron.manualMemoryFlush();
      if (result.success && result.result) {
        const { entityCount, relationCount, factCount, eventCount } = result.result;
        const total = entityCount + relationCount + factCount + eventCount;
        if (total > 0) {
          const parts = [];
          if (entityCount > 0) parts.push(t('input.memory_entity_count', { count: entityCount }));
          if (relationCount > 0) parts.push(t('input.memory_relation_count', { count: relationCount }));
          if (factCount > 0) parts.push(t('input.memory_fact_count', { count: factCount }));
          if (eventCount > 0) parts.push(t('input.memory_event_count', { count: eventCount }));
          toast.success(t('input.memory_flush_done', { parts: parts.join(t('input.bg_task_separator')) }));
        } else {
          toast.success(t('input.memory_flush_empty'));
        }
      } else {
        toast.error(t('input.memory_flush_failed', { error: result.error }));
      }
    } catch (error) {
      toast.error(t('input.memory_flush_failed', { error: error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      setIsFlushing(false);
    }
  }, [isFlushing, isRunning, memoryStatus.isExtracting, toast]);

  // ─── 后台任务追踪 ──────────────────────────────────
  const runningTaskCount = useAsyncTaskStore((s) => {
    let count = 0;
    for (const t of Object.values(s.tasks)) {
      if (t.lifecycle === 'cleared') continue;
      if (t.taskType === 'task') {
        if (t.lifecycle === 'creating' || t.lifecycle === 'running') count++;
      } else {
        if (t.members.some(m => m.lifecycle === 'creating' || m.lifecycle === 'running')) count++;
      }
    }
    return count;
  });
  const completedTaskCount = useAsyncTaskStore((s) => {
    let count = 0;
    for (const t of Object.values(s.tasks)) {
      if (t.lifecycle === 'cleared') continue;
      if (t.taskType === 'task') {
        if (t.lifecycle === 'completed' || t.lifecycle === 'cancelled') count++;
      } else {
        if (t.members.length > 0 && t.members.every(m => m.lifecycle === 'completed' || m.lifecycle === 'cancelled')) count++;
      }
    }
    return count;
  });
  const cancelledTaskCount = useAsyncTaskStore((s) => s.getCancelledCount());
  const hasBackgroundTasks = runningTaskCount > 0 || completedTaskCount > 0;

  // ─── 文案 ───────────────────────────────────────────
  const placeholder = isSending
    ? t('input.sending')
    : !isSessionReady
    ? sessionStatus === 'initializing' ? t('input.session_initializing')
      : sessionStatus === 'failed' ? t('input.service_unavailable', { error: sessionError || t('input.retry_hint') })
      : t('input.connecting_service')
    : foregroundStatus === 'writing' || foregroundStatus === 'reporting'
    ? t('input.waiting_queue_text')
    : foregroundStatus === 'executing'
    ? t('input.waiting_queue_tool')
    : foregroundStatus === 'thinking'
    ? t('input.waiting_interrupt')
    : foregroundStatus === 'pending' && isRunning
    ? t('input.waiting_direct')
    : runningTaskCount > 0
    ? t('input.waiting_background')
    : cancelledTaskCount > 0
    ? t('input.waiting_cancelled')
    : t('input.waiting_default');

  const isSendDisabled = (!input.trim() && attachments.length === 0) || isSending || (!isRemote && !isSessionReady);

  // 当前实际使用的 agent（用户选择或默认）
  const effectiveAgentId = selectedAgent?.id || DEFAULT_AGENT.id;
  const effectiveAgentName = selectedAgent?.name || DEFAULT_AGENT.name;

  return (
    <div
      className={`flex-shrink-0 border-t bg-muted/50 transition-colors ${
        isDragOver
          ? 'border-blue-400 border-2 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.3)]'
          : 'border-border'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 后台任务提示栏 */}
      {hasBackgroundTasks && (
        <div className={`flex items-center gap-2 px-4 py-1 border-b ${
          runningTaskCount > 0
            ? 'bg-blue-500/10 border-blue-500/20'
            : cancelledTaskCount > 0
              ? 'bg-red-500/10 border-red-500/20'
              : 'bg-green-500/10 border-green-500/20'
        }`}>
          {runningTaskCount > 0 ? (
            <Loader2 size={12} className="animate-spin text-blue-500 flex-shrink-0" />
          ) : cancelledTaskCount > 0 ? (
            <span className="text-xs text-red-400 flex-shrink-0"><AlertTriangle size={12} /></span>
          ) : (
            <span className="text-xs text-green-400 flex-shrink-0"><Clock size={12} /></span>
          )}
          <span className={`text-xs truncate ${
            runningTaskCount > 0 ? 'text-blue-400' : cancelledTaskCount > 0 ? 'text-red-400' : 'text-green-400'
          }`}>
            {(() => {
              const totalRunning = runningTaskCount;
              const totalReporting = completedTaskCount - cancelledTaskCount;
              const totalCancelled = cancelledTaskCount;
              const parts: string[] = [];
              if (totalRunning > 0) parts.push(t('input.task_running', { count: totalRunning }));
              if (totalCancelled > 0) parts.push(t('input.task_cancelled', { count: totalCancelled }));
              if (totalReporting > 0) parts.push(t('input.task_reporting', { count: totalReporting }));
              return parts.join(' · ');
            })()}
          </span>
          <span className={`text-xs ml-auto flex-shrink-0 ${
            runningTaskCount > 0 ? 'text-blue-400' : cancelledTaskCount > 0 ? 'text-red-400' : 'text-green-400'
          }`}>
            {isOutputting ? t('input.task_hint_outputting') : runningTaskCount > 0 ? t('input.task_hint_send_new') : cancelledTaskCount > 0 ? t('input.task_hint_cancelled') : t('input.task_hint_waiting')}
          </span>
        </div>
      )}

      {/* 工具栏 — 仅本地对话 */}
      {!isRemote && (
      <div className="flex items-center gap-2 px-4 pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCompact}
          disabled={isCompacting || isRunning || memoryStatus.isCompressing}
          title={contextUsage ? t('input.compact_usage_title', { used: String(contextUsage.estimatedTokens), max: String(contextUsage.maxInputTokens), percent: String(contextUsage.usagePercent) }) : t('input.compact_title')}
        >
          <Archive size={14} className="mr-1" />
          {isCompacting || autoCompressing ? t('input.compacting') : contextUsage ? (
            <span className={contextUsage.usagePercent > 80 ? 'text-red-400' : contextUsage.usagePercent > 50 ? 'text-yellow-400' : ''}>
              {t('input.compact_button', { percent: String(contextUsage.usagePercent) })}
            </span>
          ) : t('input.compact_button_simple')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMemoryFlush}
          disabled={isFlushing || isRunning || memoryStatus.isExtracting}
          title={t('input.memory_title')}
        >
          <Brain size={14} className="mr-1" />
          {isFlushing || autoExtracting ? t('input.extracting') : t('input.memory_extract')}
        </Button>
      </div>
      )}

      {/* 附件 chip 列表 — 仅本地对话 */}
      {!isRemote && attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-1">
          {attachments.map((att, i) => (
            <span
              key={`${att.name}-${i}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-xs text-blue-600"
            >
              <FileText size={12} className="flex-shrink-0" />
              <span className="max-w-[160px] truncate">{att.name}</span>
              <span className="text-blue-400 flex-shrink-0">
                {att.size < 1024
                  ? `${att.size}B`
                  : att.size < 1024 * 1024
                    ? `${(att.size / 1024).toFixed(1)}KB`
                    : `${(att.size / (1024 * 1024)).toFixed(1)}MB`}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="ml-0.5 p-0.5 rounded hover:bg-blue-500/20 transition-colors"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 输入区域 */}
      <div className="flex items-end gap-2 p-4 relative">
        {isDragOver && (
          <div className="absolute inset-2 flex items-center justify-center bg-blue-500/10 rounded-xl border-2 border-dashed border-blue-400 z-10 pointer-events-none">
            <span className="text-blue-400 text-sm">{t('input.drop_hint')}</span>
          </div>
        )}

        <div className="flex-1 relative">
          {/* 选中的 Agent chip — 仅本地对话 */}
          {!isRemote && selectedAgent && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mb-1.5 rounded-md bg-primary/10 border border-primary/20 text-xs text-primary">
              <span className="font-medium">@{effectiveAgentName}</span>
              <button
                type="button"
                onClick={clearSelectedAgent}
                className="ml-0.5 p-0.5 rounded hover:bg-primary/20 transition-colors"
                title={t('input.agent_chip_title')}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {/* 输入框 */}
          <div className="flex items-start gap-2 flex-wrap">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              placeholder={isRemote ? t('platform.panel.readonly_hint') : placeholder}
              disabled={isRemote || isSending}
              className="flex-1 resize-none max-h-[150px]"
              rows={1}
            />
          </div>

          {/* @ Agent 选择器弹出层 */}
          {showAgentPicker && (
            <div
              ref={pickerRef}
              className="absolute bottom-full left-0 mb-2 w-80 max-h-64 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
            >
              {/* 搜索头 */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <Search size={14} className="text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-muted-foreground">
                  {agentSearchQuery ? t('input.agent_search_label', { query: agentSearchQuery }) : t('input.agent_select_label')}
                </span>
              </div>

              {/* Agent 列表 */}
              <div ref={listRef} className="overflow-y-auto max-h-52">
                {filteredAgents.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('input.no_agents')}
                  </div>
                ) : (
                  filteredAgents.map((agent, index) => (
                    <div
                      key={agent.id}
                      data-agent-item
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                        index === highlightIndex
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/50'
                      }`}
                      onClick={() => selectAgent(agent)}
                      onMouseEnter={() => setHighlightIndex(index)}
                    >
                      {/* Avatar */}
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                        {(agent.avatar || agent.name).substring(0, 2)}
                      </span>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{agent.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {agent.description || agent.id}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 底部提示 */}
              {filteredAgents.length > 0 && (
                <div className="px-3 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center gap-3">
                  <span>{t('input.agent_nav_hint')}</span>
                  <span>{t('input.agent_select_hint')}</span>
                  <span>{t('input.agent_close_hint')}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 停止 / 发送按钮：远端模式隐藏 */}
        {!isRemote && (
          !input.trim() && attachments.length === 0 && !isSending &&
          (foregroundStatus === 'thinking' || foregroundStatus === 'executing' || foregroundStatus === 'writing' || foregroundStatus === 'reporting') ? (
          <Button
            variant="destructive"
            onClick={handleStop}
          >
            <StopCircle size={16} className="mr-1" />
            {t('input.send_button_stop')}
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={isSendDisabled}
          >
            {isSending ? (
              <Loader2 size={16} className="animate-spin mr-1" />
            ) : (
              <Send size={16} className="mr-1" />
            )}
            {isSending
              ? t('input.sending')
              : foregroundStatus === 'thinking'
                ? t('input.send_button_interrupt')
                : isRunning
                  ? t('input.send_button_queue')
                  : t('input.send_button')}
          </Button>
        ))}
      </div>

      {/* 底部提示 */}
      <div className="px-4 pb-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 flex-wrap">
          {isRemote ? (
            <span>{t('input.hint_remote')}</span>
          ) : (
            <span>{t('input.hint_local')}</span>
          )}
          {!isRemote && effectiveAgentId !== 'xuanji' && (
            <span className="text-primary">{t('input.agent_hint', { name: effectiveAgentName })}</span>
          )}
        </div>
        {foregroundStatus === 'writing' || foregroundStatus === 'reporting' ? (
          <span className="ml-2 text-blue-500">{t('input.status_outputting')}</span>
        ) : foregroundStatus === 'executing' ? (
          <span className="ml-2 text-red-500">{t('input.status_executing')}</span>
        ) : foregroundStatus === 'thinking' ? (
          <span className="ml-2 text-orange-500">{t('input.status_thinking')}</span>
        ) : foregroundStatus === 'pending' && isRunning ? (
          <span className="ml-2 text-yellow-500">{t('input.status_waiting')}</span>
        ) : null}
        {isIdle && runningTaskCount > 0 && (
          <span className="ml-2 text-blue-500">{t('input.status_bg_tasks', { count: runningTaskCount })}</span>
        )}
        {isIdle && runningTaskCount === 0 && cancelledTaskCount > 0 && (
          <span className="ml-2 text-red-400">{t('input.status_tasks_cancelled', { count: cancelledTaskCount })}</span>
        )}
        {isIdle && runningTaskCount === 0 && completedTaskCount > 0 && cancelledTaskCount === 0 && (
          <span className="ml-2 text-green-500">{t('input.status_tasks_reporting', { count: completedTaskCount - cancelledTaskCount })}</span>
        )}
        {isIdle && runningTaskCount === 0 && completedTaskCount > 0 && cancelledTaskCount > 0 && (
          <span className="ml-2 text-green-500">{t('input.status_tasks_pending', { count: completedTaskCount - cancelledTaskCount })}</span>
        )}
      </div>
    </div>
  );
}

export default memo(InputArea);
