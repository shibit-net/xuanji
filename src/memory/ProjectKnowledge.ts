// ============================================================
// M4 记忆系统 — 项目知识库封装
// ============================================================

import { randomUUID } from 'node:crypto';
import type { MemoryEntry } from './types';
import { LongTermMemory } from './LongTermMemory';

/**
 * 项目知识库 — 高层 API 封装
 *
 * 提供语义化的记录方法，内部构造 MemoryEntry 并委托给 LongTermMemory。
 */
export class ProjectKnowledge {
  private longTerm: LongTermMemory;
  private projectRoot: string;

  constructor(projectRoot: string, longTerm: LongTermMemory) {
    this.projectRoot = projectRoot;
    this.longTerm = longTerm;
  }

  /** 记录项目事实 */
  async recordFact(fact: string, keywords: string[], confidence = 0.8): Promise<void> {
    const entry = this.createEntry('project_fact', fact, keywords, confidence, 'project-knowledge');
    await this.longTerm.save(entry);
  }

  /** 记录关键决策 */
  async recordDecision(decision: string, reasoning: string, keywords: string[]): Promise<void> {
    const content = reasoning ? `${decision} — ${reasoning}` : decision;
    const entry = this.createEntry('decision', content, keywords, 0.9, 'project-knowledge');
    await this.longTerm.save(entry);
  }

  /** 记录错误解决方案 */
  async recordErrorResolution(error: string, resolution: string, keywords: string[]): Promise<void> {
    const content = `错误: ${error}\n解决: ${resolution}`;
    const entry = this.createEntry('error_resolution', content, keywords, 0.85, 'project-knowledge');
    await this.longTerm.save(entry);
  }

  /** 记录用户偏好 */
  async recordPreference(preference: string, keywords: string[]): Promise<void> {
    const entry = this.createEntry('user_preference', preference, keywords, 0.9, 'project-knowledge');
    await this.longTerm.save(entry);
  }

  // ────────── 私有方法 ──────────

  private createEntry(
    type: MemoryEntry['type'],
    content: string,
    keywords: string[],
    confidence: number,
    source: string,
  ): MemoryEntry {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      type,
      content: content.slice(0, 500),
      keywords,
      source,
      confidence,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      projectPath: this.projectRoot,
    };
  }
}
