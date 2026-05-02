/**
 * MemoryManager — 记忆管理器（⚠️ 占位 - 未实现）
 *
 * 职责：管理跨会话的持久记忆——用户偏好、项目约定、知识片段。
 * 依赖向量模型（作为特殊 Agent 配置管理，type: "embedding"）。
 */

import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryManager' });

export interface Memory {
  id: string;
  type: 'user_preference' | 'project_convention' | 'knowledge_snippet' | 'feedback';
  content: string;
  embedding?: number[];
  createdAt: number;
}

export interface RetrieveOptions {
  limit?: number;
  threshold?: number;
  types?: Memory['type'][];
}

export class MemoryManager {
  private memories: Memory[] = [];

  async save(memory: Memory): Promise<void> {
    log.warn('MemoryManager not yet implemented — memory saved in-memory only');
    this.memories.push(memory);
  }

  async retrieve(query: string, _options?: RetrieveOptions): Promise<Memory[]> {
    log.warn('MemoryManager not yet implemented — returning empty results');
    return [];
  }

  async extractFromConversation(_messages: any[]): Promise<Memory[]> {
    log.warn('MemoryManager not yet implemented');
    return [];
  }

  async delete(memoryId: string): Promise<void> {
    this.memories = this.memories.filter(m => m.id !== memoryId);
  }

  getAll(): Memory[] {
    return [...this.memories];
  }

  clear(): void {
    this.memories = [];
  }
}
