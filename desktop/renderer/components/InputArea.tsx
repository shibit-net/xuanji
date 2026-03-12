// ============================================================
// InputArea - 输入区组件
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { Send, StopCircle } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

export default function InputArea() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const status = useChatStore((state) => state.status);

  const isRunning = status === 'thinking' || status === 'executing';

  // 自动调整高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim()) return;

    if (isRunning) {
      // 执行中：中断当前执行，补充输入作为新消息
      window.electron.agentInterrupt();
      sendMessage(input.trim());
    } else {
      sendMessage(input.trim());
    }
    setInput('');
  };

  const handleInterrupt = () => {
    window.electron.agentInterrupt();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setInput('');
      textareaRef.current?.blur();
    }
  };

  return (
    <div className="border-t border-bg-tertiary bg-bg-secondary">
      {/* 输入框 */}
      <div className="flex items-end gap-2 p-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
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
