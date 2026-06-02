// ============================================================
// Download IPC Handlers - 下载管理 IPC 接口
// ============================================================

import { ipcMain, BrowserWindow } from 'electron';
import { DownloadManager } from '../../../src/core/download/DownloadManager.js';
import { LocalModelLoader } from '../../../src/core/agent/dispatch/LocalModelLoader.js';
import { scanInstalledEmbeddingModels } from '../../../src/core/embedding/EmbeddingProvider.js';
import { messageBus } from './MessageBus.js';
import { enhancedMessageBus } from './GlobalMessageBus.js';
import { getMainWindow } from '../window/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// 先注册事件转发（必须在 DownloadManager 实例化之前，否则 loadState() 恢复的下载事件无法转发到渲染进程）
const downloadEvents = ['task-created', 'task-started', 'task-progress', 'task-completed', 'task-failed', 'task-cancelled'] as const;
let eventsForwarded = false;

function forwardDownloadEvents() {
  if (eventsForwarded) return;
  eventsForwarded = true;
  downloadEvents.forEach((eventName) => {
    mainDownloadManager.on(eventName, (task) => {
      const allWindows = BrowserWindow.getAllWindows();
      allWindows.forEach((win) => {
        win.webContents.send('download:event', { type: eventName, task });
      });
    });
  });
}

// 主进程的 DownloadManager，启用任务持久化（主进程使用独立状态文件 download-state-main.json）
const mainDownloadManager = DownloadManager.getInstance(true);
forwardDownloadEvents();

// 缓存子进程的当前工作目录（由 agent-bridge 通过 workspace:directory-changed 事件更新）
let agentCwd: string | null = null;

// 监听子进程目录变更事件，更新缓存
function setupCwdListener() {
  try {
    const agentChannel = enhancedMessageBus.getChannel('agent');
    if (agentChannel) {
      agentChannel.on('workspace:directory-changed', (data: { path: string }) => {
        if (data?.path) agentCwd = data.path;
      });
      // 子进程初始化完成后重置为当前 cwd
      agentChannel.on('init-complete', (data: { success: boolean; workspacePath?: string }) => {
        if (data.success && data.workspacePath) agentCwd = data.workspacePath;
      });
      return true;
    }
  } catch {}
  return false;
}
// 延迟重试，等 agent channel 就绪
setTimeout(() => { setupCwdListener(); }, 5000);
setupCwdListener();

// 向上查找 xuanji 项目根目录（包含 package.json 且 name 为 xuanji）
function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'xuanji') {
          return current;
        }
      } catch {}
    }
    current = path.dirname(current);
  }
  // 回退方案：假设在 desktop/main/ipc/ 下，向上 3 级
  return path.join(startDir, '../../..');
}

const PROJECT_ROOT = findProjectRoot(__dirname);
const MODEL_DIR = path.join(os.homedir(), '.xuanji', 'models');
const EMBEDDING_MODEL_DIR = path.join(os.homedir(), '.xuanji', 'embedding-models');

const MODEL_IDS: Record<string, string> = {
  'qwen2.5-0.5b-q4': 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'qwen2.5-1.5b-q4': 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'chatglm3-6b-q4': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q4_K_M.gguf',
  'chatglm3-6b-q3': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q3_K_M.gguf',
  'glm4-9b-q4': 'hf:mradermacher/glm-4-9b-chat-GGUF:glm-4-9b-chat.Q4_K_M.gguf',
};

/** 扫描 embedding-models 目录下的模型列表（复用 EmbeddingProvider 核心逻辑） */
function scanEmbeddingModels(): Array<{
  id: string;
  name: string;
  description: string;
  installed: boolean;
}> {
  return scanInstalledEmbeddingModels(EMBEDDING_MODEL_DIR);
}

export function registerDownloadHandlers() {

  // 获取所有下载任务（聚合主进程和子进程）
  ipcMain.handle('download:get-tasks', async () => {
    try {
      // 获取主进程任务
      const mainTasks = mainDownloadManager.getAllTasks();

      // 获取子进程任务
      let childTasks: any[] = [];
      const agentChannel = messageBus.getChannel('agent');
      if (agentChannel && agentChannel.isConnected()) {
        try {
          const result = await agentChannel.request('download-get-tasks', {}, 5000);
          if (result.success && result.tasks) {
            childTasks = result.tasks;
          }
        } catch (err) {
          console.warn('[IPC] Failed to get child process tasks:', err);
        }
      }

      // 合并任务（子进程任务 ID 加前缀避免冲突）
      const allTasks = [
        ...mainTasks,
        ...childTasks.map((t: any) => ({ ...t, id: `child:${t.id}` })),
      ];

      return { success: true, tasks: allTasks };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 获取项目根目录
  ipcMain.handle('download:get-project-root', async () => {
    try {
      return { success: true, projectRoot: PROJECT_ROOT };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 获取 embedding 模型目录
  ipcMain.handle('download:get-embedding-model-dir', async () => {
    try {
      return { success: true, dir: EMBEDDING_MODEL_DIR };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 检查 embedding 模型是否已安装
  ipcMain.handle('download:check-embedding-model', async (_event, modelId: string) => {
    try {
      const modelDir = path.join(EMBEDDING_MODEL_DIR, modelId);

      // 检查必需的文件是否存在
      const requiredFiles = [
        'config.json',
        'tokenizer.json',
        'tokenizer_config.json',
      ];

      // 检查基础文件
      const baseFilesExist = requiredFiles.every(file => {
        const filePath = path.join(modelDir, file);
        return fs.existsSync(filePath);
      });

      // 检查模型文件（支持 model.onnx 或 model_quantized.onnx）
      const modelFile1 = path.join(modelDir, 'onnx/model.onnx');
      const modelFile2 = path.join(modelDir, 'onnx/model_quantized.onnx');
      const modelFileExists = fs.existsSync(modelFile1) || fs.existsSync(modelFile2);

      const allFilesExist = baseFilesExist && modelFileExists;

      return { success: true, installed: allFilesExist };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 列出所有 embedding 模型（预设 + 已安装）
  ipcMain.handle('download:list-embedding-models', async () => {
    try {
      const models = scanEmbeddingModels();
      return { success: true, models };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 卸载 embedding 模型
  ipcMain.handle('download:uninstall-embedding-model', async (_event, modelId: string) => {
    try {
      const modelDir = path.join(EMBEDDING_MODEL_DIR, modelId);

      if (!fs.existsSync(modelDir)) {
        return { success: true, message: 'Model not found' };
      }

      // 递归删除模型目录
      fs.rmSync(modelDir, { recursive: true, force: true });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 打开 embedding 模型目录
  ipcMain.handle('download:open-embedding-model-dir', async () => {
    try {
      const { shell } = require('electron');
      if (!fs.existsSync(EMBEDDING_MODEL_DIR)) {
        fs.mkdirSync(EMBEDDING_MODEL_DIR, { recursive: true });
      }
      await shell.openPath(EMBEDDING_MODEL_DIR);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 创建下载任务（通用接口）
  ipcMain.handle('download:create', async (_event, options: {
    url: string;
    dest: string;
    name: string;
    category?: string;
  }) => {
    try {
      const taskId = await mainDownloadManager.download(options);
      return { success: true, taskId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 取消下载（支持主进程和子进程）
  ipcMain.handle('download:cancel', async (_event, taskId: string) => {
    try {
      // 判断是主进程还是子进程的任务
      if (taskId.startsWith('child:')) {
        const realId = taskId.substring(6);
        const agentChannel = messageBus.getChannel('agent');
        if (!agentChannel || !agentChannel.isConnected()) {
          return { success: false, error: 'Agent not initialized' };
        }
        return await agentChannel.request('download-cancel', { taskId: realId });
      } else {
        mainDownloadManager.cancel(taskId);
        return { success: true };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 清除已完成的任务（主进程和子进程都清除）
  ipcMain.handle('download:clear-finished', async () => {
    try {
      // 清除主进程任务
      mainDownloadManager.clearFinished();

      // 清除子进程任务
      const agentChannel = messageBus.getChannel('agent');
      if (agentChannel && agentChannel.isConnected()) {
        try {
          await agentChannel.request('download-clear-finished', {}, 5000);
        } catch (err) {
          console.warn('[IPC] Failed to clear child process tasks:', err);
        }
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 列出本地已下载模型
  ipcMain.handle('local-model:list', async () => {
    try {
      if (!fs.existsSync(MODEL_DIR)) {
        return { success: true, models: [] };
      }

      const files = fs.readdirSync(MODEL_DIR)
        .filter((file) => file.endsWith('.gguf'))
        .map((file) => {
          const filePath = path.join(MODEL_DIR, file);
          const stats = fs.statSync(filePath);
          return {
            filename: file,
            path: filePath,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
          };
        });

      return { success: true, models: files };
    } catch (error: any) {
      console.error('[IPC] local-model:list error:', error);
      return { success: false, error: error.message };
    }
  });

  // 删除本地模型文件
  ipcMain.handle('local-model:delete', async (_event, filename: string) => {
    try {
      if (!filename || filename.includes('/') || filename.includes('\\')) {
        return { success: false, error: 'Invalid filename' };
      }

      const filePath = path.join(MODEL_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Model file not found' };
      }

      fs.unlinkSync(filePath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 检查本地模型是否已安装
  ipcMain.handle('local-model:check', async (_event, modelId: string) => {
    try {
      const modelUri = MODEL_IDS[modelId];
      if (!modelUri) {
        return { success: false, error: 'Unknown model ID' };
      }

      const loader = new LocalModelLoader({ modelId: modelUri });
      const installed = loader.isDownloaded();

      return { success: true, installed };
    } catch (error: any) {
      console.error('[IPC] local-model:check error:', error);
      return { success: false, error: error.message };
    }
  });

  // 下载本地模型
  ipcMain.handle('local-model:download', async (_event, modelId: string, downloadSource?: string, hfMirror?: string) => {
    try {
      const modelUri = MODEL_IDS[modelId];
      if (!modelUri) {
        return { success: false, error: 'Unknown model ID' };
      }

      const loader = new LocalModelLoader({ modelId: modelUri, downloadSource, hfMirror });

      // 如果已下载，直接返回
      if (loader.isDownloaded()) {
        return { success: true, message: 'Model already installed' };
      }

      // 启动下载
      loader.predownload().catch((err) => {
        console.error('Model download failed:', err);
      });

      return { success: true, message: 'Download started' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 打开本地模型目录
  ipcMain.handle('local-model:open-dir', async () => {
    try {
      const { shell } = require('electron');
      if (!fs.existsSync(MODEL_DIR)) {
        fs.mkdirSync(MODEL_DIR, { recursive: true });
      }
      await shell.openPath(MODEL_DIR);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ============ 工作目录文件浏览 ============
  ipcMain.handle('workspace:read-directory', async (_event, dirPath: string) => {
    try {
      const targetPath = dirPath || agentCwd || path.join(os.homedir(), '.xuanji', 'workspace');

      // 确保目录存在
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }

      // 新目录自动 git init
      if (!fs.existsSync(path.join(targetPath, '.git'))) {
        try { require('node:child_process').execSync('git init', { cwd: targetPath, encoding: 'utf-8', timeout: 5000, windowsHide: true }); } catch {}
      }

      // 检测 git 分支
      let gitBranch: string | null = null;
      const gitHead = path.join(targetPath, '.git', 'HEAD');
      if (fs.existsSync(gitHead)) {
        try {
          const m = fs.readFileSync(gitHead, 'utf-8').trim().match(/^ref:\s*refs\/heads\/(.+)$/);
          if (m) gitBranch = m[1];
        } catch {}
      }

      const items = fs.readdirSync(targetPath, { withFileTypes: true })
        .filter(d => !d.name.startsWith('.'))
        .map(d => {
          const fp = path.join(targetPath, d.name);
          let st: fs.Stats;
          try { st = fs.statSync(fp); } catch { st = { size: 0, mtimeMs: 0 } as fs.Stats; }
          return { name: d.name, path: fp, isDirectory: d.isDirectory(), size: d.isDirectory() ? 0 : st.size, modifiedAt: st.mtimeMs };
        })
        .sort((a, b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1);

      return { success: true, items, currentPath: targetPath, gitBranch };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // 用系统默认程序打开文件
  ipcMain.handle('workspace:open-file', async (_event, filePath: string) => {
    try {
      const { shell } = require('electron');
      await shell.openPath(path.normalize(filePath));
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 在系统文件管理器中显示文件/目录
  ipcMain.handle('workspace:show-in-folder', async (_event, filePath: string) => {
    try {
      const { shell } = require('electron');
      shell.showItemInFolder(path.normalize(filePath));
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 用系统默认浏览器打开 URL
  ipcMain.handle('workspace:open-url', async (_event, url: string) => {
    try {
      const { shell } = require('electron');
      await shell.openExternal(url);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 获取 git 工作目录文件状态（git status --porcelain）
  ipcMain.handle('workspace:get-git-status', async (_event, dirPath: string) => {
    try {
      const gitDir = path.join(dirPath, '.git');
      if (!fs.existsSync(gitDir)) {
        return { success: true, status: {} };
      }
      const { execSync } = require('node:child_process');
      const output = execSync('git status --porcelain', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      }).trim();
      const status: Record<string, string> = {};
      if (output) {
        for (const line of output.split('\n')) {
          const xy = line.substring(0, 2).trim();
          const filePath = line.substring(3).trim();
          if (filePath) {
            status[filePath] = xy;
          }
        }
      }
      return { success: true, status };
    } catch {
      return { success: true, status: {} };
    }
  });

  // ============ 文件监听（自动刷新文件树）============
  let fsWatcher: any = null;
  let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  ipcMain.handle('workspace:start-watch', async (_event, dirPath: string) => {
    try {
      // 停止旧监听
      if (fsWatcher) {
        try { fsWatcher.close(); } catch {}
        fsWatcher = null;
      }

      const Chokidar = require('chokidar');
      fsWatcher = Chokidar.watch(dirPath, {
        ignored: /(^|[/\\])\.(?!gitignore)/, // 忽略点文件但保留 .gitignore
        ignoreInitial: true,
        depth: 10,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });

      const emitChange = () => {
        if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
        watchDebounceTimer = setTimeout(() => {
          const mw = getMainWindow();
          if (mw && !mw.isDestroyed()) {
            mw.webContents.send('workspace:directory-changed', { path: dirPath });
          }
        }, 300);
      };

      fsWatcher.on('add', emitChange);
      fsWatcher.on('change', emitChange);
      fsWatcher.on('unlink', emitChange);
      fsWatcher.on('addDir', emitChange);
      fsWatcher.on('unlinkDir', emitChange);

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('workspace:stop-watch', async () => {
    if (fsWatcher) {
      try { fsWatcher.close(); } catch {}
      fsWatcher = null;
    }
    if (watchDebounceTimer) {
      clearTimeout(watchDebounceTimer);
      watchDebounceTimer = null;
    }
    return { success: true };
  });

  // ============ 拖拽文件路径解析 ============
  // Electron 28+ 移除了渲染进程的 File.path，必须通过主进程 webUtils 获取
  // 渲染进程发送文件名，主进程在各目录查找匹配的完整路径
  // 使用 app.getPath() 获取系统目录（跨平台 + 支持本地化名称）
  ipcMain.handle('workspace:resolve-drop-paths', async (_event, data: { fileNames: string[] }) => {
    try {
      const { app } = require('electron');
      const paths: string[] = [];

      // 跨平台常用目录（app.getPath 自动处理 Windows/macOS 本地化）
      const desktopDir = app.getPath('desktop');
      const downloadsDir = app.getPath('downloads');
      const documentsDir = app.getPath('documents');
      const homeDir = app.getPath('home');

      for (const name of data.fileNames) {
        // 如果是绝对路径且存在，直接使用
        if (path.isAbsolute(name) && fs.existsSync(name) && fs.statSync(name).isFile()) {
          paths.push(name);
          continue;
        }

        const candidates = [
          path.join(desktopDir, name),
          path.join(downloadsDir, name),
          path.join(documentsDir, name),
          path.join(homeDir, name),
          path.resolve(name),
        ];

        let found: string | undefined;
        for (const c of candidates) {
          try {
            if (fs.existsSync(c) && fs.statSync(c).isFile()) {
              found = c;
              break;
            }
          } catch { /* continue */ }
        }

        paths.push(found ?? name);
      }

      return paths;
    } catch {
      return [];
    }
  });

}
