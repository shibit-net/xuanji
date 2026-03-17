// ============================================================
// Xuanji Desktop - 历史 Store (History Store)
// ============================================================
// 职责：
// - 管理会话历史
// - 管理 Checkpoint
// - 管理记忆库
// - 管理工具调用日志
// - 所有数据从后端加载，只追加不修改
// ============================================================

import { create } from 'zustand';
import type {
  SessionInfo,
  CheckpointInfo,
  MemoryEntry,
  ToolCallLog,
  MemoryStats,
} from '../types/models';

interface HistoryState {
  // ========== 数据 ==========
  sessions: SessionInfo[];
  checkpoints: CheckpointInfo[];
  memoryEntries: MemoryEntry[];
  memoryStats: MemoryStats | null;
  toolCallLogs: ToolCallLog[];

  // ========== 加载状态 ==========
  loading: boolean;
  error: string | null;

  // ========== Sessions 操作 ==========
  loadSessions: () => Promise<void>;
  getSession: (id: string) => SessionInfo | undefined;
  deleteSession: (id: string) => Promise<void>;

  // ========== Checkpoints 操作 ==========
  loadCheckpoints: () => Promise<void>;
  createCheckpoint: (label?: string) => Promise<string | null>;
  rewindToCheckpoint: (id: string) => Promise<number | null>;
  getCheckpoint: (id: string) => CheckpointInfo | undefined;

  // ========== Memory 操作 ==========
  loadMemoryEntries: (query?: string, filters?: { type?: string }) => Promise<void>;
  loadMemoryStats: () => Promise<void>;
  searchMemory: (query: string) => Promise<void>;

  // ========== Tool Call Logs 操作 ==========
  addToolCallLog: (log: ToolCallLog) => void;
  clearToolCallLogs: () => void;
  getRecentToolCalls: (limit: number) => ToolCallLog[];

  // ========== 批量操作 ==========
  loadAll: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  // ========== 初始状态 ==========
  sessions: [],
  checkpoints: [],
  memoryEntries: [],
  memoryStats: null,
  toolCallLogs: [],
  loading: false,
  error: null,

  // ========== Sessions 操作 ==========
  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.sessionList();
      if (result.success && result.sessions) {
        set({ sessions: result.sessions });
      } else if (result.error) {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  getSession: (id) => {
    return get().sessions.find((session) => session.id === id);
  },

  deleteSession: async (id) => {
    try {
      const result = await window.electron.sessionDelete({ sessionId: id });
      if (result.success) {
        await get().loadSessions(); // 重新加载列表
      } else if (result.error) {
        set({ error: result.error });
        throw new Error(result.error);
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  // ========== Checkpoints 操作 ==========
  loadCheckpoints: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.checkpointList();
      if (result.success && result.checkpoints) {
        set({ checkpoints: result.checkpoints });
      } else if (result.error) {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  createCheckpoint: async (label) => {
    try {
      const result = await window.electron.checkpointCreate({ label });
      if (result.success) {
        await get().loadCheckpoints(); // 重新加载列表
        return result.checkpointId || null;
      } else if (result.error) {
        set({ error: result.error });
        throw new Error(result.error);
      }
      return null;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  rewindToCheckpoint: async (id) => {
    try {
      const result = await window.electron.checkpointRewind({ checkpointId: id });
      if (result.success) {
        await get().loadCheckpoints(); // 重新加载列表
        return result.messageCount ?? null;
      } else if (result.error) {
        set({ error: result.error });
        throw new Error(result.error);
      }
      return null;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  getCheckpoint: (id) => {
    return get().checkpoints.find((checkpoint) => checkpoint.id === id);
  },

  // ========== Memory 操作 ==========
  loadMemoryEntries: async (query, filters) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.memoryRetrieve({
        query: query || '',
        ...filters,
      });
      if (result.success && result.entries) {
        set({ memoryEntries: result.entries });
      } else if (result.error) {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  loadMemoryStats: async () => {
    try {
      const result = await window.electron.memoryStats();
      if (result.success && result.stats) {
        set({ memoryStats: result.stats });
      } else if (result.error) {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  searchMemory: async (query) => {
    await get().loadMemoryEntries(query);
  },

  // ========== Tool Call Logs 操作 ==========
  addToolCallLog: (log) =>
    set((state) => ({
      toolCallLogs: [...state.toolCallLogs, log],
    })),

  clearToolCallLogs: () => set({ toolCallLogs: [] }),

  getRecentToolCalls: (limit) => {
    const logs = get().toolCallLogs;
    return logs.slice(-limit).reverse();
  },

  // ========== 批量操作 ==========
  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      await Promise.all([
        get().loadSessions(),
        get().loadCheckpoints(),
        get().loadMemoryStats(),
      ]);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },
}));
