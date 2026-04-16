/**
 * 意图路由器
 *
 * 智能识别用户意图，支持：
 * 1. 向量匹配（快速，语义理解）
 * 2. LLM 分类（未命中时，精确分析）
 * 3. 自动学习（持续优化）
 */

import { UniversalIntentScanner } from './UniversalIntentScanner.js';
import { IntentRegistry } from './IntentRegistry.js';
import { VectorIntentMatcher } from './VectorIntentMatcher.js';
import { LLMIntentClassifier, type AvailableModule } from './LLMIntentClassifier.js';
import { IntentLearner } from './IntentLearner.js';
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
  private vectorMatcher: VectorIntentMatcher;
  private llmClassifier: LLMIntentClassifier;
  private learner: IntentLearner;
  private initialized = false;

  constructor(
    private agentRegistry: AgentRegistry | null,
    private providerConfig: ProviderConfig
  ) {
    this.scanner = new UniversalIntentScanner();
    this.registry = new IntentRegistry();
    this.vectorMatcher = new VectorIntentMatcher();
    this.llmClassifier = new LLMIntentClassifier(agentRegistry, providerConfig);
    this.learner = new IntentLearner(this.vectorMatcher);
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
   * @param options 初始化选项
   * @param options.skipVectorInit 跳过向量匹配器初始化（测试用）
   */
  async init(options?: { skipVectorInit?: boolean }): Promise<void> {
    if (this.initialized) return;

    // 1. 扫描所有可注册模块
    const { results: scanResults, stats } = await this.scanner.scanAll();

    // 2. 批量注册到注册表（文件系统扫描结果 + 已通过 registerExternalModules 注册的）
    this.registry.registerBatch(scanResults);

    // 3. 初始化学习器并加载已学习的意图
    await this.learner.init();

    // 4. 获取意图定义列表（注册的 + 学习的）
    const registeredDefs = this.registry.getIntentDefinitions();
    const learnedDefs = this.learner.getLearnedIntentDefinitions();
    const allDefs = [...registeredDefs, ...learnedDefs];

    // 5. 初始化向量匹配器（可跳过，测试用）
    if (!options?.skipVectorInit) {
      await this.vectorMatcher.init(allDefs);
    }

    const regStats = this.registry.getStats();
    log.info('IntentRouter initialized', {
      intentTypes: allDefs.length,
      modules: regStats.totalModules,
      byType: stats.byType.size > 0 ? Object.fromEntries(stats.byType) : undefined,
    });

    this.initialized = true;
  }

  /**
   * 路由用户输入（自动学习版）
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

    const threshold = options?.threshold || 0.7;
    const enableVector = options?.enableVector !== false;
    const enableLLM = options?.enableLLM !== false;

    // ========================================
    // Step 1: 向量匹配（快速）
    // ========================================
    if (enableVector) {
      const vectorIntents = await this.vectorMatcher.match(userInput, { threshold, topK: 3 });

      if (vectorIntents.length > 0) {
        const topIntent = vectorIntents[0];
        log.debug(`向量匹配命中: ${topIntent.type} (${topIntent.confidence.toFixed(2)})`);
        this.learner.learnFromVector(userInput, topIntent).catch((err) => log.warn('向量学习失败:', err));
        return vectorIntents;
      }
    }

    if (!enableLLM) return [];

    log.debug('向量未命中，使用 LLM 分析...');
    const llmIntents = await this.llmClassifier.classify(userInput, availableModules);

    if (llmIntents.length === 0) return [];

    const topIntent = llmIntents[0];
    const moduleInfo = availableModules.find((m) => m.id === topIntent.params?.moduleId);
    if (moduleInfo) {
      this.learner.learnFromLLM(userInput, topIntent, moduleInfo).catch((err) => log.warn('LLM 学习失败:', err));
    }

    return llmIntents;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
