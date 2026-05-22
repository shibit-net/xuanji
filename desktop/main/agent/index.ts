import { app } from 'electron';
import type { ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMainWindow } from '../window/index.js';
import { enhancedMessageBus } from '../ipc/GlobalMessageBus.js';
import { initAgentBridgeForwarding } from '../ipc/platform.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let agentProcess: ChildProcess | null = null;
let sessionReady = false;
let cachedConfig: any = null;
let initializationInProgress: Promise<boolean> | null = null;
let isCleaningUp = false;
let restartAttempts = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BASE_DELAY_MS = 2000;

/** 计算指数退避延迟（带 30% 随机抖动） */
function getRestartDelay(): number {
  const baseDelay = RESTART_BASE_DELAY_MS * Math.pow(2, restartAttempts);
  const jitter = baseDelay * 0.3 * Math.random();
  return Math.min(baseDelay + jitter, 30_000); // 最大 30 秒
}

/** 取消待执行的自动重启 */
function cancelAutoRestart() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

// 🔧 使用增强的消息总线，支持自动转发到renderer
// 获取 agent 消息通道
const getAgentChannel = () => enhancedMessageBus.getChannel('agent');

function findNodePath(): string {
  const { execSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
      // Windows: where node 可能返回多行，取第一个
      return execSync('where node', { encoding: 'utf8' }).trim().split(/\r?\n/)[0].trim();
    }
    return execSync('which node', { encoding: 'utf8' }).trim();
  } catch {
    // Windows 下 spawn 可以自动通过 PATH 解析 'node' → 'node.exe'
    if (process.platform === 'win32') {
      return 'node';
    }
    return '/usr/local/bin/node';
  }
}

function initChatSession(): Promise<boolean> {
  // 取消任何待执行的自动重启，避免旧 timer 与新初始化竞态
  cancelAutoRestart();

  if (initializationInProgress) {
    return initializationInProgress;
  }

  if (agentProcess && sessionReady) {
    return Promise.resolve(true);
  }

  initializationInProgress = (async () => {
    try {

      // 1. 检查用户是否登录
      const { getAuthState } = await import('../config/auth.js');
      const authState = getAuthState();

      if (!authState?.user?.userId) {
        console.warn('⚠️ 用户未登录，无法初始化会话');
        sessionReady = false;
        return false;
      }

      const userId = authState.user.userId;
      const nickname = authState.user.nickName || '';

      // 通知 renderer 初始化开始
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send('session:init-start');

      let nodePath = findNodePath();

      const isDev = !app.isPackaged;
      let scriptPath: string;
      let args: string[];

      if (isDev) {
        // 开发环境：使用 tsx 直接运行源文件
        const desktopRoot = path.join(__dirname, '../');
        scriptPath = path.join(desktopRoot, 'main/agent-bridge.ts');
        const projectRoot = path.join(desktopRoot, '../');

        if (process.platform === 'win32') {
          // Windows: node_modules/.bin/tsx 是 bash 脚本，node 无法执行
          // tsx.cmd 可以直接 spawn，不需要通过 node 调用
          nodePath = path.join(projectRoot, 'node_modules', '.bin', 'tsx.cmd');
          args = [scriptPath];
        } else {
          const tsxPath = path.join(projectRoot, 'node_modules/.bin/tsx');
          args = [tsxPath, scriptPath];
        }
      } else {
        // 生产环境：extraResources → Resources/dist-electron/agent-bridge.mjs
        scriptPath = path.join(process.resourcesPath!, 'dist-electron', 'agent-bridge.mjs');
        // createRequire(import.meta.url) 已处理 ESM/CJS 互操作，无需 --experimental-require-module
        args = [scriptPath];
      }

      const { spawn } = require('child_process');
      const spawnEnv: Record<string, any> = {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'development',
      };

      // 生产环境：设置 NODE_PATH 让子进程能找到 native 模块
      // electron-builder 自动将 native 模块解包到 app.asar.unpacked/node_modules
      if (!isDev) {
        const resourcesPath = process.resourcesPath!;
        const unpackedModules = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');
        const extraModules = path.join(resourcesPath, 'dist-electron', 'node_modules');
        spawnEnv.NODE_PATH = `${extraModules}${path.delimiter}${unpackedModules}`;
        // 模板文件通过 extraResources 打包到 Resources/templates/
        spawnEnv.XUANJI_TEMPLATE_DIR = path.join(resourcesPath, 'templates');
      } else {
        // 开发环境：模板在项目源码中
        const projectRoot = path.join(__dirname, '../../../');
        spawnEnv.XUANJI_TEMPLATE_DIR = path.join(projectRoot, 'src', 'core', 'templates');
      }

      agentProcess = spawn(nodePath, args, {
        cwd: path.resolve(__dirname, '../../'),
        env: spawnEnv,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      // 子进程 stdout/stderr 直接转发到父进程控制台
      // PinoLogger 已在子进程内完成格式化，此处只需透传
      const handleStdout = (data: Buffer) => {
        const text = data.toString('utf8').trim();
        if (text) console.log(text);
      };

      const handleStderr = (data: Buffer) => {
        const text = data.toString('utf8').trim();
        if (text) console.error(text);
      };

      agentProcess!.stdout?.on('data', handleStdout);
      agentProcess!.stderr?.on('data', handleStderr);

      agentProcess!.on('exit', (_code: number, _signal: string) => {
        if (agentProcess) {
          agentProcess.stdout?.removeAllListeners();
          agentProcess.stderr?.removeAllListeners();
          agentProcess.removeAllListeners();
        }
        agentProcess = null;
        sessionReady = false;

        // 非清理状态下的意外退出 → 自动重启
        if (!isCleaningUp && restartAttempts < MAX_RESTART_ATTEMPTS) {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('session:init-restarting', {
              attempt: restartAttempts + 1,
              maxAttempts: MAX_RESTART_ATTEMPTS,
            });
          }
          restartAttempts++;
          const delay = getRestartDelay();
          restartTimer = setTimeout(() => {
            restartTimer = null;
            initChatSession().catch((err) => {
              console.warn('Agent sub-process restart failed:', err);
            });
          }, delay);
        } else if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
          console.warn(`Agent sub-process max restarts reached: 次，放弃自动重启`);
          // 通知 renderer 子进程无法恢复
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agent:crash', {
              message: 'Agent 子进程多次崩溃，已停止自动重启。请手动重新初始化。',
            });
          }
        }
      });

      agentProcess!.on('error', (err: Error) => {
        console.warn('[Agent] sub-process error:', err);
      });

      // 创建并绑定 agent 消息通道
      const agentChannel = enhancedMessageBus.createChannel('agent', {
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        enableLogging: false,
      });
      agentChannel.attach(agentProcess!);

      // 初始化平台回复转发（依赖 agent 通道，必须在此处注册）
      initAgentBridgeForwarding();

      // 🔧 注册子进程下载事件转发
      const { BrowserWindow } = require('electron');
      agentChannel.on('download:event', (eventData: { type: string; task: any }) => {
        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach((win: any) => {
          win.webContents.send('download:event', eventData);
        });
      });

      // 监听子进程就绪
      agentChannel.once('child-ready', (data) => {
        console.log(`[Agent] Sub-process ready, PID: ${data?.pid || 'unknown'}`);
      });

      // 监听初始化完成
      agentChannel.on('init-complete', (data) => {
        if (data.success) {
          sessionReady = true;
          mainWindow?.webContents.send('session:init-complete');
        } else {
          console.error('[Agent] Session 初始化失败:', data.error);
          mainWindow?.webContents.send('session:init-failed', {
            error: data.error || '会话初始化失败',
          });
        }
      });

      // 🔧 不再需要手动转发消息，EnhancedMessageBus 会自动转发所有消息到 renderer
      // 创建并绑定 agent 消息通道时，已经启用了自动转发功能

      // 发送 init 消息触发子进程初始化，并传递 userId
      agentChannel.send('init', { userId, userName: nickname });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('ChatSession 初始化超时'));
        }, 60000);

        const checkReady = () => {
          if (sessionReady) {
            clearTimeout(timeout);
            resolve();
          }
        };

        const interval = setInterval(checkReady, 100);

        agentProcess?.once('exit', () => {
          clearInterval(interval);
          clearTimeout(timeout);
          reject(new Error('ChatSession 子进程意外退出'));
        });
      });

      // 成功后重置重启计数
      if (restartAttempts > 0) {
        console.log(`[Agent] Auto-restart succeeded after ${restartAttempts} attempts, counter reset`);
      }
      restartAttempts = 0;
      return true;
    } catch (err) {
      console.error('❌ ChatSession 初始化失败:', err);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:init-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      cleanupAgentProcess();
      throw err;
    } finally {
      initializationInProgress = null;
    }
  })();

  return initializationInProgress;
}

/** 跨平台强制终止子进程 */
function forceKillProcess(proc: ChildProcess): void {
  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 3000, stdio: 'ignore' });
    } catch {
      try { proc.kill(); } catch { /* 进程可能已退出 */ }
    }
  } else {
    proc.kill('SIGKILL');
  }
}

async function cleanupAgentProcess() {
  if (!agentProcess) return;

  // 取消任何待执行的自动重启
  cancelAutoRestart();
  restartAttempts = 0;


  // 先移除所有监听器，防止 EPIPE 错误
  agentProcess.stdout?.removeAllListeners();
  agentProcess.stderr?.removeAllListeners();

  // 获取 agent 通道
  const agentChannel = getAgentChannel();
  if (agentChannel) {
    // 发送 shutdown 消息
    agentChannel.send('shutdown');
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (agentProcess && !agentProcess.killed) {
        console.warn('[Agent] 子进程未在 2 秒内退出，执行强制终止');
        forceKillProcess(agentProcess!);
      }
      resolve();
    }, 2000);
    agentProcess!.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  // 删除消息通道
  enhancedMessageBus.deleteChannel('agent');

  agentProcess = null;
  sessionReady = false;
}

function sendRequest(type: string, data?: any, timeoutMs = 30000): Promise<any> {
  const agentChannel = getAgentChannel();
  if (!agentChannel) {
    return Promise.reject(new Error('Agent 通道未初始化'));
  }
  return agentChannel.request(type, data, timeoutMs);
}

function getAgentProcess(): ChildProcess | null {
  return agentProcess;
}

function getAgentProcessPid(): number | null {
  return agentProcess?.pid ?? null;
}

function isSessionReady(): boolean {
  return sessionReady;
}

function getCachedConfig(): any {
  return cachedConfig;
}

function setCachedConfig(config: any) {
  cachedConfig = config;
}

function getIsCleaningUp(): boolean {
  return isCleaningUp;
}

function setIsCleaningUp(value: boolean) {
  isCleaningUp = value;
}

export {
  initChatSession,
  cleanupAgentProcess,
  sendRequest,
  getAgentProcess,
  getAgentProcessPid,
  isSessionReady,
  getCachedConfig,
  setCachedConfig,
  getIsCleaningUp,
  setIsCleaningUp
};
