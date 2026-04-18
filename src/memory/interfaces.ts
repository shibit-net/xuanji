// ============================================================
// Memory 接口定义
// ============================================================

import type { MemoryEntry, MemoryFilter, Transaction } from '@/memory/types';

/**
 * 存储层接口
 */
export interface IMemoryStorage {
  save(entry: MemoryEntry): Promise<void>;
  saveBatch(entries: MemoryEntry[]): Promise<void>;
  query(filter: MemoryFilter): Promise<MemoryEntry[]>;
  delete(id: string): Promise<void>;
  update(id: string, updates: Partial<MemoryEntry>): Promise<void>;
  transaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

/**
 * 检索层接口
 */
export interface IMemoryRetrieval {
  retrieve(context: RetrievalContext): Promise<MemoryEntry[]>;
  buildDecisionContext(context: DecisionContext): Promise<string>;
  searchByKeywords(keywords: string[], limit: number): Promise<MemoryEntry[]>;
  searchByVector(embedding: number[], topK: number): Promise<MemoryEntry[]>;
}

/**
 * 提取层接口
 */
export interface IMemoryExtraction {
  extractFromConversation(messages: Message[]): Promise<MemoryEntry[]>;
  extractFromDecision(decision: DecisionContext): Promise<MemoryEntry[]>;
  extractFromFeedback(feedback: string): Promise<MemoryEntry[]>;
}

/**
 * 维护层接口
 */
export interface IMemoryMaintenance {
  compact(): Promise<CompactionResult>;
  archive(before: Date): Promise<ArchiveResult>;
  vacuum(): Promise<void>;
  scheduleMaintenance(config: MaintenanceConfig): void;
  stopMaintenance(): void;
}

/**
 * 检索上下文
 */
export interface RetrievalContext {
  keywords?: string[];
  embedding?: number[];
  timeRange?: { start: Date; end: Date };
  types?: string[];
  limit?: number;
}

/**
 * 决策上下文
 */
export interface DecisionContext {
  operation: string;
  context: Record<string, any>;
}

/**
 * 消息
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/**
 * 压缩结果
 */
export interface CompactionResult {
  before: number;
  after: number;
  removed: number;
}

/**
 * 归档结果
 */
export interface ArchiveResult {
  archived: number;
  path: string;
}

/**
 * 维护配置
 */
export interface MaintenanceConfig {
  compactInterval?: number;
  archiveInterval?: number;
  vacuumInterval?: number;
}
