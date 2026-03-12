// ============================================================
// InputArea - 输入区组件
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

export default function InputArea() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const status = useChatStore((state) => state.status);

  // 自动调整高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    if (input.trim() && status !== 'thinking') {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-bg-tertiary bg-bg-secondary">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-bg-tertiary">
        <button className="p-1 hover:bg-bg-tertiary rounded transition-colors">
          <Paperclip size={16} className="text-text-secondary" />
        </button>
        <span className="text-xs text-text-secondary">@提及文件</span>
        <div className="ml-auto text-xs text-text-secondary">
          Shift+Enter 换行
        </div>
      </div>

      {/* 输入框 */}
      <div className="flex items-end gap-2 p-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题... (支持 Markdown)"
          disabled={status === 'thinking'}
          className="flex-1 bg-bg-primary border border-bg-tertiary rounded-lg px-4 py-2 resize-none focus:outline-none focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          rows={1}
          style={{ maxHeight: '150px' }}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || status === 'thinking'}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Send size={16} />
          <span>发送</span>
        </button>
      </div>

      {/* 提示 */}
      <div className="px-4 pb-2 text-xs text-text-secondary">
        Enter 发送 · Esc 清空
      </div>
    </div>
  );
}
