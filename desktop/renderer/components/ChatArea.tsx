// ============================================================
// ChatArea - 对话区组件
// ============================================================

import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import MessageBubble from './MessageBubble';
import { useChatStore, type Message } from '../stores/chatStore';
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

// ============================================================
// 独立的虚拟消息列表组件
// 将 useVirtualizer 隔离到子组件中，避免其内部 flushSync
// 在父组件 render 阶段触发导致 React 警告
// ============================================================
const VirtualMessageList = memo(function VirtualMessageList({
  stableMessages,
  streamingMessage,
  currentStreamingText,
  scrollElementRef,
}: {
  stableMessages: Message[];
  streamingMessage: Message | null;
  currentStreamingText: string;
  scrollElementRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  const stableCount = stableMessages.length;
  const getScrollElement = useCallback(() => scrollElementRef.current, [scrollElementRef]);
  const estimateSize = useCallback(() => 100, []);

  const virtualizer = useVirtualizer({
    count: stableCount > 0 ? stableCount : 1,
    getScrollElement,
    estimateSize,
    overscan: 5,
  });

  if (!ready) {
    // 延迟一帧挂载虚拟滚动器，避免 measureElement ref 回调
    // 在 React commit 阶段触发 flushSync
    return null;
  }

  return (
    <>
      {stableCount > 0 && (
        <div
          className="chat-messages-container"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            if (virtualItem.index >= stableCount) return null;
            const message = stableMessages[virtualItem.index];
            if (!message) return null;

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="message-bubble"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="pb-4">
                  <MessageBubble message={message} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 流式消息：使用自然文档流渲染，不受虚拟滚动器干扰 */}
      {streamingMessage && (
        <div className="message-bubble-streaming pb-4">
          <MessageBubble
            message={streamingMessage}
            isStreaming={true}
            streamingText={currentStreamingText}
          />
        </div>
      )}
    </>
  );
});

export default function ChatArea() {
  const messages = useChatStore((state) => state.messages);
  const status = useChatStore((state) => state.status);
  const currentStreamingId = useChatStore((state) => state.currentStreamingId);
  const currentStreamingText = useChatStore((state) => state.currentStreamingText);
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessageButton, setShowNewMessageButton] = useState(false);

  // 是否显示三点等待动画
  const showTypingIndicator = status === 'thinking' && !currentStreamingId;

  // 是否正在流式输出中
  const isStreaming = currentStreamingId !== null;
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  // RAF ID 用于合并滚动操作
  const scrollRafRef = useRef<number | null>(null);
  const lastScrollTimeRef = useRef(0);

  // ============================================================
  // 核心优化：将流式消息从虚拟滚动器中分离
  // 流式消息使用自然文档流渲染，虚拟滚动器只管理已稳定的消息
  // ============================================================
  const { stableMessages, streamingMessage } = useMemo(() => {
    if (currentStreamingId && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.id === currentStreamingId) {
        return {
          stableMessages: messages.slice(0, -1),
          streamingMessage: lastMsg,
        };
      }
    }
    return { stableMessages: messages, streamingMessage: null };
  }, [messages, currentStreamingId]);

  // 监听归档通知
  useEffect(() => {
    const handleArchiveNotification = (data: { archivedCount: number; memoriesExtracted: number; summary?: string }) => {
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
    return scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // 使用 RAF 滚动到底部
  const scrollToBottomRaf = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
        setShowNewMessageButton(false);
      }
    });
  }, []);

  // 消息变化时的自动滚动
  useEffect(() => {
    if (messages.length === 0) return;

    if (isAtBottom) {
      if (isStreamingRef.current) {
        // 流式输出：节流到 16ms，使用 RAF 平滑跟随
        const now = Date.now();
        if (now - lastScrollTimeRef.current < 16) return;
        lastScrollTimeRef.current = now;
        scrollToBottomRaf();
      } else {
        // 非流式：直接滚动到底部
        scrollToBottomRaf();
      }
    } else {
      setShowNewMessageButton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isAtBottom]);

  // typing indicator 出现时滚动到底部
  useEffect(() => {
    if (showTypingIndicator) {
      const timer = setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showTypingIndicator]);

  // 初始化滚动
  useEffect(() => {
    if (messages.length > 0 && containerRef.current) {
      const timer = setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [messages.length]);

  // 清理 RAF
  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // 监听滚动事件
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom();
    setIsAtBottom(atBottom);
    if (atBottom) {
      setShowNewMessageButton(false);
    }
  }, [checkIfAtBottom]);

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
          <VirtualMessageList
            stableMessages={stableMessages}
            streamingMessage={streamingMessage}
            currentStreamingText={currentStreamingText}
            scrollElementRef={containerRef}
          />
        )}

        {/* LLM 响应前的三点等待动画 */}
        {showTypingIndicator && <TypingIndicator />}
      </div>

      {/* 新消息提示按钮 */}
      {showNewMessageButton && (
        <button
          onClick={() => {
            if (containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
              setShowNewMessageButton(false);
            }
          }}
          className="absolute bottom-4 right-6 flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-all animate-bounce"
        >
          <span className="text-sm">新消息</span>
          <ChevronDown size={16} />
        </button>
      )}
    </div>
  );
}
