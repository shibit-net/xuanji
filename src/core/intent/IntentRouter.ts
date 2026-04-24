/**
 * 意图路由器
 *
 * 智能识别用户意图，支持：
 * 1. LLM 分类（精确分析）
 * 2. 注册表查找（快速匹配）
 */

import { UniversalIntentScanner } from './UniversalIntentScanner.js';
import { IntentRegistry } from './IntentRegistry.js';
import { LLMIntentClassifier, type AvailableModule } from './LLMIntentClassifier.js';
import type { Intent, IntentMatchOptions } from './types.js';
import type { AgentRegistry } from '@/core/agent/AgentRegistry.js';
import type { ProviderConfig } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IntentRouter' });

// ─── CapabilityAssembler ────────────────────────────────────────────────────

/**
 * 模块查找结果
 */
export interface ModuleLookupResult {
  moduleId: string;
  moduleType: string;
  intentType: string;
  confidence: number;
}

/**
 * 能力组装器 — 根据识别到的意图查找对应模块
 */
export class CapabilityAssembler {
  constructor(private registry: IntentRegistry) {}

  findModules(intents: Intent[]): ModuleLookupResult[] {
    const results: ModuleLookupResult[] = [];
    for (const intent of intents) {
      const entries = this.registry.findByIntentType(intent.type);
      for (const entry of entries) {
        results.push({
          moduleId: entry.module.id,
          moduleType: entry.module.moduleType,
          intentType: intent.type,
          confidence: intent.confidence,
        });
      }
      if (intent.source === 'llm' && intent.params?.moduleId) {
        results.push({
          moduleId: intent.params.moduleId,
          moduleType: intent.type.split('.')[0],
          intentType: intent.type,
          confidence: intent.confidence,
        });
      }
    }
    return results;
  }

  getTopModule(intents: Intent[]): ModuleLookupResult | null {
    const modules = this.findModules(intents);
    if (modules.length === 0) return null;
    modules.sort((a, b) => b.confidence - a.confidence);
    return modules[0];
  }
}

/**
 * 意图路由器
 */
export class IntentRouter {
  private scanner: UniversalIntentScanner;
  private registry: IntentRegistry;
  private llmClassifier: LLMIntentClassifier;
  private initialized = false;

  constructor(
    private agentRegistry: AgentRegistry | null,
    private providerConfig: ProviderConfig
  ) {
    this.scanner = new UniversalIntentScanner();
    this.registry = new IntentRegistry();
    this.llmClassifier = new LLMIntentClassifier(agentRegistry, providerConfig);
  }

  /**
   * 注册外部模块（如 SkillRegistry 中的 skill）
   * 在 init() 之前调用，注册结果会参与向量构建
   */
  registerExternalModules(modules: import('@/core/intent/types').IntentRegistrable[]): void {
    for (const module of modules) {
      this.registry.register(module.intentMeta, module);
    }
    log.debug(`注册 ${modules.length} 个外部模块`);
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 1. 扫描所有可注册模块
    const { results: scanResults, stats } = await this.scanner.scanAll();

    // 2. 批量注册到注册表
    this.registry.registerBatch(scanResults);

    const regStats = this.registry.getStats();
    log.info('IntentRouter initialized', {
      intentTypes: this.registry.getIntentDefinitions().length,
      modules: regStats.totalModules,
      byType: stats.byType.size > 0 ? Object.fromEntries(stats.byType) : undefined,
    });

    this.initialized = true;
  }

  /**
   * 路由用户输入（LLM 分类）
   *
   * @param userInput 用户输入
   * @param availableModules 所有可用模块（用于 LLM 分类）
   * @param options 匹配选项
   */
  async route(
    userInput: string,
    availableModules: AvailableModule[],
    options?: IntentMatchOptions
  ): Promise<Intent[]> {
    if (!this.initialized) {
      throw new Error('IntentRouter 未初始化，请先调用 init()');
    }

    const enableLLM = options?.enableLLM !== false;
    if (!enableLLM) return [];

    const llmIntents = await this.llmClassifier.classify(userInput, availableModules);
    return llmIntents;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
