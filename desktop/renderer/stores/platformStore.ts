/**
 * platformStore — 远端平台会话状态管理
 *
 * 设计文档：docs/platform-integration-design.md §9.5
 */

import { create } from 'zustand';

export interface RemoteSession {
  id: string;
  platform: 'wechat' | 'wecom' | 'feishu' | 'dingtalk';
  name: string;
  avatar?: string;
  status: 'online' | 'offline' | 'connecting';
  unreadCount: number;
  lastMessage?: string;
  lastTime?: number;
  lastActiveAt?: number;
  sessionKey: string;
  userId: string;
  chatId: string;
  /** 对方最后阅读时间（已读回执） */
  lastReadAt?: number;
  lastReadBy?: string;
  /** 是否为群聊（用于侧边栏区分群/私聊图标） */
  isGroup?: boolean;
}

export interface PlatformMessage {
  id: string;
  sessionKey: string;
  platform: string;
  text: string;
  role: 'user' | 'agent';
  timestamp: number;
  userName?: string;
  /** 发送者类型：user（普通用户）、bot（机器人） */
  senderType?: 'user' | 'bot';
}

interface PlatformStore {
  sessions: RemoteSession[];
  activeSessionId: string | null;
  messages: Map<string, PlatformMessage[]>;
  setupDialogOpen: boolean;

  addSession: (session: RemoteSession) => void;
  removeSession: (sessionId: string) => void;
  updateSessionName: (sessionId: string, name: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  updateSessionStatus: (sessionId: string, status: RemoteSession['status']) => void;
  incrementUnread: (sessionId: string) => void;
  clearUnread: (sessionId: string) => void;

  addMessage: (msg: PlatformMessage) => void;
  markMessageRecalled: (sessionKey: string, messageId: string) => void;
  getMessages: (sessionKey: string) => PlatformMessage[];

  setSetupDialogOpen: (open: boolean) => void;
  updateSessionReadStatus: (sessionId: string, readBy: string, readAt: number) => void;
}

export const usePlatformStore = create<PlatformStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  setupDialogOpen: false,

  addSession: (session) => {
    set((s) => ({
      sessions: [...s.sessions.filter((x) => x.id !== session.id), session],
    }));
  },

  removeSession: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== sessionId),
      activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
    }));
  },

  updateSessionName: (sessionId, name) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, name } : x
      ),
    }));
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
    if (sessionId) {
      get().clearUnread(sessionId);
    }
  },

  updateSessionStatus: (sessionId, status) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, status } : x
      ),
    }));
  },

  incrementUnread: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, unreadCount: x.unreadCount + 1 } : x
      ),
    }));
  },

  clearUnread: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, unreadCount: 0 } : x
      ),
    }));
  },

  addMessage: (msg) => {
    set((s) => {
      const newMessages = new Map(s.messages);
      const existing = newMessages.get(msg.sessionKey) || [];
      newMessages.set(msg.sessionKey, [...existing, msg]);
      return { messages: newMessages };
    });

    // 如果当前未选中该 session，增加未读
    const { activeSessionId, incrementUnread } = get();
    if (activeSessionId !== msg.sessionKey && msg.role === 'user') {
      incrementUnread(msg.sessionKey);
    }

    // 更新最后消息
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.sessionKey === msg.sessionKey
          ? { ...x, lastMessage: msg.text, lastTime: msg.timestamp }
          : x
      ),
    }));
  },

  markMessageRecalled: (sessionKey, messageId) => {
    set((s) => {
      const newMessages = new Map(s.messages);
      const existing = newMessages.get(sessionKey) || [];
      const updated = existing.map((m) =>
        m.id === messageId ? { ...m, text: '对方撤回了一条消息', role: 'agent' as const } : m
      );
      newMessages.set(sessionKey, updated);
      return { messages: newMessages };
    });
  },

  getMessages: (sessionKey) => {
    return get().messages.get(sessionKey) || [];
  },

  setSetupDialogOpen: (open) => {
    set({ setupDialogOpen: open });
  },

  updateSessionReadStatus: (sessionId, readBy, readAt) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, lastReadAt: readAt, lastReadBy: readBy } : x
      ),
    }));
  },
}));
