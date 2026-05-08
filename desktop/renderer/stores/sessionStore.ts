// ============================================================
// sessionStore - 会话状态管理（conversationState、权限、日志、planMode）
// ============================================================

import { create } from 'zustand';
import type { PermissionRequestData, PlanReviewRequestData, AskUserRequestData } from '../global';

interface SessionStore {
  _conversationState: string;
  _autoSummarizeActive: boolean;
  isPlanMode: boolean;

  permissionRequest: PermissionRequestData | null;
  planReviewRequest: PlanReviewRequestData | null;
  askUserRequest: AskUserRequestData | null;

  logs: Array<{ timestamp: number; level: string; message: string }>;

  setPlanMode: (active: boolean) => void;
  setPermissionRequest: (request: PermissionRequestData | null) => void;
  setPlanReviewRequest: (request: PlanReviewRequestData | null) => void;
  setAskUserRequest: (request: AskUserRequestData | null) => void;
  addLog: (level: string, message: string) => void;
  clearLogs: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  _conversationState: 'idle',
  _autoSummarizeActive: false,
  isPlanMode: false,

  permissionRequest: null,
  planReviewRequest: null,
  askUserRequest: null,

  logs: [],

  setPlanMode: (active) => set({ isPlanMode: active }),

  setPermissionRequest: (request) => set({ permissionRequest: request }),
  setPlanReviewRequest: (request) => set({ planReviewRequest: request }),
  setAskUserRequest: (request) => set({ askUserRequest: request }),

  addLog: (level, message) =>
    set((state) => ({
      logs: [...state.logs, { timestamp: Date.now(), level, message }].slice(-100),
    })),

  clearLogs: () => set({ logs: [] }),
}));
