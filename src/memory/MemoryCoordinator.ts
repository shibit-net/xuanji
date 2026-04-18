// ============================================================
// MemoryCoordinator - 记忆协调器（重构后）
// ============================================================
// 轻量级协调器，只负责组合各个服务
//
// 职责:
// 1. 组合存储、检索、提取、维护服务
// 2. 实现 IMemoryStore 接口（向后兼容）
// 3. 委托调用到各个服务
//
// 不负责:
// - 具体的业务逻辑（由各个服务负责）
// - 复杂的初始化（由 MemoryFactory 负责）
// ============================================================

import type { IMemoryStore, MemoryEntry, SessionMemory, RetrieveOptions, MemoryConfig } from '@/memory/types';
import type { IMemoryStorage, IMemoryRetrieval, IMemoryExtraction, IMemoryMaintenance } from './interfaces';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryCoordinator' });

/**
 * MemoryCoordinator - 记忆协调器
 */
export class MemoryCoordinator implements IMemoryStore {
  constructor(
    private storage: IMemoryStorage,
    private retrieval: IMemoryRetrieval,
    private extraction: IMemoryExtraction,
    private maintenance: IMemoryMaintenance
  ) {}

  // ============================================================
  // IMemoryStore 接口实现（委托给各个服务）
  // ============================================================

  async init(): Promise<void> {
    log.debug('Initializing memory coordinator');
    await (this.storage as any).init?.();
  }

  async save(entry: MemoryEntry): Promise<void> {
    return await this.storage.save(entry);
  }

  async retrieve(options: RetrieveOptions): Promise<MemoryEntry[]> {
    return await this.retrieval.retrieve({
      keywords: options.keywords,
      embedding: options.embedding,
      types: options.types,
      limit: options.limit
    });
  }

  async query(filter: any): Promise<MemoryEntry[]> {
    return await this.storage.query(filter);
  }

  async delete(id: string): Promise<void> {
    return await this.storage.delete(id);
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    return await this.storage.update(id, updates);
  }

  async close(): Promise<void> {
    await this.storage.close();
    this.maintenance.stopMaintenance();
  }

  // ============================================================
  // 提取相关方法
  // ============================================================

  async extractFromConversation(messages: any[]): Promise<MemoryEntry[]> {
    return await this.extraction.extractFromConversation(messages);
  }

  async extractFromDecision(decision: any): Promise<MemoryEntry[]> {
    return await this.extraction.extractFromDecision(decision);
  }

  // ============================================================
  // 维护相关方法
  // ============================================================

  async compact(): Promise<void> {
    await this.maintenance.compact();
  }

  async archive(before: Date): Promise<void> {
    await this.maintenance.archive(before);
  }

  scheduleMaintenance(config: any): void {
    this.maintenance.scheduleMaintenance(config);
  }

  // ============================================================
  // 访问器（用于高级用法）
  // ============================================================

  getStorage(): IMemoryStorage {
    return this.storage;
  }

  getRetrieval(): IMemoryRetrieval {
    return this.retrieval;
  }

  getExtraction(): IMemoryExtraction {
    return this.extraction;
  }

  getMaintenance(): IMemoryMaintenance {
    return this.maintenance;
  }
}
