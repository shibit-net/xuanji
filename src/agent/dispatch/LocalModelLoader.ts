// ============================================================
// Local Model Loader - 本地模型加载器（node-llama-cpp）
// ============================================================
// 使用 node-llama-cpp 运行 GGUF 格式模型，原生支持 x64/arm64
// 首次运行自动从 HuggingFace 下载模型（通过全局 DownloadManager）

import { logger } from '@/core/logger/index.js';
import { DownloadManager } from '@/core/download/DownloadManager.js';
import { getRuntimeConfig } from '@/core/config/RuntimeConfig.js';
import type { DownloadSource } from '@/shared/types/config';
import { homedir, platform } from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
const log = logger.child({ module: 'LocalModelLoader' });

const MODEL_DIR = path.join(homedir(), '.xuanji', 'models');

/** 根据下载源和仓库路径构造模型下载 URL */
function buildDownloadUrl(source: DownloadSource, repoPath: string, filename: string, customMirror?: string): string {
  switch (source) {
    case 'huggingface':
      return `https://huggingface.co/${repoPath}/resolve/main/${filename}`;
    case 'modelscope':
      return `https://www.modelscope.cn/models/${repoPath}/resolve/master/${filename}`;
    case 'custom':
      return `${customMirror || 'https://huggingface.co'}/${repoPath}/resolve/main/${filename}`;
    case 'hf-mirror':
      return `https://hf-mirror.com/${repoPath}/resolve/main/${filename}`;
    default:
      return `https://huggingface.co/${repoPath}/resolve/main/${filename}`;
  }
}

/** GGUF 文件魔数：GGUF 格式以 "GGUF" 开头（0x47 0x47 0x55 0x46） */
const GGUF_MAGIC = Buffer.from([0x47, 0x47, 0x55, 0x46]);

export interface ModelConfig {
  /** 模型 ID，支持格式:
   * - "hf:owner/repo:filename.gguf" (HuggingFace)
   * - "file:filename.gguf" (本地文件，从 .xuanji/models/ 加载)
   */
  modelId: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 上下文窗口大小（token 数），默认 32768 */
  contextSize?: number;
  /** 下载源类型 */
  downloadSource?: string;
  /** 自定义镜像地址（source=custom 时生效） */
  hfMirror?: string;
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
    log.debug(`[LocalModelLoader] predownload: modelId=${this.config.modelId}, localPath=${localPath}`);

    if (fs.existsSync(localPath)) {
      log.debug(`[LocalModelLoader] Model already exists, skip download: ${localPath}`);
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
      log.debug(`[LocalModelLoader] Model already exists: ${localPath}`);
      return '';
    }

    fs.mkdirSync(MODEL_DIR, { recursive: true });

    const downloadManager = DownloadManager.getInstance();
    const rtConfig = getRuntimeConfig();
    const source = (this.config.downloadSource as DownloadSource)
      || rtConfig?.download?.source
      || 'huggingface';
    const customMirror = this.config.hfMirror
      || rtConfig?.download?.hfMirror;
    const downloadUrl = buildDownloadUrl(source, repoPath, filename, customMirror);

    log.debug(`[LocalModelLoader] Creating download task: ${downloadUrl} -> ${localPath}`);
    this.downloadTaskId = await downloadManager.download({
      url: downloadUrl,
      dest: localPath,
      name: `Model: ${filename}`,
      category: 'model',
    });
    log.debug(`[LocalModelLoader] Download task created: ${this.downloadTaskId}`);
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
   * 校验 GGUF 文件，检查魔数和最小文件大小
   */
  private validateGgufFile(filePath: string): void {
    const stat = fs.statSync(filePath);
    // GGUF 最小头部: magic(4) + version(4) + tensor_count(8) + metadata_kv_count(8) = 24 字节
    if (stat.size < 24) {
      throw new Error(
        `模型文件太小 (${stat.size} bytes)，可能下载不完整。请删除后重新下载: ${filePath}`
      );
    }

    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(4);
      fs.readSync(fd, header, 0, 4, 0);
      if (!header.equals(GGUF_MAGIC)) {
        throw new Error(
          `不是有效的 GGUF 文件: ${filePath}。文件头: ${header.toString('hex')}，期望: ${GGUF_MAGIC.toString('hex')}`
        );
      }
    } finally {
      fs.closeSync(fd);
    }
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
    log.debug(`Model path resolved: ${modelPath}`);

    // 校验 GGUF 文件头
    this.validateGgufFile(modelPath);

    log.debug('Importing node-llama-cpp...');
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    log.debug('node-llama-cpp imported successfully');

    log.debug(`Loading model: ${this.config.modelId}...`);
    const startTime = Date.now();

    // 使用 auto 自动检测 GPU：有 GPU 用 GPU，没有则 CPU 降级
    log.debug('Calling getLlama() with gpu=auto...');
    this.llama = await getLlama({ gpu: 'auto' as const });
    const gpuType = (this.llama as any).gpu;
    log.debug(`getLlama() done, gpu=${gpuType || 'cpu'}`);

    log.debug('Loading model file into memory...');
    try {
      const loadModelOpts: Record<string, any> = { modelPath };
      // macOS Metal 有 GPU 命令缓冲超时限制，大模型全层放 GPU 会触发
      // kIOAccelCommandBufferCallbackErrorTimeout，仅当 GPU 可用时限制层数
      if (platform() === 'darwin' && gpuType === 'metal') {
        loadModelOpts.gpuLayers = 20;
        log.debug('macOS Metal detected, limiting gpuLayers to 20 to avoid GPU timeout');
      }
      this.model = await this.llama.loadModel(loadModelOpts);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('corrupted') || msg.includes('incomplete') || msg.includes('not within the file bounds')) {
        throw new Error(
          `模型文件损坏或不完整，请删除后重新下载: ${modelPath}\n原始错误: ${msg}`
        );
      }
      throw err;
    }
    log.debug('Model file loaded');

    log.debug('Creating context...');
    const contextSize = this.config.contextSize || 32768;
    this.context = await this.model.createContext({ contextSize });
    log.debug('Context created');

    this.session = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: this.config.systemPrompt,
    });

    log.debug(`Model loaded in ${Date.now() - startTime}ms`);
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
      log.debug(`Using local model file: ${localPath}`);
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
      log.debug(`Model already exists: ${localPath}`);
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
      log.debug('Model file not found, starting background download...');
      this.startDownload().catch((err) => log.error('Background download failed:', err));
      throw new Error('Local model not downloaded yet. Download started in background, please retry later.');
    }

    // Ensure model infrastructure is loaded
    if (!this.llama || !this.context) {
      log.debug('Loading model into memory...');
      try {
        await this.load();
        log.debug('Model loaded successfully');
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
      log.debug(`Prompt completed in ${Date.now() - t0}ms, result length: ${result.length}`);
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
    log.debug('Model unloaded');
  }
}
