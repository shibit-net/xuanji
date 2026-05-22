/**
 * PlatformSessionPanel — 右侧「远端对话」Tab
 *
 * 设计文档：docs/platform-integration-design.md §9.4
 */

import { useState } from 'react';
import { Wifi, WifiOff, Send, Maximize2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlatformStore, type RemoteSession } from '../stores/platformStore';

interface PlatformSessionPanelProps {
  session: RemoteSession | null;
}

export default function PlatformSessionPanel({ session }: PlatformSessionPanelProps) {
  const { getMessages, removeSession, sessions } = usePlatformStore();
  const [replyText, setReplyText] = useState('');

  if (!session) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        <p className="mb-2">选择一个远端会话查看详情</p>
        <p className="text-xs">侧边栏点击 📡 图标进入</p>
      </div>
    );
  }

  const messages = getMessages(session.sessionKey);
  const handleDisconnect = async () => {
    await window.electron.platformDisable(session.platform);
    removeSession(session.id);
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    try {
      await window.electron.platformSendReply({
        sessionKey: session.sessionKey,
        text: replyText,
      });
      setReplyText('');
    } catch (err) {
      console.error('Failed to send reply:', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 连接状态 */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          {session.status === 'online' ? (
            <Wifi size={14} className="text-green-500" />
          ) : session.status === 'connecting' ? (
            <Wifi size={14} className="text-yellow-500" />
          ) : (
            <WifiOff size={14} className="text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            📡 {session.name}
          </span>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>平台: {session.platform}</div>
          <div>用户ID: {session.userId}</div>
          <div className="truncate">会话Key: {session.sessionKey}</div>
          <div>消息数: {messages.length}</div>
          <div>状态: {
            session.status === 'online' ? '🟢 已连接' :
            session.status === 'connecting' ? '🟡 连接中' :
            '⚫ 离线'
          }</div>
        </div>
      </div>

      {/* 快捷回复 */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background"
            placeholder="输入回复..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSendReply(); }}
          />
          <Button variant="outline" size="sm" onClick={handleSendReply} disabled={!replyText.trim()}>
            <Send size={14} />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start text-red-500 hover:text-red-600"
          onClick={handleDisconnect}
        >
          <Unplug size={14} className="mr-2" />
          断开连接
        </Button>
      </div>

      {/* 最近消息 */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs font-medium text-muted-foreground mb-2">最近消息</div>
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无消息</p>
        ) : (
          <div className="space-y-2">
            {messages.slice(-10).reverse().map((msg, i) => (
              <div key={i} className="text-xs">
                <span className="text-muted-foreground">
                  {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>{' '}
                <span className="font-medium">{msg.role === 'user' ? '用户' : 'Agent'}:</span>{' '}
                <span className="truncate block">{msg.text.slice(0, 50)}{msg.text.length > 50 ? '...' : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
