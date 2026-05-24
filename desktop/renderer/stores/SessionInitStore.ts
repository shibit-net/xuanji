/**
 * SessionInitStore — Session 初始化生命周期管理。
 *
 * 替代旧版 initEventBridge() 中隐式的 agentInit() 调用。
 * 遵循与 AgentStateMachine / AsyncTaskStore 一致的 transition(event) 模式。
 *
 * 状态机：
 *   uninitialized → initializing → ready
 *                     ↓       ↓
 *                    failed   error
 */

import { create } from 'zustand';

export type InitStatus = 'uninitialized' | 'initializing' | 'ready' | 'failed';

interface SessionInitState {
  status: InitStatus;
  error: string | null;
  progress: string;
  transition: (event: { type: 'INIT_START' | 'INIT_COMPLETE' | 'INIT_FAILED'; error?: string }) => void;
  isReady: () => boolean;
  triggerInit: () => Promise<void>;
  retry: () => void;
  reset: () => void;
}

const initialState = {
  status: 'uninitialized' as InitStatus,
  error: null as string | null,
  progress: '',
};

export const useSessionInitStore = create<SessionInitState>((set, get) => ({
  ...initialState,

  transition: (event) => {
    const { status, error, progress } = get();
    switch (event.type) {
      case 'INIT_START':
        set({ status: 'initializing', error: null, progress: '正在初始化...' });
        break;
      case 'INIT_COMPLETE':
        set({ status: 'ready', progress: '初始化完成' });
        break;
      case 'INIT_FAILED':
        set({ status: 'failed', error: event.error || '初始化失败', progress: '初始化失败' });
        break;
      default:
        console.warn('[SessionInitStore] Unknown event:', event);
    }
  },

  triggerInit: async () => {
    if (get().status === 'initializing' || get().status === 'ready') return;

    get().transition({ type: 'INIT_START' });
    try {
      const result = await window.electron.agentInit();
      if (result.success) {
        get().transition({ type: 'INIT_COMPLETE' });

        // 从初始化返回的配置同步 configStore
        if (result.config) {
          const config = result.config;
          const { useConfigStore } = await import('./configStore');
          const { setLanguage } = await import('@/core/i18n');
          const language = (config.ui?.language as 'zh' | 'en') || 'en';
          console.log('[SessionInitStore] init setting language from config:', language, 'ui:', JSON.stringify(config.ui));
          setLanguage(language);
          useConfigStore.getState().updateSettings({
            language,
            theme: (config.ui?.theme as 'light' | 'dark') || 'dark',
            workspacePath: config.workspacePath || '',
            showTokenUsage: config.ui?.showTokenUsage ?? true,
            showThinking: config.ui?.showThinking ?? true,
          });

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
    set({ status: 'uninitialized', error: null, progress: '' });
    get().triggerInit();
  },

  reset: () => {
    set(initialState);
  },

  isReady: () => {
    return get().status === 'ready';
  },
}));

export default useSessionInitStore;
