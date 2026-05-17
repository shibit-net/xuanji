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
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, StopCircle, Archive, Brain, Loader2, X, FileText } from 'lucide-react';
import type { FileAttachment } from '../global';
import { useConversationStore } from '../stores/ConversationStore';
import { useAsyncTaskStore } from '../stores/AsyncTaskStore';
import { useMessageStore, generateMessageId } from '../stores/messageStore';
import { useSessionInitStore } from '../stores/SessionInitStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';

import { useToast } from './Toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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

  const toast = useToast();

  // ─── 状态判定 ───────────────────────────────────────
  const convState = useConversationStore((s) => s.conversationState);
  const autoSummarizeActive = convState === 'outputting';

  // 检查是否有进程内 agent 仍在活跃（思考/工具/输出/汇报）
  // 异步 ACP agent 不阻塞输入框 — 用户可以直接发送新消息
  const isInProcessAgentActive = useAgentStateMachine((s) => {
    for (const agent of Object.values(s.agentMap)) {
      if (agent.executionMode === 'acp') continue;
      if (['success', 'failed', 'cancelled', 'cleared'].includes(agent.status)) continue;
      return true;
    }
    return false;
  });

  const isIdle = (convState === 'idle' || convState === 'waiting_async') && !isInProcessAgentActive;
  const isRunning = !isIdle;
  const isToolExecuting = convState === 'executing';
  const isSummarizing = convState === 'outputting';
  const isAutoSummarizing = autoSummarizeActive;

  // ─── Session 状态 ──────────────────────────────────────
  const sessionStatus = useSessionInitStore((s) => s.status);
  const sessionError = useSessionInitStore((s) => s.error);
  const isSessionReady = useSessionInitStore((s) => s.isReady());

  // ─── 前台 Agent ──────────────────────────────────────
  const foregroundAgentId = useAgentStateMachine((s) => s.foregroundAgentId);

  // ─── 后台任务追踪 ───
  // 生命周期: creating → running → completed/cancelled → cleared
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

  // ─── 自动调整 textarea 高度 ─────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      // 内容少时固定高度，超出时自动增长
      const baseScroll = textareaRef.current.scrollHeight;
      if (baseScroll <= 44) {
        textareaRef.current.style.height = '44px';
      } else {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
      }
    }
  }, [input]);

  // 首次 mount 时固定为一行高度
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
    if ((!hasText && !hasAttachments) || isSending) return;

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
    setInput('');
    setAttachments([]);
    setIsSending(true);
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
      });
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, isSessionReady, toast, attachments]);

  // ─── 纯停止（无输入时） ────────────────────────────
  const handleStop = useCallback(() => {
    window.electron.agentUserAction({ type: 'INTERRUPT' });
  }, []);

  // ─── 文件附件工具函数 ─────────────────────────────
  const MAX_TEXT_FILE_SIZE = 1 * 1024 * 1024; // 1MB
  const MAX_BINARY_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_FILE_COUNT = 10;

  // 二进制文件扩展名（后端有对应解析器）
  const BINARY_EXTENSIONS = new Set([
    'xlsx', 'xls', 'xlsm', 'xlt', 'xltx', 'xltm',
    'csv', 'tsv',
    'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm',
    'pdf',
    'pptx', 'pptm', 'potx', 'ppsx',
  ]);

  // 二进制 MIME 类型前缀
  const BINARY_MIME_PATTERNS = [
    'application/vnd.openxmlformats-officedocument',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/pdf',
    'text/csv',
    'text/tab-separated-values',
  ];

  // 文本文件扩展名
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
            // 拖放：有真实文件路径，后端直接解析
            newAttachments.push({
              name: file.name,
              path: dropPath,
              content: '',
              size: file.size,
            });
          } else {
            // 粘贴：无路径，读二进制内容并 base64 编码
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
          // 文本文件：直接读取内容
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

    // 先从 text/uri-list 提取文件路径
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

  // ─── 粘贴文件 ─────────────────────────────────────
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  // ─── 键盘事件 ───────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setInput('');
      textareaRef.current?.blur();
    }
  }, [handleSubmit, isComposing]);

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
        // 刷新上下文使用率
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

  // ─── 文案 ───────────────────────────────────────────
  const placeholder = !isSessionReady
    ? sessionStatus === 'initializing' ? '会话初始化中...'
      : sessionStatus === 'failed' ? `服务不可用: ${sessionError || '请点击重试'}`
      : '正在连接服务...'
    : isAutoSummarizing
    ? '说点什么... (后台汇总中)'
    : isRunning
    ? '说点什么... (工作执行中，消息将自动排队)'
    : runningTaskCount > 0
    ? '说点什么... (后台任务运行中)'
    : cancelledTaskCount > 0
    ? '说点什么... (有任务已取消)'
    : '说点什么...';

  const isSendDisabled = (!input.trim() && attachments.length === 0) || isSending || !isSessionReady;

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
      {/* 后台任务提示栏 — 多态：运行中/等待汇报/已取消/混合态 */}
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
            {isAutoSummarizing ? '正在汇总...' : runningTaskCount > 0 ? '可直接发送新任务' : cancelledTaskCount > 0 ? '任务已取消' : '等待汇总'}
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
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
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

        {/* 停止 / 发送按钮 */}
        {isRunning && !isAutoSummarizing && !input.trim() && attachments.length === 0 && !isSending ? (
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
            {isSending ? '发送中...' : '发送'}
          </Button>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-4 pb-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 flex-wrap">
          <span>Enter 发送 · Shift+Enter 换行 · Esc 清空 · 拖入/粘贴文件上传</span>
          {foregroundAgentId && foregroundAgentId !== 'xuanji' && (
            <span className="text-blue-400">· Agent: {foregroundAgentId}</span>
          )}
        </div>
        {isAutoSummarizing && <span className="ml-2 text-blue-500">· 后台任务结果汇总中</span>}
        {!isAutoSummarizing && isToolExecuting && <span className="ml-2 text-red-500">· 工具执行中</span>}
        {!isAutoSummarizing && isSummarizing && <span className="ml-2 text-orange-500">· 流式输出中</span>}
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
