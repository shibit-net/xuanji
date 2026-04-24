import type { ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMainWindow } from '../window/index.js';
import { EnhancedMessageChannel } from '../ipc/EnhancedMessageBus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let agentProcess: ChildProcess | null = null;
let sessionReady = false;
let cachedConfig: any = null;
let initializationInProgress: Promise<boolean> | null = null;
let isCleaningUp = false;
let agentChannel: EnhancedMessageChannel | null = null;

// 🔧 获取 agent 消息通道
const getAgentChannel = () => agentChannel;

function findNodePath(): string {
  const { execSync } = require('child_process');
  try {
    return execSync('which node', { encoding: 'utf8' }).trim();
  } catch {
    return '/usr/local/bin/node';
  }
}

function initChatSession(): Promise<boolean> {
  if (initializationInProgress) {
    console.log('⏳ ChatSession 初始化已在进行中，等待完成...');
    return initializationInProgress;
  }

  if (agentProcess && sessionReady) {
    console.log('✅ ChatSession 已就绪，无需重新初始化');
    return Promise.resolve(true);
  }

  initializationInProgress = (async () => {
    try {
      console.log('🚀 开始初始化 ChatSession 子进程...');

      // 1. 检查用户是否登录
      const { getAuthState } = await import('../config/auth.js');
      const authState = getAuthState();

      if (!authState?.user?.userId) {
        console.warn('⚠️ 用户未登录，无法初始化会话');
        sessionReady = false;
        return false;
      }

      const userId = authState.user.userId;
      console.log(`👤 当前用户: ${userId}`);

      const nodePath = findNodePath();
      console.log(`📍 使用 Node.js: ${nodePath}`);

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
        console.log(`📜 开发模式，使用 tsx 运行: ${scriptPath}`);
      } else {
        // 生产环境：运行构建后的文件
        scriptPath = path.join(__dirname, 'agent-bridge.js');
        args = [scriptPath];
        console.log(`📜 生产模式，运行构建文件: ${scriptPath}`);
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

      // 统一处理子进程的所有输出
      const handleOutput = (data: Buffer) => {
        const lines = data.toString('utf8').trim().split('\n');
        lines.forEach(line => {
          if (line) {
            // 改进错误检测逻辑：
            // 1. 排除 "error: undefined" 这种情况
            // 2. 排除 JSON 中的 error 字段（如果值为 undefined/null）
            const lowerLine = line.toLowerCase();
            const isError = (
              (lowerLine.includes('error') && !lowerLine.includes('error: undefined') && !lowerLine.includes('error: null')) ||
              lowerLine.includes('exception') ||
              lowerLine.includes('failed') ||
              lowerLine.includes('fatal')
            ) && !lowerLine.includes('🚨'); // 避免重复标记

            if (isError) {
              console.error(`🚨 [Agent Error] ${line}`);
            } else {
              console.log(`📝 [Agent] ${line}`);
            }
          }
        });
      };

      agentProcess!.stdout?.on('data', handleOutput);
      agentProcess!.stderr?.on('data', handleOutput);

      agentProcess!.on('exit', (code: number, signal: string) => {
        console.log(`❌ ChatSession 子进程已退出 (code: ${code}, signal: ${signal})`);
        if (agentProcess) {
          agentProcess.stdout?.removeAllListeners();
          agentProcess.stderr?.removeAllListeners();
          agentProcess.removeAllListeners();
        }
        agentProcess = null;
        sessionReady = false;
      });

      agentProcess!.on('error', (err: Error) => {
        console.error('[Agent] 子进程错误:', err);
      });

      // 🔧 创建增强的消息通道，支持自动转发到renderer
      agentChannel = new EnhancedMessageChannel({
        name: 'agent',
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        enableLogging: true,
        autoForwardToRenderer: true,
        mainWindow: getMainWindow(),
      });
      agentChannel.attach(agentProcess!);

      // 监听子进程就绪
      agentChannel.once('child-ready', () => {
        console.log('[Agent] 子进程已就绪');
      });

      // 监听初始化完成
      agentChannel.on('init-complete', (data) => {
        if (data.success) {
          sessionReady = true;
          console.log('[Agent] Session 初始化完成');
        } else {
          console.error('[Agent] Session 初始化失败:', data.error);
        }
      });

      // 🔧 不再需要手动转发消息到renderer
      // EnhancedMessageChannel 会自动转发所有消息

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

      console.log('🎉 ChatSession 子进程启动成功！');
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

  console.log('[Agent] 正在清理子进程...');

  // 先移除所有监听器，防止 EPIPE 错误
  agentProcess.stdout?.removeAllListeners();
  agentProcess.stderr?.removeAllListeners();

  // 获取 agent 通道
  const agentChannel = getAgentChannel();
  if (agentChannel) {
    // 发送 shutdown 消息
    agentChannel.send('shutdown');
    // 清理通道
    agentChannel.detach();
    agentChannel = null;
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
