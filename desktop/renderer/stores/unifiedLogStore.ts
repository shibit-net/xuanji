// ============================================================
// Xuanji Desktop - 统一日志 Store (Unified Log Store)
// ============================================================
// 职责：
// - 管理统一日志的查询和状态
// - 实时日志订阅和推送
// - Loki 集成配置和状态
// - 统一日志的颜色和样式管理
// ============================================================

import { create } from 'zustand';
import { ipcRenderer } from 'electron';

// 导入类型（注意：因为是前端，只能使用类型导入）
import type {
  UnifiedLogRecord,
  UnifiedLogFilter,
  UnifiedQueryResult,
  LogStats,
  LokiClientConfig,
  LogSource
} from '@root/src/infrastructure/logging/UnifiedLogManager';

// 日志源颜色配置（前端版本）
export const LOG_SOURCE_COLORS: Record<LogSource, { color: string; emoji: string }> = {
  core: { color: '#60a5fa', emoji: '📝' },
  agentloop: { color: '#a78bfa', emoji: '🤖' },
  session: { color: '#34d399', emoji: '💬' },
  audit: { color: '#f472b6', emoji: '🔐' },
  usage: { color: '#fbbf24', emoji: '📊' },
  daily: { color: '#f87171', emoji: '📅' },
};

// 日志级别颜色配置
export const LOG_LEVEL_COLORS: Record<string, { color: string; emoji: string }> = {
  debug: { color: '#9ca3af', emoji: '🔍' },
  info: { color: '#60a5fa', emoji: 'ℹ️' },
  warn: { color: '#fbbf24', emoji: '⚠️' },
  error: { color: '#ef4444', emoji: '❌' },
  success: { color: '#34d399', emoji: '✅' },
};

// Store 状态接口
interface UnifiedLogStoreState {
  // ========== 日志数据 ==========
  /** 查询结果 */
  queryResult: UnifiedQueryResult | null;
  /** 实时日志流 */
  liveLogs: UnifiedLogRecord[];
  /** 统计数据 */
  stats: LogStats | null;

  // ========== 查询状态 ==========
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否正在查询历史 */
  isQuerying: boolean;
  /** 错误信息 */
  error: string | null;

  // ========== 查询过滤器 ==========
  /** 当前过滤器 */
  filter: UnifiedLogFilter;

  // ========== 订阅状态 ==========
  /** 是否已订阅实时日志 */
  isSubscribed: boolean;

  // ========== Loki 配置 ==========
  /** Loki 是否启用 */
  lokiEnabled: boolean;
  /** Loki 连接状态 */
  lokiHealthy: boolean;
  /** Loki 配置 */
  lokiConfig: LokiClientConfig | null;

  // ========== UI 状态 ==========
  /** 是否显示日志面板 */
  panelVisible: boolean;
  /** 自动滚动 */
  autoScroll: boolean;

  // ========== 操作方法 ==========
  // 查询操作
  queryLogs: (filter?: UnifiedLogFilter) => Promise<void>;
  getStats: () => Promise<void>;
  getLiveLogs: (limit?: number) => Promise<void>;
  clearLiveLogs: () => Promise<void>;

  // 过滤器操作
  setFilter: (filter: Partial<UnifiedLogFilter>) => void;
  resetFilter: () => void;

  // 订阅操作
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;

  // Loki 操作
  enableLoki: (config: LokiClientConfig) => Promise<void>;
  disableLoki: () => Promise<void>;
  checkLokiHealth: () => Promise<void>;
  syncToLoki: (filter?: UnifiedLogFilter) => Promise<void>;

  // UI 操作
  togglePanel: () => void;
  setPanelVisible: (visible: boolean) => void;
  setAutoScroll: (enabled: boolean) => void;

  // 状态管理
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

// 初始过滤器
const initialFilter: UnifiedLogFilter = {
  limit: 100,
  sources: ['core', 'agentloop', 'session', 'audit', 'usage'],
};

// 创建 Store
export const useUnifiedLogStore = create<UnifiedLogStoreState>()((set, get) => ({
  // ========== 初始状态 ==========
  queryResult: null,
  liveLogs: [],
  stats: null,
  isLoading: false,
  isQuerying: false,
  error: null,
  filter: initialFilter,
  isSubscribed: false,
  lokiEnabled: false,
  lokiHealthy: false,
  lokiConfig: null,
  panelVisible: false,
  autoScroll: true,

  // ========== 查询操作 ==========
  queryLogs: async (filter?: UnifiedLogFilter) => {
    set({ isQuerying: true, error: null });
    try {
      const result = await ipcRenderer.invoke('unified-logs:query', filter || get().filter);
      if (result.success) {
        set({ queryResult: result.data });
      } else {
        set({ error: result.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
    } finally {
      set({ isQuerying: false });
    }
  },

  getStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await ipcRenderer.invoke('unified-logs:get-stats');
      if (result.success) {
        set({ stats: result.data });
      } else {
        set({ error: result.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
    } finally {
      set({ isLoading: false });
    }
  },

  getLiveLogs: async (limit = 100) => {
    try {
      const result = await ipcRenderer.invoke('unified-logs:get-live', limit);
      if (result.success) {
        set({ liveLogs: result.data });
      }
    } catch (err) {
      console.error('[unifiedLogStore] 获取实时日志失败:', err);
    }
  },

  clearLiveLogs: async () => {
    try {
      await ipcRenderer.invoke('unified-logs:clear-live');
      set({ liveLogs: [] });
    } catch (err) {
      console.error('[unifiedLogStore] 清除实时日志失败:', err);
    }
  },

  // ========== 过滤器操作 ==========
  setFilter: (filter: Partial<UnifiedLogFilter>) => {
    set((state) => ({
      filter: { ...state.filter, ...filter },
    }));
  },

  resetFilter: () => {
    set({ filter: initialFilter });
  },

  // ========== 订阅操作 ==========
  subscribe: async () => {
    if (get().isSubscribed) return;

    try {
      const result = await ipcRenderer.invoke('unified-logs:subscribe');
      if (result.success) {
        set({ isSubscribed: true });

        // 监听新日志
        ipcRenderer.on('unified-logs:new-record', (_event, record: UnifiedLogRecord) => {
          set((state) => ({
            liveLogs: [record, ...state.liveLogs].slice(0, 1000), // 最多保留1000条
          }));
        });
      }
    } catch (err) {
      console.error('[unifiedLogStore] 订阅失败:', err);
    }
  },

  unsubscribe: async () => {
    if (!get().isSubscribed) return;

    try {
      await ipcRenderer.invoke('unified-logs:unsubscribe');
      ipcRenderer.removeAllListeners('unified-logs:new-record');
      set({ isSubscribed: false });
    } catch (err) {
      console.error('[unifiedLogStore] 取消订阅失败:', err);
    }
  },

  // ========== Loki 操作 ==========
  enableLoki: async (config: LokiClientConfig) => {
    try {
      const result = await ipcRenderer.invoke('unified-logs:loki:enable', config);
      if (result.success) {
        set({ lokiEnabled: true, lokiConfig: config });
      }
    } catch (err) {
      console.error('[unifiedLogStore] 启用 Loki 失败:', err);
    }
  },

  disableLoki: async () => {
    try {
      await ipcRenderer.invoke('unified-logs:loki:disable');
      set({ lokiEnabled: false, lokiHealthy: false });
    } catch (err) {
      console.error('[unifiedLogStore] 禁用 Loki 失败:', err);
    }
  },

  checkLokiHealth: async () => {
    try {
      const result = await ipcRenderer.invoke('unified-logs:loki:health-check');
      if (result.success) {
        set({ lokiHealthy: result.data });
      }
    } catch (err) {
      console.error('[unifiedLogStore] Loki 健康检查失败:', err);
      set({ lokiHealthy: false });
    }
  },

  syncToLoki: async (filter?: UnifiedLogFilter) => {
    try {
      await ipcRenderer.invoke('unified-logs:loki:sync', filter);
    } catch (err) {
      console.error('[unifiedLogStore] 同步到 Loki 失败:', err);
    }
  },

  // ========== UI 操作 ==========
  togglePanel: () => {
    set((state) => ({ panelVisible: !state.panelVisible }));
  },

  setPanelVisible: (visible: boolean) => {
    set({ panelVisible: visible });
  },

  setAutoScroll: (enabled: boolean) => {
    set({ autoScroll: enabled });
  },

  // ========== 状态管理 ==========
  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  setError: (error: string | null) => {
    set({ error });
  },
}));

// ========== 工具函数 ==========

/**
 * 获取日志源的颜色和 emoji
 */
export function getSourceStyle(source: LogSource) {
  return LOG_SOURCE_COLORS[source] || LOG_SOURCE_COLORS.core;
}

/**
 * 获取日志级别的颜色和 emoji
 */
export function getLevelStyle(level: string) {
  return LOG_LEVEL_COLORS[level.toLowerCase()] || LOG_LEVEL_COLORS.info;
}

/**
 * 格式化时间戳
 */
export function formatTimestamp(timestamp: string | number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

/**
 * 格式化日志记录用于显示
 */
export function formatLogRecord(record: UnifiedLogRecord) {
  const sourceStyle = getSourceStyle(record.source);
  const levelStyle = getLevelStyle(record.level);

  return {
    timestamp: formatTimestamp(record.timestamp),
    source: {
      name: record.source,
      emoji: sourceStyle.emoji,
      color: sourceStyle.color,
    },
    level: {
      name: record.level,
      emoji: levelStyle.emoji,
      color: levelStyle.color,
    },
    namespace: record.namespace,
    message: record.message,
    data: record.data,
  };
}

/**
 * 过滤日志记录
 */
export function filterLogs(
  logs: UnifiedLogRecord[],
  filter: {
    sources?: LogSource[];
    levels?: string[];
    keyword?: string;
  }
): UnifiedLogRecord[] {
  return logs.filter((log) => {
    // 源过滤
    if (filter.sources && filter.sources.length > 0) {
      if (!filter.sources.includes(log.source)) {
        return false;
      }
    }

    // 级别过滤
    if (filter.levels && filter.levels.length > 0) {
      if (!filter.levels.includes(log.level.toLowerCase())) {
        return false;
      }
    }

    // 关键词过滤
    if (filter.keyword) {
      const keyword = filter.keyword.toLowerCase();
      const text = `${log.message} ${log.namespace || ''}`.toLowerCase();
      if (!text.includes(keyword)) {
        return false;
      }
    }

    return true;
  });
}
