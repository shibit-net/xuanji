// ============================================================
// ChatArea - 对话区组件
// ============================================================

import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo, memo } from 'react';
import { ChevronDown, Zap, Brain, Wrench } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import MessageBubble from './MessageBubble';

import { useMessageStore, type Message } from '../stores/messageStore';

// 主 agent 头像
import agentAvatar from '../assets/logos/01bff9e8a394133b79cf6911056f3bff.png';
// 灰色版 logo（水印背景）
import watermarkLogo from '../assets/logos/15b2c2b5954c2f350d3018385db4a81c.png';
import { t } from '@/core/i18n';

// 模块级变量：页面切换时保存/恢复滚动位置
let savedScrollTop: number | null = null;

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
      <div className="flex items-center gap-1.5 px-4 py-3 bg-card rounded-2xl rounded-tl-sm">
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
  useLayoutEffect(() => { setReady(true); }, []);

  const stableCount = stableMessages.length;
  const getScrollElement = useCallback(() => scrollElementRef.current, [scrollElementRef]);
	const estimateSize = useCallback(() => 200, []);
  const virtualizer = useVirtualizer({
    count: stableCount > 0 ? stableCount : 1,
    getScrollElement,
    estimateSize,
    overscan: 5,
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

      {/* 流式消息：有文字或媒体内容（图片/文件）时展示气泡 */}
      {streamingMessage && (currentStreamingText || (streamingMessage.contentBlocks && streamingMessage.contentBlocks.length > 0)) && (
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

function ChatArea() {
  const messages = useMessageStore((state) => state.messages);
  const status = useMessageStore((state) => state.status);
  const currentStreamingId = useMessageStore((state) => state.currentStreamingId);
  const currentStreamingText = useMessageStore((state) => state.currentStreamingText);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // 统一滚动按钮（新消息 / 流式输出）
  const [showScrollButton, setShowScrollButton] = useState(false);

  // 是否显示三点等待动画（未开始输出 或 已创建气泡但尚无文字内容）
  const showTypingIndicator = (status === 'thinking' && !currentStreamingId) || (currentStreamingId !== null && !currentStreamingText);

  // 是否正在流式输出中
  const isStreaming = currentStreamingId !== null;
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  // 流式降频滚动：每 50 字符滚动一次
  const prevStreamingLenRef = useRef(0);
  const isAtBottomRef = useRef(true);

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

  // 消息变化时的自动滚动（新消息 + 已有消息内容更新如工具结果）
  const prevMessagesLenRef = useRef(messages.length);
  const contentBlocksTotal = useMemo(
    () => messages.reduce((sum, m) => sum + (m.contentBlocks?.length || 0), 0),
    [messages],
  );
  const prevContentBlocksRef = useRef(contentBlocksTotal);
  useEffect(() => {
    if (messages.length === 0) return;

    const currentLen = messages.length;
    const prevLen = prevMessagesLenRef.current;
    prevMessagesLenRef.current = currentLen;

    const prevBlocks = prevContentBlocksRef.current;
    prevContentBlocksRef.current = contentBlocksTotal;

    const isNewBubble = currentLen > prevLen;
    const hasNewContent = contentBlocksTotal > prevBlocks;

    if (isNewBubble || hasNewContent) {
      if (isAtBottomRef.current) {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }
        });
      } else if (isNewBubble) {
        setShowScrollButton(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, contentBlocksTotal]);

  // isAtBottom 同步 + 回底检测
  useEffect(() => {
    const wasAtBottom = isAtBottomRef.current;
    isAtBottomRef.current = isAtBottom;

    if (isAtBottom && !wasAtBottom) {
      // 用户刚滚回底部 → 立即贴底
      prevStreamingLenRef.current = 0;
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
      setShowScrollButton(false);
    }

    if (!isAtBottom && isStreamingRef.current) {
      // 流式过程中用户滚离 → 显示按钮
      setShowScrollButton(true);
    }
  }, [isAtBottom]);

  // 流式内容增长时降频滚动（50 字符阈值）
  useEffect(() => {
    if (!isStreaming || !currentStreamingText) return;

    const textLen = currentStreamingText.length;
    if (textLen - prevStreamingLenRef.current < 50) return;
    prevStreamingLenRef.current = textLen;

    if (!isAtBottomRef.current) return;

    requestAnimationFrame(() => {
      if (containerRef.current && isAtBottomRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    });
  }, [currentStreamingText, isStreaming]);

  // 流式停止时，如果用户在底部则贴底
  useEffect(() => {
    if (!isStreaming && isAtBottomRef.current && containerRef.current) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [isStreaming]);

  // 监听滚动事件
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom();
    setIsAtBottom(atBottom);
  }, [checkIfAtBottom]);

  // 页面切换时保存/恢复滚动位置
  useEffect(() => {
    if (savedScrollTop !== null && containerRef.current) {
      containerRef.current.scrollTop = savedScrollTop;
    }
    return () => {
      if (containerRef.current) {
        savedScrollTop = containerRef.current.scrollTop;
      }
    };
  }, []);

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
              {t('chatarea.subtitle')}
            </p>
            {/* 快捷操作提示 */}
            <div className="mt-8 flex items-center gap-4 text-xs text-muted-foreground/50">
              <span className="flex items-center gap-1.5">
                <Zap size={12} className="text-primary/50" />
                /help
              </span>
              <span className="flex items-center gap-1.5">
                <Brain size={12} className="text-primary/50" />
                /memory
              </span>
              <span className="flex items-center gap-1.5">
                <Wrench size={12} className="text-primary/50" />
                /agents
              </span>
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

      {/* 滚动到底部按钮 — 流式或新消息时用户滚离底部出现 */}
      {showScrollButton && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={() => {
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
              }
              setShowScrollButton(false);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-full shadow-lg text-sm hover:bg-primary/90 transition-all animate-bounce"
          >
            <ChevronDown size={16} />
            {t('chat.scroll_to_bottom')}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(ChatArea);
