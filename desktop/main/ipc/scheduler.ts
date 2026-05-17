import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerSchedulerIpcHandlers() {
  ipcMain.handle('scheduler:jobs', async () => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('scheduler-jobs'); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('scheduler:add', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('scheduler-add', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('scheduler:update', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('scheduler-update', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('scheduler:remove', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('scheduler-remove', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('scheduler:logs', async (_event, data) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('scheduler-logs', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });
}

export { registerSchedulerIpcHandlers };
