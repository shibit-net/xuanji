/**
 * SemanticIndex — 语义搜索索引
 *
 * 向 embeddings.data 写入 384 维浮点向量，通过 embeddings.idx 维护索引。
 * 每次 index() 后追加到磁盘，启动时从磁盘加载全量向量到内存。
 * 设计文档：docs/memory-system-part-5-semantic-search.md
 */

import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';
import type { EmbeddingProviderInterface } from '@/core/embedding/EmbeddingProvider';

const log = logger.child({ module: 'SemanticIndex' });

export interface EmbeddingEntry {
  sourceId: string;
  sourceTable: string;
  offset: number;
  length: number;
  textSummary: string;
  updatedAt: number;
}

export interface SearchResult {
  sourceId: string;
  sourceTable: string;
  textSummary: string;
  score: number;
}

export class SemanticIndex {
  private vectors: Float32Array | null = null;
  private entries: EmbeddingEntry[] = [];
  private dimensions = 384;
  private initialized = false;

  constructor(
    private provider: EmbeddingProviderInterface,
    private memoryDir: string,
  ) {}

  async init(): Promise<void> {
    const idxPath = join(this.memoryDir, 'embeddings.idx');
    const dataPath = join(this.memoryDir, 'embeddings.data');

    try {
      if (existsSync(idxPath) && existsSync(dataPath)) {
        const idxJson = await readFile(idxPath, 'utf-8');
        const idxData = JSON.parse(idxJson);
        this.entries = idxData.entries || [];
        this.dimensions = idxData.dimensions || 384;

        const buf = await readFile(dataPath);
        this.vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      } else {
        this.entries = [];
        this.vectors = null;
      }
    } catch (err) {
      log.warn('Failed to load existing index, starting fresh:', err);
      this.entries = [];
      this.vectors = null;
    }

    this.initialized = true;
    log.info(`SemanticIndex initialized with ${this.entries.length} entries`);
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.init();
  }

  async embed(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  /**
   * 索引一个文本条目，追加向量到磁盘文件
   */
  async index(sourceId: string, sourceTable: string, text: string): Promise<void> {
    await this.ensureInit();

    const vector = await this.provider.embed(text);
    if (vector.length === 0) return;

    // 移除旧条目（如果存在）
    await this.remove(sourceId);

    const now = Date.now();
    const entry: EmbeddingEntry = {
      sourceId,
      sourceTable,
      offset: this.entries.length * this.dimensions,
      length: this.dimensions,
      textSummary: text.slice(0, 200),
      updatedAt: now,
    };

    this.entries.push(entry);

    // 追加到内存 vector
    const newVector = new Float32Array(vector);
    if (this.vectors) {
      const combined = new Float32Array(this.vectors.length + this.dimensions);
      combined.set(this.vectors);
      combined.set(newVector, this.vectors.length);
      this.vectors = combined;
    } else {
      this.vectors = newVector;
    }

    await this.persist();
  }

  /**
   * 索引叙事记忆
   */
  async indexEpisode(episodeId: string, narrative: string): Promise<void> {
    await this.index(episodeId, 'episodes', narrative);
  }

  /**
   * 语义搜索
   */
  async search(query: string, limit: number = 10, scoreThreshold: number = 0.5): Promise<SearchResult[]> {
    await this.ensureInit();
    if (!this.vectors || this.entries.length === 0) return [];

    const queryVec = await this.provider.embed(query);
    if (queryVec.length === 0) return [];

    const results: Array<{ entry: EmbeddingEntry; score: number }> = [];

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const start = entry.offset;
      const end = start + entry.length;
      const vec = this.vectors.slice(start, end);
      const score = this.provider.cosineSimilarity(queryVec, Array.from(vec));
      if (score >= scoreThreshold) {
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => ({
      sourceId: r.entry.sourceId,
      sourceTable: r.entry.sourceTable,
      textSummary: r.entry.textSummary,
      score: r.score,
    }));
  }

  /**
   * 叙事记忆语义搜索
   */
  async searchEpisodes(query: string, limit: number = 10): Promise<SearchResult[]> {
    const results = await this.search(query, limit * 2);
    return results.filter(r => r.sourceTable === 'episodes').slice(0, limit);
  }

  /**
   * 删除一个索引条目
   */
  async remove(sourceId: string): Promise<void> {
    const idx = this.entries.findIndex(e => e.sourceId === sourceId);
    if (idx < 0) return;

    this.entries.splice(idx, 1);

    // 重建向量数组（简单方案：复制时跳过被删除的条目）
    if (this.entries.length === 0) {
      this.vectors = null;
    } else {
      const totalLen = this.entries.length * this.dimensions;
      const newVectors = new Float32Array(totalLen);
      let writeOffset = 0;
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        const oldStart = entry.offset;
        entry.offset = writeOffset;
        if (this.vectors) {
          const slice = this.vectors.slice(oldStart, oldStart + this.dimensions);
          newVectors.set(slice, writeOffset);
        }
        writeOffset += this.dimensions;
      }
      this.vectors = newVectors;
    }

    await this.persist();
  }

  get size(): number { return this.entries.length; }

  private async persist(): Promise<void> {
    const dir = this.memoryDir;
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const idxPath = join(dir, 'embeddings.idx');
    const dataPath = join(dir, 'embeddings.data');

    // 写入索引文件
    const idxData = {
      version: 1,
      dimensions: this.dimensions,
      entries: this.entries,
    };
    await writeFile(idxPath, JSON.stringify(idxData, null, 2), 'utf-8');

    // 写入向量文件
    if (this.vectors) {
      const buf = Buffer.from(this.vectors.buffer);
      await writeFile(dataPath, buf);
    }
  }
}
