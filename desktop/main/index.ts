// ============================================================
// Xuanji Desktop - Electron 主进程
// ============================================================
//
// 架构：Electron 主进程只负责窗口管理和 IPC 转发。
// ChatSession 运行在独立的 Node.js 子进程中（agent-bridge），
// 使用系统 Node.js 而非 Electron 的 Node.js，
// 这样 better-sqlite3 等 native 模块可以正常加载。

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ChildProcess } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let agentProcess: ChildProcess | null = null;
let sessionReady = false;
let cachedConfig: any = null;

// 用于 agent:get-state / agent:init 等请求-响应式 IPC
let pendingRequests = new Map<string, { resolve: (val: any) => void; timer: ReturnType<typeof setTimeout> }>();
let requestIdCounter = 0;

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#1E1E1E',
    titleBarStyle: 'hiddenInset', // macOS 样式
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 开发环境：加载 Vite 开发服务器
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:9100';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：加载打包后的 HTML
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 发送请求到子进程，并等待响应
 */
function sendRequest(type: string, data?: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!agentProcess) {
      reject(new Error('子进程未启动'));
      return;
    }

    const requestId = `req-${++requestIdCounter}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`请求超时 (${type})`));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, timer });
    agentProcess.send({ type, data, requestId });
  });
}

/**
 * 查找系统 Node.js 路径
 */
function findNodePath(): string {
  const { execSync } = require('child_process');
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim();
  } catch {
    return '/usr/local/bin/node';
  }
}

/**
 * 初始化 ChatSession 子进程
 */
async function initChatSession(): Promise<boolean> {
  try {
    // __dirname = desktop/dist-electron, ../.. = 项目根
    const mainProjectRoot = path.resolve(__dirname, '../..');
    console.log('📂 正在启动 ChatSession 子进程...');
    console.log('📂 项目根:', mainProjectRoot);

    const { fork } = require('child_process');

    // agent-bridge.ts 通过 tsx 加载
    const bridgePath = path.join(mainProjectRoot, 'desktop/main/agent-bridge.ts');
    const nodePath = process.env.XUANJI_NODE_PATH || findNodePath();
    const tsxPath = path.join(mainProjectRoot, 'node_modules/.bin/tsx');

    console.log('📂 Node 路径:', nodePath);
    console.log('📂 Bridge 路径:', bridgePath);

    agentProcess = fork(bridgePath, [], {
      cwd: mainProjectRoot,
      env: {
        ...process.env,
        XUANJI_PROJECT_ROOT: mainProjectRoot,
      },
      execPath: nodePath,
      execArgv: ['--import', 'tsx'],
    });

    // 等待初始化完成
    const initResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: '子进程初始化超时（30s）' });
      }, 30000);

      const onMessage = (msg: any) => {
        if (msg.type === 'init-result') {
          clearTimeout(timeout);
          agentProcess!.removeListener('message', onMessage);
          resolve(msg.data);
        }
      };

      agentProcess!.on('message', onMessage);

      agentProcess!.once('error', (err: Error) => {
        clearTimeout(timeout);
        resolve({ success: false, error: err.message });
      });

      agentProcess!.once('exit', (code: number) => {
        clearTimeout(timeout);
        resolve({ success: false, error: `子进程异常退出 (code: ${code})` });
      });

      // 发送初始化命令
      agentProcess!.send({ type: 'init' });
    });

    if (!initResult.success) {
      console.error('❌ ChatSession 子进程初始化失败:', initResult.error);
      return false;
    }

    // 设置持久的消息监听
    setupAgentProcessListeners();
    sessionReady = true;

    console.log('✅ ChatSession 子进程初始化成功');
    return true;
  } catch (err) {
    console.error('❌ ChatSession 初始化失败:', err);
    return false;
  }
}

/**
 * 设置子进程消息监听（持久）
 */
function setupAgentProcessListeners() {
  if (!agentProcess) return;

  agentProcess.on('message', (msg: any) => {
    // 处理请求-响应式消息
    if (msg.requestId && pendingRequests.has(msg.requestId)) {
      const pending = pendingRequests.get(msg.requestId)!;
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.requestId);
      pending.resolve(msg.data);
      return;
    }

    // 处理流式事件转发
    if (!mainWindow) return;

    switch (msg.type) {
      case 'agent:text':
        mainWindow.webContents.send('agent:text', msg.data);
        break;
      case 'agent:thinking':
        mainWindow.webContents.send('agent:thinking', msg.data);
        break;
      case 'agent:tool-start':
        mainWindow.webContents.send('agent:tool-start', msg.data);
        break;
      case 'agent:tool-end':
        mainWindow.webContents.send('agent:tool-end', msg.data);
        break;
      case 'agent:usage':
        mainWindow.webContents.send('agent:usage', msg.data);
        break;
      case 'agent:error':
        mainWindow.webContents.send('agent:error', msg.data);
        break;
      case 'agent:end':
        mainWindow.webContents.send('agent:end', msg.data);
        break;
      case 'send-result':
        // send-message 的完成通知（非请求式）
        break;

      // 权限交互请求（子进程 → renderer）
      case 'permission:request':
        mainWindow.webContents.send('permission:request', msg.data);
        break;
      case 'plan-review:request':
        mainWindow.webContents.send('plan-review:request', msg.data);
        break;
      case 'ask-user:request':
        mainWindow.webContents.send('ask-user:request', msg.data);
        break;
    }
  });

  agentProcess.on('exit', (code: number) => {
    console.log(`⚠️ Agent 子进程退出 (code: ${code})`);
    agentProcess = null;
    sessionReady = false;
    cachedConfig = null;
    // 清理所有 pending 请求
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve({ success: false, error: '子进程已退出' });
    }
    pendingRequests.clear();
  });
}

/**
 * 清理子进程
 */
async function cleanupAgentProcess() {
  if (agentProcess) {
    agentProcess.kill('SIGTERM');
    // 给子进程 3 秒优雅退出
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (agentProcess) {
          agentProcess.kill('SIGKILL');
        }
        resolve();
      }, 3000);
      agentProcess!.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    agentProcess = null;
    sessionReady = false;
  }
}

// ============================================================
// 应用生命周期
// ============================================================

app.whenReady().then(async () => {
  await initChatSession();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  await cleanupAgentProcess();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await cleanupAgentProcess();
});

// ============================================================
// IPC 通信 - 窗口控制
// ============================================================

ipcMain.handle('app:version', () => {
  return app.getVersion();
});

ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

// ============================================================
// IPC 通信 - Agent（全部转发到子进程）
// ============================================================

ipcMain.handle('agent:init', async () => {
  if (sessionReady && cachedConfig) {
    return { success: true, config: cachedConfig };
  }

  if (!sessionReady) {
    const success = await initChatSession();
    if (!success) {
      return { success: false, error: 'ChatSession 初始化失败' };
    }
  }

  try {
    const config = await sendRequest('get-config');
    cachedConfig = config;
    return { success: true, config };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

ipcMain.handle('agent:send-message', async (_event, message: string) => {
  if (!sessionReady || !agentProcess) {
    return { success: false, error: '会话未初始化' };
  }

  // send-message 是流式的，不等待完成
  agentProcess.send({ type: 'send-message', data: message });
  return { success: true };
});

ipcMain.handle('agent:interrupt', async () => {
  if (!sessionReady || !agentProcess) {
    return { success: false, error: '会话未初始化' };
  }

  agentProcess.send({ type: 'interrupt' });
  return { success: true };
});

ipcMain.handle('agent:reset', async () => {
  if (!sessionReady || !agentProcess) {
    return { success: false, error: '会话未初始化' };
  }

  agentProcess.send({ type: 'reset' });
  return { success: true };
});

ipcMain.handle('agent:get-state', async () => {
  if (!sessionReady) {
    return {
      status: 'idle',
      tokenUsage: { input: 0, output: 0 },
      cost: 0,
    };
  }

  try {
    return await sendRequest('get-state');
  } catch {
    return {
      status: 'idle',
      tokenUsage: { input: 0, output: 0 },
      cost: 0,
    };
  }
});

// ============================================================
// IPC 通信 - 设置
// ============================================================

ipcMain.handle('settings:get-config', async () => {
  if (!sessionReady) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const config = await sendRequest('get-full-config');
    return { success: true, config };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

ipcMain.handle('settings:update-config', async (_event, data: any) => {
  if (!sessionReady) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const result = await sendRequest('update-config', data);
    // 清除缓存，下次 agent:init 会重新拉取
    cachedConfig = null;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

// ============================================================
// IPC 通信 - 会话管理
// ============================================================

ipcMain.handle('session:save', async (_event, data: any) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('session-save', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('session:resume', async (_event, data: any) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('session-resume', data, 60000);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('session:list', async () => {
  if (!sessionReady) return { success: true, sessions: [] };
  try {
    return await sendRequest('session-list');
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('session:delete', async (_event, data: any) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('session-delete', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('checkpoint:create', async (_event, data: any) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('checkpoint-create', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('checkpoint:list', async () => {
  if (!sessionReady) return { success: true, checkpoints: [] };
  try {
    return await sendRequest('checkpoint-list');
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('checkpoint:rewind', async (_event, data: any) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('checkpoint-rewind', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ============================================================
// IPC 通信 - 记忆管理
// ============================================================

ipcMain.handle('memory:retrieve', async (_event, data: any) => {
  if (!sessionReady) return { success: true, entries: [] };
  try {
    return await sendRequest('memory-retrieve', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('memory:stats', async () => {
  if (!sessionReady) return { success: true, stats: null };
  try {
    return await sendRequest('memory-stats');
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ============================================================
// IPC 通信 - 工具统计
// ============================================================

ipcMain.handle('usage:stats', async () => {
  if (!sessionReady) return { success: true, stats: null };
  try {
    return await sendRequest('get-usage-stats');
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ============================================================
// IPC 通信 - Agent 管理
// ============================================================

ipcMain.handle('agent:list', async () => {
  if (!sessionReady) return { success: true, agents: [] };
  try {
    return await sendRequest('agent-list');
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('agent:get', async (_event, data: { agentId: string }) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('agent-get', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('agent:create', async (_event, data: { config: any }) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('agent-create', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('agent:update', async (_event, data: { agentId: string; config: any }) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('agent-update', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('agent:delete', async (_event, data: { agentId: string }) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('agent-delete', data);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ============================================================
// IPC 通信 - 高级功能
// ============================================================

ipcMain.handle('compact', async (_event, data: any) => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('compact', data, 60000);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('get-diagnostics', async () => {
  if (!sessionReady) return { success: false, error: '会话未初始化' };
  try {
    return await sendRequest('get-diagnostics');
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ============================================================
// IPC 通信 - 权限交互（双向）
// ============================================================

ipcMain.handle('permission:respond', async (_event, data: any) => {
  if (!agentProcess) return;
  agentProcess.send({ type: 'permission-response', data });
});

ipcMain.handle('plan-review:respond', async (_event, data: any) => {
  if (!agentProcess) return;
  agentProcess.send({ type: 'plan-review-response', data });
});

ipcMain.handle('ask-user:respond', async (_event, data: any) => {
  if (!agentProcess) return;
  agentProcess.send({ type: 'ask-user-response', data });
});
