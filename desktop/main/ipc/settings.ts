import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerSettingsIpcHandlers() {
  ipcMain.handle('settings:get-config', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('get-config');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('settings:update-config', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('update-config', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}

export { registerSettingsIpcHandlers };
