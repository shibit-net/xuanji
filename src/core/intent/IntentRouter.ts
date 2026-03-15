/**
 * 意图路由器
 *
 * 智能识别用户意图，支持：
 * 1. 向量匹配（快速，语义理解）
 * 2. LLM 分类（未命中时，精确分析）
 * 3. 自动学习（持续优化）
 *
 * **架构变更**（2026-03-15）：
 * - LLM 分类改为调用 IntentAnalyzer Agent（独立配置模型）
 * - 移除 lightProvider 依赖，符合多 Agent 架构设计
 */

import { UniversalIntentScanner } from './UniversalIntentScanner.js';
import { IntentRegistry } from './IntentRegistry.js';
import { VectorIntentMatcher } from './VectorIntentMatcher.js';
import { LLMIntentClassifier, type AvailableModule } from './LLMIntentClassifier.js';
import { IntentLearner } from './IntentLearner.js';
import type { Intent, IntentMatchOptions } from './types.js';
import type { AgentRegistry } from '@/core/agent/AgentRegistry.js';
import type { ProviderConfig } from '@/core/types';

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
   * 初始化
   * @param options 初始化选项
   * @param options.skipVectorInit 跳过向量匹配器初始化（测试用）
   */
  async init(options?: { skipVectorInit?: boolean }): Promise<void> {
    if (this.initialized) {
      console.log('⚠️  IntentRouter 已经初始化');
      return;
    }

    console.log('⏳ 初始化意图路由器...');

    // 1. 扫描所有可注册模块（有 intentMeta 的）
    const { results: scanResults, stats } = await this.scanner.scanAll();

    // 2. 批量注册到注册表
    this.registry.registerBatch(scanResults);

    // 3. 初始化学习器并加载已学习的意图
    await this.learner.init();

    // 4. 获取意图定义列表（注册的 + 学习的）
    const registeredDefs = this.registry.getIntentDefinitions();
    const learnedDefs = this.learner.getLearnedIntentDefinitions();
    const allDefs = [...registeredDefs, ...learnedDefs];

    console.log(`  注册的意图: ${registeredDefs.length} 个`);
    console.log(`  学习的意图: ${learnedDefs.length} 个`);

    // 5. 初始化向量匹配器（可跳过，测试用）
    if (!options?.skipVectorInit) {
      await this.vectorMatcher.init(allDefs);
    } else {
      console.log('  ⚠️  跳过向量匹配器初始化（测试模式）');
    }

    // 6. 输出统计信息
    const regStats = this.registry.getStats();
    console.log('✓ 意图路由器初始化完成:');
    console.log(`  总意图类型: ${allDefs.length}`);
    console.log(`  注册模块: ${regStats.totalModules}`);
    if (stats.byType.size > 0) {
      console.log('  模块分布:', Object.fromEntries(stats.byType));
    }

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
      const vectorIntents = await this.vectorMatcher.match(userInput, {
        threshold,
        topK: 3,
      });

      if (vectorIntents.length > 0) {
        const topIntent = vectorIntents[0];
        console.log(
          `✓ 向量匹配命中: ${topIntent.type} (置信度: ${topIntent.confidence.toFixed(2)})`
        );

        // 异步学习（增强样本）
        this.learner
          .learnFromVector(userInput, topIntent)
          .catch((err) => console.error('向量学习失败:', err));

        return vectorIntents;
      }
    }

    // ========================================
    // Step 2: LLM 分类（向量未命中时）
    // ========================================
    if (!enableLLM) {
      console.log('⚠️  向量未命中，但 LLM 分类已禁用');
      return [];
    }

    console.log('⚠️  向量未命中，使用 LLM 分析...');

    const llmIntents = await this.llmClassifier.classify(userInput, availableModules);

    if (llmIntents.length === 0) {
      console.log('⚠️  LLM 也未识别到意图');
      return [];
    }

    // 异步学习（创建新意图或增强现有意图）
    const topIntent = llmIntents[0];
    const moduleInfo = availableModules.find((m) => m.id === topIntent.params?.moduleId);

    if (moduleInfo) {
      this.learner
        .learnFromLLM(userInput, topIntent, moduleInfo)
        .catch((err) => console.error('LLM 学习失败:', err));
    }

    return llmIntents;
  }

  /**
   * 获取注册表
   */
  getRegistry(): IntentRegistry {
    return this.registry;
  }

  /**
   * 获取向量匹配器
   */
  getVectorMatcher(): VectorIntentMatcher {
    return this.vectorMatcher;
  }

  /**
   * 获取学习器
   */
  getLearner(): IntentLearner {
    return this.learner;
  }

  /**
   * 获取学习统计
   */
  getLearningStats() {
    return this.learner.getStats();
  }

  /**
   * 获取学习历史
   */
  getLearningHistory(limit?: number) {
    return this.learner.getHistory(limit);
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
