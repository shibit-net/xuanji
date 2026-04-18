// ============================================================
// PermanentConstraintManager — 永久约束管理器
// ============================================================
// 统一管理所有"必须遵守的永久约束"，包括：
// - 核心规则（行为约束、隐私规则等）
// - 身份记忆（用户称呼、助手名字等）
// - 其他永久性约束
//
// 所有约束存储在 memory.db，标记为：
// - constraint: 'must'
// - volatility: 'permanent'
// ============================================================

import type { MemoryStore } from './MemoryStore';
import type { MemoryEntry } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'PermanentConstraintManager' });

/**
 * 约束类型
 */
export type ConstraintType =
  | 'behavior'      // 行为约束（如"不要泄露隐私"）
  | 'privacy'       // 隐私规则
  | 'communication' // 沟通方式
  | 'ethics'        // 伦理规范
  | 'task'          // 任务规则
  | 'identity'      // 身份信息（用户称呼、助手名字）
  | 'custom';       // 自定义

/**
 * 约束条目
 */
export interface Constraint {
  id: string;
  type: ConstraintType;
  content: string;
  description?: string;
  createdAt: string;
  active: boolean;
  source: 'user_explicit' | 'inferred' | 'llm_extracted';
}

/**
 * 身份信息（从 identity 类型的约束中解析）
 */
export interface Identity {
  assistantName?: string;
  userTitle?: string;
  persona?: string;
  tone?: string;
}

/**
 * 永久约束管理器
 *
 * 统一管理所有必须遵守的永久约束
 */
export class PermanentConstraintManager {
  private store: MemoryStore;
  private cachedConstraints: Constraint[] | null = null;
  private cachedIdentity: Identity | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL = 60000; // 1分钟缓存

  constructor(store: MemoryStore) {
    this.store = store;
  }

  // ────────── 通用约束管理 ──────────

  /**
   * 添加约束
   */
  add(params: {
    content: string;
    type?: ConstraintType;
    description?: string;
    source?: 'user_explicit' | 'inferred' | 'llm_extracted';
  }): Constraint {
    const now = new Date().toISOString();
    const id = `constraint_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const memory: MemoryEntry = {
      id,
      type: 'user_preference',  // 使用 user_preference 而不是 core_rule
      content: params.content,
      keywords: this.extractKeywords(params.content),
      source: params.source || 'user_explicit',
      confidence: 1.0,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      scope: 'core_rule',
      volatility: 'permanent',
      significance: 1.0,
      constraint: 'must',
      categoryLabel: params.type || 'custom',  // 使用 categoryLabel 而不是 category
      memoryOriginV2: 'user',  // 使用 'user' 而不是 source
      usageScenarios: ['always'],
      usageCount: 0,
      effectiveCount: 0,
      dreamGeneration: 0,
      evidenceCount: 1,
      dreamCount: 0,
      obsolete: false,
      dismissed: false,
      relatedMemories: [],
      metadata: {},
    };

    this.store.saveEntry(memory);
    this.clearCache();

    log.info(`Constraint added: [${params.type || 'custom'}] ${params.content.slice(0, 60)}`);

    return {
      id,
      type: params.type || 'custom',
      content: params.content,
      description: params.description,
      createdAt: now,
      active: true,
      source: params.source || 'user_explicit',
    };
  }

  /**
   * 获取所有激活的约束
   */
  getActiveConstraints(): Constraint[] {
    if (this.cachedConstraints && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedConstraints;
    }

    const entries = this.store.readAll({ limit: 10000 });
    const constraints = entries
      .filter(e =>
        e.constraint === 'must' &&
        e.volatility === 'permanent' &&
        !e.obsolete
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(e => this.entryToConstraint(e));

    this.cachedConstraints = constraints;
    this.cacheTimestamp = Date.now();

    return constraints;
  }

  /**
   * 更新约束
   */
  update(id: string, updates: { content?: string; active?: boolean; description?: string }): boolean {
    const entry = this.store.getEntry(id);
    if (!entry) return false;

    const updateData: Partial<MemoryEntry> = {};
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.active !== undefined) updateData.obsolete = !updates.active;
    // description 存储在 content 中，不使用 metadata

    this.store.updateEntry(id, updateData);
    this.clearCache();

    log.info(`Constraint updated: ${id}`);
    return true;
  }

  /**
   * 删除约束
   */
  delete(id: string): boolean {
    const entry = this.store.getEntry(id);
    if (!entry) return false;

    this.store.deleteEntry(id);
    this.clearCache();

    log.info(`Constraint deleted: ${id}`);
    return true;
  }

  /**
   * 停用/启用约束
   */
  setActive(id: string, active: boolean): boolean {
    return this.update(id, { active });
  }

  // ────────── 身份记忆便捷方法 ──────────

  /**
   * 设置用户称呼
   */
  async setUserTitle(title: string): Promise<void> {
    log.info('设置用户称呼', { title });

    // 标记旧的用户称呼为过时
    const allEntries = this.store.readAll({ limit: 10000 });
    const oldTitles = allEntries.filter(e =>
      e.categoryLabel === 'identity' &&
      e.content.includes('被称呼为') &&
      !e.obsolete
    );

    for (const old of oldTitles) {
      this.store.updateEntry(old.id, { obsolete: true });
    }

    // 添加新的用户称呼
    this.add({
      content: `用户希望被称呼为"${title}"`,
      type: 'identity',
      description: '用户的称呼',
      source: 'user_explicit',
    });

    log.info('用户称呼已更新');
  }

  /**
   * 设置助手名字
   */
  async setAssistantName(name: string): Promise<void> {
    log.info('设置助手名字', { name });

    // 标记旧的助手名字为过时
    const allEntries = this.store.readAll({ limit: 10000 });
    const oldNames = allEntries.filter(e =>
      e.categoryLabel === 'identity' &&
      e.content.includes('称呼助手为') &&
      !e.obsolete
    );

    for (const old of oldNames) {
      this.store.updateEntry(old.id, { obsolete: true });
    }

    // 添加新的助手名字
    this.add({
      content: `用户希望称呼助手为"${name}"`,
      type: 'identity',
      description: '助手的昵称',
      source: 'user_explicit',
    });

    log.info('助手名字已更新');
  }

  /**
   * 获取身份信息
   */
  async getIdentity(): Promise<Identity> {
    if (this.cachedIdentity && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedIdentity;
    }

    const constraints = this.getActiveConstraints();
    const identityConstraints = constraints.filter(c => c.type === 'identity');

    const identity: Identity = {};

    for (const constraint of identityConstraints) {
      // 解析助手名字
      const nameMatch = constraint.content.match(/称呼助手为\s*["']([^"']+?)["']/);
      if (nameMatch) {
        identity.assistantName = nameMatch[1];
      }

      // 解析用户称呼
      const titleMatch = constraint.content.match(/被称呼为\s*["']([^"']+?)["']/);
      if (titleMatch) {
        identity.userTitle = titleMatch[1];
      }
    }

    this.cachedIdentity = identity;
    return identity;
  }

  /**
   * 格式化身份信息为 System Prompt
   */
  formatIdentityForPrompt(identity: Identity): string {
    const lines: string[] = [];

    if (identity.assistantName) {
      lines.push(`- Your name is "${identity.assistantName}"`);
    }

    if (identity.userTitle) {
      lines.push(`- Address the user as "${identity.userTitle}"`);
    }

    if (identity.persona) {
      lines.push(`- Persona: ${identity.persona}`);
    }

    if (identity.tone) {
      lines.push(`- Tone: ${identity.tone}`);
    }

    return lines.length > 0 ? `### Identity\n\n${lines.join('\n')}` : '';
  }

  // ────────── 格式化（注入 Prompt） ──────────

  /**
   * 格式化所有约束为 Prompt 文本
   */
  formatForPrompt(): string {
    const constraints = this.getActiveConstraints();
    if (constraints.length === 0) return '';

    const lines = constraints.map((c, i) => `${i + 1}. ${c.content}`);
    return `### 🚫 核心规则（必须严格遵守，不可违反）\n\n${lines.join('\n')}`;
  }

  // ────────── 辅助方法 ──────────

  private entryToConstraint(entry: MemoryEntry): Constraint {
    return {
      id: entry.id,
      type: (entry.categoryLabel as ConstraintType) || 'custom',
      content: entry.content,
      description: undefined,  // description 不存储在 metadata 中
      createdAt: entry.createdAt,
      active: !entry.obsolete,
      source: entry.source === 'user' ? 'user_explicit' : 'inferred',
    };
  }

  private extractKeywords(content: string): string[] {
    // 简单的关键词提取
    const words = content.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || [];
    return [...new Set(words)].slice(0, 10);
  }

  private clearCache(): void {
    this.cachedConstraints = null;
    this.cachedIdentity = null;
    this.cacheTimestamp = 0;
  }
}
