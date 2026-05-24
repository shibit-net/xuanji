// ============================================================
// messageStore - 消息状态管理（精简版）
// 仅保留消息 CRUD，编排逻辑已迁移到 EventAdapter + AgentStateMachine
// ============================================================

import { create } from 'zustand';
import { useExecutionStore } from './executionStore';

function stripTodoProgress(text: string): string {
  return text.replace(/<!--TODO_PROGRESS:.*?-->/g, '').replace(/\n{3,}/g, '\n\n');
}

// ── 消息数量上限（防止 OOM）──
const MAX_MESSAGES = 500;

function trimMessages(messages: Message[]): Message[] {
  if (messages.length > MAX_MESSAGES) {
    return messages.slice(-Math.floor(MAX_MESSAGES / 2));
  }
  return messages;
}

// ============================================================
// 类型定义
// ============================================================

let messageIdCounter = 0;
export function generateMessageId(prefix = 'msg'): string {
  return `${prefix}-${Date.now()}-${++messageIdCounter}`;
}

// ── 富媒体内容块 ──────────────────────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; name?: string }
  | { type: 'audio'; data: string; mimeType: string; name?: string; duration?: number }
  | { type: 'video'; data: string; mimeType: string; name?: string; duration?: number }
  | { type: 'file'; fileName: string; filePath: string; fileSize: number };

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 富媒体内容块（与 content 互斥展示：有 contentBlocks 时优先渲染 contentBlocks） */
  contentBlocks?: ContentBlock[];
  timestamp?: number;
  thinking?: boolean;
  statusHint?: string;
  toolCalls?: ToolCall[];
  toolSummary?: boolean;
  duration?: number;
  tokensUsed?: { input: number; output: number };
  agentId?: string;
  attachments?: import('../global').FileAttachment[];
}

export interface SubAgentReference {
  agentName: string;
  originalOutput: string;
  duration: number;
  tokensUsed: { input: number; output: number };
}

export interface ToolCall {
  id: string;
  name: string;
  status: 'pending' | 'success' | 'error' | 'running';
  duration?: number;
  startTime?: number;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export type ChatStatus = 'idle' | 'thinking' | 'executing';

// ============================================================
// Store 接口
// ============================================================

interface MessageStore {
  messages: Message[];
  status: ChatStatus;
  currentStreamingId: string | null;
  currentStreamingText: string;
  activeToolCalls: Map<string, ToolCall>;
  citationOutputs: Record<string, SubAgentReference[]>;
  stats: { model: string; tokenUsage: { input: number; output: number }; cost: number };
  currentSkill: { name: string; icon: string } | null;

  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setStatus: (status: ChatStatus) => void;
  clearMessages: () => void;
  reset: () => Promise<void>;
  getCitationOutput: (agentName: string) => SubAgentReference | null;
  startStreaming: (messageId: string) => void;
  appendStreamingText: (text: string) => void;
  finishStreaming: () => void;
  cancelStreaming: () => void;
  appendContentBlock: (messageId: string, block: ContentBlock) => void;
}

// ============================================================
// Store 实现
// ============================================================

export const useMessageStore = create<MessageStore>((set, get) => ({
  // ── 初始状态 ──────────────────────────────
  messages: [],
  status: 'idle',
  currentSkill: null,
  stats: { model: 'Claude Haiku 4', tokenUsage: { input: 0, output: 0 }, cost: 0 },
  currentStreamingId: null,
  currentStreamingText: '',
  activeToolCalls: new Map(),
  citationOutputs: {},

  // ── 操作 ──────────────────────────────────

  addMessage: (message) =>
    set((state) => ({ messages: trimMessages([...state.messages, message]) })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    })),

  setStatus: (status) => set({ status }),

  startStreaming: (messageId) => {
    const emptyMsg: Message = {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    set((s) => ({
      messages: trimMessages([...s.messages, emptyMsg]),
      currentStreamingId: messageId,
      currentStreamingText: '',
      status: 'thinking',
    }));
  },

  appendStreamingText: (text) => set((s) => ({
    currentStreamingText: s.currentStreamingText + text,
  })),

  finishStreaming: () => {
    const s = get();
    if (!s.currentStreamingId) return;
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === s.currentStreamingId
          ? { ...msg, content: stripTodoProgress(s.currentStreamingText) }
          : msg
      ),
      currentStreamingId: null,
      currentStreamingText: '',
      status: 'idle',
    }));
  },

  cancelStreaming: () => {
    const s = get();
    if (!s.currentStreamingId) return;
    set((state) => ({
      messages: state.messages.filter(m => m.id !== s.currentStreamingId),
      currentStreamingId: null,
      currentStreamingText: '',
      status: 'idle',
    }));
  },

  appendContentBlock: (messageId, block) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? { ...msg, contentBlocks: [...(msg.contentBlocks || []), block] }
          : msg
      ),
    })),

  clearMessages: () => {
    set({ messages: [], status: 'idle' });
  },

  reset: async () => {
    await window.electron.agentReset();
    useExecutionStore.setState({ todos: [] });
    set({
      messages: [], status: 'idle', currentStreamingId: null,
      currentStreamingText: '', activeToolCalls: new Map(), citationOutputs: {},
    });
  },

  getCitationOutput: (agentName: string): SubAgentReference | null => {
    const list = get().citationOutputs[agentName];
    if (!list || list.length === 0) return null;
    return list[list.length - 1];
  },
}));
