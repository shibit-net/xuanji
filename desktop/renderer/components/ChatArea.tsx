// ============================================================
// ChatArea - 对话区组件
// ============================================================

import React, { useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import { useChatStore } from '../stores/chatStore';

export default function ChatArea() {
  const messages = useChatStore((state) => state.messages);
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
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
  );
}
