/**
 * RemoteChatArea — 远端平台会话对话框
 *
 * 复用 MessageBubble 等共享组件，与本地对话框保持一致的渲染体验。
 * 数据源：平台消息（platformStore）+ agent 消息（ConversationHub）。
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import { Button } from '@/components/ui/button';
import { usePlatformStore, type PlatformMessage } from '../stores/platformStore';
import { useConversationHub } from '../stores/conversationHub';
import { t } from '@/core/i18n';

export default function RemoteChatArea() {
  const activeSessionId = usePlatformStore((s) => s.activeSessionId);
  const sessions = usePlatformStore((s) => s.sessions);
  const messages = usePlatformStore((s) => s.messages);
  const setActiveSession = usePlatformStore((s) => s.setActiveSession);

  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const session = sessions.find((s) => s.id === activeSessionId);
  const sessionKey = session?.sessionKey;

  // 远端会话的 ConversationHub 状态
  const hubState = sessionKey ? useConversationHub((s) => s.conversations[sessionKey]) : undefined;

  // 远端平台消息（仅 user 角色）
  const platformMessages: PlatformMessage[] = session
    ? messages.get(session.sessionKey) || []
    : [];

  // 交错消息：平台 user 消息 + ConversationHub agent 消息
  const allMessages = useMemo(() => {
    const items: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
      userName?: string;
      isStreaming?: boolean;
      contentBlocks?: any[];
    }> = [];

    for (const m of platformMessages) {
      if (m.role !== 'user') continue;
      // 将平台附件转换为 ContentBlock（用于 MessageBubble 渲染）
      const contentBlocks: any[] | undefined = m.attachments?.map(a => {
        switch (a.type) {
          case 'image':
            return { type: 'image', mimeType: a.mimeType || 'image/png', data: '', imageUrl: a.url, name: a.name };
          case 'voice':
          case 'audio':
            return { type: 'audio', mimeType: a.mimeType || 'audio/mpeg', data: '', name: a.name };
          case 'video':
            return { type: 'video', mimeType: a.mimeType || 'video/mp4', data: '', name: a.name };
          default:
            return null;
        }
      }).filter(Boolean) as any[] | undefined;

      items.push({
        id: m.id,
        role: 'user',
        content: m.text || '',
        timestamp: m.timestamp,
        userName: m.userName,
        contentBlocks: contentBlocks?.length ? contentBlocks : undefined,
      });
    }

    if (hubState) {
      for (const m of hubState.messages) {
        if (m.role === 'assistant' && (m.content || m.contentBlocks?.length)) {
          items.push({
            id: m.id,
            role: 'assistant',
            content: m.content || '',
            timestamp: m.timestamp || Date.now(),
            contentBlocks: m.contentBlocks,
          });
        }
      }
      // 流式消息
      if (hubState.currentStreamingText) {
        items.push({
          id: 'streaming',
          role: 'assistant',
          content: hubState.currentStreamingText,
          timestamp: Date.now(),
          isStreaming: true,
        });
      }
    }

    items.sort((a, b) => a.timestamp - b.timestamp);
    return items;
  }, [platformMessages, hubState]);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [allMessages.length, hubState?.currentStreamingText, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distFromBottom < 80);
    setShowScrollBtn(distFromBottom > 200);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setAutoScroll(true);
      setShowScrollBtn(false);
    }
  }, []);

  const handleBack = useCallback(() => {
    setActiveSession(null);
  }, [setActiveSession]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        {t('msg.session_not_found')}
      </div>
    );
  }

  const platformLabel =
    session.platform === 'wechat'
      ? t('sidebar.platform_wechat')
      : session.platform === 'wecom'
        ? t('sidebar.platform_wecom')
        : session.platform === 'feishu'
          ? t('sidebar.platform_feishu')
          : t('sidebar.platform_dingtalk');

  const statusText =
    hubState?.status === 'thinking'
      ? t('agent.status_list.status.thinking')
      : session.status === 'online'
        ? t('agent.status_list.status.idle')
        : session.status === 'connecting'
          ? t('agent.panel.status.waiting')
          : t('agent.panel.status.idle');

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {/* 头部 */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-secondary/30">
        <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
          <ArrowLeft size={16} />
        </Button>
        <div>
          <div className="text-sm font-medium">{session.name}</div>
          <div className="text-xs text-muted-foreground">{platformLabel} · {statusText}</div>
        </div>
      </div>

      {/* 消息列表 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {allMessages.length === 0 && !hubState?.currentStreamingText ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            <p>暂无消息，等待远端用户发送消息</p>
          </div>
        ) : (
          allMessages.map((msg, i) => (
            <MessageBubble
              key={msg.id || i}
              message={{
                id: msg.id,
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content,
                timestamp: msg.timestamp,
                contentBlocks: msg.contentBlocks,
              }}
              isStreaming={msg.isStreaming}
            />
          ))
        )}
      </div>

      {/* 查看最新按钮 */}
      {showScrollBtn && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
          <Button variant="secondary" size="sm" onClick={scrollToBottom} className="shadow-lg">
            <ChevronDown size={16} className="mr-1" />查看最新
          </Button>
        </div>
      )}
    </div>
  );
}
