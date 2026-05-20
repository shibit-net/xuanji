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

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, StopCircle, Archive, Brain, Loader2, X, FileText, Search } from 'lucide-react';
import type { FileAttachment } from '../global';
import { useAsyncTaskStore } from '../stores/AsyncTaskStore';
import { useMessageStore, generateMessageId } from '../stores/messageStore';
import { useSessionInitStore } from '../stores/SessionInitStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';

import { useToast } from './Toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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

export default function InputArea() {
  const [input, setInput] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [contextUsage, setContextUsage] = useState<{ estimatedTokens: number; maxInputTokens: number; usagePercent: number; messageCount: number } | null>(null);
  const [memoryStatus, setMemoryStatus] = useState<{ isExtracting: boolean; isCompressing: boolean }>({ isExtracting: false, isCompressing: false });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── @ Agent 选择器状态 ─────────────────────────────
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(null); // null = 默认 xuanji
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
  const isToolExecuting = foregroundStatus === 'executing';
  const isOutputting = foregroundStatus === 'writing' || foregroundStatus === 'reporting' || (foregroundStatus === 'pending' && isRunning);
  // isSending 统一由 handleSubmit 的 finally 块清退，不再依赖 convState

  // ─── Session 状态 ──────────────────────────────────────
  const sessionStatus = useSessionInitStore((s) => s.status);
  const sessionError = useSessionInitStore((s) => s.error);
  const isSessionReady = useSessionInitStore((s) => s.isReady());

  // ─── 加载 Agent 列表 ──────────────────────────────────
  useEffect(() => {
    let active = true;
    const loadAgents = async () => {
      try {
        const res = await window.electron.agentList();
        if (active && res.success && res.agents) {
          // 过滤掉 system 类别（scene-classifier 等）和 xuanji 自身
          const filtered = (res.agents as AgentListItem[]).filter(
            (a) => a.id !== 'xuanji' && a.category !== 'system' && a.metadata?.category !== 'system'
          );
          setAgentList(filtered);
        }
      } catch {
        // 忽略加载失败
      }
    };
    loadAgents();
    return () => { active = false; };
  }, []);

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
      const store = useSessionInitStore.getState();
      if (store.status === 'uninitialized' || store.status === 'failed') {
        store.triggerInit();
        toast.info('正在连接服务，请稍后重试...');
      } else if (store.status === 'initializing') {
        toast.info('服务正在初始化中，请稍候...');
      }
      return;
    }

    const content = input.trim();
    const currentAttachments = [...attachments];
    // 获取当前选中的 agent（默认 xuanji）
    const agentId = selectedAgent?.id || DEFAULT_AGENT.id;

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
      await window.electron.agentUserAction({
        type: 'SEND_MESSAGE',
        message: content,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        agentId,
      });
    } finally {
      setIsSending(false);
      sendingRef.current = false;
    }
  }, [input, isSessionReady, toast, attachments, selectedAgent]);

  // ─── 纯停止（无输入时） ────────────────────────────
  const handleStop = useCallback(() => {
    window.electron.agentUserAction({ type: 'INTERRUPT' });
  }, []);

  // ─── 文件附件工具函数 ─────────────────────────────
  const MAX_TEXT_FILE_SIZE = 1 * 1024 * 1024;
  const MAX_BINARY_FILE_SIZE = 10 * 1024 * 1024;
  const MAX_FILE_COUNT = 10;

  const BINARY_EXTENSIONS = new Set([
    'xlsx', 'xls', 'xlsm', 'xlt', 'xltx', 'xltm',
    'csv', 'tsv',
    'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm',
    'pdf',
    'pptx', 'pptm', 'potx', 'ppsx',
  ]);

  const BINARY_MIME_PATTERNS = [
    'application/vnd.openxmlformats-officedocument',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/pdf',
    'text/csv',
    'text/tab-separated-values',
  ];

  const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'xml',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'env', 'sh', 'bash', 'zsh',
    'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sql',
    'graphql', 'vue', 'svelte', 'log', 'svg', 'properties', 'gradle',
    'kt', 'swift', 'scala', 'r', 'm', 'mm', 'pl', 'php', 'lua', 'vim',
    'gitignore', 'editorconfig', 'dockerfile', 'makefile',
  ]);

  function isBinaryFile(file: File): boolean {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && BINARY_EXTENSIONS.has(ext)) return true;
    if (file.type && BINARY_MIME_PATTERNS.some(p => file.type.startsWith(p))) return true;
    return false;
  }

  function isTextFile(file: File): boolean {
    if (file.type && (
      file.type.startsWith('text/') ||
      file.type === 'application/json' ||
      file.type === 'application/javascript' ||
      file.type === 'application/xml'
    )) return true;
    const ext = file.name.split('.').pop()?.toLowerCase();
    return !!(ext && TEXT_EXTENSIONS.has(ext));
  }

  function isSurpportedFile(file: File): boolean {
    return isTextFile(file) || isBinaryFile(file);
  }

  const addFiles = useCallback(async (files: FileList, filePaths?: string[]) => {
    const newAttachments: FileAttachment[] = [];
    let skippedUnsupported = false;
    let skippedLarge = false;
    let skippedCount = false;

    const remaining = MAX_FILE_COUNT - attachments.length;
    if (remaining <= 0) {
      toast.warning(`最多添加 ${MAX_FILE_COUNT} 个附件`);
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);
    if (files.length > remaining) skippedCount = true;

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i]!;

      if (!isSurpportedFile(file)) {
        skippedUnsupported = true;
        continue;
      }

      const isBinary = isBinaryFile(file);
      const maxSize = isBinary ? MAX_BINARY_FILE_SIZE : MAX_TEXT_FILE_SIZE;

      if (file.size > maxSize) {
        skippedLarge = true;
        continue;
      }

      try {
        const dropPath = filePaths?.[i];

        if (isBinary) {
          if (dropPath) {
            newAttachments.push({
              name: file.name,
              path: dropPath,
              content: '',
              size: file.size,
            });
          } else {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let j = 0; j < bytes.length; j++) {
              binary += String.fromCharCode(bytes[j]);
            }
            newAttachments.push({
              name: file.name,
              content: btoa(binary),
              size: file.size,
            });
          }
        } else {
          const content = await file.text();
          newAttachments.push({
            name: file.name,
            path: dropPath,
            content,
            size: file.size,
          });
        }
      } catch {
        toast.warning(`无法读取文件: ${file.name}`);
      }
    }

    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
    }
    if (skippedUnsupported) toast.warning('已跳过不支持的文件类型');
    if (skippedLarge) toast.warning(`文件过大（文本最大 1MB，二进制最大 10MB）`);
    if (skippedCount) toast.warning(`最多添加 ${MAX_FILE_COUNT} 个附件`);
  }, [attachments.length, toast]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ─── 拖拽文件放入 ────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    let paths: string[] | undefined;
    try {
      const uriList = e.dataTransfer.getData('text/uri-list');
      if (uriList) {
        paths = uriList.split('\n')
          .map(u => u.trim())
          .filter(u => u.startsWith('file://'))
          .map(u => decodeURIComponent(u.slice(7)));
      }
    } catch { /* fallback */ }

    await addFiles(files, paths);
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

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
          `压缩完成：${result.result.originalTokens} → ${result.result.compressedTokens} tokens（压缩 ${ratio}%）`
        );
        try {
          const status = await window.electron.contextStatus();
          if (status.success && status.data) setContextUsage(status.data);
        } catch { /* ignore */ }
      } else if (result.success) {
        toast.success('上下文使用率较低，无需压缩');
      } else {
        toast.error(`压缩失败: ${result.error}`);
      }
    } catch (error) {
      toast.error(`压缩失败: ${error instanceof Error ? error.message : '未知错误'}`);
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
          if (entityCount > 0) parts.push(`${entityCount} 个实体`);
          if (relationCount > 0) parts.push(`${relationCount} 条关系`);
          if (factCount > 0) parts.push(`${factCount} 条事实`);
          if (eventCount > 0) parts.push(`${eventCount} 个事件`);
          toast.success(`记忆提取完成：${parts.join('，')}`);
        } else {
          toast.success('当前上下文中暂无值得提取的记忆');
        }
      } else {
        toast.error(`记忆提取失败: ${result.error}`);
      }
    } catch (error) {
      toast.error(`记忆提取失败: ${error instanceof Error ? error.message : '未知错误'}`);
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
    ? '发送中...'
    : !isSessionReady
    ? sessionStatus === 'initializing' ? '会话初始化中...'
      : sessionStatus === 'failed' ? `服务不可用: ${sessionError || '请点击重试'}`
      : '正在连接服务...'
    : isOutputting
    ? '说点什么... (文本输出中 — 消息将排队)'
    : isToolExecuting
    ? '说点什么... (工具执行中，消息将排队)'
    : isRunning
    ? '说点什么... (工作执行中，消息将自动排队)'
    : runningTaskCount > 0
    ? '说点什么... (后台任务运行中)'
    : cancelledTaskCount > 0
    ? '说点什么... (有任务已取消)'
    : '说点什么... (输入 @ 选择 Agent)';

  const isSendDisabled = (!input.trim() && attachments.length === 0) || isSending || !isSessionReady;

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
            <span className="text-xs text-red-400 flex-shrink-0">🛑</span>
          ) : (
            <span className="text-xs text-green-400 flex-shrink-0">⏳</span>
          )}
          <span className={`text-xs truncate ${
            runningTaskCount > 0 ? 'text-blue-400' : cancelledTaskCount > 0 ? 'text-red-400' : 'text-green-400'
          }`}>
            {(() => {
              const totalRunning = runningTaskCount;
              const totalReporting = completedTaskCount - cancelledTaskCount;
              const totalCancelled = cancelledTaskCount;
              const parts: string[] = [];
              if (totalRunning > 0) parts.push(`${totalRunning} 个任务运行中`);
              if (totalCancelled > 0) parts.push(`${totalCancelled} 个已取消`);
              if (totalReporting > 0) parts.push(`${totalReporting} 个待汇报`);
              return parts.join(' · ');
            })()}
          </span>
          <span className={`text-xs ml-auto flex-shrink-0 ${
            runningTaskCount > 0 ? 'text-blue-400' : cancelledTaskCount > 0 ? 'text-red-400' : 'text-green-400'
          }`}>
            {isOutputting ? '文本输出中...' : runningTaskCount > 0 ? '可直接发送新任务' : cancelledTaskCount > 0 ? '任务已取消' : '等待汇总'}
          </span>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCompact}
          disabled={isCompacting || isRunning || memoryStatus.isCompressing}
          title={contextUsage ? `上下文用量: ${contextUsage.estimatedTokens} / ${contextUsage.maxInputTokens} tokens (${contextUsage.usagePercent}%)` : '压缩历史消息，减少 token 使用'}
        >
          <Archive size={14} className="mr-1" />
          {isCompacting || autoCompressing ? '压缩中...' : contextUsage ? (
            <span className={contextUsage.usagePercent > 80 ? 'text-red-400' : contextUsage.usagePercent > 50 ? 'text-yellow-400' : ''}>
              压缩消息 ({contextUsage.usagePercent}%)
            </span>
          ) : '压缩消息'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMemoryFlush}
          disabled={isFlushing || isRunning || memoryStatus.isExtracting}
          title="从当前对话中提取值得记忆的内容（实体/关系/事实/事件）"
        >
          <Brain size={14} className="mr-1" />
          {isFlushing || autoExtracting ? '提取中...' : '提取记忆'}
        </Button>
      </div>

      {/* 附件 chip 列表 */}
      {attachments.length > 0 && (
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
            <span className="text-blue-400 text-sm">释放以添加文件</span>
          </div>
        )}

        <div className="flex-1 relative">
          {/* Agent chip + 输入框 */}
          <div className="flex items-start gap-2 flex-wrap">
            {/* 选中的 Agent chip（非默认 xuanji 时显示） */}
            {selectedAgent && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-500/10 border border-purple-500/20 text-xs text-purple-600 shrink-0 mt-1.5">
                <span className="font-medium">@{effectiveAgentName}</span>
                <button
                  type="button"
                  onClick={clearSelectedAgent}
                  className="ml-0.5 p-0.5 rounded hover:bg-purple-500/20 transition-colors"
                  title="取消选择，恢复默认 xuanji"
                >
                  <X size={12} />
                </button>
              </span>
            )}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              placeholder={placeholder}
              disabled={isSending}
              className="flex-1 resize-none"
              rows={1}
              style={{ maxHeight: '150px' }}
            />
          </div>

          {/* @ Agent 选择器弹出层 */}
          {showAgentPicker && (
            <div
              ref={pickerRef}
              className="absolute bottom-full left-0 mb-2 w-80 max-h-64 bg-[#1e1e2e] border border-border rounded-lg shadow-lg z-50 overflow-hidden"
            >
              {/* 搜索头 */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <Search size={14} className="text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-muted-foreground">
                  {agentSearchQuery ? `搜索: "${agentSearchQuery}"` : '选择 Agent'}
                </span>
              </div>

              {/* Agent 列表 */}
              <div ref={listRef} className="overflow-y-auto max-h-52">
                {filteredAgents.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    暂无可用 Agent
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
                  <span>↑↓ 导航</span>
                  <span>↵ 选择</span>
                  <span>Esc 关闭</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 停止 / 发送按钮 */}
        {isRunning && !input.trim() && attachments.length === 0 && !isSending ? (
          <Button
            variant="destructive"
            onClick={handleStop}
          >
            <StopCircle size={16} className="mr-1" />
            停止
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
            {isSending ? '发送中...' : isRunning ? '排队发送' : '发送'}
          </Button>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-4 pb-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 flex-wrap">
          <span>Enter 发送 · Shift+Enter 换行 · Esc 清空 · 输入 @ 选择Agent · 拖入/粘贴文件上传</span>
          {effectiveAgentId !== 'xuanji' && (
            <span className="text-purple-400">· Agent: @{effectiveAgentName}</span>
          )}
        </div>
        {isOutputting && <span className="ml-2 text-blue-500">· 文本输出中</span>}
        {!isOutputting && isToolExecuting && <span className="ml-2 text-red-500">· 工具执行中</span>}
        {!isOutputting && !isToolExecuting && isRunning && <span className="ml-2 text-orange-500">· 思考中</span>}
        {isIdle && runningTaskCount > 0 && (
          <span className="ml-2 text-blue-500">· {runningTaskCount} 个后台任务运行中</span>
        )}
        {isIdle && runningTaskCount === 0 && cancelledTaskCount > 0 && (
          <span className="ml-2 text-red-400">· {cancelledTaskCount} 个任务已取消</span>
        )}
        {isIdle && runningTaskCount === 0 && completedTaskCount > 0 && cancelledTaskCount === 0 && (
          <span className="ml-2 text-green-500">· {completedTaskCount - cancelledTaskCount} 个后台任务待汇报</span>
        )}
        {isIdle && runningTaskCount === 0 && completedTaskCount > 0 && cancelledTaskCount > 0 && (
          <span className="ml-2 text-green-500">· {completedTaskCount - cancelledTaskCount} 个待汇报</span>
        )}
      </div>
    </div>
  );
}
