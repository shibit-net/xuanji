/**
 * EmbeddingProvider — 通过独立子进程做向量化
 *
 * 子进程运行在打包的 Node.js 上（extraResources/node/bin/node），
 * 使用 @xenova/transformers 做向量化，通过 stdin/stdout JSON 通信。
 *
 * 这样避免了 Electron 打包后 native 模块（sharp、onnxruntime-node）
 * 依赖路径断裂的问题。
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
  // Electron 主进程：process.resourcesPath
  const pRes = (process as any).resourcesPath as string | undefined;
  if (pRes) return pRes;

  // 从 import.meta.url 向上查找项目根目录（适用 dev + 打包环境）
  // dev 模式：tsx 直接运行 TypeScript，import.meta.url = .../src/core/embedding/EmbeddingProvider.ts
  // 打包环境：agent-bridge.mjs 位于 resources/dist-electron/ 下
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    // 向上遍历最多 10 层，找到包含 package.json + src/ 的目录（项目根）
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, 'package.json')) &&
          fs.existsSync(path.join(dir, 'src'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    // 打包环境兜底：检查 dist-electron/
    dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, 'dist-electron'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}

  // Electron + ELECTRON_RUN_AS_NODE=1
  try {
    const alt = path.join(path.dirname(process.execPath), '..', 'Resources');
    if (fs.existsSync(alt)) return path.resolve(alt);
  } catch {}

  return null;
}

export interface EmbeddingProviderInterface {
  embed(text: string): Promise<number[]>;
  cosineSimilarity(a: number[], b: number[]): number;
  /** 向量点积——直接对 Float32Array 偏移量计算，零分配 */
  dotProduct(vectors: Float32Array, offset: number, query: Float32Array, dimensions: number): number;
}

export interface EmbeddingProviderConfig {
  modelId?: string;
  cacheDir?: string;
  dimensions?: number;
}

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.xuanji', 'embedding-models');

/** 获取运行 worker 的 Node.js 路径 */
function getWorkerNodePath(): string | null {
  const root = getResourcesRoot();
  if (root) {
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    const bundled = path.join(root, 'node', 'bin', nodeName);
    if (fs.existsSync(bundled)) return bundled;
  }
  return process.execPath;
}

/** 获取 worker 脚本路径 */
function getWorkerPath(): string | null {
  const root = getResourcesRoot();
  if (root) {
    // 打包环境: Resources/node/embedding-worker.js (extraResources)
    const packaged = path.join(root, 'node', 'embedding-worker.js');
    if (fs.existsSync(packaged)) return packaged;
    // Dev 模式: {project}/desktop/extraResources/node/embedding-worker.js
    const dev = path.join(root, 'desktop', 'extraResources', 'node', 'embedding-worker.js');
    if (fs.existsSync(dev)) return dev;
  }
  return null;
}

function getDistNodeModulesPath(): string | null {
  const root = getResourcesRoot();
  if (root) {
    // 打包环境: Resources/dist-electron/node_modules (@xenova/transformers)
    const packaged = path.join(root, 'dist-electron', 'node_modules');
    if (fs.existsSync(packaged)) return packaged;
    // Dev 模式: {project}/node_modules (@xenova/transformers)
    const dev = path.join(root, 'node_modules');
    if (fs.existsSync(dev)) return dev;
  }
  return null;
}

export class EmbeddingProvider implements EmbeddingProviderInterface {
  private modelId: string;
  private cacheDir: string;
  private dimensions: number;
  private worker: ChildProcess | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private requestId = 0;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private workerNodePath: string | null = null;

  constructor(config: EmbeddingProviderConfig = {}) {
    this.modelId = config.modelId || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
    this.cacheDir = config.cacheDir || DEFAULT_CACHE_DIR;
    this.dimensions = config.dimensions || 384;
  }

  modelExists(): boolean {
    const modelDir = path.join(this.cacheDir, this.modelId);
    const configExists = fs.existsSync(path.join(modelDir, 'config.json'));
    const tokenizerExists = fs.existsSync(path.join(modelDir, 'tokenizer.json'));
    const onnxDir = path.join(modelDir, 'onnx');
    const onnxExists = fs.existsSync(path.join(onnxDir, 'model.onnx')) ||
      fs.existsSync(path.join(onnxDir, 'model_quantized.onnx'));
    return configExists && tokenizerExists && onnxExists;
  }

  private async initWorker(): Promise<void> {
    // 如果已有旧 worker，先清理事件监听器再杀掉
    // 防止旧 worker 的 exit 事件清空 pending map 导致新 worker 的 ready 丢失
    if (this.worker) {
      this.worker.stdout?.removeAllListeners();
      this.worker.stderr?.removeAllListeners();
      this.worker.removeAllListeners();
      this.worker.kill();
      this.worker = null;
      // 清空上一个 worker 遗留的 pending 请求
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
      // 不抛错——让 embed() 在非打包环境降级返回零向量
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
        // 输出到临时文件，便于调试
        WORKER_DEBUG_LOG: path.join(os.tmpdir(), 'embedding-worker-debug.log'),
      },
    });

    // 记录子进程 pid 到日志
    log.info(`[EmbeddingProvider] worker spawned: pid=${this.worker.pid}`);

    // 同时也把输出写入临时文件
    this.worker.stdout?.on('data', (data: Buffer) => {
      try {
        require('fs').appendFileSync(path.join(os.tmpdir(), 'embedding-worker-stdout.log'), data);
      } catch {}
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || ''; // 保留未完成的行
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const id = msg.id as string;
          this.resolvePending(id, msg.result, msg.error);
        } catch (e) {
          log.warn('[EmbeddingProvider] 子进程消息解析失败:', line);
        }
      }
    });

    this.worker.stderr?.on('data', (data: Buffer) => {
      // onnxruntime 和 transformers 的日志走 stderr
      const text = data.toString().trim();
      if (text) log.warn(`[worker] ${text}`);
    });

    this.worker.on('exit', (code, signal) => {
      log.warn(`[EmbeddingProvider] worker exited code=${code} signal=${signal}`);
      this.worker = null;
      this.initialized = false;
      // 拒绝所有 pending requests
      for (const [id, p] of this.pending) {
        p.reject(new Error(`worker exited (code=${code})`));
        this.pending.delete(id);
      }
    });

    this.worker.on('error', (err) => {
      log.error(`[EmbeddingProvider] worker error: ${err.message}`);
      this.worker = null;
    });

    // 等 ready 信号（pipeline 初始化可能需要 30s+）
    await this.waitFor('ready', 60000);

    // 发送 init
    const rtConfig = getRuntimeConfig();
    const source: DownloadSource = rtConfig?.download?.source || 'huggingface';
    let remoteHost: string;
    switch (source) {
      case 'hf-mirror':
        remoteHost = 'https://hf-mirror.com'; break;
      case 'modelscope':
        remoteHost = 'https://www.modelscope.cn/models'; break;
      case 'custom':
        remoteHost = rtConfig?.download?.hfMirror || 'https://huggingface.co'; break;
      case 'huggingface':
      default:
        remoteHost = 'https://huggingface.co'; break;
    }

    // 区分 wasm 和 native 模式
    const backend = distModules ? 'wasm' : 'native';
    // 注：worker 内部设 NODE_PATH 指向 dist-electron/node_modules 时用 native 也可以
    // 但我们让 worker 自动尝试 native（onnxruntime-node），失败会 fallback 到 WASM

    const initResult = await this.send('init', {
      modelId: this.modelId,
      cacheDir: this.cacheDir,
      remoteHost,
    }, 300000); // 5 min — 首次需下载模型

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
      const msg = JSON.stringify({ id, method, params }) + '\n';
      this.worker.stdin.write(msg);
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

  async embed(text: string): Promise<number[]> {
    if (!text || text.trim() === '') {
      return new Array(this.dimensions).fill(0);
    }

    // 触发初始化，如果正在初始化中则等待完成
    this.triggerInit();
    if (this.initPromise && !this.initialized) {
      try {
        await this.initPromise;
      } catch {
        // init 失败已在 triggerInit 中处理，这里继续检查 initialized
      }
    }

    // 初始化失败 → 降级返回零向量，让 L2 自然降级到 L3
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

  /** 非阻塞触发初始化：如果模型已缓存则快速完成，否则后台下载 */
  private triggerInit(): void {
    if (this.initialized) return;
    if (this.initPromise) return; // 正在初始化中
    this.initPromise = this.initWorker()
      .then(() => {
        this.initialized = true;
        log.info('[EmbeddingProvider] 后台初始化完成，向量模型就绪');
      })
      .catch((err) => {
        log.warn(`[EmbeddingProvider] 后台初始化失败: ${err instanceof Error ? err.message : String(err)}，将自动重试`);
        this.initPromise = null; // 允许下次 embed() 重试
      });
  }

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

  /** 退出子进程 */
  async shutdown(): Promise<void> {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }
    this.initialized = false;
  }
}
