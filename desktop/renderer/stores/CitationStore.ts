/**
 * CitationStore — 从 messageStore 中拆出的 citation 缓存。
 *
 * 存储子 agent 输出引用（task / agent_team 的 file changes 汇总）。
 */

import { create } from 'zustand';

export interface SubAgentReference {
  agentId: string;
  agentName: string;
  files: string[];
  summary?: string;
  timestamp: number;
  originalOutput?: string;
  duration?: number;
  tokensUsed?: { input: number; output: number };
}

interface CitationStoreState {
  citations: Record<string, SubAgentReference[]>;

  addCitation: (key: string, ref: SubAgentReference) => void;
  addCitations: (key: string, refs: SubAgentReference[]) => void;
  getCitations: (key: string) => SubAgentReference[];
  clearCitations: (key?: string) => void;
  clearAll: () => void;
}

export const useCitationStore = create<CitationStoreState>((set, get) => ({
  citations: {},

  addCitation: (key, ref) => {
    set((state) => {
      const existing = state.citations[key] ?? [];
      const filtered = existing.filter((r) => r.agentId !== ref.agentId);
      return { citations: { ...state.citations, [key]: [...filtered, ref] } };
    });
  },

  addCitations: (key, refs) => {
    set((state) => {
      const existing = state.citations[key] ?? [];
      const agentIds = new Set(refs.map((r) => r.agentId));
      const filtered = existing.filter((r) => !agentIds.has(r.agentId));
      return { citations: { ...state.citations, [key]: [...filtered, ...refs] } };
    });
  },

  getCitations: (key) => get().citations[key] ?? [],

  clearCitations: (key) => {
    if (key) {
      set((state) => {
        const { [key]: _, ...rest } = state.citations;
        return { citations: rest };
      });
    } else {
      set({ citations: {} });
    }
  },

  clearAll: () => set({ citations: {} }),
}));
