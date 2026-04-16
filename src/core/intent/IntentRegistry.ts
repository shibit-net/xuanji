/**
 * 意图注册表
 *
 * 管理所有注册的意图模块，提供多种索引方式以快速查找
 */

import type {
  IntentMetadata,
  IntentRegistrable,
  IntentCallback,
  IntentDefinition,
  IntentContext,
  ModuleType,
  IntentDomain,
} from './types.js';
import type { ScanResult } from './UniversalIntentScanner.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IntentRegistry' });

/**
 * 注册项
 */
export interface RegistryEntry {
  /** 意图元数据 */
  intentMeta: IntentMetadata;

  /** 模块实例 */
  module: IntentRegistrable;

  /** 回调函数（可选） */
  callback?: IntentCallback;

  /** 注册时间 */
  registeredAt: number;
}

/**
 * 注册统计
 */
export interface RegistryStats {
  /** 意图类型总数 */
  totalIntentTypes: number;

  /** 注册模块总数 */
  totalModules: number;

  /** 按模块类型分组 */
  byModuleType: Record<string, number>;

  /** 按领域分组 */
  byDomain: Record<string, number>;

  /** 按优先级分组 */
  byPriority: {
    high: number; // >= 80
    medium: number; // 50-79
    low: number; // < 50
  };
}

/**
 * 意图注册表
 */
export class IntentRegistry {
  /** 按 IntentType 索引（一个 IntentType 可能对应多个模块） */
  private byIntentType = new Map<string, RegistryEntry[]>();

  /** 按 ModuleId 索引 */
  private byModuleId = new Map<string, RegistryEntry>();

  /** 按 ModuleType 索引 */
  private byModuleType = new Map<ModuleType, RegistryEntry[]>();

  /** 按 Domain 索引 */
  private byDomain = new Map<IntentDomain, RegistryEntry[]>();

  /**
   * 批量注册（从扫描结果）
   */
  registerBatch(scanResults: ScanResult[]): void {
    for (const result of scanResults) {
      this.register(result.intentMeta, result.module);
    }

    log.debug(`注册 ${this.byIntentType.size} 个意图类型，${this.byModuleId.size} 个模块`);
  }

  /**
   * 注册单个模块
   */
  register(
    intentMeta: IntentMetadata,
    module: IntentRegistrable,
    callback?: IntentCallback
  ): void {
    // 跳过禁用的意图
    if (intentMeta.enabled === false) {
      return;
    }

    const entry: RegistryEntry = {
      intentMeta,
      module,
      callback,
      registeredAt: Date.now(),
    };

    // 1. 按 IntentType 索引（支持多个模块注册同一个 IntentType）
    const existing = this.byIntentType.get(intentMeta.type) || [];
    existing.push(entry);
    // 按优先级排序
    existing.sort((a, b) => (b.intentMeta.priority || 50) - (a.intentMeta.priority || 50));
    this.byIntentType.set(intentMeta.type, existing);

    // 2. 按 ModuleId 索引
    this.byModuleId.set(module.id, entry);

    // 3. 按 ModuleType 索引
    const byType = this.byModuleType.get(module.moduleType) || [];
    byType.push(entry);
    this.byModuleType.set(module.moduleType, byType);

    // 4. 按 Domain 索引
    const byDomain = this.byDomain.get(intentMeta.domain) || [];
    byDomain.push(entry);
    this.byDomain.set(intentMeta.domain, byDomain);
  }

  /**
   * 注销模块
   */
  unregister(moduleId: string): boolean {
    const entry = this.byModuleId.get(moduleId);
    if (!entry) return false;

    // 从所有索引中移除
    const intentType = entry.intentMeta.type;
    const moduleType = entry.module.moduleType;
    const domain = entry.intentMeta.domain;

    // 按 IntentType 索引
    const byIntent = this.byIntentType.get(intentType);
    if (byIntent) {
      const filtered = byIntent.filter((e) => e.module.id !== moduleId);
      if (filtered.length === 0) {
        this.byIntentType.delete(intentType);
      } else {
        this.byIntentType.set(intentType, filtered);
      }
    }

    // 按 ModuleId 索引
    this.byModuleId.delete(moduleId);

    // 按 ModuleType 索引
    const byType = this.byModuleType.get(moduleType);
    if (byType) {
      const filtered = byType.filter((e) => e.module.id !== moduleId);
      this.byModuleType.set(moduleType, filtered);
    }

    // 按 Domain 索引
    const byDom = this.byDomain.get(domain);
    if (byDom) {
      const filtered = byDom.filter((e) => e.module.id !== moduleId);
      this.byDomain.set(domain, filtered);
    }

    return true;
  }

  /**
   * 获取意图定义列表（用于生成向量）
   */
  getIntentDefinitions(): IntentDefinition[] {
    const intentDefMap = new Map<string, IntentDefinition>();

    for (const [intentType, entries] of this.byIntentType.entries()) {
      // 合并同一 IntentType 的所有训练样本
      const allExamples: string[] = [];
      let firstEntry: RegistryEntry | null = null;

      for (const entry of entries) {
        allExamples.push(...entry.intentMeta.trainingExamples);
        if (!firstEntry) firstEntry = entry;
      }

      // 创建意图定义
      const intentDef: IntentDefinition = {
        type: intentType,
        domain: firstEntry!.intentMeta.domain,
        name: firstEntry!.intentMeta.name || intentType,
        description: firstEntry!.intentMeta.description || '',
        examples: [...new Set(allExamples)], // 去重
      };

      intentDefMap.set(intentType, intentDef);
    }

    return Array.from(intentDefMap.values());
  }

  /**
   * 根据 IntentType 查找模块
   */
  findByIntentType(intentType: string): RegistryEntry[] {
    return this.byIntentType.get(intentType) || [];
  }

  /**
   * 根据 ModuleId 查找模块
   */
  findByModuleId(moduleId: string): RegistryEntry | undefined {
    return this.byModuleId.get(moduleId);
  }

  /**
   * 根据 ModuleType 查找模块
   */
  findByModuleType(moduleType: ModuleType): RegistryEntry[] {
    return this.byModuleType.get(moduleType) || [];
  }

  /**
   * 根据 Domain 查找模块
   */
  findByDomain(domain: IntentDomain): RegistryEntry[] {
    return this.byDomain.get(domain) || [];
  }

  /**
   * 触发意图回调
   */
  async trigger(intentType: string, context: IntentContext): Promise<void> {
    const entries = this.findByIntentType(intentType);

    // 按优先级顺序执行所有回调
    for (const entry of entries) {
      if (entry.callback) {
        try {
          await entry.callback(context);
        } catch (err) {
          log.warn(`意图回调执行失败 (${intentType}):`, err);
        }
      }
    }
  }

  /**
   * 检查意图是否已注册
   */
  has(intentType: string): boolean {
    return this.byIntentType.has(intentType);
  }

  /**
   * 检查模块是否已注册
   */
  hasModule(moduleId: string): boolean {
    return this.byModuleId.has(moduleId);
  }

  /**
   * 获取所有意图类型
   */
  getAllIntentTypes(): string[] {
    return Array.from(this.byIntentType.keys());
  }

  /**
   * 获取所有模块 ID
   */
  getAllModuleIds(): string[] {
    return Array.from(this.byModuleId.keys());
  }

  /**
   * 获取统计信息
   */
  getStats(): RegistryStats {
    const byModuleType: Record<string, number> = {};
    const byDomain: Record<string, number> = {};
    const byPriority = { high: 0, medium: 0, low: 0 };

    for (const entry of this.byModuleId.values()) {
      // 按模块类型
      const type = entry.module.moduleType;
      byModuleType[type] = (byModuleType[type] || 0) + 1;

      // 按领域
      const domain = entry.intentMeta.domain;
      byDomain[domain] = (byDomain[domain] || 0) + 1;

      // 按优先级
      const priority = entry.intentMeta.priority || 50;
      if (priority >= 80) {
        byPriority.high++;
      } else if (priority >= 50) {
        byPriority.medium++;
      } else {
        byPriority.low++;
      }
    }

    return {
      totalIntentTypes: this.byIntentType.size,
      totalModules: this.byModuleId.size,
      byModuleType,
      byDomain,
      byPriority,
    };
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.byIntentType.clear();
    this.byModuleId.clear();
    this.byModuleType.clear();
    this.byDomain.clear();
  }

}
