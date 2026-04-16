// ============================================================
// CoreRuleStore — 核心规则专属存储
// ============================================================
// 用户定义的不可违反底线，永久存储，不参与衰减，始终注入 Prompt
// 存储在 ~/.xuanji/core-rules.json（独立于 memory.db）
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { CoreRule } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'CoreRuleStore' });

const DEFAULT_RULES_PATH = join(homedir(), '.xuanji', 'core-rules.json');

export class CoreRuleStore {
  private rules: Map<string, CoreRule> = new Map();
  private filePath: string;
  private dirty = false;

  constructor(filePath = DEFAULT_RULES_PATH) {
    this.filePath = filePath;
    this.load();
  }

  // ────────── 读取 ──────────

  /** 获取所有激活的规则（注入 Prompt 时使用） */
  getActiveRules(): CoreRule[] {
    return Array.from(this.rules.values())
      .filter((r) => r.active)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** 获取所有规则（管理界面使用） */
  getAllRules(): CoreRule[] {
    return Array.from(this.rules.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getRule(id: string): CoreRule | undefined {
    return this.rules.get(id);
  }

  // ────────── 写入 ──────────

  /**
   * 添加规则（用户显式指令触发）
   * @returns 新规则的 id
   */
  add(params: {
    rule: string;
    description?: string;
    category?: CoreRule['category'];
    source?: CoreRule['source'];
  }): CoreRule {
    const now = new Date().toISOString();
    const entry: CoreRule = {
      id: `rule_${randomUUID().slice(0, 8)}`,
      rule: params.rule.trim(),
      description: params.description,
      category: params.category ?? 'custom',
      createdAt: now,
      updatedAt: now,
      active: true,
      source: params.source ?? 'user_explicit',
    };

    this.rules.set(entry.id, entry);
    this.persist();
    log.info(`Core rule added: [${entry.category}] ${entry.rule.slice(0, 60)}`);
    return entry;
  }

  /** 更新规则内容（只允许用户显式操作，不允许 LLM 自动修改） */
  update(id: string, updates: Partial<Pick<CoreRule, 'rule' | 'description' | 'category' | 'active'>>): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;

    Object.assign(rule, updates, { updatedAt: new Date().toISOString() });
    this.persist();
    log.info(`Core rule updated: ${id}`);
    return true;
  }

  /** 删除规则（只允许用户显式操作） */
  delete(id: string): boolean {
    if (!this.rules.has(id)) return false;
    this.rules.delete(id);
    this.persist();
    log.info(`Core rule deleted: ${id}`);
    return true;
  }

  /** 停用/启用规则 */
  setActive(id: string, active: boolean): boolean {
    return this.update(id, { active });
  }

  // ────────── 格式化（注入 Prompt） ──────────

  /**
   * 格式化为 Prompt 文本
   * 始终出现在 System Prompt 最前，优先级高于一切
   */
  formatForPrompt(): string {
    const active = this.getActiveRules();
    if (active.length === 0) return '';

    const lines = active.map((r, i) => `${i + 1}. ${r.rule}`);
    return `### 🚫 核心规则（必须严格遵守，不可违反）\n\n${lines.join('\n')}`;
  }

  // ────────── 持久化 ──────────

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as CoreRule[];
      for (const rule of data) {
        this.rules.set(rule.id, rule);
      }
      log.debug(`Loaded ${this.rules.size} core rules`);
    } catch (err) {
      log.warn('Failed to load core rules:', err);
    }
  }

  private persist(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data = Array.from(this.rules.values());
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      log.warn('Failed to persist core rules:', err);
    }
  }
}
