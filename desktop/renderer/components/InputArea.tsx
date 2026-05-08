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
import { Send, StopCircle, Archive, Brain, Loader2 } from 'lucide-react';
import { useMessageStore } from '../stores/messageStore';
import { useBackgroundTaskStore } from '../stores/backgroundTaskStore';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useMessageStore((state) => state.sendMessage);
  const autoSummarizeActive = useMessageStore((state) => state._autoSummarizeActive);
  const toast = useToast();

  // ─── 状态判定 ───────────────────────────────────────
  const convState = useMessageStore((s) => s._conversationState);
  const isIdle = convState === 'idle' || convState === 'waiting_async';
  const isRunning = !isIdle;
  const isToolExecuting = convState === 'executing';
  const isSummarizing = convState === 'outputting';
  const isAutoSummarizing = autoSummarizeActive;

  // ─── 后台任务追踪（统一从 backgroundTaskStore 派生）───
  // 生命周期: creating → running → completed → cleared
  const runningTaskCount = useBackgroundTaskStore((s) => {
    let count = 0;
    for (const t of Object.values(s.tasks)) {
      if (t.lifecycle === 'cleared') continue;
      if (t.type === 'task') {
        if (t.lifecycle === 'creating' || t.lifecycle === 'running') count++;
      } else {
        if (t.members.some(m => m.lifecycle === 'creating' || m.lifecycle === 'running')) count++;
      }
    }
    return count;
  });
  const completedTaskCount = useBackgroundTaskStore((s) => {
    let count = 0;
    for (const t of Object.values(s.tasks)) {
      if (t.lifecycle === 'cleared') continue;
      if (t.type === 'task') {
        if (t.lifecycle === 'completed') count++;
      } else {
        if (t.members.length > 0 && t.members.every(m => m.lifecycle === 'completed')) count++;
      }
    }
    return count;
  });
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

  // ─── 发送入口 ───────────────────────────────────────
  // 统一走 sendMessage，后端 handleUserInput 基于权威同步状态决定：
  //   idle → 直接执行 / executing → 中断 + 入队 / outputting → 追加到队列
  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isSending) return;
    const content = input.trim();
    setInput('');
    setIsSending(true);
    try {
      sendMessage(content);
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, sendMessage]);

  // ─── 纯停止（无输入时） ────────────────────────────
  const handleStop = useCallback(() => {
    window.electron.agentInterrupt();
  }, []);

  // ─── 拖拽文件放入 ────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只在离开容器时取消高亮（避免子元素触发）
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const pathList: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as File & { path?: string };
      if (file.path) {
        pathList.push(file.path);
      }
    }

    if (pathList.length === 0) return;

    setInput((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed}\n${pathList.join('\n')}` : pathList.join('\n');
    });
  }, []);

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
  const handleCompact = useCallback(async () => {
    if (isCompacting || isRunning) return;
    setIsCompacting(true);
    try {
      const result = await window.electron.compact({});
      toast[result.success ? 'success' : 'error'](
        result.success ? '消息压缩完成' : `压缩失败: ${result.error}`
      );
    } catch (error) {
      toast.error(`压缩失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, isRunning, toast]);

  const handleMemoryFlush = useCallback(async () => {
    if (isFlushing || isRunning) return;
    setIsFlushing(true);
    try {
      const result = await window.electron.manualMemoryFlush();
      toast[result.success ? 'success' : 'error'](
        result.success ? '记忆提取完成' : `记忆提取失败: ${result.error}`
      );
    } catch (error) {
      toast.error(`记忆提取失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsFlushing(false);
    }
  }, [isFlushing, isRunning, toast]);

  // ─── 文案 ───────────────────────────────────────────
  const placeholder = isAutoSummarizing
    ? '说点什么... (后台汇总中)'
    : isRunning
    ? '说点什么... (工作执行中，消息将自动排队)'
    : runningTaskCount > 0
    ? '说点什么... (后台任务运行中)'
    : '说点什么...';

  const isSendDisabled = !input.trim() || isSending;

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
      {/* 后台任务提示栏 — 多态：运行中/等待汇报/异步后台任务/混合态 */}
      {hasBackgroundTasks && (
        <div className={`flex items-center gap-2 px-4 py-1 border-b ${
          runningTaskCount > 0
            ? 'bg-blue-500/10 border-blue-500/20'
            : 'bg-green-500/10 border-green-500/20'
        }`}>
          {runningTaskCount > 0 ? (
            <Loader2 size={12} className="animate-spin text-blue-500 flex-shrink-0" />
          ) : (
            <span className="text-xs text-green-400 flex-shrink-0">⏳</span>
          )}
          <span className={`text-xs truncate ${
            runningTaskCount > 0 ? 'text-blue-400' : 'text-green-400'
          }`}>
            {(() => {
              const totalRunning = runningTaskCount;
              const totalReporting = completedTaskCount;
              const parts: string[] = [];
              if (totalRunning > 0) parts.push(`${totalRunning} 个任务运行中`);
              if (totalReporting > 0) parts.push(`${totalReporting} 个待汇报`);
              return parts.join(' · ');
            })()}
          </span>
          <span className={`text-xs ml-auto flex-shrink-0 ${
            runningTaskCount > 0 ? 'text-blue-400' : 'text-green-400'
          }`}>
            {isAutoSummarizing ? '正在汇总...' : runningTaskCount > 0 ? '可直接发送新任务' : '等待汇总'}
          </span>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCompact}
          disabled={isCompacting || isRunning}
          title="压缩历史消息，减少 token 使用"
        >
          <Archive size={14} className="mr-1" />
          {isCompacting ? '压缩中...' : '压缩消息'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMemoryFlush}
          disabled={isFlushing || isRunning}
          title="提取对话中的记忆，保存到长期记忆库"
        >
          <Brain size={14} className="mr-1" />
          {isFlushing ? '提取中...' : '提取记忆'}
        </Button>
      </div>

      {/* 输入区域 */}
      <div className="flex items-end gap-2 p-4 relative">
        {isDragOver && (
          <div className="absolute inset-2 flex items-center justify-center bg-blue-500/10 rounded-xl border-2 border-dashed border-blue-400 z-10 pointer-events-none">
            <span className="text-blue-400 text-sm">释放以添加文件路径</span>
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={placeholder}
          disabled={isSending}
          className="flex-1 resize-none"
          rows={1}
          style={{ maxHeight: '150px' }}
        />

        {/* 停止 / 发送按钮 */}
        {isRunning && !isAutoSummarizing && !input.trim() && !isSending ? (
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
        Enter 发送 · Shift+Enter 换行 · Esc 清空 · 拖入文件追加路径
        {isAutoSummarizing && <span className="ml-2 text-blue-500">· 后台任务结果汇总中</span>}
        {!isAutoSummarizing && isToolExecuting && <span className="ml-2 text-red-500">· 工具执行中</span>}
        {!isAutoSummarizing && isSummarizing && <span className="ml-2 text-orange-500">· 流式输出中</span>}
        {isIdle && runningTaskCount > 0 && (
          <span className="ml-2 text-blue-500">· {runningTaskCount} 个后台任务运行中</span>
        )}
        {isIdle && runningTaskCount === 0 && completedTaskCount > 0 && (
          <span className="ml-2 text-green-500">· {completedTaskCount} 个后台任务待汇报</span>
        )}
      </div>
    </div>
  );
}
