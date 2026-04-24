import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerToolsIpcHandlers() {
  ipcMain.handle('tools:list', async () => {
    console.log('[IPC tools:list] 收到请求');
    console.log('[IPC tools:list] isSessionReady:', isSessionReady());

    if (!isSessionReady()) {
      console.warn('[IPC tools:list] 会话未初始化');
      return { success: false, error: '会话未初始化' };
    }

    try {
      console.log('[IPC tools:list] 发送 tools-list 请求到 agent-bridge');
      const result = await sendRequest('tools-list');
      console.log('[IPC tools:list] 收到响应:', JSON.stringify(result, null, 2));
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
