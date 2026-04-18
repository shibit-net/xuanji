import type { ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMainWindow } from '../window/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let agentProcess: ChildProcess | null = null;
let sessionReady = false;
let cachedConfig: any = null;
let initializationInProgress: Promise<boolean> | null = null;
let pendingRequests = new Map<string, { resolve: (val: any) => void; timer: ReturnType<typeof setTimeout> }>();
let requestIdCounter = 0;
let isCleaningUp = false;

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

      const nodePath = findNodePath();
      console.log(`📍 使用 Node.js: ${nodePath}`);

      const isDev = process.env.NODE_ENV !== 'production';
      let scriptPath: string;
      let args: string[];

      if (isDev) {
        // 开发环境：使用 tsx 直接运行源文件
        // __dirname 在编译后是 desktop/dist-electron
        // 源文件在 desktop/main/agent-bridge.ts
        const desktopRoot = path.join(__dirname, '../');  // desktop/
        scriptPath = path.join(desktopRoot, 'main/agent-bridge.ts');
        // tsx 在项目根目录的 node_modules/.bin/tsx
        const projectRoot = path.join(desktopRoot, '../');  // xuanji/
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
        cwd: path.join(__dirname, '../../'), // 在项目根目录运行
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
            // 简单的错误检测：检查是否包含明显的错误关键词
            const isError = line.toLowerCase().includes('error') || 
                           line.toLowerCase().includes('exception') ||
                           line.toLowerCase().includes('failed') ||
                           line.toLowerCase().includes('fatal');
            
            if (isError) {
              console.error(`🚨 [Agent Error] ${line}`);
            } else {
              console.log(`📝 [Agent] ${line}`);
            }
          }
        });
      };

      agentProcess.stdout?.on('data', handleOutput);
      agentProcess.stderr?.on('data', handleOutput);

      agentProcess.on('exit', (code: number, signal: string) => {
        console.log(`❌ ChatSession 子进程已退出 (code: ${code}, signal: ${signal})`);
        // 移除所有事件监听器，防止 EPIPE 错误
        if (agentProcess) {
          agentProcess.stdout?.removeAllListeners();
          agentProcess.stderr?.removeAllListeners();
          agentProcess.removeAllListeners();
        }
        agentProcess = null;
        sessionReady = false;
      });

      agentProcess.on('error', (err: Error) => {
        console.error('💥 ChatSession 子进程错误:', err);
      });

      agentProcess.on('message', (msg: any) => {
        if (!msg) return;

        if (msg.type === 'init-complete') {
          console.log('✅ ChatSession 初始化完成！');
          sessionReady = true;
          return;
        }

        if (msg.requestId) {
          const pending = pendingRequests.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRequests.delete(msg.requestId);
            pending.resolve(msg.data);
          }
          return;
        }

        const mainWindow = getMainWindow();
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send(msg.type, msg.data);
        }
      });

      // 发送 init 消息触发子进程初始化
      agentProcess.send({ type: 'init' });

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

  console.log('🧹 正在清理 ChatSession 子进程...');

  // 先移除所有监听器，防止 EPIPE 错误
  agentProcess.stdout?.removeAllListeners();
  agentProcess.stderr?.removeAllListeners();

  // 检查进程是否还活着再发送消息
  if (!agentProcess.killed && agentProcess.connected) {
    try {
      agentProcess.send({ type: 'shutdown' });
    } catch (err) {
      console.warn('⚠️ 发送 shutdown 消息失败:', err);
    }
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (agentProcess && !agentProcess.killed) {
        console.warn('⚠️ ChatSession 子进程未在 5 秒内退出，发送 SIGKILL');
        agentProcess.kill('SIGKILL');
      }
      resolve();
    }, 5000);
    agentProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  agentProcess = null;
  sessionReady = false;
}

function sendRequest(type: string, data?: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!agentProcess) {
      reject(new Error('子进程未启动'));
      return;
    }

    if (agentProcess.killed || !agentProcess.connected) {
      reject(new Error('子进程已关闭'));
      return;
    }

    const requestId = `req-${++requestIdCounter}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`请求超时 (${type})`));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, timer });

    try {
      agentProcess.send({ type, data, requestId });
    } catch (err) {
      clearTimeout(timer);
      pendingRequests.delete(requestId);
      reject(new Error(`发送消息失败: ${err instanceof Error ? err.message : String(err)}`));
    }
  });
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

function triggerStartup() {
  if (!agentProcess || !sessionReady) {
    console.warn('⚠️ ChatSession 未就绪，无法触发启动消息');
    return;
  }

  console.log('🚀 触发启动消息...');
  agentProcess.send({ type: 'trigger-startup' });
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
  setIsCleaningUp,
  triggerStartup
};
