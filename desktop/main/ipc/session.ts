import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerSessionIpcHandlers() {
  ipcMain.handle('session:save', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('save-session', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('session:resume', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('resume-session', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('session:list', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('list-sessions');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('session:delete', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('delete-session', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('checkpoint:create', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('create-checkpoint', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('checkpoint:list', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('list-checkpoints');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('checkpoint:rewind', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('rewind-checkpoint', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}

export { registerSessionIpcHandlers };
