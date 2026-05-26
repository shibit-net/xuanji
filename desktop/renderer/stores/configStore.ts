// ============================================================
// Xuanji Desktop - 配置 Store (Configuration Store)
// ============================================================
// 职责：
// - 管理所有静态配置（Settings, Agents, Tools）
// - 从后端 IPC 加载配置
// - 保存配置到后端
// - 持久化用户设置（通过 zustand persist）
// ============================================================

import { create } from 'zustand';
import { setLanguage } from '@/core/i18n';
import { useAuthStore } from '../stores/authStore';
import type {
  UserSettings,
  ModelConfig,
  APIConfig,
  PermissionConfig,
  AgentProfile,
  ToolDefinition,
} from '../types/models';

interface ConfigState {
  // ========== 数据 ==========
  settings: UserSettings;
  fullConfig: any;  // 后端返回的完整配置，供 SettingsPage 等使用
  agents: AgentProfile[];
  tools: ToolDefinition[];

  // ========== 加载状态 ==========
  loaded: boolean;
  loading: boolean;
  error: string | null;
  fallbackProvider: any | null;

  // ========== 统一配置加载（唯一入口） ==========
  loadConfig: () => Promise<void>;
  initSettings: (settings: Partial<UserSettings>) => void;

  // ========== Settings 操作 ==========
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  updateModelConfig: (config: Partial<ModelConfig>) => void;
  updateAPIConfig: (config: Partial<APIConfig>) => void;
  updatePermissionConfig: (config: Partial<PermissionConfig>) => void;

  // ========== Agents 操作 ==========
  loadAgents: () => Promise<void>;
  getAgent: (id: string) => AgentProfile | undefined;
  createAgent: (agent: Partial<AgentProfile>) => Promise<void>;
  updateAgent: (id: string, agent: Partial<AgentProfile>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;

  // ========== Tools 操作 ==========
  loadTools: () => Promise<void>;
  getTool: (name: string) => ToolDefinition | undefined;

  // ========== 批量加载 ==========
  loadAll: () => Promise<void>;
}

const defaultSettings: UserSettings = {
  language: 'en',
  theme: 'auto',
  fontSize: 14,
  workspacePath: '',
  showTokenUsage: true,
  showThinking: true,
  model: {
    defaultModel: 'claude-3-5-haiku-20241022',
    temperature: 1.0,
    maxTokens: 8000,
    streaming: true,
  },
  api: {},
  permissions: {
    autoAllowRead: true,
    autoAllowWrite: false,
    autoAllowBash: false,
  },
};

export const useConfigStore = create<ConfigState>()(
  (set, get) => ({
      // ========== 初始状态 ==========
      settings: defaultSettings,
      fullConfig: null,
      agents: [],
      tools: [],
      loaded: false,
      loading: false,
      error: null,
      fallbackProvider: null,

      // ========== 统一配置加载（唯一入口） ==========
      loadConfig: async () => {
        // 避免重复加载
        if (get().loaded || get().loading) return;
        set({ loading: true, error: null });

        try {
          // 第一步：直接从磁盘读配置（不依赖 session），快速决定路由
          const userId = useAuthStore.getState().user?.userId;
          console.log(`[DIAG] loadConfig: userId=${userId}`);
          const diskResult = await window.electron.settingsReadDiskConfig?.(userId);
          if (diskResult?.success && diskResult.config) {
            const c = diskResult.config;
            const language = (c.ui?.language as 'zh' | 'en') || 'en';
            console.log('[configStore] loadConfig from disk, fallbackProvider:', JSON.stringify(c.fallbackProvider));
            setLanguage(language);
            set({
              fullConfig: c,
              settings: {
                language,
                theme: (c.ui?.theme as 'light' | 'dark' | 'auto') || 'auto',
                fontSize: 14,
                workspacePath: (c.workspacePath as string) || '',
                showTokenUsage: c.ui?.showTokenUsage ?? true,
                showThinking: c.ui?.showThinking ?? true,
                model: {
                  defaultModel: c.provider?.model || '',
                  temperature: c.provider?.temperature ?? 1.0,
                  maxTokens: c.provider?.maxTokens ?? 8000,
                  streaming: true,
                },
                api: {},
                permissions: get().settings.permissions,
              },
              fallbackProvider: c.fallbackProvider || null,
              loaded: true,
              loading: false,
            });

            return;
          }

          // 磁盘无配置（首次登录），直接设置 loaded=true，让 SetupGuard 跳转到引导页
          set({
            loaded: true,
            loading: false,
            fallbackProvider: null,
          });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[configStore] loadConfig failed:', msg);
          set({ loading: false, error: msg });
        }
      },

      initSettings: (settings) => {
        const newSettings = { ...get().settings, ...settings };
        set({ settings: newSettings, loaded: true });
      },

      loadSettings: async () => {
        set({ loading: true, error: null });
        try {
          const initResult = await window.electron.agentInit?.();
          const result = initResult?.success && initResult.config
            ? initResult
            : await window.electron.settingsGetFullConfig?.()
              ?? await window.electron.settingsGetConfig?.();
          if (result?.success && result.config) {
            const c = result.config;
            const language = (c.ui?.language as 'zh' | 'en') || 'en';
            console.log('[configStore] loadSettings language from config:', language, 'ui:', JSON.stringify(c.ui));
            setLanguage(language);
            set({
              settings: {
                language,
                theme: (c.ui?.theme as 'light' | 'dark' | 'auto') || 'auto',
                fontSize: 14,
                workspacePath: (c.workspacePath as string) || '',
                showTokenUsage: c.ui?.showTokenUsage ?? true,
                showThinking: c.ui?.showThinking ?? true,
                model: {
                  defaultModel: c.provider?.model || '',
                  temperature: c.provider?.temperature ?? 1.0,
                  maxTokens: c.provider?.maxTokens ?? 8000,
                  streaming: true,
                },
                api: {},
                permissions: get().settings.permissions,
              },
              fallbackProvider: c.fallbackProvider || null,
              loaded: true,
            });
          } else if (result?.error) {
            set({ error: result.error });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
          set({ loading: false });
        }
      },

      updateSettings: async (settings) => {
        try {
          const newSettings = { ...get().settings, ...settings };
          // 分离 UI 和 Provider 字段，分别按 section 更新
          const uiData: Record<string, unknown> = {};
          if (settings.theme !== undefined) uiData.theme = newSettings.theme;
          if (settings.language !== undefined) uiData.language = newSettings.language;
          if (settings.showTokenUsage !== undefined) uiData.showTokenUsage = newSettings.showTokenUsage;
          if (settings.showThinking !== undefined) uiData.showThinking = newSettings.showThinking;

          const providerData: Record<string, unknown> = {};
          if (settings.model?.defaultModel !== undefined) providerData.model = newSettings.model.defaultModel;
          if (settings.model?.temperature !== undefined) providerData.temperature = newSettings.model.temperature;
          if (settings.model?.maxTokens !== undefined) providerData.maxTokens = newSettings.model.maxTokens;

          const updates: Promise<any>[] = [];
          if (Object.keys(uiData).length > 0) {
            updates.push(window.electron.settingsUpdateConfig({ section: 'ui', sectionData: uiData }));
          }
          if (Object.keys(providerData).length > 0) {
            updates.push(window.electron.settingsUpdateConfig({ section: 'provider', sectionData: providerData }));
          }
          if (settings.workspacePath !== undefined) {
            updates.push(window.electron.settingsUpdateConfig({ section: 'workspace', sectionData: { workspacePath: newSettings.workspacePath } }));
          }

          if (updates.length > 0) {
            const results = await Promise.all(updates);
            if (results.every(r => r?.success)) {
              set({ settings: newSettings });
            } else {
              const failed = results.find(r => !r?.success);
              set({ error: failed?.error || '保存失败' });
            }
          } else {
            set({ settings: newSettings });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      updateModelConfig: (config) => {
        const newSettings = {
          ...get().settings,
          model: { ...get().settings.model, ...config },
        };
        set({ settings: newSettings });
      },

      updateAPIConfig: (config) => {
        const newSettings = {
          ...get().settings,
          api: { ...get().settings.api, ...config },
        };
        set({ settings: newSettings });
      },

      updatePermissionConfig: (config) => {
        const newSettings = {
          ...get().settings,
          permissions: { ...get().settings.permissions, ...config },
        };
        set({ settings: newSettings });
      },

      // ========== Agents 操作 ==========
      loadAgents: async () => {
        set({ loading: true, error: null });
        try {
          const result = await window.electron.agentList();
          if (result.success && result.agents) {
            set({ agents: result.agents });
          } else if (result.error) {
            set({ error: result.error });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
          set({ loading: false });
        }
      },

      getAgent: (id) => {
        return get().agents.find((agent) => agent.id === id);
      },

      createAgent: async (agent) => {
        try {
          const result = await window.electron.agentCreate({ config: agent });
          if (result.success) {
            await get().loadAgents(); // 重新加载列表
          } else if (result.error) {
            set({ error: result.error });
            throw new Error(result.error);
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
          throw err;
        }
      },

      updateAgent: async (id, agent) => {
        try {
          const result = await window.electron.agentUpdate({ agentId: id, config: agent });
          if (result.success) {
            await get().loadAgents(); // 重新加载列表
          } else if (result.error) {
            set({ error: result.error });
            throw new Error(result.error);
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
          throw err;
        }
      },

      deleteAgent: async (id) => {
        try {
          const result = await window.electron.agentDelete({ agentId: id });
          if (result.success) {
            await get().loadAgents(); // 重新加载列表
          } else if (result.error) {
            set({ error: result.error });
            throw new Error(result.error);
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
          throw err;
        }
      },

      // ========== Tools 操作 ==========
      loadTools: async () => {
        try {
          const result = await window.electron.toolsList();
          if (result.success && result.tools) {
            set({ tools: result.tools as any });
          } else if (result.error) {
            set({ error: result.error });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      getTool: (name) => {
        return get().tools.find((tool) => tool.name === name);
      },

      // ========== 批量加载 ==========
      loadAll: async () => {
        set({ loading: true, error: null });
        try {
          await Promise.all([
            get().loadConfig(),
            get().loadAgents(),
            get().loadTools(),
          ]);
          set({ loaded: true });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
          set({ loading: false });
        }
      },
    })
);
