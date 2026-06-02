/**
 * EmbeddingProvider — 本地 + API 双模式向量化
 *
 * local 模式：通过独立子进程运行 @xenova/transformers，使用 stdin/stdout JSON 通信
 * API 模式：直接 HTTP 调用于火山引擎 / OpenAI / 百炼 / Ollama 等平台
 */
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '@/core/logger';
import { getRuntimeConfig } from '@/core/config/RuntimeConfig.js';
import type { DownloadSource } from '@/shared/types/config';

const log = logger.child({ module: 'EmbeddingProvider' });

/** 获取 resources 根目录（兼容 Electron 主进程和独立 Node 子进程） */
function getResourcesRoot(): string | null {
  const pRes = (process as any).resourcesPath as string | undefined;
  if (pRes) return pRes;

  try {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(scriptDir, '..');
    if (fs.existsSync(path.join(root, 'dist-electron'))) return root;
  } catch {}

  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, 'desktop', 'extraResources')) &&
          fs.existsSync(path.join(dir, 'src'))) {
        return path.join(dir, 'desktop');
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}

  try {
    const alt = path.join(path.dirname(process.execPath), '..', 'Resources');
    if (fs.existsSync(alt)) return path.resolve(alt);
  } catch {}

  return null;
}

export interface EmbeddingProviderInterface {
  embed(text: string): Promise<number[]>;
  cosineSimilarity(a: number[], b: number[]): number;
  dotProduct(vectors: Float32Array, offset: number, query: Float32Array, dimensions: number): number;
  /** 返回当前使用的模型标识，如 "ark/doubao-embedding-vision" */
  getModelName(): string;
}

export interface EmbeddingProviderConfig {
  /** 本地模型 ID（local 模式），如 Xenova/paraphrase-multilingual-MiniLM-L12-v2 */
  modelId?: string;
  /** 本地模型缓存目录 */
  cacheDir?: string;
  /** 向量维度（local 默认 384，API 模式自动检测） */
  dimensions?: number;
  /** 平台标识: "local" | "ark" | "openai" | "bailian" | "ollama" */
  provider?: string;
  /** API Key（API 模式必需） */
  apiKey?: string;
  /** API 接口地址（API 模式必需） */
  baseURL?: string;
}

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.xuanji', 'embedding-models');
const DEFAULT_LOCAL_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

/** 预置向量模型列表（Xenova/transformers.js 格式） */
export const EMBEDDING_MODEL_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
}> = [
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    name: 'paraphrase-multilingual-MiniLM-L12-v2',
    description: '多语言 (中/英), 384d — 推荐',
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    name: 'all-MiniLM-L6-v2',
    description: '英语轻量, 384d, ~80MB',
  },
  {
    id: 'Xenova/bge-small-en-v1.5',
    name: 'bge-small-en-v1.5',
    description: 'BGE 英语通用, 384d — BAAI',
  },
];

/** 扫描本地已安装的向量模型（Xenova 格式，二层目录：Xenova/model-name/） */
export function scanInstalledEmbeddingModels(cacheDir?: string): Array<{
  id: string;
  name: string;
  description: string;
  installed: boolean;
}> {
  const dir = cacheDir || DEFAULT_CACHE_DIR;
  const installedIds = new Set<string>();

  try {
    if (fs.existsSync(dir)) {
      // 二层扫描：embedding-models/Xenova/<model-name>/
      for (const topEntry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!topEntry.isDirectory()) continue;
        const namespaceDir = path.join(dir, topEntry.name);
        for (const entry of fs.readdirSync(namespaceDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const modelDir = path.join(namespaceDir, entry.name);
          const configExists = fs.existsSync(path.join(modelDir, 'config.json'));
          const tokenizerExists = fs.existsSync(path.join(modelDir, 'tokenizer.json'));
          const onnxDir = path.join(modelDir, 'onnx');
          const onnxExists = fs.existsSync(path.join(onnxDir, 'model.onnx')) ||
            fs.existsSync(path.join(onnxDir, 'model_quantized.onnx'));
          if (configExists && tokenizerExists && onnxExists) {
            installedIds.add(entry.name);
          }
        }
      }
    }
  } catch {}

  // 合并预设 + 已安装
  const result: Array<{ id: string; name: string; description: string; installed: boolean }> = [];

  // 先添加预设模型
  for (const preset of EMBEDDING_MODEL_PRESETS) {
    result.push({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      installed: installedIds.has(preset.name),
    });
    installedIds.delete(preset.name);
  }

  // 再添加用户手动放入的模型
  for (const name of installedIds) {
    result.push({ id: `Xenova/${name}`, name, description: '用户安装', installed: true });
  }

  return result;
}

/** API 模式各 provider 的维度映射 */
const PROVIDER_DIMENSIONS: Record<string, number> = {
  ark: 2048,
  openai: 1536,
  bailian: 1536,
  ollama: 768,
};

/** 读取 RuntimeConfig 中的 embedding 配置 */
function readEmbeddingConfig(): { provider: string; model: string; apiKey: string; baseURL: string } | null {
  const rt = getRuntimeConfig();
  if (!rt) return null;
  const emb = rt.modelProviders?.embedding || rt.embedding;
  if (!emb || !emb.provider) return null;
  return {
    provider: emb.provider,
    model: emb.model || '',
    apiKey: emb.apiKey || '',
    baseURL: emb.baseURL || '',
  };
}

/** 获取运行 worker 的 Node.js 路径 */
function getWorkerNodePath(): string | null {
  const root = getResourcesRoot();
  if (root) {
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    const packaged = path.join(root, 'node', 'bin', nodeName);
    if (fs.existsSync(packaged)) return packaged;
    const dev = path.join(root, 'extraResources', 'node', 'bin', nodeName);
    if (fs.existsSync(dev)) return dev;
  }
  return process.execPath;
}

/** 获取 worker 脚本路径 */
function getWorkerPath(): string | null {
  const root = getResourcesRoot();
  if (root) {
    const packaged = path.join(root, 'node', 'embedding-worker.js');
    if (fs.existsSync(packaged)) return packaged;
    const dev = path.join(root, 'extraResources', 'node', 'embedding-worker.js');
    if (fs.existsSync(dev)) return dev;
  }
  return null;
}

function getDistNodeModulesPath(): string | null {
  const root = getResourcesRoot();
  if (root) {
    const p = path.join(root, 'dist-electron', 'node_modules');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export class EmbeddingProvider implements EmbeddingProviderInterface {
  // ── Provider 标识 ──
  private provider: string;

  // ── 通用字段 ──
  private modelId: string;
  private dimensions: number;

  // ── API Provider 字段 ──
  private apiKey: string;
  private apiBaseURL: string;

  // ── Xenova Worker ──
  private cacheDir: string;
  private worker: ChildProcess | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private requestId = 0;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private workerNodePath: string | null = null;

  /** Xenova Worker 作为 provider 的一种，不是独立"模式" */
  private get isXenova(): boolean {
    return this.provider === 'xenova' || this.provider === 'local';
  }

  constructor(config: EmbeddingProviderConfig = {}) {
    // 优先使用显式传入的 config，其次读取 RuntimeConfig
    if (config.provider) {
      this.provider = config.provider;
      this.modelId = config.modelId || (this.isXenova ? DEFAULT_LOCAL_MODEL : '');
      this.apiKey = config.apiKey || '';
      this.apiBaseURL = config.baseURL || '';
    } else {
      const rtCfg = readEmbeddingConfig();
      if (rtCfg && rtCfg.provider) {
        this.provider = rtCfg.provider;
        this.modelId = rtCfg.model || '';
        this.apiKey = rtCfg.apiKey;
        this.apiBaseURL = rtCfg.baseURL;
      } else {
        this.provider = 'xenova';
        this.modelId = config.modelId || DEFAULT_LOCAL_MODEL;
        this.apiKey = '';
        this.apiBaseURL = '';
      }
    }

    this.cacheDir = config.cacheDir || DEFAULT_CACHE_DIR;
    this.dimensions = config.dimensions || (this.isXenova
      ? 384
      : (PROVIDER_DIMENSIONS[this.provider] || 1024));

    if (!this.isXenova) {
      log.info(`[EmbeddingProvider] provider=${this.provider}, model=${this.modelId}, dims=${this.dimensions}`);
    }
  }

  getModelName(): string {
    return `${this.provider}/${this.modelId}`;
  }

  modelExists(): boolean {
    if (!this.isXenova) {
      return !!(this.apiKey && this.modelId && this.apiBaseURL);
    }
    // xenova: check disk
    const modelDir = path.join(this.cacheDir, this.modelId);
    const configExists = fs.existsSync(path.join(modelDir, 'config.json'));
    const tokenizerExists = fs.existsSync(path.join(modelDir, 'tokenizer.json'));
    const onnxDir = path.join(modelDir, 'onnx');
    const onnxExists = fs.existsSync(path.join(onnxDir, 'model.onnx')) ||
      fs.existsSync(path.join(onnxDir, 'model_quantized.onnx'));
    return configExists && tokenizerExists && onnxExists;
  }

  // ============================================================
  // API 模式：embedViaAPI
  // ============================================================

  /** 构建 API 模式的请求 URL */
  private buildApiUrl(): string {
    const base = this.apiBaseURL.replace(/\/+$/, '');
    switch (this.provider) {
      case 'ollama':
        return `${base}/api/embeddings`;
      default:
        return `${base}/embeddings`;
    }
  }

  /** 构建 API 模式的请求体 */
  private buildApiBody(text: string): Record<string, unknown> {
    switch (this.provider) {
      case 'ollama':
        return { model: this.modelId, prompt: text };
      default:
        return { model: this.modelId, input: text };
    }
  }

  /** 从 API 响应中提取 embedding 向量 */
  private extractApiEmbedding(data: any): number[] | null {
    switch (this.provider) {
      case 'ollama':
        return data?.embedding || null;
      case 'bailian': {
        const output = data?.output;
        if (output?.embeddings?.[0]?.embedding) return output.embeddings[0].embedding;
        break;
      }
      default:
        return data?.data?.[0]?.embedding || null;
    }
    return null;
  }

  /** HTTP API 方式做向量化 */
  private async embedViaAPI(text: string): Promise<number[]> {
    const url = this.buildApiUrl();
    const body = this.buildApiBody(text);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.provider !== 'ollama') {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Embedding API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const vec = this.extractApiEmbedding(data);
    if (!vec || !Array.isArray(vec) || vec.length === 0) {
      throw new Error(`Embedding API returned no vector`);
    }

    // 动态更新维度（首次调用时确定实际维度）
    if (this.dimensions !== vec.length) {
      this.dimensions = vec.length;
    }

    return vec;
  }

  // ============================================================
  // Local 模式：Xenova worker
  // ============================================================

  private async initWorker(): Promise<void> {
    if (this.worker) {
      this.worker.stdout?.removeAllListeners();
      this.worker.stderr?.removeAllListeners();
      this.worker.removeAllListeners();
      this.worker.kill();
      this.worker = null;
      for (const [id, p] of this.pending) {
        p.reject(new Error('worker restarted'));
      }
      this.pending.clear();
    }
    this.buffer = '';
    this.initialized = false;
    const nodePath = getWorkerNodePath();
    const workerPath = getWorkerPath();
    const distModules = getDistNodeModulesPath();

    if (!nodePath || !workerPath) {
      log.info('[EmbeddingProvider] 不在打包环境下，跳过子进程模式');
      return;
    }

    this.workerNodePath = nodePath;
    log.info(`[EmbeddingProvider] spawning worker: ${nodePath} ${workerPath}`);

    const isElectronNode = nodePath === process.execPath;

    this.worker = spawn(nodePath, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ...(isElectronNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        NODE_PATH: distModules || '',
        WORKER_DEBUG_LOG: path.join(os.tmpdir(), 'embedding-worker-debug.log'),
      },
    });

    log.info(`[EmbeddingProvider] worker spawned: pid=${this.worker.pid}`);

    this.worker.stdout?.on('data', (data: Buffer) => {
      try {
        require('fs').appendFileSync(path.join(os.tmpdir(), 'embedding-worker-stdout.log'), data);
      } catch {}
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this.resolvePending(msg.id as string, msg.result, msg.error);
        } catch {
          log.warn('[EmbeddingProvider] 子进程消息解析失败:', line);
        }
      }
    });

    this.worker.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log.warn(`[worker] ${text}`);
    });

    this.worker.on('exit', (code, signal) => {
      log.warn(`[EmbeddingProvider] worker exited code=${code} signal=${signal}`);
      this.worker = null;
      this.initialized = false;
      for (const [id, p] of this.pending) {
        p.reject(new Error(`worker exited (code=${code})`));
        this.pending.delete(id);
      }
    });

    this.worker.on('error', (err) => {
      log.error(`[EmbeddingProvider] worker error: ${err.message}`);
      this.worker = null;
    });

    await this.waitFor('ready', 60000);

    const rtConfig = getRuntimeConfig();
    const source: DownloadSource = rtConfig?.download?.source || 'huggingface';
    let remoteHost: string;
    switch (source) {
      case 'hf-mirror': remoteHost = 'https://hf-mirror.com'; break;
      case 'modelscope': remoteHost = 'https://www.modelscope.cn/models'; break;
      case 'custom': remoteHost = rtConfig?.download?.hfMirror || 'https://huggingface.co'; break;
      case 'huggingface':
      default: remoteHost = 'https://huggingface.co'; break;
    }

    const initResult = await this.send('init', {
      modelId: this.modelId,
      cacheDir: this.cacheDir,
      remoteHost,
    }, 300000);

    if (!initResult?.ok) {
      throw new Error(`Embedding worker init failed: ${initResult?.error || 'unknown'}`);
    }

    log.info('[EmbeddingProvider] worker initialized');
  }

  private send(method: string, params: any, timeoutMs?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.worker.stdin) {
        reject(new Error('worker not running'));
        return;
      }
      const id = String(++this.requestId);
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`send ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      this.pending.set(id, {
        resolve: (result: any) => {
          if (timer) clearTimeout(timer);
          resolve(result);
        },
        reject: (err: Error) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      });
      this.worker.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  private waitFor(eventType: string, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('worker not running'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(eventType);
        reject(new Error(`waitFor ${eventType} timed out after ${timeout}ms`));
      }, timeout);
      this.pending.set(eventType, {
        resolve: (result: any) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  private resolvePending(id: string, result: any, error?: string) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (error) {
      p.reject(new Error(error));
    } else {
      p.resolve(result);
    }
  }

  // ============================================================
  // 统一 embed 入口
  // ============================================================

  async embed(text: string): Promise<number[]> {
    if (!text || text.trim() === '') {
      return new Array(this.dimensions).fill(0);
    }

    // 非 Xenova provider：直接 HTTP 调用
    if (!this.isXenova) {
      try {
        return await this.embedViaAPI(text);
      } catch (err) {
        log.warn(`[EmbeddingProvider] API embed failed: ${err instanceof Error ? err.message : String(err)}`);
        return new Array(this.dimensions).fill(0);
      }
    }

    // Xenova provider：worker 子进程
    this.triggerLocalInit();
    if (this.initPromise && !this.initialized) {
      try {
        await this.initPromise;
      } catch {
        // init 失败已在 triggerLocalInit 中处理
      }
    }

    if (!this.initialized || !this.worker) {
      return new Array(this.dimensions).fill(0);
    }

    const result = await this.send('embed', { text }, 30000);
    if (result?.vector) {
      return result.vector;
    }
    log.warn(`[EmbeddingProvider] embed failed: ${result?.error || 'no vector'}`);
    return new Array(this.dimensions).fill(0);
  }

  /** 非阻塞触发 Xenova provider 初始化 */
  private triggerLocalInit(): void {
    if (this.initialized) return;
    if (this.initPromise) return;
    this.initPromise = this.initWorker()
      .then(() => {
        this.initialized = true;
        log.info('[EmbeddingProvider] 后台初始化完成，向量模型就绪');
      })
      .catch((err) => {
        log.warn(`[EmbeddingProvider] 后台初始化失败: ${err instanceof Error ? err.message : String(err)}，将自动重试`);
        this.initPromise = null;
      });
  }

  // ============================================================
  // 向量计算工具方法
  // ============================================================

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  dotProduct(vectors: Float32Array, offset: number, query: Float32Array, dimensions: number): number {
    let dot = 0;
    for (let i = 0; i < dimensions; i++) {
      dot += vectors[offset + i] * query[i];
    }
    return dot;
  }

  /** 退出子进程（local 模式）/ 清理（API 模式无操作） */
  async shutdown(): Promise<void> {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }
    this.initialized = false;
  }
}
