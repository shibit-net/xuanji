/**
 * ConversationHub — 远端会话独立状态管理
 *
 * 每个远端会话在此维护独立的消息流、对话状态、token 快照，
 * 与本地的 messageStore / ConversationStore 完全隔离。
 */

import { create } from 'zustand';
import { generateMessageId, type Message, type ContentBlock, type ChatStatus } from './messageStore';
import type { ConvState, RoutingInfo } from './ConversationStore';

export interface PerConversationState {
  // Message streaming
  messages: Message[];
  currentStreamingId: string | null;
  currentStreamingText: string;

  // Conversation status
  status: ChatStatus;
  conversationState: ConvState;
  iteration: number;
  routingInfo: RoutingInfo | null;

  // Token snapshot (captured at agent:started)
  tokenSnapshot: { input: number; output: number; cached: number };
}

interface ConversationHubState {
  conversations: Record<string, PerConversationState>;

  ensureConversation: (sessionKey: string) => void;
  removeConversation: (sessionKey: string) => void;
  getState: (sessionKey: string) => PerConversationState | undefined;

  // Message actions (routed by sessionKey)
  startStreaming: (sessionKey: string) => void;
  appendStreamingText: (sessionKey: string, text: string) => void;
  finishStreaming: (sessionKey: string) => void;
  cancelStreaming: (sessionKey: string) => void;
  addMessage: (sessionKey: string, msg: Message) => void;
  appendContentBlock: (sessionKey: string, block: ContentBlock) => void;

  // Status actions
  setStatus: (sessionKey: string, status: ChatStatus) => void;
  setConversationState: (sessionKey: string, state: ConvState) => void;
  onAgentStarted: (sessionKey: string, data?: { model?: string }) => void;
  onAgentCompleted: (sessionKey: string) => void;
  setTokenSnapshot: (sessionKey: string, snapshot: { input: number; output: number; cached: number }) => void;
}

function createDefaultState(): PerConversationState {
  return {
    messages: [],
    currentStreamingId: null,
    currentStreamingText: '',
    status: 'idle',
    conversationState: 'idle',
    iteration: 0,
    routingInfo: null,
    tokenSnapshot: { input: 0, output: 0, cached: 0 },
  };
}

export const useConversationHub = create<ConversationHubState>((set, get) => ({
  conversations: {},

  ensureConversation: (sessionKey) => {
    const { conversations } = get();
    if (!conversations[sessionKey]) {
      set({
        conversations: {
          ...conversations,
          [sessionKey]: createDefaultState(),
        },
      });
    }
  },

  removeConversation: (sessionKey) => {
    set((s) => {
      const { [sessionKey]: _, ...rest } = s.conversations;
      return { conversations: rest };
    });
  },

  getState: (sessionKey) => {
    return get().conversations[sessionKey];
  },

  // ── Message streaming ────────────────────────

  startStreaming: (sessionKey) => {
    const streamId = generateMessageId('stream');
    const now = Date.now();
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: {
            ...conv,
            messages: [...conv.messages, {
              id: streamId,
              role: 'assistant' as const,
              content: '',
              timestamp: now,
            }],
            currentStreamingId: streamId,
            currentStreamingText: '',
            status: 'thinking',
          },
        },
      };
    });
  },

  appendStreamingText: (sessionKey, text) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: {
            ...conv,
            currentStreamingText: conv.currentStreamingText + text,
          },
        },
      };
    });
  },

  finishStreaming: (sessionKey) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      const hasContent = conv.currentStreamingText.trim().length > 0;
      let messages = conv.messages;

      if (hasContent && conv.currentStreamingId) {
        const existingMsg = messages.find((m) => m.id === conv.currentStreamingId);
        const duration = existingMsg?.timestamp ? Date.now() - existingMsg.timestamp : undefined;
        messages = messages.map((m) =>
          m.id === conv.currentStreamingId
            ? { ...m, content: conv.currentStreamingText, duration }
            : m,
        );
      } else if (conv.currentStreamingId) {
        // Remove empty bubble
        messages = messages.filter((m) => m.id !== conv.currentStreamingId);
      }

      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: {
            ...conv,
            messages,
            currentStreamingId: null,
            currentStreamingText: '',
            status: 'idle',
          },
        },
      };
    });
  },

  cancelStreaming: (sessionKey) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      const messages = conv.currentStreamingId
        ? conv.messages.filter((m) => m.id !== conv.currentStreamingId)
        : conv.messages;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: {
            ...conv,
            messages,
            currentStreamingId: null,
            currentStreamingText: '',
            status: 'idle',
          },
        },
      };
    });
  },

  addMessage: (sessionKey, msg) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: {
            ...conv,
            messages: [...conv.messages, msg],
          },
        },
      };
    });
  },

  appendContentBlock: (sessionKey, block) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv || !conv.currentStreamingId) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: {
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === conv.currentStreamingId
                ? { ...m, contentBlocks: [...(m.contentBlocks || []), block] }
                : m,
            ),
          },
        },
      };
    });
  },

  // ── Status actions ───────────────────────────

  setStatus: (sessionKey, status) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: { ...conv, status },
        },
      };
    });
  },

  setConversationState: (sessionKey, conversationState) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: { ...conv, conversationState },
        },
      };
    });
  },

  onAgentStarted: (sessionKey) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: {
            ...conv,
            status: 'thinking',
            conversationState: 'executing',
            iteration: conv.iteration + 1,
          },
        },
      };
    });
  },

  onAgentCompleted: (sessionKey) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: {
            ...conv,
            status: 'idle',
            conversationState: 'idle',
          },
        },
      };
    });
  },

  setTokenSnapshot: (sessionKey, snapshot) => {
    set((s) => {
      const conv = s.conversations[sessionKey];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [sessionKey]: { ...conv, tokenSnapshot: snapshot },
        },
      };
    });
  },
}));
