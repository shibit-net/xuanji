// ============================================================
// ChatArea - 对话区组件
// ============================================================

import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import MessageBubble from './MessageBubble';
import { Button } from '@/components/ui/button';
import { useMessageStore, type Message } from '../stores/messageStore';

// 主 agent 头像
import agentAvatar from '../assets/logos/01bff9e8a394133b79cf6911056f3bff.png';
// 灰色版 logo（水印背景）
import watermarkLogo from '../assets/logos/15b2c2b5954c2f350d3018385db4a81c.png';

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
      <div className="w-8 h-8 rounded-full bg-primary/20 overflow-hidden flex-shrink-0 mt-0.5">
        <img src={agentAvatar} alt="Xuanji" className="w-full h-full object-cover" />
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
  afterMessages,
}: {
  stableMessages: Message[];
  streamingMessage: Message | null;
  currentStreamingText: string;
  scrollElementRef: React.RefObject<HTMLDivElement | null>;
  afterMessages: Message[];
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  const stableCount = stableMessages.length;
  const getScrollElement = useCallback(() => scrollElementRef.current, [scrollElementRef]);
	const estimateSize = useCallback(() => 200, []);
  const virtualizer = useVirtualizer({
    count: stableCount > 0 ? stableCount : 1,
    getScrollElement,
    estimateSize,
    overscan: 10,
  });

  if (!ready) {
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

      {/* 流式消息：有实际文字内容后才展示气泡，避免空泡闪烁 */}
      {streamingMessage && currentStreamingText && (
        <div className="message-bubble-streaming pb-4">
          <MessageBubble
            message={streamingMessage}
            isStreaming={true}
            streamingText={currentStreamingText}
          />
        </div>
      )}

      {/* 流式输出中发送的补充消息，展示在流式气泡下方 */}
      {afterMessages.length > 0 && afterMessages.map((msg) => (
        <div key={msg.id} className="pb-4">
          <MessageBubble message={msg} />
        </div>
      ))}
    </>
  );
});

export default function ChatArea() {
  const messages = useMessageStore((state) => state.messages);
  const status = useMessageStore((state) => state.status);
  const currentStreamingId = useMessageStore((state) => state.currentStreamingId);
  const currentStreamingText = useMessageStore((state) => state.currentStreamingText);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessageButton, setShowNewMessageButton] = useState(false);

  // 是否显示三点等待动画（未开始输出 或 已创建气泡但尚无文字内容）
  const showTypingIndicator = (status === 'thinking' && !currentStreamingId) || (currentStreamingId !== null && !currentStreamingText);

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
  const { stableMessages, streamingMessage, afterMessages } = useMemo(() => {
    if (currentStreamingId && messages.length > 0) {
      // 按 ID 查找流式消息，而不是假设它一定是最后一条
      // 用户在流式输出中发送补充消息时，新消息会追加到末尾，导致位置假设失效
      const streamingIdx = messages.findIndex(m => m.id === currentStreamingId);
      if (streamingIdx !== -1) {
        const streaming = messages[streamingIdx];
        const stable = messages.slice(0, streamingIdx);
        const after = messages.slice(streamingIdx + 1);
        return { stableMessages: stable, streamingMessage: streaming, afterMessages: after };
      }
    }
    return { stableMessages: messages, streamingMessage: null, afterMessages: [] };
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
      useMessageStore.getState().addMessage(archiveMessage);
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
  const prevMessagesLenRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length === 0) return;

    const currentLen = messages.length;
    const prevLen = prevMessagesLenRef.current;
    prevMessagesLenRef.current = currentLen;

    // 只有新消息（长度增加）才触发新消息提示，流式更新不触发
    const isNewBubble = currentLen > prevLen;

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
    } else if (isNewBubble) {
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
      {/* 底部灰色 logo 水印 — 用 background-image 替代 img 标签 */}
      <div
        className="absolute inset-0 pointer-events-none z-0 bg-no-repeat bg-center"
        style={{
          backgroundImage: `url(${watermarkLogo})`,
          backgroundSize: '360px 360px',
          opacity: 0.08,
        }}
      />
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto px-6 py-4 z-[1]" style={{ overflowAnchor: 'none' }}
      >
        {messages.length === 0 ? (
          // 空状态 — visionOS 风格
          <div className="flex flex-col items-center justify-center h-full text-center relative">
            {/* 背景装饰光晕 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[500px] h-[500px] rounded-full bg-primary/3 blur-[120px]" />
            </div>
            {/* 标题 */}
            <h1 className="text-2xl font-semibold text-foreground/90 mb-2 tracking-tight">Xuanji 璇玑</h1>
            <p className="text-sm text-muted-foreground max-w-[320px] leading-relaxed">
              智能管家 · 理解、推理、执行
            </p>
            <div className="mt-10 flex items-center gap-2 text-xs text-muted-foreground/50">
              <div className="w-1 h-1 rounded-full bg-primary/50" />
              输入你的问题开始对话
              <div className="w-1 h-1 rounded-full bg-primary/50" />
            </div>
            {/* 底部装饰 */}
            <div className="absolute bottom-12 flex gap-3">
              {['⚡', '🧠', '🔧', '🤖'].map((icon) => (
                <div key={icon} className="w-8 h-8 rounded-xl bg-card backdrop-blur-sm flex items-center justify-center text-sm animate-pulse" style={{ animationDelay: `${['⚡', '🧠', '🔧', '🤖'].indexOf(icon) * 0.5}s`, opacity: 0.3 }}>{icon}</div>
              ))}
            </div>
          </div>
        ) : (
          <VirtualMessageList
            stableMessages={stableMessages}
            streamingMessage={streamingMessage}
            currentStreamingText={currentStreamingText}
            scrollElementRef={containerRef}
            afterMessages={afterMessages}
          />
        )}

        {/* LLM 响应前的三点等待动画 */}
        {showTypingIndicator && <TypingIndicator />}
      </div>

      {/* 新消息提示按钮 */}
      {showNewMessageButton && (
        <Button
          onClick={() => {
            if (containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
              setShowNewMessageButton(false);
            }
          }}
          variant="default"
          className="absolute bottom-4 right-6 flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-all animate-bounce"
        >
          <span className="text-sm">新消息</span>
          <ChevronDown size={16} />
        </Button>
      )}
    </div>
  );
}
