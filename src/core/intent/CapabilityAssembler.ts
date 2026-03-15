/**
 * 能力组装器（简化版）
 *
 * 根据识别到的意图，查找并返回对应的模块
 *
 * TODO: 后续扩展完整版
 * - 动态组装 System Prompt Components
 * - 选择最佳 Model
 * - 合并 Memory Scopes
 */

import type { Intent } from './types.js';
import type { IntentRegistry } from './IntentRegistry.js';

/**
 * 模块查找结果
 */
export interface ModuleLookupResult {
  /** 模块 ID */
  moduleId: string;

  /** 模块类型 */
  moduleType: string;

  /** 意图类型 */
  intentType: string;

  /** 置信度 */
  confidence: number;
}

/**
 * 能力组装器
 */
export class CapabilityAssembler {
  constructor(private registry: IntentRegistry) {}

  /**
   * 根据意图查找对应的模块
   */
  findModules(intents: Intent[]): ModuleLookupResult[] {
    const results: ModuleLookupResult[] = [];

    for (const intent of intents) {
      // 从注册表查找
      const entries = this.registry.findByIntentType(intent.type);

      for (const entry of entries) {
        results.push({
          moduleId: entry.module.id,
          moduleType: entry.module.moduleType,
          intentType: intent.type,
          confidence: intent.confidence,
        });
      }

      // 如果是 LLM 识别的，params 中有 moduleId
      if (intent.source === 'llm' && intent.params?.moduleId) {
        results.push({
          moduleId: intent.params.moduleId,
          moduleType: intent.type.split('.')[0], // 从 type 提取（如 skill.xxx）
          intentType: intent.type,
          confidence: intent.confidence,
        });
      }
    }

    return results;
  }

  /**
   * 获取顶部模块（置信度最高）
   */
  getTopModule(intents: Intent[]): ModuleLookupResult | null {
    const modules = this.findModules(intents);

    if (modules.length === 0) {
      return null;
    }

    // 按置信度排序
    modules.sort((a, b) => b.confidence - a.confidence);

    return modules[0];
  }
}
