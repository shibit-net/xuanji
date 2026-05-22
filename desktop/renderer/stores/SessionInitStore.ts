/**
 * SessionInitStore — Session 初始化生命周期管理。
 *
 * 替代旧版 initEventBridge() 中隐式的 agentInit() 调用。
 * 遵循与 AgentStateMachine / AsyncTaskStore 一致的 transition(event) 模式。
 *
 * 状态机：
 *   uninitialized → initializing → ready
 *                     ↓       ↓
 *                   failed ←─┘
 *
 * IPC 事件驱动：
 *   session:init-start     → INIT_START
 *   session:init-complete  → INIT_COMPLETE
 *   session:init-failed    → INIT_FAILED
 *   session:init-restarting → INIT_RESTARTING
 *   agent:crash            → CHILD_CRASH
 */

import { create } from 'zustand';

export type InitStatus = 'uninitialized' | 'initializing' | 'ready' | 'failed';

export type InitEvent =
  | { type: 'INIT_START' }
  | { type: 'INIT_COMPLETE' }
  | { type: 'INIT_FAILED'; error: string }
  | { type: 'INIT_RESTARTING' }
  | { type: 'CHILD_CRASH'; message: string }
  | { type: 'RETRY' };

interface SessionInitState {
  status: InitStatus;
  error: string | null;

  transition: (event: InitEvent) => void;
  triggerInit: () => Promise<void>;
  retry: () => void;
  isReady: () => boolean;
  resetAllStores: () => void;
}

export const useSessionInitStore = create<SessionInitState>((set, get) => ({
  status: 'uninitialized',
  error: null,

  transition: (event) => {
    const { status } = get();
    switch (event.type) {
      case 'INIT_START':
        set({ status: 'initializing', error: null });
        break;

      case 'INIT_COMPLETE':
        set({ status: 'ready', error: null });
        break;

      case 'INIT_FAILED':
        set({ status: 'failed', error: event.error });
        break;

      case 'INIT_RESTARTING':
        set({ status: 'initializing' });
        break;

      case 'CHILD_CRASH':
        set({ status: 'failed', error: event.message });
        get().resetAllStores();
        break;

      case 'RETRY':
        if (status === 'failed') {
          set({ status: 'initializing', error: null });
          get().triggerInit();
        }
        break;
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
          const language = (config.ui?.language as 'zh' | 'en') || 'zh';
          setLanguage(language);
          useConfigStore.getState().updateSettings({
            language,
            theme: (config.ui?.theme as 'light' | 'dark') || 'dark',
            workspacePath: config.workspacePath || '',
            showTokenUsage: config.ui?.showTokenUsage ?? true,
            showCost: config.ui?.showCost ?? true,
            showThinking: config.ui?.showThinking ?? false,
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
    get().transition({ type: 'RETRY' });
  },

  isReady: () => get().status === 'ready',

  resetAllStores: async () => {
    const { useConversationStore } = await import('./ConversationStore');
    const { useAgentStateMachine } = await import('./AgentStateMachine');
    const { useMessageStore } = await import('./messageStore');
    const { useAsyncTaskStore } = await import('./AsyncTaskStore');
    const { useIntentRoutingStore } = await import('./IntentRoutingStore');

    useConversationStore.getState().onAgentCompleted();
    useAgentStateMachine.getState().clearAll();
    useMessageStore.getState().finishStreaming();
    useIntentRoutingStore.getState().transition({ type: 'ROUTE_RESET' });
    const taskStore = useAsyncTaskStore.getState();
    for (const taskId of Object.keys(taskStore.tasks)) {
      taskStore.transition({ type: 'TASK_CLEARED', taskId });
    }
  },
}));
