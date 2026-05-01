// ============================================================
// InputArea - 输入区组件（适配异步 Agent 任务模式）
// ============================================================
//
// 发送策略（根据主 agent 状态自动选择）：
//   主 agent 空闲 → 直接发送
//   主 agent 执行工具中 → 中断当前执行 + 注入新消息
//   主 agent 流式输出中 → 追加消息，等待流式完成后处理
//   后台异步任务运行中（主 agent 空闲）→ 直接发送
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, StopCircle, Archive, Brain, Loader2 } from 'lucide-react';
import { useChatStore, Message } from '../stores/chatStore';
import { useToast } from './Toast';

export default function InputArea() {
  const [input, setInput] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useChatStore((state) => state.sendMessage);
  const addMessage = useChatStore((state) => state.addMessage);
  const status = useChatStore((state) => state.status);
  const currentStreamingId = useChatStore((state) => state.currentStreamingId);
  const messages = useChatStore((state) => state.messages);
  const autoSummarizeActive = useChatStore((state) => state._autoSummarizeActive);
  const toast = useToast();

  // ─── 状态判定 ───────────────────────────────────────
  const isIdle = status === 'idle';
  const isRunning = !isIdle;
  const isStreaming = isRunning && currentStreamingId !== null;
  const isExecutingTools = isRunning && currentStreamingId === null;
  // 后台任务完成自动汇总：用户可正常发送消息，不阻塞交互
  const isAutoSummarizing = isRunning && autoSummarizeActive;

  // ─── 后台任务追踪 ───────────────────────────────────
  const backgroundTaskIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.toolCalls) continue;
      for (const tc of msg.toolCalls) {
        if ((tc.name === 'agent_team' || tc.name === 'task') && tc.output) {
          const m = tc.output.match(/任务组 ID: (at-[a-f0-9]+)/);
          if (m) ids.push(m[1]);
        }
      }
    }
    return [...new Set(ids)];
  }, [messages]);

  // ─── 自动调整 textarea 高度 ─────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  // ─── 发送入口 ───────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isSending) return;
    const content = input.trim();
    setInput('');
    setIsSending(true);

    try {
      if (isIdle || isAutoSummarizing) {
        // 主 agent 空闲 / 后台任务完成自动汇总中 → 直接发送
        sendMessage(content);
      } else if (isExecutingTools) {
        // 正在执行工具 → 中断当前执行 + 注入新消息
        const msg: Message = {
          id: `interrupt-${Date.now()}`,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        addMessage(msg);
        await window.electron.agentInterrupt(content);
        toast.success('已中断并发送新消息');
      } else if (isStreaming) {
        // 正在流式输出 → 追加消息，等待流式完成后处理
        const msg: Message = {
          id: `append-${Date.now()}`,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        addMessage(msg);
        await window.electron.agentAppendMessage(content);
        toast.info('消息将在流式输出完成后处理');
      }
    } catch (error) {
      toast.error('发送失败');
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, isIdle, isExecutingTools, isStreaming, sendMessage, addMessage, toast]);

  // ─── 纯停止（无输入时） ────────────────────────────
  const handleStop = useCallback(() => {
    window.electron.agentInterrupt();
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
    ? '输入你的问题... (后台任务结果汇总中，可直接发送)'
    : isExecutingTools
    ? '正在执行工具，输入内容将中断并替换当前任务...'
    : isStreaming
    ? '正在生成回复，输入内容将在输出完成后处理...'
    : backgroundTaskIds.length > 0
    ? '输入你的问题... (后台任务运行中，可直接发送新任务)'
    : '输入你的问题... (支持 Markdown)';

  const isSendDisabled = !input.trim() || isSending;

  return (
    <div className="flex-shrink-0 border-t border-bg-tertiary bg-bg-secondary">
      {/* 后台任务提示栏 */}
      {(backgroundTaskIds.length > 0 || isAutoSummarizing) && (isIdle || isAutoSummarizing) && (
        <div className="flex items-center gap-2 px-4 py-1 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/30">
          <Loader2 size={12} className="animate-spin text-blue-600 flex-shrink-0" />
          <span className="text-xs text-blue-700 dark:text-blue-300 truncate">
            {isAutoSummarizing
              ? '后台任务结果汇总中...'
              : `${backgroundTaskIds.length} 个后台任务运行中 (${backgroundTaskIds.join(', ')})`}
          </span>
          <span className="text-xs text-blue-400 ml-auto flex-shrink-0">
            可直接发送新任务
          </span>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <button
          onClick={handleCompact}
          disabled={isCompacting || isRunning}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="压缩历史消息，减少 token 使用"
        >
          <Archive size={14} />
          <span>{isCompacting ? '压缩中...' : '压缩消息'}</span>
        </button>
        <button
          onClick={handleMemoryFlush}
          disabled={isFlushing || isRunning}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="提取对话中的记忆，保存到长期记忆库"
        >
          <Brain size={14} />
          <span>{isFlushing ? '提取中...' : '提取记忆'}</span>
        </button>
      </div>

      {/* 输入区域 */}
      <div className="flex items-end gap-2 p-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={placeholder}
          disabled={isSending}
          className="flex-1 bg-bg-primary border border-bg-tertiary rounded-lg px-4 py-2 resize-none focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
          rows={1}
          style={{ maxHeight: '150px' }}
        />

        {/* 停止 / 发送按钮 */}
        {isRunning && !isAutoSummarizing && !input.trim() && !isSending ? (
          <button
            onClick={handleStop}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 flex-shrink-0"
          >
            <StopCircle size={16} />
            <span>停止</span>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isSendDisabled}
            className={`px-4 py-2 text-white rounded-lg transition-colors flex items-center gap-2 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
              isAutoSummarizing
                ? 'bg-primary hover:bg-primary/90'
                : isExecutingTools
                ? 'bg-red-600 hover:bg-red-700'
                : isStreaming
                ? 'bg-orange-600 hover:bg-orange-700'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {isSending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            <span>{isSending ? '发送中...' : '发送'}</span>
          </button>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-4 pb-2 text-xs text-text-secondary">
        Enter 发送 · Shift+Enter 换行 · Esc 清空
        {isAutoSummarizing && <span className="ml-2 text-blue-500">· 后台任务结果汇总中</span>}
        {!isAutoSummarizing && isExecutingTools && <span className="ml-2 text-red-500">· 输入将中断当前工具执行</span>}
        {!isAutoSummarizing && isStreaming && <span className="ml-2 text-orange-500">· 输入将在输出完成后处理</span>}
        {isIdle && backgroundTaskIds.length > 0 && (
          <span className="ml-2 text-blue-500">· 后台任务运行中</span>
        )}
      </div>
    </div>
  );
}
