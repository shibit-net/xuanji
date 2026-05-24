import { ipcMain } from 'electron';
import {
  initChatSession,
  sendRequest,
  isSessionReady,
  getCachedConfig,
  setCachedConfig,
  getAgentProcessPid,
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
      console.log('AGENT:INIT get-config response:', JSON.stringify({ hasUi: config?.ui !== undefined, ui: config?.ui }));
      setCachedConfig(config);
      return { success: true, config };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('agent:user-action', async (_event, action: { type: string; message?: string; attachments?: Array<{ name: string; path?: string; content: string; size: number }>; imageBlocks?: Array<{ data: string; mimeType: string; name?: string }>; audioBlocks?: Array<{ data: string; mimeType: string; name?: string }>; videoBlocks?: Array<{ data: string; mimeType: string; name?: string }>; agentId?: string }) => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      const result = await sendRequest('user-action', action, 120000);
      return { success: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
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
      const os = require('os');
      const totalMem = os.totalmem();
      const totalMemMB = Math.round(totalMem / (1024 * 1024));

      // 跨平台资源采集：macOS/Linux 用 ps，Windows 用 tasklist + 内置 API
      let cpuPercent = 0;
      let usedMemMB = 0;

      if (process.platform === 'win32') {
        cpuPercent = getCpuPercentWin();
        usedMemMB = await getMemoryUsageWin(process.pid);
      } else {
        // macOS / Linux：ps -A 遍历进程树
        const result = getResourceUsagePosix(process.pid, totalMemMB);
        cpuPercent = result.cpu;
        usedMemMB = result.memMB;
      }

      const memPercent = totalMemMB > 0 ? Math.round((usedMemMB / totalMemMB) * 1000) / 10 : 0;

      return {
        success: true,
        data: {
          cpu: { percentCPUUsage: cpuPercent },
          memory: { usedMB: usedMemMB, totalMB: totalMemMB, percent: memPercent },
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}

/** Windows 平台：CPU 使用率（仅统计 xuanji 主进程 + agent 子进程） */
let prevCpuUsage: { user: number; system: number; timestamp: number } | null = null;
let prevAgentCpuSec: { seconds: number; timestamp: number } | null = null;

function getCpuPercentWin(): number {
  const now = Date.now();
  const usage = process.cpuUsage();

  // 主进程 CPU（process.cpuUsage 差值）
  let mainCpuPercent = 0;
  if (prevCpuUsage) {
    const deltaUs = (usage.user - prevCpuUsage.user) + (usage.system - prevCpuUsage.system);
    const deltaMs = now - prevCpuUsage.timestamp;
    if (deltaMs > 0) {
      mainCpuPercent = (deltaUs / (deltaMs * 1000)) * 100;
    }
  }
  prevCpuUsage = { user: usage.user, system: usage.system, timestamp: now };

  // Agent 子进程 CPU（PowerShell Get-Process 差值）
  let agentCpuPercent = 0;
  const agentPid = getAgentProcessPid();
  if (agentPid) {
    try {
      const { execSync } = require('child_process');
      const raw = execSync(
        `powershell -NoProfile -Command "(Get-Process -Id ${agentPid}).CPU"`,
        { encoding: 'utf-8', timeout: 2000 }
      );
      const cpuSeconds = parseFloat(raw.trim());
      if (!isNaN(cpuSeconds)) {
        if (prevAgentCpuSec) {
          const deltaSec = cpuSeconds - prevAgentCpuSec.seconds;
          const deltaMs = now - prevAgentCpuSec.timestamp;
          if (deltaMs > 0 && deltaSec >= 0) {
            agentCpuPercent = (deltaSec / (deltaMs / 1000)) * 100;
          }
        }
        prevAgentCpuSec = { seconds: cpuSeconds, timestamp: now };
      }
    } catch {
      // PowerShell 不可用时忽略子进程 CPU
    }
  }

  const total = mainCpuPercent + agentCpuPercent;
  return Math.round(total * 10) / 10;
}

/** Windows 平台：仅统计 xuanji 自身进程内存（主进程 RSS + agent 子进程 RSS） */
function getMemoryUsageWin(parentPid: number): number {
  let totalMemMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const agentPid = getAgentProcessPid();
  if (!agentPid || agentPid === parentPid) return totalMemMB;

  try {
    const { execSync } = require('child_process');
    const raw = execSync(`tasklist /FO CSV /NH /FI "PID eq ${agentPid}"`, {
      encoding: 'utf-8',
      timeout: 2000,
    });
    // CSV 格式: "ImageName","PID","SessionName","Session#","Mem Usage"
    const match = raw.match(/(\d[\d,]*)\s*K/);
    if (match) {
      const agentKB = parseInt(match[1].replace(/,/g, ''), 10);
      if (!isNaN(agentKB)) {
        totalMemMB += Math.round(agentKB / 1024);
      }
    }
  } catch {
    // tasklist 失败时仅返回主进程内存
  }
  return totalMemMB;
}

/** macOS/Linux：ps -A 遍历进程树获取 CPU + 内存 */
function getResourceUsagePosix(
  pid: number,
  _totalMemMB: number
): { cpu: number; memMB: number } {
  const { execSync } = require('child_process');
  const raw = execSync('ps -A -o pid= -o ppid= -o %cpu= -o rss=', {
    encoding: 'utf-8',
    timeout: 2000,
  });
  const lines = raw.trim().split('\n').filter(Boolean);

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

  const self = procs.find(p => p.pid === pid);
  if (self) {
    totalCPU += self.cpu;
    totalRSS += self.rss;
    visited.add(pid);
  }
  walk(pid);

  const memMB = Math.round(totalRSS / 1024);
  return {
    cpu: Math.round(totalCPU * 10) / 10,
    memMB,
  };
}

export { registerAgentIpcHandlers, registerSystemIpcHandlers };
