/**
 * usePlatformEvents — 监听远端平台 IPC 事件并恢复/同步状态
 */

import { useEffect } from 'react';
import { usePlatformStore } from '../stores/platformStore';

export function usePlatformEvents() {
  // 挂载时从主进程恢复平台会话状态
  useEffect(() => {
    window.electron.platformStatus().then((result) => {
      if (result.success && result.sessions) {
        const { addSession } = usePlatformStore.getState();
        for (const s of result.sessions) {
          addSession(s);
        }
      }
    }).catch(() => {
      // PlatformRouter 可能未初始化，忽略
    });
  }, []);

  // 监听平台消息事件
  useEffect(() => {
    const handleMessageReceived = (data: {
      id: string;
      sessionKey: string;
      platform: string;
      text: string;
      role: string;
      timestamp: number;
      userName?: string;
    }) => {
      console.log('[PlatformEvent] message-received:', data.sessionKey, data.text?.slice(0, 50));
      usePlatformStore.getState().addMessage({
        id: data.id,
        sessionKey: data.sessionKey,
        platform: data.platform,
        text: data.text,
        role: data.role as 'user' | 'agent',
        timestamp: data.timestamp,
        userName: data.userName,
      });
    };

    const handleMessageSent = (data: {
      sessionKey: string;
      platform: string;
      text: string;
      role: string;
      timestamp: number;
    }) => {
      usePlatformStore.getState().addMessage({
        id: `sent-${Date.now()}`,
        sessionKey: data.sessionKey,
        platform: data.platform,
        text: data.text,
        role: data.role as 'user' | 'agent',
        timestamp: data.timestamp,
      });
    };

    const handleSessionUpdated = (data: {
      sessionKey: string;
      platform: string;
      chatId?: string;
      userId?: string;
      userName?: string;
      status: string;
    }) => {
      const store = usePlatformStore.getState();
      const exists = store.sessions.some((s) => s.id === data.sessionKey);
      if (!exists && data.chatId) {
        console.log('[PlatformEvent] Creating new session:', data.sessionKey, 'name:', data.userName || data.chatId);
        store.addSession({
          id: data.sessionKey,
          platform: data.platform as 'wechat' | 'wecom' | 'feishu' | 'dingtalk',
          name: data.userName || data.chatId,
          status: data.status as 'online' | 'offline' | 'connecting',
          unreadCount: 0,
          sessionKey: data.sessionKey,
          userId: data.userId || '',
          chatId: data.chatId,
        });
      } else {
        store.updateSessionStatus(data.sessionKey, data.status as 'online' | 'offline' | 'connecting');
      }
    };

    window.electron.onPlatformMessageReceived(handleMessageReceived);
    window.electron.onPlatformMessageSent(handleMessageSent);
    window.electron.onPlatformSessionUpdated(handleSessionUpdated);

    return () => {
      window.electron.removeAllListeners('platform:message-received');
      window.electron.removeAllListeners('platform:message-sent');
      window.electron.removeAllListeners('platform:session-updated');
    };
  }, []);
}
