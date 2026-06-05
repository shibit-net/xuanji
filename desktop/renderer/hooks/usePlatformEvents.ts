/**
 * usePlatformEvents — 监听远端平台 IPC 事件并恢复/同步状态
 */

import { useEffect } from 'react';
import { usePlatformStore } from '../stores/platformStore';

/**
 * 自动更新会话显示名。
 * 优先级：备注名（session-names.json）> 飞书官方 API 数据 > chatId
 *
 * - P2P：使用飞书 Contact API 返回的用户名覆盖 chatId
 * - 群聊：使用飞书 SDK 事件中的群名覆盖 chatId
 * - 备注名存在时不自动更新（用户手动设置的优先）
 */
async function autoUpdateSessionName(
  sessionKey: string,
  chatType: string | undefined,
  userName: string | undefined,
  chatName: string | undefined,
): Promise<void> {
  const store = usePlatformStore.getState();
  const session = store.sessions.find((s) => s.sessionKey === sessionKey);
  if (!session) return;

  // 检查是否有备注名
  let hasCustomName = false;
  try {
    const namesResult = await window.electron.platformLoadSessionNames();
    if (namesResult.success && namesResult.names) {
      hasCustomName = !!namesResult.names[session.id];
    }
  } catch { /* 忽略查询失败 */ }

  // 备注名优先级最高，存在时不自动覆盖
  if (hasCustomName) return;

  const newName = chatType === 'group'
    ? (chatName || undefined)
    : (userName || undefined);

  if (newName && session.name !== newName) {
    store.updateSessionName(session.id, newName);
  }
}

export function usePlatformEvents() {
  // 挂载时从主进程恢复平台会话状态 + 已保存的备注名
  useEffect(() => {
    (async () => {
      try {
        const [statusResult, namesResult] = await Promise.all([
          window.electron.platformStatus(),
          window.electron.platformLoadSessionNames(),
        ]);
        if (statusResult.success && statusResult.sessions) {
          const store = usePlatformStore.getState();
          const savedNames: Record<string, string> = (namesResult.success && namesResult.names) ? namesResult.names : {};
          for (const s of statusResult.sessions) {
            // 应用已保存的备注名
            if (savedNames[s.id]) {
              s.name = savedNames[s.id];
            }
            store.addSession(s);
          }
        }
      } catch {
        // PlatformRouter 可能未初始化，忽略
      }
    })();
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
      chatName?: string;
      chatType?: string;
      eventType?: string;
      readReceipt?: { messageId: string; userId: string; readTime: number };
      recallMessageId?: string;
    }) => {
      console.log('[PlatformEvent] message-received:', data.sessionKey, data.text?.slice(0, 50), data.eventType);

      // 处理撤回事件：标记原消息为已撤回
      if (data.eventType === 'recall' && data.recallMessageId) {
        usePlatformStore.getState().markMessageRecalled(data.sessionKey, data.recallMessageId);
        return;
      }

      // 处理已读回执：更新 session 的最后阅读状态
      if (data.eventType === 'read_receipt' && data.readReceipt) {
        const store = usePlatformStore.getState();
        const session = store.sessions.find((s) => s.sessionKey === data.sessionKey);
        if (session) {
          const readBy = data.userName || data.readReceipt.userId;
          store.updateSessionReadStatus(session.id, readBy, data.timestamp);
        }
        return;
      }

      usePlatformStore.getState().addMessage({
        id: data.id,
        sessionKey: data.sessionKey,
        platform: data.platform,
        text: data.text,
        role: data.role as 'user' | 'agent',
        timestamp: data.timestamp,
        userName: data.userName,
      });

      // 自动更新会话显示名：P2P 用用户名，群聊用群名（备注名优先，不受影响）
      autoUpdateSessionName(data.sessionKey, data.chatType, data.userName, data.chatName);
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

    const handleSessionUpdated = async (data: {
      sessionKey: string;
      platform: string;
      chatId?: string;
      userId?: string;
      userName?: string;
      chatName?: string;
      chatType?: string;
      status: string;
    }) => {
      const store = usePlatformStore.getState();

      // 飞书占位会话：连接成功后侧边栏立即显示"飞书已连接"
      if (data.chatId === '__feishu_placeholder__') {
        const placeholderId = 'feishu:private:__placeholder__';
        if (!store.sessions.some((s) => s.id === placeholderId)) {
          store.addSession({
            id: placeholderId,
            platform: 'feishu',
            name: '飞书已连接',
            status: 'online',
            unreadCount: 0,
            sessionKey: placeholderId,
            userId: '',
            chatId: '__feishu_placeholder__',
            isGroup: false,
          });
        }
        return;
      }

      // 收到真实飞书会话时，移除占位
      if (data.platform === 'feishu' && data.sessionKey !== 'feishu:private:__placeholder__') {
        const placeholderId = 'feishu:private:__placeholder__';
        if (store.sessions.some((s) => s.id === placeholderId)) {
          store.removeSession(placeholderId);
        }
      }

      const exists = store.sessions.some((s) => s.id === data.sessionKey);
      if (!exists && data.chatId) {
        // 查询已保存的备注名（最高优先级）
        let savedName: string | undefined;
        try {
          const namesResult = await window.electron.platformLoadSessionNames();
          if (namesResult.success && namesResult.names) {
            savedName = namesResult.names[data.sessionKey];
          }
        } catch { /* 忽略查询失败 */ }
        // 优先级：备注名 > 飞书用户名(P2P) / 群名(group) > chatId
        const autoName = data.chatType === 'group'
          ? (data.chatName || data.chatId)
          : (data.userName || data.chatId);
        const displayName = savedName || autoName;
        console.log('[PlatformEvent] Creating new session:', data.sessionKey, 'name:', displayName);
        store.addSession({
          id: data.sessionKey,
          platform: data.platform as 'wechat' | 'wecom' | 'feishu' | 'dingtalk',
          name: displayName,
          status: data.status as 'online' | 'offline' | 'connecting',
          unreadCount: 0,
          sessionKey: data.sessionKey,
          userId: data.userId || '',
          chatId: data.chatId,
          isGroup: data.chatType === 'group',
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
