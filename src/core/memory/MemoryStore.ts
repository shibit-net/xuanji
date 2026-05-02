/**
 * MemoryStore — 记忆持久化存储
 *
 * 基于文件的记忆存储，支持按类型和标签索引。
 */
import { logger } from '@/core/logger';
import * as fs from 'fs';
import * as path from 'path';
import type { Memory, MemoryStoreOptions } from './types';

const log = logger.child({ module: 'MemoryStore' });

export class MemoryStore {
  private basePath: string;
  private maxMemories: number;
  private cache: Memory[] | null = null;

  constructor(options: MemoryStoreOptions = {}) {
    this.basePath = options.basePath ?? path.join(process.cwd(), '.xuanji', 'memory');
    this.maxMemories = options.maxMemories ?? 1000;
  }

  private getFilePath(): string {
    return path.join(this.basePath, 'memories.json');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  loadAll(): Memory[] {
    if (this.cache) return this.cache;
    try {
      this.ensureDir();
      const fp = this.getFilePath();
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf-8');
        this.cache = JSON.parse(raw);
        return this.cache!;
      }
    } catch (err) {
      log.warn('Failed to load memories', err);
    }
    this.cache = [];
    return this.cache;
  }

  save(memory: Memory): void {
    const memories = this.loadAll();
    const idx = memories.findIndex(m => m.id === memory.id);
    if (idx >= 0) {
      memories[idx] = memory;
    } else {
      memories.push(memory);
      if (memories.length > this.maxMemories) {
        memories.shift();
      }
    }
    this.persist(memories);
  }

  delete(memoryId: string): boolean {
    const memories = this.loadAll();
    const idx = memories.findIndex(m => m.id === memoryId);
    if (idx >= 0) {
      memories.splice(idx, 1);
      this.persist(memories);
      return true;
    }
    return false;
  }

  findByType(type: Memory['type']): Memory[] {
    return this.loadAll().filter(m => m.type === type);
  }

  findByTag(tag: string): Memory[] {
    return this.loadAll().filter(m => m.tags?.includes(tag));
  }

  clear(): void {
    this.persist([]);
  }

  private persist(memories: Memory[]): void {
    try {
      this.ensureDir();
      fs.writeFileSync(this.getFilePath(), JSON.stringify(memories, null, 2));
      this.cache = memories;
    } catch (err) {
      log.error('Failed to persist memories', err);
    }
  }
}
