/**
 * RemoteChatArea — 远端平台会话对话框
 *
 * 替代本地 ChatArea，仅包含消息列表 + 回复输入。
 * 监控面板（RightPanel / ExecutionFlowV2）由 MainPage 全局渲染、所有会话共享。
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePlatformStore, type PlatformMessage } from '../stores/platformStore';
import { useConversationHub } from '../stores/conversationHub';

export default function RemoteChatArea() {
  const activeSessionId = usePlatformStore((s) => s.activeSessionId);
  const sessions = usePlatformStore((s) => s.sessions);
  const messages = usePlatformStore((s) => s.messages);
  const setActiveSession = usePlatformStore((s) => s.setActiveSession);

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const session = sessions.find((s) => s.id === activeSessionId);
  const sessionKey = session?.sessionKey;

  // 远端会话的 ConversationHub 状态
  const hubState = sessionKey ? useConversationHub((s) => s.conversations[sessionKey]) : undefined;

  // 远端平台消息（仅 user 角色，agent 回复来自 ConversationHub）
  const platformMessages: PlatformMessage[] = session
    ? messages.get(session.sessionKey) || []
    : [];

  // 交错消息
  const allMessages = useMemo(() => {
    const items: Array<{
      id: string;
      role: 'user' | 'agent';
      text: string;
      timestamp: number;
      userName?: string;
    }> = [];

    for (const m of platformMessages) {
      if (m.role !== 'user') continue;
      items.push({
        id: m.id,
        role: 'user',
        text: m.text,
        timestamp: m.timestamp,
        userName: m.userName,
      });
    }

    if (hubState) {
      for (const m of hubState.messages) {
        if (m.role === 'assistant' && m.content) {
          items.push({
            id: m.id,
            role: 'agent',
            text: m.content,
            timestamp: m.timestamp || Date.now(),
          });
        }
      }
      if (hubState.currentStreamingText) {
        items.push({
          id: 'streaming',
          role: 'agent',
          text: hubState.currentStreamingText,
          timestamp: Date.now(),
        });
      }
    }

    items.sort((a, b) => a.timestamp - b.timestamp);
    return items;
  }, [platformMessages, hubState]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [allMessages.length, hubState?.currentStreamingText]);

  const handleBack = useCallback(() => {
    setActiveSession(null);
  }, [setActiveSession]);

  const handleSend = useCallback(async () => {
    if (!replyText.trim() || sending || !session) return;
    setSending(true);
    try {
      await window.electron.platformSendReply({
        sessionKey: session.sessionKey,
        text: replyText.trim(),
      });
      setReplyText('');
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      setSending(false);
    }
  }, [replyText, sending, session]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [replyText]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        会话未找到
      </div>
    );
  }

  const platformLabel =
    session.platform === 'wechat'
      ? '微信'
      : session.platform === 'wecom'
        ? '企业微信'
        : session.platform === 'feishu'
          ? '飞书'
          : '钉钉';

  const statusText =
    hubState?.status === 'thinking'
      ? '思考中...'
      : session.status === 'online'
        ? '已连接'
        : session.status === 'connecting'
          ? '连接中'
          : '离线';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 头部 */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-secondary/30">
        <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
          <ArrowLeft size={16} />
        </Button>
        <div>
          <div className="text-sm font-medium">📡 {session.name}</div>
          <div className="text-xs text-muted-foreground">{platformLabel} · {statusText}</div>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {allMessages.length === 0 && !hubState?.currentStreamingText ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            <p>暂无消息，等待远端用户发送消息</p>
          </div>
        ) : (
          allMessages.map((msg, i) => (
            <div
              key={msg.id || i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-secondary text-secondary-foreground rounded-bl-sm'
                }`}
              >
                {msg.userName && msg.role === 'user' && (
                  <div className="text-xs opacity-70 mb-0.5 font-medium">{msg.userName}</div>
                )}
                <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                <div className="text-xs opacity-50 mt-1 text-right">
                  {new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 输入区 */}
      <div className="flex-shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入回复..."
            disabled={sending}
            className="flex-1 resize-none"
            rows={1}
            style={{ maxHeight: '120px' }}
          />
          <Button onClick={handleSend} disabled={!replyText.trim() || sending} size="sm">
            <Send size={16} className="mr-1" />
            {sending ? '发送中...' : '发送'}
          </Button>
        </div>
      </div>
    </div>
  );
}
