// ============================================================
// Local Model Loader - 本地模型加载器（node-llama-cpp）
// ============================================================
// 使用 node-llama-cpp 运行 GGUF 格式模型，原生支持 x64/arm64
// 首次运行自动从 HuggingFace 下载模型（通过全局 DownloadManager）

import { logger } from '../../logger/index.js';
import { DownloadManager } from '../../download/DownloadManager.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const log = logger.child({ module: 'LocalModelLoader' });

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
  // 回退方案：假设在 src/core/agent/dispatch/ 下，向上 4 级
  return path.join(startDir, '../../../..');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = findProjectRoot(__dirname);
const MODEL_DIR = path.join(PROJECT_ROOT, '.xuanji', 'models');

export interface ModelConfig {
  /** 模型 ID，支持格式:
   * - "hf:owner/repo:filename.gguf" (HuggingFace)
   * - "file:filename.gguf" (本地文件，从 ~/.xuanji/models/ 加载)
   */
  modelId: string;
  /** 系统提示词 */
  systemPrompt?: string;
}

export class LocalModelLoader {
  private session: any = null;
  private llama: any = null;
  private model: any = null;
  private context: any = null;
  private config: ModelConfig;
  private loading: Promise<void> | null = null;
  private downloadTaskId: string | null = null;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  /**
   * 预下载模型（不加载到内存）
   * 适用于首次启动时后台下载，不阻塞主流程
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

    log.info(`[LocalModelLoader] Model not found locally, starting download...`);

    // 使用全局 DownloadManager
    const downloadManager = DownloadManager.getInstance();
    const hfEndpoint = process.env.HF_ENDPOINT || 'https://hf-mirror.com';
    const downloadUrl = `${hfEndpoint}/${repoPath}/resolve/main/${filename}`;

    log.info(`[LocalModelLoader] Creating download task: ${downloadUrl} -> ${localPath}`);
    this.downloadTaskId = await downloadManager.download({
      url: downloadUrl,
      dest: localPath,
      name: `Model: ${filename}`,
      category: 'model',
    });
    log.info(`[LocalModelLoader] Download task created: ${this.downloadTaskId}`);

    // 等待下载完成
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

    const [, repoPath, filename] = this.config.modelId.split(':');
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
      await this.loading;
      return;
    }
    this.loading = this._load();
    await this.loading;
    this.loading = null;
  }

  private async _load(): Promise<void> {
    const {
      getLlama,
      LlamaChatSession,
    } = await import('node-llama-cpp');

    log.info(`Loading model: ${this.config.modelId}...`);
    const startTime = Date.now();

    // 解析模型 URI 并下载（如果不存在）
    const modelPath = await this.downloadModelIfNeeded(this.config.modelId);

    this.llama = await getLlama();
    this.model = await this.llama.loadModel({ modelPath });
    this.context = await this.model.createContext({ contextSize: 2048 });

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
   * - "file:filename.gguf" (本地文件，直接从 ~/.xuanji/models/ 加载)
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

  async generate(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    // Check if model file still exists
    if (!this.isDownloaded()) {
      if (this.session) {
        await this.unload();
      }
      log.info(`Model file not found, re-downloading: ${this.modelPath}`);
      await this.download();
    }

    if (!this.session) await this.load();

    const result = await this.session.prompt(prompt, {
      maxTokens: options?.maxTokens ?? 128,
      temperature: options?.temperature ?? 0.3,
    });

    return result;
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
