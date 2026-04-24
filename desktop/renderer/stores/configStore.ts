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
import { persist } from 'zustand/middleware';
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
  agents: AgentProfile[];
  tools: ToolDefinition[];

  // ========== 加载状态 ==========
  loaded: boolean;
  loading: boolean;
  error: string | null;

  // ========== Settings 操作 ==========
  loadSettings: () => Promise<void>;
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
  language: 'zh-CN',
  theme: 'dark',
  fontSize: 14,
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
  persist(
    (set, get) => ({
      // ========== 初始状态 ==========
      settings: defaultSettings,
      agents: [],
      tools: [],
      loaded: false,
      loading: false,
      error: null,

      // ========== Settings 操作 ==========
      loadSettings: async () => {
        set({ loading: true, error: null });
        try {
          const result = await window.electron.settingsGetConfig();
          if (result.success && result.config) {
            set({ settings: result.config, loaded: true });
          } else if (result.error) {
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
          const result = await window.electron.settingsUpdateConfig(newSettings);
          if (result.success) {
            set({ settings: newSettings });
          } else if (result.error) {
            set({ error: result.error });
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
            get().loadSettings(),
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
    }),
    {
      name: 'xuanji-config-storage',
      // 只持久化 settings，其他数据从后端加载
      partialize: (state) => ({ settings: state.settings }),
      // 合并策略：确保所有字段都有默认值
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ConfigState>;
        return {
          ...currentState,
          settings: {
            ...defaultSettings,
            ...persisted.settings,
            model: {
              ...defaultSettings.model,
              ...(persisted.settings?.model || {}),
            },
            api: {
              ...defaultSettings.api,
              ...(persisted.settings?.api || {}),
            },
            permissions: {
              ...defaultSettings.permissions,
              ...(persisted.settings?.permissions || {}),
            },
          },
        };
      },
    }
  )
);
