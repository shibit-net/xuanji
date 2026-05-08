import { ipcMain } from 'electron';
import {
  initChatSession,
  sendRequest,
  isSessionReady,
  getCachedConfig,
  setCachedConfig,
  getAgentProcess
} from '../agent/index.js';

function logToRender(msg: string) {
  process.stderr.write('[Agent:Debug] ' + msg + '\n');
}

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
      logToRender('send-message: session not ready');
      return { success: false, error: '会话未初始化' };
    }

    try {
      const result = await sendRequest('send-message', { message }, 120000);
      return { success: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : '';
      logToRender('send-message FAILED: ' + msg + '\n' + stack);
      return { success: false, error: msg };
    }
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

  ipcMain.handle('agent:append-message', async (_event, message: string) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    const agentProcess = getAgentProcess();
    if (!agentProcess) {
      return { success: false, error: '会话未初始化' };
    }

    agentProcess.send({ type: 'append-message', data: message });
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

function registerSystemIpcHandlers() {
  ipcMain.handle('system:resource-usage', async () => {
    try {
      const { execSync } = require('child_process');
      const os = require('os');

      const totalMem = os.totalmem();
      const totalMemMB = Math.round(totalMem / (1024 * 1024));

      // 使用 ps 获取本进程及所有子进程的资源
      const pid = process.pid;
      const raw = execSync('ps -A -o pid= -o ppid= -o %cpu= -o rss=', {
        encoding: 'utf-8',
        timeout: 2000,
      });
      const lines = raw.trim().split('\n').filter(Boolean);

      // 构建进程树
      const procs: Array<{ pid: number; ppid: number; cpu: number; rss: number }> = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          procs.push({
            pid: parseInt(parts[0]),
            ppid: parseInt(parts[1]),
            cpu: parseFloat(parts[2]) || 0,
            rss: parseFloat(parts[3]) || 0,
          });
        }
      }

      // 递归累加子孙进程
      let totalCPU = 0;
      let totalRSS = 0;
      const visited = new Set<number>();
      const walk = (parentPid: number) => {
        for (const p of procs) {
          if (p.ppid === parentPid && !visited.has(p.pid)) {
            visited.add(p.pid);
            totalCPU += p.cpu;
            totalRSS += p.rss;
            walk(p.pid);
          }
        }
      };
      // 加上自己
      const self = procs.find(p => p.pid === pid);
      if (self) {
        totalCPU += self.cpu;
        totalRSS += self.rss;
        visited.add(pid);
      }
      walk(pid);

      const memMB = Math.round(totalRSS / 1024);
      const memPercent = totalMemMB > 0 ? Math.round((memMB / totalMemMB) * 1000) / 10 : 0;

      return {
        success: true,
        data: {
          cpu: { percentCPUUsage: Math.round(totalCPU * 10) / 10 },
          memory: { usedMB: memMB, totalMB: totalMemMB, percent: memPercent },
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}

export { registerAgentIpcHandlers, registerSystemIpcHandlers };
