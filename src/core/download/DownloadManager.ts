// ============================================================
// Download Manager - 全局下载管理器
// ============================================================
// 通用下载管理，支持 HTTP/HTTPS 代理、进度追踪、队列管理
// 类似 IDE 的下载功能，可用于模型、插件、资源等任何文件下载

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger } from '../logger/index.js';
import { fileURLToPath } from 'node:url';

const log = logger.child({ module: 'DownloadManager' });

// 查找项目根目录
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
  return startDir;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = findProjectRoot(__dirname);
const DOWNLOAD_STATE_FILE = path.join(PROJECT_ROOT, '.xuanji', 'download-state.json');

export interface DownloadTask {
  id: string;
  url: string;
  dest: string;
  name: string;
  category?: string; // 'model' | 'plugin' | 'resource' 等
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: {
    percent: number;
    downloaded: number;
    total: number;
    speed: number; // bytes/s
  };
  error?: string;
  startTime?: number;
  endTime?: number;
}

export type DownloadEventType =
  | 'task-created'
  | 'task-started'
  | 'task-progress'
  | 'task-completed'
  | 'task-failed'
  | 'task-cancelled';

/**
 * 全局下载管理器（单例）
 */
export class DownloadManager extends EventEmitter {
  private static instance: DownloadManager;
  private static instanceCounter = 0;
  private instanceId: number;
  private tasks: Map<string, DownloadTask> = new Map();
  private activeDownloads: Map<string, AbortController> = new Map();
  private maxConcurrent = 3; // 最大并发下载数
  private shouldRestoreTasks: boolean;

  private constructor(shouldRestoreTasks: boolean = true) {
    super();
    this.instanceId = ++DownloadManager.instanceCounter;
    this.shouldRestoreTasks = shouldRestoreTasks;
    log.info(`[DownloadManager] 创建实例 #${this.instanceId}, shouldRestoreTasks=${shouldRestoreTasks}`);
    log.info(`[DownloadManager] Constructor called, PROJECT_ROOT=${PROJECT_ROOT}, DOWNLOAD_STATE_FILE=${DOWNLOAD_STATE_FILE}, shouldRestoreTasks=${shouldRestoreTasks}`);
    if (shouldRestoreTasks) {
      this.loadState();
    }
  }

  static getInstance(shouldRestoreTasks: boolean = true): DownloadManager {
    if (!DownloadManager.instance) {
      DownloadManager.instance = new DownloadManager(shouldRestoreTasks);
      log.info(`[DownloadManager] 首次创建单例实例 #${DownloadManager.instance.instanceId}`);
    } else {
      log.debug(`[DownloadManager] 返回已存在的实例 #${DownloadManager.instance.instanceId}, 当前 task-created 监听器数量: ${DownloadManager.instance.listenerCount('task-created')}`);
    }
    return DownloadManager.instance;
  }

  getInstanceId(): number {
    return this.instanceId;
  }

  /**
   * 触发事件
   */
  private emitEvent(eventName: DownloadEventType, task: DownloadTask): void {
    this.emit(eventName, task);
  }

  /**
   * 加载持久化的任务状态
   */
  private loadState(): void {
    try {
      log.info(`[DownloadManager] Loading state from: ${DOWNLOAD_STATE_FILE}`);
      if (!fs.existsSync(DOWNLOAD_STATE_FILE)) {
        log.info('[DownloadManager] No state file found, starting fresh');
        return;
      }

      const data = fs.readFileSync(DOWNLOAD_STATE_FILE, 'utf-8');
      const savedTasks: DownloadTask[] = JSON.parse(data);
      log.info(`[DownloadManager] Found ${savedTasks.length} saved tasks`);

      for (const task of savedTasks) {
        log.info(`[DownloadManager] Processing saved task: ${task.name} (${task.id}), status=${task.status}`);
        // 只恢复未完成的任务
        if (task.status === 'pending' || task.status === 'downloading') {
          // 重置为 pending 状态，准备重新下载
          task.status = 'pending';
          task.progress = {
            percent: 0,
            downloaded: 0,
            total: 0,
            speed: 0,
          };
          this.tasks.set(task.id, task);
          log.info(`[DownloadManager] Restored task: ${task.name} (${task.id}), will restart download`);

          // 自动重启下载
          this.startDownload(task.id).catch((err) => {
            log.error(`Failed to restart download: ${task.name}`, err);
          });
        } else {
          log.info(`[DownloadManager] Skipping task with status: ${task.status}`);
        }
      }
    } catch (err) {
      log.warn('[DownloadManager] Failed to load state:', err);
    }
  }

  /**
   * 保存任务状态到文件
   */
  private saveState(): void {
    // 只有启用了任务恢复的实例才保存状态
    if (!this.shouldRestoreTasks) {
      return;
    }

    try {
      const dir = path.dirname(DOWNLOAD_STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tasks = Array.from(this.tasks.values());
      fs.writeFileSync(DOWNLOAD_STATE_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
      log.info(`[DownloadManager] Saved ${tasks.length} tasks to state file`);
    } catch (err) {
      log.warn('[DownloadManager] Failed to save state:', err);
    }
  }

  /**
   * 创建下载任务
   */
  async download(options: {
    url: string;
    dest: string;
    name: string;
    category?: string;
  }): Promise<string> {
    log.info(`[DownloadManager] download() called: dest=${options.dest}, name=${options.name}`);
    log.info(`[DownloadManager] Current tasks count: ${this.tasks.size}`);

    // 检查是否已有相同目标文件的下载任务
    const existingTask = Array.from(this.tasks.values()).find(
      (t) => t.dest === options.dest && (t.status === 'pending' || t.status === 'downloading')
    );

    if (existingTask) {
      log.info(`[DownloadManager] Task already exists for ${options.dest}, reusing task ${existingTask.id}, status=${existingTask.status}`);
      return existingTask.id;
    }

    log.info(`[DownloadManager] No existing task found, creating new task`);
    log.info(`[DownloadManager] Existing tasks: ${Array.from(this.tasks.values()).map(t => `${t.id}:${t.dest}:${t.status}`).join(', ')}`);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const task: DownloadTask = {
      id,
      url: options.url,
      dest: options.dest,
      name: options.name,
      category: options.category,
      status: 'pending',
      progress: {
        percent: 0,
        downloaded: 0,
        total: 0,
        speed: 0,
      },
    };

    this.tasks.set(id, task);
    log.info(`[DownloadManager] Task created: ${task.name} (${id}), category=${task.category}`);
    this.saveState(); // 保存状态
    log.info(`[DownloadManager] 实例 #${this.instanceId} 触发 'task-created' 事件 for task ${id}`);
    log.info(`[DownloadManager] task-created 监听器数量: ${this.listenerCount('task-created')}`);

    this.emitEvent('task-created', task);
    log.info(`[DownloadManager] 'task-created' event emitted for task ${id}`);

    // 启动下载（异步）
    this.startDownload(id).catch((err) => {
      log.error(`Download failed: ${task.name}`, err);
    });

    return id;
  }

  /**
   * 启动下载
   */
  private async startDownload(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // 等待并发槽位
    while (this.activeDownloads.size >= this.maxConcurrent) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const abortController = new AbortController();
    this.activeDownloads.set(taskId, abortController);

    task.status = 'downloading';
    task.startTime = Date.now();
    this.saveState(); // 保存状态
    this.emitEvent('task-started', task);

    try {
      await this.downloadFile(task, abortController.signal);
      task.status = 'completed';
      task.endTime = Date.now();
      task.progress.percent = 100;
      this.saveState(); // 保存状态
      this.emitEvent('task-completed', task);
      log.info(`Download completed: ${task.name}`);

      // 自动清理已完成的任务（延迟清理，给UI时间显示完成状态）
      setTimeout(() => {
        this.tasks.delete(taskId);
        this.saveState();
        log.info(`[DownloadManager] Auto-cleaned completed task: ${taskId}`);
      }, 5000); // 5秒后清理
    } catch (err: any) {
      if (err.name === 'AbortError') {
        task.status = 'cancelled';
        this.saveState(); // 保存状态
        this.emitEvent('task-cancelled', task);
        log.info(`Download cancelled: ${task.name}`);
      } else {
        task.status = 'failed';
        task.error = err.message;
        this.saveState(); // 保存状态
        this.emitEvent('task-failed', task);
        log.error(`Download failed: ${task.name}`, err);
      }
    } finally {
      this.activeDownloads.delete(taskId);
    }
  }

  /**
   * 下载文件（支持代理、进度、取消）
   */
  private async downloadFile(task: DownloadTask, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(task.url);
      const isHttps = parsedUrl.protocol === 'https:';

      // 检测代理
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                    process.env.https_proxy || process.env.http_proxy;
      const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

      if (proxy) {
        log.info(`Using proxy: ${proxy}`);
      }

      // 确保目标目录存在
      const dir = path.dirname(task.dest);
      fs.mkdirSync(dir, { recursive: true });

      const client = isHttps ? https : http;
      const options: any = {
        agent,
        headers: {
          'User-Agent': 'xuanji/0.9.0',
        },
      };

      const file = fs.createWriteStream(task.dest);
      let downloadedBytes = 0;
      let lastBytes = 0;
      let lastTime = Date.now();

      // 监听取消信号
      signal.addEventListener('abort', () => {
        file.close();
        if (fs.existsSync(task.dest)) {
          fs.unlinkSync(task.dest);
        }
        reject(new Error('AbortError'));
      });

      const request = client.get(task.url, options, (response) => {
        // 处理重定向 (301, 302, 307, 308)
        if (response.statusCode === 301 || response.statusCode === 302 ||
            response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'));
            return;
          }
          file.close();
          if (fs.existsSync(task.dest)) {
            fs.unlinkSync(task.dest);
          }

          // 处理相对路径重定向
          let fullRedirectUrl: string;
          if (redirectUrl.startsWith('http://') || redirectUrl.startsWith('https://')) {
            fullRedirectUrl = redirectUrl;
          } else {
            // 相对路径，需要拼接原始 URL 的 origin
            const originalUrl = new URL(task.url);
            if (redirectUrl.startsWith('/')) {
              // 绝对路径（相对于域名）
              fullRedirectUrl = `${originalUrl.protocol}//${originalUrl.host}${redirectUrl}`;
            } else {
              // 相对路径（相对于当前路径）
              const basePath = originalUrl.pathname.substring(0, originalUrl.pathname.lastIndexOf('/') + 1);
              fullRedirectUrl = `${originalUrl.protocol}//${originalUrl.host}${basePath}${redirectUrl}`;
            }
          }

          task.url = fullRedirectUrl;
          this.downloadFile(task, signal).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(task.dest)) {
            fs.unlinkSync(task.dest);
          }
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        task.progress.total = totalBytes;

        response.on('data', (chunk) => {
          if (signal.aborted) return;

          downloadedBytes += chunk.length;
          const now = Date.now();
          const elapsed = now - lastTime;

          // 每秒更新一次进度
          if (elapsed >= 1000) {
            const speed = ((downloadedBytes - lastBytes) / elapsed) * 1000;
            const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

            task.progress.downloaded = downloadedBytes;
            task.progress.percent = percent;
            task.progress.speed = speed;

            this.emitEvent('task-progress', task);

            lastBytes = downloadedBytes;
            lastTime = now;
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          task.progress.downloaded = downloadedBytes;
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(task.dest)) {
          fs.unlinkSync(task.dest);
        }
        reject(err);
      });

      file.on('error', (err) => {
        file.close();
        if (fs.existsSync(task.dest)) {
          fs.unlinkSync(task.dest);
        }
        reject(err);
      });
    });
  }

  /**
   * 取消下载
   */
  cancel(taskId: string): void {
    const controller = this.activeDownloads.get(taskId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): DownloadTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取指定分类的任务
   */
  getTasksByCategory(category: string): DownloadTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.category === category);
  }

  /**
   * 清除已完成/失败的任务
   */
  clearFinished(): void {
    log.info('[DownloadManager] Clearing finished tasks...');
    let count = 0;
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        this.tasks.delete(id);
        count++;
      }
    }
    log.info(`[DownloadManager] Cleared ${count} finished tasks`);
    // 更新持久化文件
    this.saveState();
  }

  /**
   * 设置最大并发数
   */
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, max);
  }
}
