/**
 * 向量意图匹配器
 *
 * 使用 Embedding 模型将用户输入和意图训练样本转换为向量，
 * 通过余弦相似度进行语义匹配
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from '@xenova/transformers';
import type {
  IntentDefinition,
  IntentVector,
  VectorCacheData,
  Intent,
  IntentMatchOptions,
} from './types.js';

/**
 * 向量意图匹配器
 */
export class VectorIntentMatcher {
  private embedModel: any = null;
  private intentVectors = new Map<string, IntentVector>();
  private vectorCachePath: string;
  private modelName = 'Xenova/all-MiniLM-L6-v2'; // 384 维，快速
  private initialized = false;

  constructor() {
    this.vectorCachePath = path.join(os.homedir(), '.xuanji/cache/intent-vectors.json');
  }

  /**
   * 初始化（加载模型和向量）
   */
  async init(intentDefinitions: IntentDefinition[]): Promise<void> {
    if (this.initialized) {
      console.log('⚠️  VectorIntentMatcher 已经初始化');
      return;
    }

    console.log('⏳ 初始化向量意图匹配器...');

    // 1. 检查是否有缓存的向量
    const cached = await this.loadCachedVectors();
    const needsRebuild = cached ? this.needsRebuild(intentDefinitions, cached) : true;

    if (cached && !needsRebuild) {
      // 使用缓存，快速启动
      this.intentVectors = this.deserializeVectors(cached.vectors);
      console.log(`✓ 从缓存加载 ${this.intentVectors.size} 个意图向量`);
      this.initialized = true;
      return;
    }

    // 2. 没有缓存或需要重建，加载模型
    console.log(needsRebuild ? '⏳ 检测到意图定义变更，重建向量库...' : '⏳ 首次启动，构建意图向量库...');

    this.embedModel = await pipeline('feature-extraction', this.modelName, {
      quantized: true,
    });

    console.log('✓ Embedding 模型加载完成');

    // 3. 为每个意图生成向量
    for (const intentDef of intentDefinitions) {
      await this.buildIntentVector(intentDef);
    }

    // 4. 保存到缓存
    await this.saveCachedVectors();

    console.log(`✓ 意图向量库构建完成（${this.intentVectors.size} 个意图）`);
    this.initialized = true;
  }

  /**
   * 为单个意图生成向量
   */
  async buildIntentVector(intentDef: IntentDefinition): Promise<void> {
    if (!this.embedModel) {
      throw new Error('Embedding 模型未初始化');
    }

    console.log(`  构建向量: ${intentDef.name} (${intentDef.examples.length} 个样本)`);

    // 1. 为每个样本生成向量
    const exampleVectors: number[][] = [];

    for (const example of intentDef.examples) {
      const vector = await this.encode(example);
      exampleVectors.push(vector);
    }

    // 2. 计算质心向量（平均）
    const centroidVector = this.computeCentroid(exampleVectors);

    // 3. 保存
    this.intentVectors.set(intentDef.type, {
      type: intentDef.type,
      domain: intentDef.domain,
      vector: centroidVector,
      exampleVectors: exampleVectors,
      lastUpdated: Date.now(),
    });
  }

  /**
   * 匹配用户输入
   */
  async match(userInput: string, options?: IntentMatchOptions): Promise<Intent[]> {
    if (!this.initialized) {
      throw new Error('VectorIntentMatcher 未初始化');
    }

    const threshold = options?.threshold || 0.7;
    const topK = options?.topK || 3;

    // 1. 用户输入转向量（延迟加载模型）
    if (!this.embedModel) {
      this.embedModel = await pipeline('feature-extraction', this.modelName, {
        quantized: true,
      });
    }

    const userVector = await this.encode(userInput);

    // 2. 计算与所有意图的相似度
    const similarities: Array<{
      type: string;
      domain: string;
      similarity: number;
    }> = [];

    for (const [intentType, intentVector] of this.intentVectors) {
      const similarity = this.cosineSimilarity(userVector, intentVector.vector);

      similarities.push({
        type: intentType,
        domain: intentVector.domain,
        similarity: similarity,
      });
    }

    // 3. 过滤和排序
    const matched = similarities
      .filter((s) => s.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    // 4. 转换为 Intent 对象
    return matched.map((m, index) => ({
      id: `intent-vector-${index}`,
      type: m.type,
      domain: m.domain as any,
      confidence: m.similarity,
      text: userInput,
      source: 'vector' as const,
    }));
  }

  /**
   * 编码文本为向量
   */
  private async encode(text: string): Promise<number[]> {
    const output = await this.embedModel(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data);
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('向量维度不匹配');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * 计算向量质心
   */
  private computeCentroid(vectors: number[][]): number[] {
    if (vectors.length === 0) return [];

    const dim = vectors[0].length;
    const centroid = new Array(dim).fill(0);

    for (const vector of vectors) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += vector[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] /= vectors.length;
    }

    return centroid;
  }

  /**
   * 加载缓存的向量
   */
  private async loadCachedVectors(): Promise<VectorCacheData | null> {
    try {
      const content = await fs.readFile(this.vectorCachePath, 'utf-8');
      const data: VectorCacheData = JSON.parse(content);

      return data;
    } catch {
      return null;
    }
  }

  /**
   * 保存向量到缓存
   */
  private async saveCachedVectors(): Promise<void> {
    const data: VectorCacheData = {
      version: '1.0.0',
      generatedAt: Date.now(),
      vectors: Object.fromEntries(this.intentVectors),
    };

    await fs.mkdir(path.dirname(this.vectorCachePath), { recursive: true });
    await fs.writeFile(this.vectorCachePath, JSON.stringify(data, null, 2));
  }

  /**
   * 检查是否需要重建
   */
  private needsRebuild(intentDefinitions: IntentDefinition[], cached: VectorCacheData): boolean {
    // 检查意图类型是否一致
    const currentTypes = new Set(intentDefinitions.map((d) => d.type));
    const cachedTypes = new Set(Object.keys(cached.vectors));

    if (currentTypes.size !== cachedTypes.size) {
      return true;
    }

    for (const type of currentTypes) {
      if (!cachedTypes.has(type)) {
        return true;
      }
    }

    // 检查训练样本是否变更
    for (const intentDef of intentDefinitions) {
      const cachedVector = cached.vectors[intentDef.type];
      if (!cachedVector) continue;

      // 简单检查：样本数量是否一致
      if (cachedVector.exampleVectors.length !== intentDef.examples.length) {
        return true;
      }
    }

    return false;
  }

  /**
   * 反序列化向量数据
   */
  private deserializeVectors(
    vectors: Record<string, IntentVector>
  ): Map<string, IntentVector> {
    const map = new Map<string, IntentVector>();

    for (const [key, value] of Object.entries(vectors)) {
      map.set(key, value);
    }

    return map;
  }

  /**
   * 获取所有意图类型
   */
  getIntentTypes(): string[] {
    return Array.from(this.intentVectors.keys());
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 清空向量库
   */
  clear(): void {
    this.intentVectors.clear();
    this.initialized = false;
  }
}
