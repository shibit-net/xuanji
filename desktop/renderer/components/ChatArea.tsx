// ============================================================
// ChatArea - 对话区组件
// ============================================================

import { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import MessageBubble from './MessageBubble';
import { useChatStore } from '../stores/chatStore';
import { useToast } from './Toast';

// ============================================================
// 唯一 ID 生成器（与 chatStore 保持一致）
// ============================================================
let messageIdCounter = 0;
function generateMessageId(prefix = 'msg'): string {
  return `${prefix}-${Date.now()}-${++messageIdCounter}`;
}

/** 三点波浪等待动画（LLM 响应前的即时反馈） */
function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 px-1">
      {/* 与 MessageBubble 的 assistant 头像对齐 */}
      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-sm">🤖</span>
      </div>
      <div className="flex items-center gap-1.5 px-4 py-3 bg-bg-secondary rounded-2xl rounded-tl-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block w-2 h-2 rounded-full bg-text-secondary"
            style={{
              animation: 'typing-dot 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}

export default function ChatArea() {
  const messages = useChatStore((state) => state.messages);
  const status = useChatStore((state) => state.status);
  const currentStreamingId = useChatStore((state) => state.currentStreamingId);
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessageButton, setShowNewMessageButton] = useState(false);

  // 是否显示三点等待动画：LLM 收到请求后、第一个 token 到达前
  const showTypingIndicator = status === 'thinking' && !currentStreamingId;

  // 虚拟滚动配置
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 100, // 预估每条消息高度
    overscan: 5, // 预渲染上下各 5 条
  });

  // 监听归档通知
  useEffect(() => {
    const handleArchiveNotification = (data: { archivedCount: number; memoriesExtracted: number; summary?: string }) => {
      // 在聊天区域添加一条系统提示消息，而不是弹出 toast
      const archiveMessage: Message = {
        id: generateMessageId('system-archive'),
        role: 'system',
        content: `📦 已归档 ${data.archivedCount} 条消息，提取 ${data.memoriesExtracted} 条记忆`,
        timestamp: Date.now(),
      };
      useChatStore.getState().addMessage(archiveMessage);
    };

    window.electron.on('session:archive-notification', handleArchiveNotification);

    return () => {
      window.electron.off('session:archive-notification', handleArchiveNotification);
    };
  }, []);

  // 检查是否在底部
  const checkIfAtBottom = useCallback(() => {
    if (!containerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const threshold = 100; // 距离底部 100px 内认为在底部
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, []);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setShowNewMessageButton(false);
    }
  }, []);

  // 虚拟滚动到最后一项
  const scrollToLastItem = useCallback(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
      setShowNewMessageButton(false);
    }
  }, [messages.length, virtualizer]);

  // 监听滚动事件
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom();
    setIsAtBottom(atBottom);
    if (atBottom) {
      setShowNewMessageButton(false);
    }
  }, [checkIfAtBottom]);

  // 消息变化时的自动滚动逻辑
  useEffect(() => {
    if (isAtBottom) {
      // 用户在底部，自动滚动
      scrollToLastItem();
    } else {
      // 用户在上方查看历史，显示新消息提示
      setShowNewMessageButton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isAtBottom]);

  // typing indicator 出现时也滚动到底部
  useEffect(() => {
    if (showTypingIndicator && isAtBottom) {
      scrollToLastItem();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTypingIndicator, isAtBottom]);

  // 初始化时滚动到底部
  useEffect(() => {
    scrollToLastItem();
  }, []);

  return (
    <div className="flex-1 min-h-0 relative">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto px-6 py-4"
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
          // 虚拟滚动消息列表
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const message = messages[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className="pb-4"
                >
                  <MessageBubble message={message} />
                </div>
              );
            })}
          </div>
        )}

        {/* LLM 响应前的三点等待动画 */}
        {showTypingIndicator && <TypingIndicator />}
      </div>

      {/* 新消息提示按钮 */}
      {showNewMessageButton && (
        <button
          onClick={scrollToLastItem}
          className="absolute bottom-4 right-6 flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-all animate-bounce"
        >
          <span className="text-sm">新消息</span>
          <ChevronDown size={16} />
        </button>
      )}
    </div>
  );
}
