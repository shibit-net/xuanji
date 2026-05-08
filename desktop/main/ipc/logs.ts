import { ipcMain } from 'electron';
import path from 'path';
import {
  UnifiedLogManager,
  getUnifiedLogManager,
  type UnifiedLogFilter,
  type LokiClientConfig
} from '@root/src/core/logging/UnifiedLogManager';
import { LogReader } from '@root/src/core/logger/LogReader';
import { getMainWindow } from '../window/index.js';

// 全局统一日志管理器实例
let unifiedLogManager: UnifiedLogManager | null = null;

/**
 * 获取或创建统一日志管理器
 */
function getUnifiedManager(): UnifiedLogManager {
  if (!unifiedLogManager) {
    unifiedLogManager = getUnifiedLogManager();
  }
  return unifiedLogManager;
}

/**
 * 注册统一日志 IPC 处理器
 */
function registerLogsIpcHandlers() {
  const logDir = path.join(process.cwd(), '.xuanji', 'logs');
  const manager = getUnifiedManager();

  // ─────────────────────────────────────────────────────
  // 统一查询接口
  // ─────────────────────────────────────────────────────

  ipcMain.handle('unified-logs:query', async (_event, filter?: UnifiedLogFilter) => {
    try {
      const result = await manager.query(filter);
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('unified-logs:get-stats', async () => {
    try {
      const stats = await manager.getStats();
      return { success: true, data: stats };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('unified-logs:get-live', async (_event, limit?: number) => {
    try {
      const logs = manager.getLiveLogs(limit);
      return { success: true, data: logs };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('unified-logs:clear-live', async () => {
    try {
      manager.clearLiveLogs();
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  // ─────────────────────────────────────────────────────
  // 实时日志订阅
  // ─────────────────────────────────────────────────────

  ipcMain.handle('unified-logs:subscribe', async (_event) => {
    try {
      // 订阅新日志
      const unsubscribe = manager.subscribe((record) => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('unified-logs:new-record', record);
        }
      });

      // 存储取消订阅函数
      (ipcMain as any)._unsubscribeLogs = unsubscribe;

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('unified-logs:unsubscribe', async () => {
    try {
      const unsubscribe = (ipcMain as any)._unsubscribeLogs;
      if (unsubscribe) {
        unsubscribe();
        (ipcMain as any)._unsubscribeLogs = null;
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  // ─────────────────────────────────────────────────────
  // Loki 集成
  // ─────────────────────────────────────────────────────

  ipcMain.handle('unified-logs:loki:enable', async (_event, config: LokiClientConfig) => {
    try {
      manager.setLokiClient({ ...config, enabled: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('unified-logs:loki:disable', async () => {
    try {
      const lokiClient = manager.getLokiClient();
      if (lokiClient) {
        lokiClient.setEnabled(false);
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('unified-logs:loki:health-check', async () => {
    try {
      const lokiClient = manager.getLokiClient();
      const healthy = lokiClient ? await lokiClient.healthCheck() : false;
      return { success: true, data: healthy };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('unified-logs:loki:sync', async (_event, filter?: UnifiedLogFilter) => {
    try {
      await manager.syncToLoki(filter);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  // ─────────────────────────────────────────────────────
  // 向后兼容：保留原有的日志接口
  // ─────────────────────────────────────────────────────

  const logReader: any = new LogReader(logDir);
  let logWatcherCleanup: (() => void) | null = null;

  ipcMain.handle('logs:read', async (_event, query: any) => {
    try {
      return await logReader.read(query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('logs:read-latest', async (_event, count?: number, levels?: string[]) => {
    try {
      return await logReader.readLatest(count, levels);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('logs:clear', async () => {
    try {
      await logReader.clear();
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('logs:stats', async () => {
    try {
      return await logReader.getStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('logs:start-watch', async (_event, levels: string[]) => {
    try {
      logWatcherCleanup = logReader.watch((record: any) => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('logs:new-record', record);
        }
      }, levels);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('logs:stop-watch', async () => {
    try {
      if (logWatcherCleanup) {
        logWatcherCleanup();
        logWatcherCleanup = null;
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}

export { registerLogsIpcHandlers };
