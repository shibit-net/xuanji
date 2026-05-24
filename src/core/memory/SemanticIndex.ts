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
  private lastPersistedCount = 0;
  private dirtySinceCompact = 0;

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
        this.lastPersistedCount = this.entries.length;
      } else {
        this.entries = [];
        this.vectors = null;
        this.lastPersistedCount = 0;
      }
    } catch (err) {
      log.warn('Failed to load existing index, starting fresh:', err);
      this.entries = [];
      this.vectors = null;
      this.lastPersistedCount = 0;
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
   * 索引一个文本条目。已有条目就地更新，新条目追加入向量文件（减少写入放大）。
   */
  async index(sourceId: string, sourceTable: string, text: string): Promise<void> {
    await this.ensureInit();

    const vector = await this.provider.embed(text);
    if (vector.length === 0) return;

    const now = Date.now();
    const existingIdx = this.entries.findIndex(e => e.sourceId === sourceId);

    if (existingIdx >= 0) {
      // 已有条目：就地更新（不触发 remove 的全量复制）
      const entry = this.entries[existingIdx];
      entry.textSummary = text.slice(0, 200);
      entry.updatedAt = now;
      // 直接更新向量
      const newVec = new Float32Array(vector);
      if (this.vectors) {
        this.vectors.set(newVec, entry.offset);
      }
      this.dirtySinceCompact++;
    } else {
      // 新条目：追加
      const newVector = new Float32Array(vector);
      const entry: EmbeddingEntry = {
        sourceId,
        sourceTable,
        offset: this.entries.length * this.dimensions,
        length: this.dimensions,
        textSummary: text.slice(0, 200),
        updatedAt: now,
      };
      this.entries.push(entry);

      if (this.vectors) {
        const combined = new Float32Array(this.vectors.length + this.dimensions);
        combined.set(this.vectors);
        combined.set(newVector, this.vectors.length);
        this.vectors = combined;
      } else {
        this.vectors = newVector;
      }
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

    const queryEmbedding = await this.provider.embed(query);
    if (queryEmbedding.length === 0) return [];

    // 查询向量存为 Float32Array，避免循环内重复转换
    const queryVec = new Float32Array(queryEmbedding);
    const dims = this.dimensions;
    const results: Array<{ entry: EmbeddingEntry; score: number }> = [];
    const threshold = scoreThreshold;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      // 直接对 Float32Array 偏移量计算点积，零分配
      const score = this.provider.dotProduct(this.vectors!, entry.offset, queryVec, dims);
      if (score >= threshold) {
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

    // 索引文件始终完整重写（小文件，~数 KB）
    const idxData = {
      version: 1,
      dimensions: this.dimensions,
      entries: this.entries,
    };
    await writeFile(idxPath, JSON.stringify(idxData), 'utf-8');

    // 向量文件：仅追加新增条目，避免全量重写
    if (this.vectors) {
      const dataExists = existsSync(dataPath);
      if (dataExists && this.lastPersistedCount > 0 && this.lastPersistedCount < this.entries.length) {
        // 追加模式：仅写入新向量
        const newStart = this.lastPersistedCount * this.dimensions;
        const newVecs = this.vectors.slice(newStart);
        const { appendFile } = await import('node:fs/promises');
        await appendFile(dataPath, Buffer.from(newVecs.buffer));
      } else {
        // 全量写入（首次、无历史数据、或需要 compact）
        await writeFile(dataPath, Buffer.from(this.vectors.buffer));
      }
    }

    this.lastPersistedCount = this.entries.length;
  }

  /**
   * Compact: 整理向量文件，移除已删除条目的碎片空间。
   * 当 dirtySinceCompact 超过阈值（50次更新）时自动触发。
   */
  async compact(): Promise<void> {
    if (this.dirtySinceCompact < 50) return;

    const dir = this.memoryDir;
    const dataPath = join(dir, 'embeddings.data');

    // 重建连续向量数组（跳过空位）
    if (!this.vectors || this.entries.length === 0) {
      if (existsSync(dataPath)) {
        const { unlink } = await import('node:fs/promises');
        await unlink(dataPath).catch(() => {});
      }
      this.vectors = null;
      this.lastPersistedCount = 0;
      this.dirtySinceCompact = 0;
      return;
    }

    const compactedLen = this.entries.length * this.dimensions;
    const compacted = new Float32Array(compactedLen);
    for (let i = 0; i < this.entries.length; i++) {
      const src = this.entries[i].offset;
      compacted.set(this.vectors.slice(src, src + this.dimensions), i * this.dimensions);
      this.entries[i].offset = i * this.dimensions;
    }
    this.vectors = compacted;
    this.lastPersistedCount = 0; // 强制下次全量写入
    this.dirtySinceCompact = 0;

    await writeFile(dataPath, Buffer.from(compacted.buffer));
    log.info(`SemanticIndex compacted: ${this.entries.length} entries`);
  }
}
