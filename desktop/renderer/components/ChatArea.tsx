// ============================================================
// ChatArea - 对话区组件
// ============================================================

import React, { useRef, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import { useChatStore } from '../stores/chatStore';

export default function ChatArea() {
  const messages = useChatStore((state) => state.messages);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessageButton, setShowNewMessageButton] = useState(false);

  // 检查是否在底部
  const checkIfAtBottom = () => {
    if (!containerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const threshold = 100; // 距离底部 100px 内认为在底部
    return scrollHeight - scrollTop - clientHeight < threshold;
  };

  // 滚动到底部
  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setShowNewMessageButton(false);
    }
  };

  // 监听滚动事件
  const handleScroll = () => {
    const atBottom = checkIfAtBottom();
    setIsAtBottom(atBottom);
    if (atBottom) {
      setShowNewMessageButton(false);
    }
  };

  // 消息变化时的自动滚动逻辑
  useEffect(() => {
    if (isAtBottom) {
      // 用户在底部，自动滚动
      scrollToBottom();
    } else {
      // 用户在上方查看历史，显示新消息提示
      setShowNewMessageButton(true);
    }
  }, [messages]);

  // 初始化时滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, []);

  return (
    <div className="flex-1 relative">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto px-6 py-4 space-y-4"
      >
        {messages.length === 0 ? (
          // 空状态
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-6xl mb-4">⭐</div>
            <div className="text-2xl font-bold mb-2">Shibit Xuanji</div>
            <div className="text-text-secondary">
              智能编程助手，帮你理解、生成、重构代码
            </div>
            <div className="mt-8 text-sm text-text-secondary">
              输入你的问题开始对话 →
            </div>
          </div>
        ) : (
          // 消息列表
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>

      {/* 新消息提示按钮 */}
      {showNewMessageButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-6 flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-all animate-bounce"
        >
          <span className="text-sm">新消息</span>
          <ChevronDown size={16} />
        </button>
      )}
    </div>
  );
}
