import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerMemoryIpcHandlers() {
  ipcMain.handle('memory:retrieve', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('retrieve-memory', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('memory:stats', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('memory-stats');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('memory:get-config', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('get-memory-config');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('memory:save-config', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('save-memory-config', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('memory:manual-flush', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('manual-memory-flush');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('memory:extract-topics', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('extract-topics');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('memory:get-list', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('get-memory-list', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}

export { registerMemoryIpcHandlers };
