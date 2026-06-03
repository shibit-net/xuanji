// ============================================================
// sessionStore — 会话生命周期管理（初始化状态机 + 运行时状态 + 日志）
// ============================================================

import { create } from 'zustand';
import type { PermissionRequestData, PlanReviewRequestData, AskUserRequestData } from '../global';

export type InitStatus = 'uninitialized' | 'initializing' | 'ready' | 'failed';

interface SessionStore {
  // ── 初始化状态机 ──────────────────────────
  initStatus: InitStatus;
  initError: string | null;
  initProgress: string;
  transition: (event: { type: 'INIT_START' | 'INIT_COMPLETE' | 'INIT_FAILED' | 'INIT_RESTARTING' | 'CHILD_CRASH'; error?: string; message?: string }) => void;
  triggerInit: () => Promise<void>;
  retry: () => void;
  reset: () => void;

  // ── 运行时状态 ────────────────────────────
  isPlanMode: boolean;
  permissionRequest: PermissionRequestData | null;
  planReviewRequest: PlanReviewRequestData | null;
  askUserRequest: AskUserRequestData | null;

  // ── 日志 ──────────────────────────────────
  logs: Array<{ timestamp: number; level: string; message: string }>;

  // ── Actions ───────────────────────────────
  setPlanMode: (active: boolean) => void;
  setPermissionRequest: (request: PermissionRequestData | null) => void;
  setPlanReviewRequest: (request: PlanReviewRequestData | null) => void;
  setAskUserRequest: (request: AskUserRequestData | null) => void;
  addLog: (level: string, message: string) => void;
  clearLogs: () => void;
}

const initInitialState = {
  initStatus: 'uninitialized' as InitStatus,
  initError: null as string | null,
  initProgress: '',
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initInitialState,

  // ── 初始化状态机 ──────────────────────────

  transition: (event) => {
    switch (event.type) {
      case 'INIT_START':
        set({ initStatus: 'initializing', initError: null, initProgress: '正在初始化...' });
        break;
      case 'INIT_COMPLETE':
        set({ initStatus: 'ready', initProgress: '初始化完成' });
        break;
      case 'INIT_FAILED':
        set({ initStatus: 'failed', initError: event.error || '初始化失败', initProgress: '初始化失败' });
        break;
      case 'INIT_RESTARTING':
        set({ initStatus: 'initializing', initProgress: '正在重启...' });
        break;
      case 'CHILD_CRASH':
        set({ initError: event.message || 'Agent 异常' });
        break;
      default:
        console.warn('[sessionStore] Unknown event:', event);
    }
  },

  triggerInit: async () => {
    if (get().initStatus === 'initializing' || get().initStatus === 'ready') return;

    get().transition({ type: 'INIT_START' });
    try {
      const result = await window.electron.agentInit();
      if (result.success) {
        get().transition({ type: 'INIT_COMPLETE' });

        if (result.config) {
          const config = result.config;
          const { useConfigStore } = await import('./configStore');

          if (config.provider?.model) {
            useConfigStore.getState().updateModelConfig({
              defaultModel: config.provider.model,
              temperature: config.provider.temperature,
              maxTokens: config.provider.maxTokens,
            });
          }

          const { useMessageStore } = await import('./messageStore');
          useMessageStore.setState((s) => ({
            stats: { ...s.stats, model: config.provider?.model || s.stats.model },
          }));
        }
      } else {
        get().transition({ type: 'INIT_FAILED', error: result.error || '初始化失败' });
      }
    } catch (err) {
      get().transition({
        type: 'INIT_FAILED',
        error: err instanceof Error ? err.message : '初始化异常',
      });
    }
  },

  retry: () => {
    set({ initStatus: 'uninitialized', initError: null, initProgress: '' });
    get().triggerInit();
  },

  reset: () => {
    set(initInitialState);
  },

  // ── 运行时状态 ────────────────────────────

  isPlanMode: false,
  permissionRequest: null,
  planReviewRequest: null,
  askUserRequest: null,

  setPlanMode: (active) => set({ isPlanMode: active }),

  setPermissionRequest: (request) => set({ permissionRequest: request }),
  setPlanReviewRequest: (request) => set({ planReviewRequest: request }),
  setAskUserRequest: (request) => set({ askUserRequest: request }),

  // ── 日志 ──────────────────────────────────

  logs: [],

  addLog: (level, message) =>
    set((state) => ({
      logs: [...state.logs, { timestamp: Date.now(), level, message }].slice(-100),
    })),

  clearLogs: () => set({ logs: [] }),
}));
