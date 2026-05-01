import type { ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMainWindow } from '../window/index.js';
import { enhancedMessageBus } from '../ipc/GlobalMessageBus.js';

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
    return execSync('which node', { encoding: 'utf8' }).trim();
  } catch {
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

      const nodePath = findNodePath();

      const isDev = process.env.NODE_ENV !== 'production';
      let scriptPath: string;
      let args: string[];

      if (isDev) {
        // 开发环境：使用 tsx 直接运行源文件
        const desktopRoot = path.join(__dirname, '../');
        scriptPath = path.join(desktopRoot, 'main/agent-bridge.ts');
        const projectRoot = path.join(desktopRoot, '../');
        const tsxPath = path.join(projectRoot, 'node_modules/.bin/tsx');
        args = [tsxPath, scriptPath];
      } else {
        // 生产环境：运行构建后的文件
        scriptPath = path.join(__dirname, 'agent-bridge.js');
        args = [scriptPath];
      }

      const { spawn } = require('child_process');
      agentProcess = spawn(nodePath, args, {
        cwd: path.join(__dirname, '../../'),
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || 'development',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      // 解析 debug 包的日志级别
      // 格式: "2026-05-01 01:50:49.339 xuanji:DownloadManager:info message"
      // debug 包同时输出到 stdout 和 stderr，需要识别级别再决定前缀
      const extractLevel = (line: string): string | null => {
        const match = line.match(/\s[\w:]+:(debug|info|warn|error|fatal)\s/);
        return match ? match[1].toLowerCase() : null;
      };

      // 处理子进程 stdout 输出
      const handleStdout = (data: Buffer) => {
        const lines = data.toString('utf8').trim().split('\n');
        lines.forEach(line => {
          if (line) {
            const level = extractLevel(line);
            if (level === 'error' || level === 'fatal') {
              console.error(`🚨 [Agent Error] ${line}`);
            }
          }
        });
      };

      // 处理子进程 stderr 输出（debug 包默认写到 stderr，不只是错误）
      const handleStderr = (data: Buffer) => {
        const lines = data.toString('utf8').trim().split('\n');
        lines.forEach(line => {
          if (line) {
            const level = extractLevel(line);
            if (level === 'error' || level === 'fatal') {
              console.error(`🚨 [Agent Error] ${line}`);
            }
          }
        });
      };

      agentProcess!.stdout?.on('data', handleStdout);
      agentProcess!.stderr?.on('data', handleStderr);

      agentProcess!.on('exit', (code: number, signal: string) => {
        if (agentProcess) {
          agentProcess.stdout?.removeAllListeners();
          agentProcess.stderr?.removeAllListeners();
          agentProcess.removeAllListeners();
        }
        agentProcess = null;
        sessionReady = false;

        // 非清理状态下的意外退出 → 自动重启
        if (!isCleaningUp && restartAttempts < MAX_RESTART_ATTEMPTS) {
          restartAttempts++;
          const delay = getRestartDelay();
          restartTimer = setTimeout(() => {
            restartTimer = null;
            initChatSession().catch((err) => {
              console.error('❌ Agent 子进程自动重启失败:', err);
            });
          }, delay);
        } else if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
          console.error(`❌ Agent 子进程已重启 ${MAX_RESTART_ATTEMPTS} 次，放弃自动重启`);
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
        console.error('[Agent] 子进程错误:', err);
      });

      // 创建并绑定 agent 消息通道
      const agentChannel = enhancedMessageBus.createChannel('agent', {
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        enableLogging: true, // 🔧 临时启用日志用于调试
      });
      agentChannel.attach(agentProcess!);

      // 🔧 注册子进程下载事件转发
      const { BrowserWindow } = require('electron');
      agentChannel.on('download:event', (eventData: { type: string; task: any }) => {
        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach((win: any) => {
          win.webContents.send('download:event', eventData);
        });
      });

      // 监听子进程就绪
      agentChannel.once('child-ready', () => {
      });

      // 监听初始化完成
      agentChannel.on('init-complete', (data) => {
        if (data.success) {
          sessionReady = true;
        } else {
          console.error('[Agent] Session 初始化失败:', data.error);
        }
      });

      // 🔧 不再需要手动转发消息，EnhancedMessageBus 会自动转发所有消息到 renderer
      // 创建并绑定 agent 消息通道时，已经启用了自动转发功能

      // 发送 init 消息触发子进程初始化，并传递 userId
      agentChannel.send('init', { userId });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('ChatSession 初始化超时'));
        }, 30000);

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
      restartAttempts = 0;
      return true;
    } catch (err) {
      console.error('❌ ChatSession 初始化失败:', err);
      cleanupAgentProcess();
      throw err;
    } finally {
      initializationInProgress = null;
    }
  })();

  return initializationInProgress;
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
        console.warn('[Agent] 子进程未在 5 秒内退出，发送 SIGKILL');
        agentProcess!.kill('SIGKILL');
      }
      resolve();
    }, 5000);
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
  isSessionReady,
  getCachedConfig,
  setCachedConfig,
  getIsCleaningUp,
  setIsCleaningUp
};
