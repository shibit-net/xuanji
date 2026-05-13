// ============================================================
// Local Model Loader - 本地模型加载器（node-llama-cpp）
// ============================================================
// 使用 node-llama-cpp 运行 GGUF 格式模型，原生支持 x64/arm64
// 首次运行自动从 HuggingFace 下载模型（通过全局 DownloadManager）

import { logger } from '@/core/logger/index.js';
import { DownloadManager } from '@/core/download/DownloadManager.js';
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
const log = logger.child({ module: 'LocalModelLoader' });

const MODEL_DIR = path.join(homedir(), '.xuanji', 'models');

export interface ModelConfig {
  /** 模型 ID，支持格式:
   * - "hf:owner/repo:filename.gguf" (HuggingFace)
   * - "file:filename.gguf" (本地文件，从 .xuanji/models/ 加载)
   */
  modelId: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 上下文窗口大小（token 数），默认 2048 */
  contextSize?: number;
}

export class LocalModelLoader {
  private static instances = new Map<string, LocalModelLoader>();

  private session: any = null;
  private llama: any = null;
  private model: any = null;
  private context: any = null;
  private config: ModelConfig;
  private loading: Promise<void> | null = null;
  private downloadTaskId: string | null = null;

  constructor(config: ModelConfig) {
    this.config = config;
    // 按 modelUri 追踪实例，用于全局卸载
    if (config.modelId) {
      LocalModelLoader.instances.set(config.modelId, this);
    }
  }

  /** 获取某个模型的加载器实例 */
  static getInstance(modelUri: string): LocalModelLoader | undefined {
    return LocalModelLoader.instances.get(modelUri);
  }

  /** 卸载指定模型并释放内存 */
  static async unloadModel(modelUri: string): Promise<boolean> {
    const instance = LocalModelLoader.instances.get(modelUri);
    if (!instance || !instance.isLoaded()) return false;
    await instance.unload();
    return true;
  }

  /** 获取所有已加载的模型 URI */
  static getLoadedModels(): string[] {
    return [...LocalModelLoader.instances.entries()]
      .filter(([, loader]) => loader.isLoaded())
      .map(([uri]) => uri);
  }

  /**
   * 预下载模型（不加载到内存），等待下载完成。
   * 适用于首次启动时后台下载，不阻塞主流程。
   */
  async predownload(): Promise<void> {
    const [, repoPath, filename] = this.config.modelId.split(':');
    if (!filename) throw new Error(`Invalid model ID: ${this.config.modelId}`);

    const localPath = path.join(MODEL_DIR, filename);
    log.info(`[LocalModelLoader] predownload: modelId=${this.config.modelId}, localPath=${localPath}`);

    if (fs.existsSync(localPath)) {
      log.info(`[LocalModelLoader] Model already exists, skip download: ${localPath}`);
      return;
    }

    // 创建下载任务，然后等待完成
    await this.startDownload();
    await this.waitForDownload();
  }

  /**
   * 创建下载任务（非阻塞），通过 DownloadManager 管理。
   * 调用后立即返回，不等待下载完成。
   */
  async startDownload(): Promise<string> {
    const [, repoPath, filename] = this.config.modelId.split(':');
    if (!filename) throw new Error(`Invalid model ID: ${this.config.modelId}`);

    const localPath = path.join(MODEL_DIR, filename);
    if (fs.existsSync(localPath)) {
      log.info(`[LocalModelLoader] Model already exists: ${localPath}`);
      return '';
    }

    fs.mkdirSync(MODEL_DIR, { recursive: true });

    const downloadManager = DownloadManager.getInstance();
    const downloadUrl = `https://hf-mirror.com/${repoPath}/resolve/main/${filename}`;

    log.info(`[LocalModelLoader] Creating download task: ${downloadUrl} -> ${localPath}`);
    this.downloadTaskId = await downloadManager.download({
      url: downloadUrl,
      dest: localPath,
      name: `Model: ${filename}`,
      category: 'model',
    });
    log.info(`[LocalModelLoader] Download task created: ${this.downloadTaskId}`);
    return this.downloadTaskId;
  }

  /**
   * 等待下载任务完成。
   */
  async waitForDownload(): Promise<void> {
    if (!this.downloadTaskId) return;
    const downloadManager = DownloadManager.getInstance();

    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        const task = downloadManager.getTask(this.downloadTaskId!);
        if (!task) {
          reject(new Error('Download task not found'));
          return;
        }
        if (task.status === 'completed') {
          resolve();
        } else if (task.status === 'failed') {
          reject(new Error(task.error || 'Download failed'));
        } else if (task.status === 'cancelled') {
          reject(new Error('Download cancelled'));
        } else {
          setTimeout(checkStatus, 500);
        }
      };
      checkStatus();
    });
  }

  /**
   * 检查模型是否已下载
   */
  isDownloaded(): boolean {
    if (this.config.modelId.startsWith('file:')) {
      const filename = this.config.modelId.substring(5);
      const localPath = path.join(MODEL_DIR, filename);
      return fs.existsSync(localPath);
    }

    const [, _repoPath, filename] = this.config.modelId.split(':');
    if (!filename) return false;
    const localPath = path.join(MODEL_DIR, filename);
    return fs.existsSync(localPath);
  }

  /**
   * 获取下载任务 ID
   */
  getDownloadTaskId(): string | null {
    return this.downloadTaskId;
  }

  async load(): Promise<void> {
    if (this.session) return;
    if (this.loading) {
      try {
        await this.loading;
        return;
      } catch {
        // 上次加载失败，清除残留的 rejected promise，重新尝试
        this.loading = null;
      }
    }
    this.loading = this._load();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async _load(): Promise<void> {
    const modelPath = await this.downloadModelIfNeeded(this.config.modelId);
    log.info(`Model path resolved: ${modelPath}`);

    log.info('Importing node-llama-cpp...');
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    log.info('node-llama-cpp imported successfully');

    log.info(`Loading model: ${this.config.modelId}...`);
    const startTime = Date.now();

    log.info('Calling getLlama()...');
    this.llama = await getLlama();
    log.info('getLlama() done');

    log.info('Loading model file into memory...');
    this.model = await this.llama.loadModel({ modelPath });
    log.info('Model file loaded');

    log.info('Creating context...');
    const contextSize = this.config.contextSize || 2048;
    this.context = await this.model.createContext({ contextSize });
    log.info('Context created');

    this.session = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: this.config.systemPrompt,
    });

    log.info(`Model loaded in ${Date.now() - startTime}ms`);
  }

  /**
   * 下载模型文件（使用全局 DownloadManager）
   * URI 格式:
   * - "hf:owner/repo:filename.gguf" (HuggingFace)
   * - "file:filename.gguf" (本地文件，直接从 .xuanji/models/ 加载)
   */
  private async downloadModelIfNeeded(modelId: string): Promise<string> {
    if (modelId.startsWith('file:')) {
      const filename = modelId.substring(5);
      const localPath = path.join(MODEL_DIR, filename);
      if (!fs.existsSync(localPath)) {
        throw new Error(`本地模型文件不存在: ${localPath}`);
      }
      log.info(`Using local model file: ${localPath}`);
      return localPath;
    }

    if (!modelId.startsWith('hf:')) {
      throw new Error(`Unsupported model URI: ${modelId}`);
    }

    const [, repoPath, filename] = modelId.split(':');
    if (!repoPath || !filename) {
      throw new Error(`Invalid HF URI format: ${modelId}`);
    }

    const localPath = path.join(MODEL_DIR, filename);

    if (fs.existsSync(localPath)) {
      log.info(`Model already exists: ${localPath}`);
      return localPath;
    }

    fs.mkdirSync(MODEL_DIR, { recursive: true });

    await this.predownload();

    return localPath;
  }

  async generate(prompt: string, options?: { maxTokens?: number; temperature?: number; stateless?: boolean }): Promise<string> {
    // 模型未下载：创建下载任务（非阻塞），立即抛异常让调用方降级
    if (!this.isDownloaded()) {
      if (this.session) {
        await this.unload();
      }
      log.info('Model file not found, starting background download...');
      this.startDownload().catch((err) => log.error('Background download failed:', err));
      throw new Error('Local model not downloaded yet. Download started in background, please retry later.');
    }

    // Ensure model infrastructure is loaded
    if (!this.llama || !this.context) {
      log.info('Loading model into memory...');
      try {
        await this.load();
        log.info('Model loaded successfully');
      } catch (err: any) {
        log.error('Model load failed:', err.message, err.stack);
        throw err;
      }
    }

    if (options?.stateless) {
      this.session.resetChatHistory();
      await this.session.sequence.clearHistory();
    } else if (!this.session) {
      try {
        await this.load();
      } catch (err: any) {
        log.error('Model session load failed:', err.message, err.stack);
        throw err;
      }
    }

    try {
      const t0 = Date.now();
      const result = await this.session!.prompt(prompt, {
        maxTokens: options?.maxTokens ?? 128,
        temperature: options?.temperature ?? 0.3,
      });
      log.info(`Prompt completed in ${Date.now() - t0}ms, result length: ${result.length}`);
      return result;
    } catch (err: any) {
      log.error('Model prompt failed:', err.message, err.stack);
      throw err;
    }
  }

  isLoaded(): boolean {
    return this.session !== null;
  }

  async unload(): Promise<void> {
    this.session = null;
    if (this.context) { await this.context.dispose(); this.context = null; }
    if (this.model) { await this.model.dispose(); this.model = null; }
    if (this.llama) { await this.llama.dispose(); this.llama = null; }
    log.info('Model unloaded');
  }
}
