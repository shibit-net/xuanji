// ============================================================
// InputArea - 输入区组件
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { Send, StopCircle, Archive, Brain } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { useToast } from './Toast';

export default function InputArea() {
  const [input, setInput] = useState('');
  const [isComposing, setIsComposing] = useState(false); // 输入法组合状态
  const [isCompacting, setIsCompacting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const status = useChatStore((state) => state.status);
  const toast = useToast();

  const isRunning = status === 'thinking' || status === 'executing';

  // 自动调整高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const addMessage = useChatStore((state) => state.addMessage);

  const handleSubmit = () => {
    if (!input.trim()) return;

    if (isRunning) {
      // 执行中：先将补充输入显示到聊天框，再中断当前执行
      addMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: input.trim(),
        timestamp: Date.now(),
      });
      window.electron.agentInterrupt(input.trim());
    } else {
      sendMessage(input.trim());
    }
    setInput('');
  };

  const handleInterrupt = () => {
    window.electron.agentInterrupt();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 输入法组合中（如中文输入法输入拼音时），Enter 应该确认候选词，而不是发送消息
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setInput('');
      textareaRef.current?.blur();
    }
  };

  // 手动触发压缩
  const handleCompact = async () => {
    if (isCompacting || isRunning) return;

    setIsCompacting(true);
    try {
      const result = await window.electron.compact({});
      if (result.success) {
        toast.success('消息压缩完成');
      } else {
        toast.error(`压缩失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      toast.error(`压缩失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsCompacting(false);
    }
  };

  // 手动触发记忆提取
  const handleMemoryFlush = async () => {
    if (isFlushing || isRunning) return;

    setIsFlushing(true);
    try {
      const result = await window.electron.manualMemoryFlush();
      if (result.success) {
        toast.success('记忆提取完成');
      } else {
        toast.error(`记忆提取失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      toast.error(`记忆提取失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsFlushing(false);
    }
  };

  return (
    <div className="flex-shrink-0 border-t border-bg-tertiary bg-bg-secondary">
      {/* 操作按钮 */}
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

      {/* 输入框 */}
      <div className="flex items-end gap-2 p-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={isRunning ? '输入补充内容，发送后将中断当前执行...' : '输入你的问题... (支持 Markdown)'}
          className="flex-1 bg-bg-primary border border-bg-tertiary rounded-lg px-4 py-2 resize-none focus:outline-none focus:border-primary transition-colors"
          rows={1}
          style={{ maxHeight: '150px' }}
        />
        {isRunning && !input.trim() ? (
          <button
            onClick={handleInterrupt}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
          >
            <StopCircle size={16} />
            <span>停止</span>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className={`px-4 py-2 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isRunning && input.trim()
                ? 'bg-orange-600 hover:bg-orange-700'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            <Send size={16} />
            <span>{isRunning && input.trim() ? '中断并发送' : '发送'}</span>
          </button>
        )}
      </div>

      {/* 提示 */}
      <div className="px-4 pb-2 text-xs text-text-secondary">
        Enter 发送 · Shift+Enter 换行 · Esc 清空
        {isRunning && <span className="ml-2 text-orange-400">· Agent 执行中</span>}
      </div>
    </div>
  );
}
