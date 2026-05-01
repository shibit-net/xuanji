// ============================================================
// Download IPC Handlers - 下载管理 IPC 接口
// ============================================================

import { ipcMain, BrowserWindow } from 'electron';
import { DownloadManager } from '../../../src/core/download/DownloadManager.js';
import { LocalModelLoader } from '../../../src/core/agent/dispatch/LocalModelLoader.js';
import { messageBus } from './MessageBus.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 主进程的 DownloadManager（用于主进程触发的下载）
// 不恢复任务，避免与子进程重复
const mainDownloadManager = DownloadManager.getInstance(false);

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
const MODEL_DIR = path.join(PROJECT_ROOT, '.xuanji', 'models');

const MODEL_IDS: Record<string, string> = {
  'qwen2.5-0.5b-q4': 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'qwen2.5-1.5b-q4': 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'chatglm3-6b-q4': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q4_K_M.gguf',
  'chatglm3-6b-q3': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q3_K_M.gguf',
  'glm4-9b-q4': 'hf:mradermacher/glm-4-9b-chat-GGUF:glm-4-9b-chat.Q4_K_M.gguf',
};

// 转发主进程 DownloadManager 事件到渲染进程
let mainEventsForwarded = false;


export function registerDownloadHandlers() {

  // 转发主进程 DownloadManager 事件到渲染进程（只注册一次）
  if (!mainEventsForwarded) {
    mainEventsForwarded = true;

    // 所有下载事件类型
    const downloadEvents = [
      'task-created',
      'task-started',
      'task-progress',
      'task-completed',
      'task-failed',
      'task-cancelled',
    ];

    // 转发主进程下载事件
    downloadEvents.forEach((eventName) => {
      mainDownloadManager.on(eventName, (task) => {
        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach((win) => {
          win.webContents.send('download:event', { type: eventName, task });
        });
      });
    });

    // 注意：子进程的下载事件转发在 agent/index.ts 中的 agent channel 创建时注册
  }

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

  // 检查 embedding 模型是否已安装
  ipcMain.handle('download:check-embedding-model', async (_event, modelId: string) => {
    try {
      const modelDir = path.join(PROJECT_ROOT, '.xuanji', 'embedding-models', modelId);

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

  // 卸载 embedding 模型
  ipcMain.handle('download:uninstall-embedding-model', async (_event, modelId: string) => {
    try {
      const modelDir = path.join(PROJECT_ROOT, '.xuanji', 'embedding-models', modelId);

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
  ipcMain.handle('local-model:download', async (_event, modelId: string) => {
    try {
      const modelUri = MODEL_IDS[modelId];
      if (!modelUri) {
        return { success: false, error: 'Unknown model ID' };
      }

      const loader = new LocalModelLoader({ modelId: modelUri });

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

}
