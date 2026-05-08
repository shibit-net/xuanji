import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerToolsIpcHandlers() {
  ipcMain.handle('tools:list', async () => {
    if (!isSessionReady()) {
      console.warn('[IPC tools:list] 会话未初始化');
      return { success: false, error: '会话未初始化' };
    }

    try {
      const result = await sendRequest('tools-list');
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC tools:list] 异常:', msg);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('todo:archive-completed', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('todo-archive-completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('todo:get-archived-count', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('todo-get-archived-count');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}

export { registerToolsIpcHandlers };
