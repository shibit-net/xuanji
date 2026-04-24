// ============================================================
// Embedding 服务 — 本地向量化（Transformers.js + ONNX Runtime）
// ============================================================

import { logger } from '@/core/logger';
import { createHash } from 'node:crypto';
import type { EmbeddingConfig } from '@/shared/types/config';

const log = logger.child({ module: 'embedding-service' });

/** 默认 Embedding 配置 */
const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  dimensions: 384,
  cacheEnabled: true,
  cacheMaxSize: 100,
  hfMirror: 'https://hf-mirror.com',
};

/**
 * 本地 Embedding 服务（单例）
 *
 * 使用 @xenova/transformers (ONNX Runtime) 在本地 CPU 上运行
 * 多语言 Sentence Embedding 模型。
 *
 * - 模型: 可配置（默认 paraphrase-multilingual-MiniLM-L12-v2, 384 维）
 * - 首次运行自动下载到 ~/.cache/huggingface/
 * - 懒加载：首次 embed() 调用时才初始化
 * - 支持配置文件和环境变量
 */
export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private pipeline: any = null;
  private ready = false;
  private initializing: Promise<void> | null = null;
  private cache = new Map<string, Float32Array>();
  private config: EmbeddingConfig;
  private currentModel: string | null = null;

  private constructor(config?: Partial<EmbeddingConfig>) {
    this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  }

  static getInstance(config?: Partial<EmbeddingConfig>): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService(config);
    }
    return EmbeddingService.instance;
  }

  /** 重置单例（仅用于测试） */
  static reset(): void {
    EmbeddingService.instance = null;
  }

  static resetInstance(): void {
    EmbeddingService.reset();
  }

  /** 初始化模型 pipeline */
  async init(): Promise<void> {
    if (this.ready && this.currentModel === this.config.model) return;
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = this.doInit();
    await this.initializing;
  }

  private async doInit(): Promise<void> {
    try {
      log.info(`Loading embedding model: ${this.config.model} ...`);
      // @ts-ignore - Optional dependency
      const transformers = await import('@xenova/transformers');

      // 设置 HuggingFace 镜像：优先环境变量，其次配置，最后默认镜像
      const remoteHost = process.env.HF_ENDPOINT || this.config.hfMirror;
      if (transformers.env && remoteHost) {
        (transformers.env as any).remoteHost = remoteHost;
      }
      log.debug(`HuggingFace remote host: ${remoteHost}`);

      this.pipeline = await transformers.pipeline('feature-extraction', this.config.model, {
        quantized: false, // FP32 保证精度
      });
      this.ready = true;
      this.currentModel = this.config.model;
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
    if (!this.config.cacheEnabled) {
      await this.ensureReady();
      const output = await this.pipeline!(text, {
        pooling: 'mean',
        normalize: true,
      });
      return new Float32Array(output.data);
    }

    // 检查缓存（使用模型+哈希值作为 key）
    const cacheKey = `${this.config.model}:${createHash('md5').update(text).digest('hex')}`;
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
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureReady();

    const results: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embed(text);
      results.push(Array.from(embedding));
    }
    return results;
  }

  /** 是否已就绪 */
  isReady(): boolean {
    return this.ready;
  }

  /** 获取 embedding 维度 */
  getDimension(): number {
    return this.config.dimensions;
  }

  getDimensions(): number {
    return this.getDimension();
  }

  /** 获取当前模型 ID */
  getModelId(): string {
    return this.config.model;
  }

  /**
   * 运行时更新配置（用于测试或动态切换）
   */
  updateConfig(config: Partial<EmbeddingConfig>): void {
    this.config = { ...this.config, ...config };
    // 如果模型变了，重置状态
    if (config.model && config.model !== this.currentModel) {
      this.pipeline = null;
      this.ready = false;
      this.initializing = null;
      this.currentModel = null;
    }
    // 清空缓存
    this.cache.clear();
  }

  // ────────── 私有方法 ──────────

  private async ensureReady(): Promise<void> {
    if (!this.ready || this.currentModel !== this.config.model) {
      await this.init();
    }
  }

  private addToCache(key: string, value: Float32Array): void {
    if (this.cache.size >= this.config.cacheMaxSize) {
      // 删除最早的条目
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

/** Embedding 维度常量（供外部使用，已废弃，请使用 embeddingService.getDimension()） */
export const EMBEDDING_DIMENSION = DEFAULT_EMBEDDING_CONFIG.dimensions;
