// ============================================================
// CoreRuleStore — 核心规则适配器（兼容层）
// ============================================================
// 保持向后兼容，内部委托给 PermanentConstraintManager
// 所有数据存储在 memory.db，不再使用 core-rules.json
// ============================================================

import type { CoreRule } from './types';
import type { PermanentConstraintManager } from './PermanentConstraintManager';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'CoreRuleStore' });

/**
 * CoreRuleStore 适配器
 *
 * 保持向后兼容的接口，内部委托给 PermanentConstraintManager
 */
export class CoreRuleStore {
  private constraintManager: PermanentConstraintManager;

  constructor(constraintManager?: PermanentConstraintManager) {
    // 如果没有传入 constraintManager，则延迟初始化
    // 这是为了兼容旧代码中直接 new CoreRuleStore() 的情况
    this.constraintManager = constraintManager as any;
    if (!constraintManager) {
      log.warn('CoreRuleStore created without PermanentConstraintManager, some features may not work');
    }
  }

  /**
   * 设置 PermanentConstraintManager（延迟注入）
   */
  setConstraintManager(manager: PermanentConstraintManager): void {
    this.constraintManager = manager;
  }

  // ────────── 读取 ──────────

  /** 获取所有激活的规则（注入 Prompt 时使用） */
  getActiveRules(): CoreRule[] {
    if (!this.constraintManager) return [];

    const constraints = this.constraintManager.getActiveConstraints();
    return constraints.map(c => ({
      id: c.id,
      rule: c.content,
      description: c.description,
      category: c.type as any,
      createdAt: c.createdAt,
      updatedAt: c.createdAt,  // 使用 createdAt 作为 updatedAt
      active: c.active,
      source: c.source,
    }));
  }

  /** 获取所有规则（管理界面使用） */
  getAllRules(): CoreRule[] {
    return this.getActiveRules();
  }

  getRule(id: string): CoreRule | undefined {
    const rules = this.getActiveRules();
    return rules.find(r => r.id === id);
  }

  // ────────── 写入 ──────────

  /**
   * 添加规则（用户显式指令触发）
   * @returns 新规则
   */
  add(params: {
    rule: string;
    description?: string;
    category?: CoreRule['category'];
    source?: CoreRule['source'];
  }): CoreRule {
    if (!this.constraintManager) {
      throw new Error('CoreRuleStore not initialized with PermanentConstraintManager');
    }

    const constraint = this.constraintManager.add({
      content: params.rule,
      type: params.category as any,
      description: params.description,
      source: params.source,
    });

    return {
      id: constraint.id,
      rule: constraint.content,
      description: constraint.description,
      category: constraint.type as any,
      createdAt: constraint.createdAt,
      updatedAt: constraint.createdAt,
      active: constraint.active,
      source: constraint.source,
    };
  }

  /** 更新规则内容（只允许用户显式操作，不允许 LLM 自动修改） */
  update(id: string, updates: Partial<Pick<CoreRule, 'rule' | 'description' | 'category' | 'active'>>): boolean {
    if (!this.constraintManager) return false;

    return this.constraintManager.update(id, {
      content: updates.rule,
      description: updates.description,
      active: updates.active,
    });
  }

  /** 删除规则（只允许用户显式操作） */
  delete(id: string): boolean {
    if (!this.constraintManager) return false;
    return this.constraintManager.delete(id);
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
    if (!this.constraintManager) return '';
    return this.constraintManager.formatForPrompt();
  }
}
