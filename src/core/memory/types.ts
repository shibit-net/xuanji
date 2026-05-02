/**
 * Memory 模块类型定义
 */

export interface Memory {
  id: string;
  type: 'user_preference' | 'project_convention' | 'knowledge_snippet' | 'feedback';
  content: string;
  embedding?: number[];
  tags?: string[];
  source?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryQuery {
  text?: string;
  types?: Memory['type'][];
  tags?: string[];
  limit?: number;
  threshold?: number;
  since?: number;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
}

export interface MemoryStoreOptions {
  basePath?: string;
  maxMemories?: number;
}
