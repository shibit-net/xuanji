import { app } from 'electron';
import type { ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { getMainWindow } from '../window/index.js';
import { enhancedMessageBus } from '../ipc/GlobalMessageBus.js';
import { initAgentBridgeForwarding } from '../ipc/platform.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 日志文件（Windows 用户看不到控制台，必须写文件） ──────────────
let _agentLogPath: string | null = null;

function getAgentLogPath(): string {
  if (_agentLogPath) return _agentLogPath;
  if (app.isPackaged) {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
    _agentLogPath = path.join(logsDir, 'agent-bridge.log');
  } else {
    _agentLogPath = path.join(os.tmpdir(), 'xuanji-agent-bridge.log');
  }
  return _agentLogPath;
}

function agentLog(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(getAgentLogPath(), line, 'utf-8');
  } catch {}
  // 开发环境也输出到控制台
  console.log(`[Agent] ${message}`);
}

let agentProcess: any = null;
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
      return execSync('where node', { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0].trim();
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

      let scriptPath: string;
      let args: string[];
      let nodePath: string;

      const isDev = !app.isPackaged;
      const desktopRoot = path.join(__dirname, '../');
      const projectRoot = path.join(desktopRoot, '../');

      if (isDev) {
        // 开发环境：使用 tsx 直接运行源文件
        scriptPath = path.join(desktopRoot, 'main/agent-bridge.ts');

        if (process.platform === 'win32') {
          // Windows: spawn tsx.cmd 实际通过 cmd.exe 执行，IPC 通道无法连通
          // 改为直接 spawn node.exe + tsx CLI 入口，确保 IPC 通道正常
          nodePath = findNodePath();
          const tsxCliPath = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
          args = [tsxCliPath, scriptPath];
        } else {
          nodePath = findNodePath();
          const tsxPath = path.join(projectRoot, 'node_modules/.bin/tsx');
          args = [tsxPath, scriptPath];
        }
      } else {
        // 生产环境：优先使用内置 Node.js，不存在则用 Electron + ELECTRON_RUN_AS_NODE=1
        const pRes = process.resourcesPath!;
        scriptPath = path.join(pRes, 'dist-electron', 'agent-bridge.mjs');
        const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
        const bundledNode = path.join(pRes, 'node', 'bin', nodeName);
        if (fs.existsSync(bundledNode)) {
          nodePath = bundledNode;
          args = [scriptPath];
        } else {
          nodePath = process.execPath;
          args = [scriptPath];
        }
      }

      const spawnEnv: Record<string, any> = {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'development',
      };
      // 清除可能干扰 Provider 配置的环境变量（SDK 会自动读取作为默认值）
      delete spawnEnv.ANTHROPIC_AUTH_TOKEN;
      delete spawnEnv.ANTHROPIC_API_KEY;
      delete spawnEnv.ANTHROPIC_BASE_URL;
      delete spawnEnv.ANTHROPIC_MODEL;
      delete spawnEnv.OPENAI_API_KEY;
      delete spawnEnv.OPENAI_BASE_URL;

      const resourcesPath = !isDev ? process.resourcesPath! : null;

      // 设置 NODE_PATH 让子进程能找到 native 模块
      if (!isDev && resourcesPath) {
        spawnEnv.ELECTRON_RUN_AS_NODE = '1';
        const unpackedModules = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');
        const extraModules = path.join(resourcesPath, 'dist-electron', 'node_modules');
        const nodePathDirs = [extraModules];
        if (fs.existsSync(unpackedModules)) {
          nodePathDirs.push(unpackedModules);
        }
        spawnEnv.NODE_PATH = nodePathDirs.join(path.delimiter);
        spawnEnv.XUANJI_TEMPLATE_DIR = path.join(resourcesPath, 'templates');
        spawnEnv.XUANJI_PYTHON_RUNTIME = path.join(resourcesPath, 'python-runtime');
      } else {
        spawnEnv.XUANJI_TEMPLATE_DIR = path.join(projectRoot, 'src', 'infrastructure', 'templates');
        spawnEnv.XUANJI_PYTHON_RUNTIME = path.join(desktopRoot, 'python-runtime');
      }

      const spawnCwd = path.resolve(__dirname, '../../');

      // 诊断日志
      if (isDev) {
        agentLog(`Spawning agent-bridge (dev mode):`);
        agentLog(`  node: ${nodePath} (exists: ${fs.existsSync(nodePath)})`);
        agentLog(`  script: ${scriptPath} (exists: ${fs.existsSync(scriptPath)})`);
        agentLog(`  cwd: ${spawnCwd}`);
      } else {
        agentLog(`Spawning agent-bridge (prod mode via bundled node):`);
        agentLog(`  node: ${nodePath} (exists: ${fs.existsSync(nodePath)})`);
        agentLog(`  script: ${scriptPath} (exists: ${fs.existsSync(scriptPath)})`);
        agentLog(`  NODE_PATH: ${spawnEnv.NODE_PATH || '(not set)'}`);
      }

      const { spawn } = require('child_process');
      agentProcess = spawn(nodePath, args, {
        cwd: spawnCwd,
        env: spawnEnv,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
      });

      agentLog(`Agent-bridge spawned, PID: ${agentProcess.pid}`);

      // 收集 stdout 用于崩溃诊断（PinoLogger 输出到 stdout）
      let stdoutTail = '';
      const STDOUT_TAIL_MAX = 8192;
      const handleStdout = (data: Buffer) => {
        const text = data.toString('utf8');
        stdoutTail += text;
        if (stdoutTail.length > STDOUT_TAIL_MAX) {
          stdoutTail = stdoutTail.slice(-STDOUT_TAIL_MAX);
        }
        const trimmed = text.trim();
        if (trimmed) agentLog(`[bridge] ${trimmed}`);
      };

      const handleStderr = (data: Buffer) => {
        const text = data.toString('utf8').trim();
        if (text) agentLog(`[bridge:err] ${text}`);
      };

      agentProcess!.stdout?.on('data', handleStdout);
      agentProcess!.stderr?.on('data', handleStderr);

      // 记录子进程启动时间，用于检测快速崩溃
      const spawnTime = Date.now();

      agentProcess!.on('exit', (code: number, signal: string) => {
        const livedMs = Date.now() - spawnTime;
        agentLog(`Agent-bridge EXITED: code=${code}, signal=${signal}, pid=${agentProcess?.pid}, lived=${livedMs}ms`);

        // 输出崩溃前的 stdout 尾部到日志文件，便于诊断
        if (code !== 0 && stdoutTail.trim()) {
          agentLog(`Last stdout before crash:\n${stdoutTail.trim().slice(-4096)}`);
        }

        if (agentProcess) {
          agentProcess.stdout?.removeAllListeners();
          agentProcess.stderr?.removeAllListeners();
          agentProcess.removeAllListeners();
        }
        agentProcess = null;
        sessionReady = false;
        stdoutTail = '';

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
          agentLog(`Max restarts (${MAX_RESTART_ATTEMPTS}) reached, giving up`);
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agent:crash', {
              message: `Agent 子进程多次崩溃（code=${code}），已停止自动重启。请手动重新初始化。`,
            });
          }
        }
      });

      // ChildProcess 的 error 事件
      agentProcess!.on('error', (err: Error) => {
        agentLog(`Agent-bridge spawn error: ${err.message}\n${err.stack || ''}`);
      });

      // 创建并绑定 agent 消息通道
      const agentChannel = enhancedMessageBus.createChannel('agent', {
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        enableLogging: false,
      });
      agentChannel.attach(agentProcess! as ChildProcess);

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
        agentLog(`Sub-process ready, PID: ${data?.pid || 'unknown'}`);
      });

      // 监听初始化完成
      agentChannel.on('init-complete', (data) => {
        if (data.success) {
          sessionReady = true;
          agentLog('Session init complete');
          mainWindow?.webContents.send('session:init-complete');
        } else {
          agentLog(`Session init FAILED: ${data.error || 'unknown'}`);
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
          const pid = agentProcess?.pid || 'unknown';
          reject(new Error(`ChatSession 初始化超时 (60s), pid=${pid}, 子进程可能卡在模块加载或 init 消息处理`));
        }, 60000);

        const checkReady = () => {
          if (sessionReady) {
            clearTimeout(timeout);
            resolve();
          }
        };

        const interval = setInterval(checkReady, 100);

        agentProcess?.once('exit', (code: number, signal: string) => {
          clearInterval(interval);
          clearTimeout(timeout);
          reject(new Error(`ChatSession 子进程退出 code=${code} signal=${signal}`));
        });
      });

      // 成功后重置重启计数
      if (restartAttempts > 0) {
        agentLog(`Auto-restart succeeded after ${restartAttempts} attempts, counter reset`);
      }
      restartAttempts = 0;
      return true;
    } catch (err) {
      agentLog(`ChatSession init FAILED: ${err instanceof Error ? err.message : String(err)}`);
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
function forceKillProcess(proc: any): void {
  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 3000, stdio: 'ignore', windowsHide: true });
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

function sendRequest(type: string, data?: any, timeoutMs = 10000): Promise<any> {
  const agentChannel = getAgentChannel();
  if (!agentChannel) {
    return Promise.reject(new Error('Agent 通道未初始化'));
  }
  return agentChannel.request(type, data, timeoutMs);
}

function getAgentProcess(): any {
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
