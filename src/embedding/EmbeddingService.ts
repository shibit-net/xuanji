// ============================================================
// Embedding 服务 — 本地向量化（Transformers.js + ONNX Runtime）
// ============================================================

import { logger } from '@/core/logger';
import { createHash } from 'node:crypto';

const log = logger.child({ module: 'embedding-service' });

/** Embedding 模型配置 */
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const EMBEDDING_DIM = 384;
const CACHE_MAX_SIZE = 100;

/** HuggingFace 镜像（国内环境 huggingface.co 不通） */
const HF_MIRROR = 'https://hf-mirror.com';

/**
 * 本地 Embedding 服务（单例）
 *
 * 使用 @xenova/transformers (ONNX Runtime) 在本地 CPU 上运行
 * 多语言 Sentence Embedding 模型。
 *
 * - 模型: paraphrase-multilingual-MiniLM-L12-v2 (384 维)
 * - 首次运行自动下载到 ~/.cache/huggingface/
 * - 懒加载：首次 embed() 调用时才初始化
 * - 支持 HF_ENDPOINT 环境变量自定义镜像，默认使用 hf-mirror.com
 */
export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private pipeline: any = null;
  private ready = false;
  private initializing: Promise<void> | null = null;
  private cache = new Map<string, Float32Array>();

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /** 重置单例（仅用于测试） */
  static resetInstance(): void {
    EmbeddingService.instance = null;
  }

  /** 初始化模型 pipeline */
  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = this.doInit();
    await this.initializing;
  }

  private async doInit(): Promise<void> {
    try {
      log.info(`Loading embedding model: ${MODEL_ID} ...`);
      const transformers = await import('@xenova/transformers');

      // 设置 HuggingFace 镜像：优先环境变量，其次默认镜像
      const remoteHost = process.env.HF_ENDPOINT || HF_MIRROR;
      if (transformers.env) {
        (transformers.env as any).remoteHost = remoteHost;
      }
      log.debug(`HuggingFace remote host: ${remoteHost}`);

      this.pipeline = await transformers.pipeline('feature-extraction', MODEL_ID, {
        quantized: false, // FP32 保证精度
      });
      this.ready = true;
      log.info('Embedding model loaded successfully');
    } catch (err) {
      // 网络超时等常见原因简短提示，不打完整堆栈
      const msg = err instanceof Error ? err.message : String(err);
      const isNetwork = msg.includes('fetch failed') || msg.includes('TIMEOUT') || msg.includes('ENOTFOUND');
      if (isNetwork) {
        log.warn(`Embedding model unavailable (network): ${msg}`);
      } else {
        log.error(`Failed to load embedding model: ${msg}`);
      }
      this.initializing = null;
      throw err;
    }
  }

  /** 文本转向量 */
  async embed(text: string): Promise<Float32Array> {
    // 检查缓存（使用哈希值作为 key，避免长文本占用大量内存）
    const cacheKey = createHash('md5').update(text).digest('hex');
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    await this.ensureReady();

    const output = await this.pipeline!(text, {
      pooling: 'mean',
      normalize: true,
    });

    const embedding = new Float32Array(output.data);
    this.addToCache(cacheKey, embedding);
    return embedding;
  }

  /** 批量文本转向量 */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.ensureReady();

    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  /** 是否已就绪 */
  isReady(): boolean {
    return this.ready;
  }

  /** 获取 embedding 维度 */
  getDimension(): number {
    return EMBEDDING_DIM;
  }

  // ────────── 私有方法 ──────────

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      await this.init();
    }
  }

  private addToCache(key: string, value: Float32Array): void {
    if (this.cache.size >= CACHE_MAX_SIZE) {
      // 删除最早的条目
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

/** Embedding 维度常量（供外部使用） */
export const EMBEDDING_DIMENSION = EMBEDDING_DIM;
