import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerMemoryIpcHandlers() {
  // ─── 诊断状态 ───────────────────────────────────────────
  ipcMain.handle('memory:status', async () => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-status'); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 统计 ──────────────────────────────────────────────
  ipcMain.handle('memory:stats', async () => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-stats'); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 搜索 ──────────────────────────────────────────────
  ipcMain.handle('memory:search', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-search', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 实体列表 ──────────────────────────────────────────
  ipcMain.handle('memory:entities', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-entities', data || {}); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 事实列表 ──────────────────────────────────────────
  ipcMain.handle('memory:facts', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-facts', data || {}); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 事件时间线 ────────────────────────────────────────
  ipcMain.handle('memory:timeline', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-timeline', data || {}); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 叙事记忆 ──────────────────────────────────────────
  ipcMain.handle('memory:episodes', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-episodes', data || {}); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 关系 ──────────────────────────────────────────────
  ipcMain.handle('memory:relations', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-relations', data || {}); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 图谱数据 ──────────────────────────────────────────
  ipcMain.handle('memory:graph-data', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-graph-data', data || {}); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 删除实体 ──────────────────────────────────────────
  ipcMain.handle('memory:delete-entity', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-delete-entity', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 手动触发记忆提取 ──────────────────────────────────
  ipcMain.handle('memory:flush', async () => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-flush'); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── 清空全部 ──────────────────────────────────────────
  ipcMain.handle('memory:clear-all', async () => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('memory-clear-all'); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });
}

export { registerMemoryIpcHandlers };
