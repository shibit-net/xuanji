/**
 * EmbeddingProvider — 基于 @xenova/transformers 的语义向量提供者
 *
 * 使用本地 ONNX 模型进行文本向量化，无需外部 API 调用。
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { logger } from '@/core/logger';
import { getRuntimeConfig } from '@/core/config/RuntimeConfig.js';
import type { DownloadSource } from '@/shared/types/config';

const log = logger.child({ module: 'EmbeddingProvider' });

export interface EmbeddingProviderInterface {
  embed(text: string): Promise<number[]>;
  cosineSimilarity(a: number[], b: number[]): number;
  /**
   * 向量点积（假定向量已归一化，等价于余弦相似度）。
   * 直接对 Float32Array 偏移量计算，零内存分配，用于热路径。
   */
  dotProduct(vectors: Float32Array, offset: number, query: Float32Array, dimensions: number): number;
}

export interface EmbeddingProviderConfig {
  modelId?: string;
  cacheDir?: string;
  dimensions?: number;
  hfMirror?: string;
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
    // 使用 createRequire 解析模块路径：ESM import 在 Electron 打包后
    // 无法穿透 app.asar 找到 @xenova/transformers，CJS 路径解析支持
    // NODE_PATH（指向 app.asar.unpacked + dist-electron/node_modules）
    const { createRequire } = await import('module');
    const _require = createRequire(import.meta.url);
    const resolvedPath = _require.resolve('@xenova/transformers');
    const { pipeline, env } = await import(resolvedPath);

    env.cacheDir = this.cacheDir;
    env.allowLocalModels = true;
    // 优先使用本地已下载的模型，缺失时才从 HF 下载
    env.allowRemoteModels = true;
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
    env.remoteHost = remoteHost;

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

  /**
   * 向量点积——直接对 Float32Array 偏移量计算，零分配。
   * 假定向量已归一化（pipeline normalize: true），点积 = 余弦相似度。
   */
  dotProduct(vectors: Float32Array, offset: number, query: Float32Array, dimensions: number): number {
    let dot = 0;
    for (let i = 0; i < dimensions; i++) {
      dot += vectors[offset + i] * query[i];
    }
    return dot;
  }
}
