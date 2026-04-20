import { ipcMain } from 'electron';
import {
  initChatSession,
  sendRequest,
  isSessionReady,
  getCachedConfig,
  setCachedConfig,
  getAgentProcess
} from '../agent/index.js';

function registerAgentIpcHandlers() {
  ipcMain.handle('agent:init', async () => {
    if (isSessionReady() && getCachedConfig()) {
      return { success: true, config: getCachedConfig() };
    }

    if (!isSessionReady()) {
      const success = await initChatSession();
      if (!success) {
        return { success: false, error: 'ChatSession 初始化失败' };
      }
    }

    try {
      const config = await sendRequest('get-config');
      setCachedConfig(config);
      return { success: true, config };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('agent:send-message', async (_event, message: string) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    const agentProcess = getAgentProcess();
    if (!agentProcess) {
      return { success: false, error: '会话未初始化' };
    }

    agentProcess.send({ type: 'send-message', data: message });
    return { success: true };
  });

  ipcMain.handle('agent:interrupt', async (_event, message?: string) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    const agentProcess = getAgentProcess();
    if (!agentProcess) {
      return { success: false, error: '会话未初始化' };
    }

    agentProcess.send({ type: 'interrupt', data: { message: message || '' } });
    return { success: true };
  });

  ipcMain.handle('agent:reset', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      const result = await sendRequest('reset');
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('agent:get-state', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('get-state');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  // Agent 列表查询
  ipcMain.handle('agent:list', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('agent-list');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('agent:get', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('agent-get', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('agent:create', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('agent-create', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('agent:update', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('agent-update', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('agent:delete', async (_event, data: any) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('agent-delete', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('agent:send-supplement', async (_event, content: string) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    const agentProcess = getAgentProcess();
    if (!agentProcess) {
      return { success: false, error: '会话未初始化' };
    }

    agentProcess.send({ type: 'supplement', data: content });
    return { success: true };
  });

  ipcMain.handle('agent:analyze-intent', async (_event, prompt: string) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('analyze-intent', prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}

export { registerAgentIpcHandlers };
