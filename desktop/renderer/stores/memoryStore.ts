// ============================================================
// Xuanji Desktop - 记忆 Store (Memory Store)
// ============================================================
// 职责：
// - 管理统一记忆存储（UnifiedMemoryStore）的数据
// - 从后端 IPC 加载记忆
// - 提供搜索、过滤、排序功能
// - 处理记忆的 CRUD 操作和质量反馈
// ============================================================

import { create } from 'zustand';
import type { UnifiedMemory, UnifiedMemoryStats } from '../types/models';

export interface SearchOptions {
  query?: string;
  type?: string | string[];
  minQuality?: number;
  minAccuracy?: number;
  minConfidence?: number;
  excludeHidden?: boolean;
  excludeObsolete?: boolean;
  timeRange?: {
    start?: number;
    end?: number;
  };
  limit?: number;
  offset?: number;
}

interface MemoryState {
  // ========== 数据 ==========
  memories: UnifiedMemory[];
  stats: UnifiedMemoryStats | null;

  // ========== 加载状态 ==========
  loaded: boolean;
  loading: boolean;
  error: string | null;

  // ========== 操作 ==========
  loadMemories: (options?: SearchOptions) => Promise<void>;
  loadStats: () => Promise<void>;
  getMemory: (id: string) => Promise<UnifiedMemory | null>;
  updateMemory: (id: string, updates: Partial<UnifiedMemory>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  provideFeedback: (id: string, feedback: 'thumbsup' | 'thumbsdown' | 'obsolete') => Promise<void>;
  exportMemories: () => Promise<UnifiedMemory[]>;
  importMemories: (memories: UnifiedMemory[]) => Promise<{ imported: number; skipped: number }>;
  refresh: () => Promise<void>;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  // ========== 初始状态 ==========
  memories: [],
  stats: null,
  loaded: false,
  loading: false,
  error: null,

  // ========== 加载记忆 ==========
  loadMemories: async (options?: SearchOptions) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.unifiedMemorySearch({ options });
      if (result.success && result.memories) {
        set({ memories: result.memories, loaded: true });
      } else if (result.error) {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  // ========== 加载统计 ==========
  loadStats: async () => {
    try {
      const result = await window.electron.unifiedMemoryStats();
      if (result.success && result.stats) {
        set({ stats: result.stats });
      }
    } catch (err) {
      console.error('Failed to load memory stats:', err);
    }
  },

  // ========== 获取单条记忆 ==========
  getMemory: async (id: string) => {
    try {
      const result = await window.electron.unifiedMemoryGet({ id });
      if (result.success && result.memory) {
        return result.memory;
      }
      return null;
    } catch (err) {
      console.error('Failed to get memory:', err);
      return null;
    }
  },

  // ========== 更新记忆 ==========
  updateMemory: async (id: string, updates: Partial<UnifiedMemory>) => {
    try {
      const result = await window.electron.unifiedMemoryUpdate({ id, updates });
      if (result.success) {
        // 更新本地状态
        set((state) => ({
          memories: state.memories.map((m) =>
            m.id === id ? { ...m, ...updates, updatedAt: Date.now() } : m
          ),
        }));
      } else if (result.error) {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  // ========== 删除记忆 ==========
  deleteMemory: async (id: string) => {
    try {
      const result = await window.electron.unifiedMemoryDelete({ id });
      if (result.success) {
        // 从本地状态移除
        set((state) => ({
          memories: state.memories.filter((m) => m.id !== id),
        }));
        // 重新加载统计
        get().loadStats();
      } else if (result.error) {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  // ========== 质量反馈 ==========
  provideFeedback: async (id: string, feedback: 'thumbsup' | 'thumbsdown' | 'obsolete') => {
    try {
      const result = await window.electron.unifiedMemoryFeedback({ id, feedback });
      if (result.success) {
        // 重新加载该记忆
        const memory = await get().getMemory(id);
        if (memory) {
          set((state) => ({
            memories: state.memories.map((m) => (m.id === id ? memory : m)),
          }));
        }
        // 重新加载统计
        get().loadStats();
      } else if (result.error) {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  // ========== 导出记忆 ==========
  exportMemories: async () => {
    try {
      const result = await window.electron.unifiedMemoryExport();
      if (result.success && result.memories) {
        return result.memories;
      }
      return [];
    } catch (err) {
      console.error('Failed to export memories:', err);
      return [];
    }
  },

  // ========== 导入记忆 ==========
  importMemories: async (memories: UnifiedMemory[]) => {
    try {
      const result = await window.electron.unifiedMemoryImport({ memories });
      if (result.success && result.result) {
        // 重新加载列表和统计
        await get().refresh();
        return result.result;
      }
      return { imported: 0, skipped: 0 };
    } catch (err) {
      console.error('Failed to import memories:', err);
      return { imported: 0, skipped: 0 };
    }
  },

  // ========== 刷新 ==========
  refresh: async () => {
    await Promise.all([get().loadMemories(), get().loadStats()]);
  },
}));
