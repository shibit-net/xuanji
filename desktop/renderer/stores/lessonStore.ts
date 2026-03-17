// ============================================================
// lessonStore - 经验教训状态管理
// ============================================================

import { create } from 'zustand';

// 经验教训类型定义（与后端 types.ts 对应）
export type LessonType = 'success' | 'failure' | 'best_practice' | 'pitfall' | 'optimization';
export type LessonDomain = 'coding' | 'debugging' | 'tool_usage' | 'communication' | 'decision_making' | 'workflow';
export type ImpactLevel = 'critical' | 'major' | 'minor';
export type DiscoveryMethod = 'tool_result' | 'user_feedback' | 'pattern_recognition' | 'code_review';

export interface LessonExperience {
  title: string;
  description: string;
  impact: ImpactLevel;
  discoveredBy: DiscoveryMethod;
}

export interface LessonContext {
  task: string;
  userInput: string;
  myAction: string;
  files: string[];
  toolsUsed: string[];
  cwd: string;
  projectType?: string;
}

export interface LessonAnalysis {
  rootCause?: string;
  whatWentWrong?: string;
  whatWentRight?: string;
  confidence: number;
}

export interface CoreLesson {
  summary: string;
  keyTakeaway: string;
  actionableInsight: string;
}

export interface Verification {
  applied: boolean;
  verified: boolean;
  applicationCount: number;
  successCount: number;
}

export interface LessonEvent {
  id: string;
  timestamp: number;
  type: LessonType;
  domain: LessonDomain;
  experience: LessonExperience;
  context: LessonContext;
  analysis?: LessonAnalysis;
  lesson?: CoreLesson;
  applicationRule?: any;
  verification: Verification;
}

export interface LessonSearchOptions {
  query?: string;
  type?: LessonType | LessonType[];
  domain?: LessonDomain | LessonDomain[];
  minConfidence?: number;
  onlyVerified?: boolean;
  excludeObsolete?: boolean;
  timeRange?: {
    start?: number;
    end?: number;
  };
  limit?: number;
  offset?: number;
}

export interface LessonStats {
  total: number;
  byType: Record<LessonType, number>;
  byDomain: Record<LessonDomain, number>;
  verified: number;
  applied: number;
  averageSuccessRate: number;
}

interface LessonStoreState {
  lessons: LessonEvent[];
  stats: LessonStats | null;
  loading: boolean;
  error: string | null;

  // 操作
  loadLessons: (options?: LessonSearchOptions) => Promise<void>;
  loadStats: () => Promise<void>;
  getLesson: (id: string) => Promise<LessonEvent | null>;
  updateLesson: (id: string, updates: Partial<LessonEvent>) => Promise<void>;
  deleteLesson: (id: string) => Promise<void>;
  exportLessons: () => Promise<LessonEvent[]>;
  importLessons: (lessons: LessonEvent[]) => Promise<{ imported: number; skipped: number }>;
  refresh: () => Promise<void>;
}

export const useLessonStore = create<LessonStoreState>((set, get) => ({
  lessons: [],
  stats: null,
  loading: false,
  error: null,

  loadLessons: async (options?: LessonSearchOptions) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.lessonSearch(options || {});
      if (result.success && result.result) {
        set({ lessons: result.result, loading: false });
      } else {
        set({ error: result.error || 'Failed to load lessons', loading: false });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  loadStats: async () => {
    try {
      const result = await window.electron.lessonStats();
      if (result.success && result.result) {
        set({ stats: result.result });
      }
    } catch (err) {
      console.error('Failed to load lesson stats:', err);
    }
  },

  getLesson: async (id: string) => {
    try {
      const result = await window.electron.lessonGet(id);
      if (result.success && result.result) {
        return result.result;
      }
      return null;
    } catch (err) {
      console.error('Failed to get lesson:', err);
      return null;
    }
  },

  updateLesson: async (id: string, updates: Partial<LessonEvent>) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.lessonUpdate(id, updates);
      if (result.success) {
        // 更新本地状态
        set((state) => ({
          lessons: state.lessons.map((l) => (l.id === id ? { ...l, ...updates } : l)),
          loading: false,
        }));
      } else {
        set({ error: result.error || 'Failed to update lesson', loading: false });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  deleteLesson: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.lessonDelete(id);
      if (result.success) {
        // 从本地状态移除
        set((state) => ({
          lessons: state.lessons.filter((l) => l.id !== id),
          loading: false,
        }));
      } else {
        set({ error: result.error || 'Failed to delete lesson', loading: false });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  exportLessons: async () => {
    try {
      const result = await window.electron.lessonExport();
      if (result.success && result.result) {
        return result.result;
      }
      return [];
    } catch (err) {
      console.error('Failed to export lessons:', err);
      return [];
    }
  },

  importLessons: async (lessons: LessonEvent[]) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.lessonImport(lessons);
      if (result.success && result.result) {
        await get().loadLessons();
        set({ loading: false });
        return result.result;
      } else {
        set({ error: result.error || 'Failed to import lessons', loading: false });
        return { imported: 0, skipped: 0 };
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
      return { imported: 0, skipped: 0 };
    }
  },

  refresh: async () => {
    await Promise.all([get().loadLessons(), get().loadStats()]);
  },
}));
