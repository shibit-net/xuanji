/**
 * EmbeddingProvider — 基于 @xenova/transformers 的语义向量提供者
 *
 * 使用本地 ONNX 模型进行文本向量化，无需外部 API 调用。
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'EmbeddingProvider' });

export interface EmbeddingProviderInterface {
  embed(text: string): Promise<number[]>;
  cosineSimilarity(a: number[], b: number[]): number;
}

export interface EmbeddingProviderConfig {
  modelId?: string;
  cacheDir?: string;
  dimensions?: number;
}

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.xuanji', 'embedding-models');

export class EmbeddingProvider implements EmbeddingProviderInterface {
  private modelId: string;
  private cacheDir: string;
  private dimensions: number;
  private pipeline: any = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;

  constructor(config: EmbeddingProviderConfig = {}) {
    this.modelId = config.modelId || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
    this.cacheDir = config.cacheDir || DEFAULT_CACHE_DIR;
    this.dimensions = config.dimensions || 384;
  }

  /** 检查模型文件是否存在 */
  modelExists(): boolean {
    const modelDir = path.join(this.cacheDir, this.modelId);
    const configExists = fs.existsSync(path.join(modelDir, 'config.json'));
    const tokenizerExists = fs.existsSync(path.join(modelDir, 'tokenizer.json'));
    const onnxDir = path.join(modelDir, 'onnx');
    const onnxExists = fs.existsSync(path.join(onnxDir, 'model.onnx')) ||
      fs.existsSync(path.join(onnxDir, 'model_quantized.onnx'));
    return configExists && tokenizerExists && onnxExists;
  }

  /** 确保 pipeline 已初始化 */
  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initPipeline();
    await this.initPromise;
    this.initialized = true;
  }

  private async initPipeline(): Promise<void> {
    const { pipeline, env } = await import('@xenova/transformers');

    env.cacheDir = this.cacheDir;
    env.allowLocalModels = true;
    // 优先使用本地已下载的模型，缺失时才从 HF 下载
    env.allowRemoteModels = true;

    log.info(`[EmbeddingProvider] 初始化 pipeline, modelId=${this.modelId}, cacheDir=${this.cacheDir}`);

    try {
      this.pipeline = await pipeline('feature-extraction', this.modelId, {
        quantized: true,
      });
      log.info('[EmbeddingProvider] pipeline 初始化完成');
    } catch (err: any) {
      log.error(`[EmbeddingProvider] pipeline 初始化失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 文本 → 向量
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim() === '') {
      return new Array(this.dimensions).fill(0);
    }

    await this.ensureInit();

    const result = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    // result.data 是 Float32Array
    return Array.from(result.data);
  }

  /**
   * 余弦相似度
   */
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
}
