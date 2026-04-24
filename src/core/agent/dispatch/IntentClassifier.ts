// ============================================================
// Intent Classifier - 统一的意图分类器（3层降级策略）
// ============================================================

import { ModelClassifier, type ClassificationResult } from './ModelClassifier';
import { IntentAnalyzer } from '@/core/prompt/IntentAnalyzer';
import type { AgentRegistry } from '../AgentRegistry';
import type { HookRegistry } from '@/core/hooks/HookRegistry';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IntentClassifier' });

export interface IntentClassifierOptions {
  agentRegistry?: AgentRegistry;
  intentAnalyzer?: IntentAnalyzer;
  hookRegistry?: HookRegistry;
  modelClassifierConfig?: {
    modelType?: import('./ModelClassifier').ClassifierModelType;
    systemPrompt?: string;
  };
}

/**
 * IntentClassifier - 统一的意图分类器
 *
 * 封装3层降级策略：
 * 1. 本地LLM（ModelClassifier）- 最快，最准确
 * 2. 向量分析（IntentAnalyzer with Embedding）- 中等速度，较准确
 * 3. 关键字匹配（IntentAnalyzer with Regex）- 最快降级，基本准确
 *
 * 使用方式：
 * ```typescript
 * const classifier = new IntentClassifier({ agentRegistry, intentAnalyzer });
 * await classifier.init();
 * const result = await classifier.classify(userInput);
 * ```
 */
export class IntentClassifier {
  private modelClassifier: ModelClassifier;
  private intentAnalyzer: IntentAnalyzer | null;
  private hookRegistry: HookRegistry | null;
  private initialized = false;

  constructor(options: IntentClassifierOptions = {}) {
    this.modelClassifier = new ModelClassifier(
      options.agentRegistry,
      options.modelClassifierConfig
    );
    this.intentAnalyzer = options.intentAnalyzer ?? null;
    this.hookRegistry = options.hookRegistry ?? null;
  }

  /**
   * 初始化分类器（懒加载本地模型）
   */
  async init(): Promise<void> {
    log.info('[IntentClassifier] init() called, initialized=' + this.initialized);
    if (this.initialized) {
      log.info('[IntentClassifier] already initialized, skipping');
      return;
    }

    try {
      await this.modelClassifier.init();
      log.info('[IntentClassifier] Initialized successfully');
    } catch (err) {
      log.warn('[IntentClassifier] Failed to initialize ModelClassifier:', err);
    }

    this.initialized = true;
  }

  /**
   * 分类用户输入（3层降级策略）
   *
   * @param userInput - 用户输入文本
   * @returns 分类结果 {scene, agent, complexity}
   */
  async classify(userInput: string): Promise<ClassificationResult> {
    // 第1层：尝试本地LLM
    const llmResult = await this.tryLocalModel(userInput);
    if (llmResult) {
      log.info(`[IntentClassifier] ✅ 本地LLM分类成功: scene=${llmResult.scene} agent=${llmResult.agent} complexity=${llmResult.complexity}`);
      return llmResult;
    }

    // 第2层：降级到向量分析
    const embeddingResult = await this.tryEmbedding(userInput);
    if (embeddingResult) {
      log.info(`[IntentClassifier] ✅ 向量分析成功: scene=${embeddingResult.scene} agent=${embeddingResult.agent}`);
      return embeddingResult;
    }

    // 第3层：降级到关键字匹配
    const keywordResult = await this.tryKeyword(userInput);
    if (keywordResult) {
      log.info(`[IntentClassifier] ✅ 关键字匹配成功: scene=${keywordResult.scene} agent=${keywordResult.agent}`);
      return keywordResult;
    }

    // 最终降级：返回默认
    log.info('[IntentClassifier] ⚠️ 所有策略失败，使用默认配置');
    return this.getDefault();
  }

  /**
   * 第1层：尝试本地LLM分类
   */
  private async tryLocalModel(userInput: string): Promise<ClassificationResult | null> {
    if (!this.modelClassifier.isAvailable()) {
      log.debug('[IntentClassifier] 本地LLM不可用，尝试重新初始化...');

      // 尝试重新初始化（可能是模型文件被删除了）
      try {
        await this.modelClassifier.init();
        if (!this.modelClassifier.isAvailable()) {
          log.debug('[IntentClassifier] 重新初始化后仍不可用，跳过');
          return null;
        }
        log.info('[IntentClassifier] 重新初始化成功');
      } catch (err) {
        log.debug('[IntentClassifier] 重新初始化失败，跳过');
        return null;
      }
    }

    // 触发分类开始事件（只有在模型真正可用时才触发）
    if (this.hookRegistry) {
      await this.hookRegistry.emit('ModelClassifierStart', {
        sessionId: `session-${Date.now()}`,
        data: {
          userInput,
          model: this.modelClassifier.getCurrentModel(),
        },
      });
    }

    try {
      const startTime = Date.now();
      const result = await this.modelClassifier.classify(userInput);
      const durationMs = Date.now() - startTime;

      // 触发分类结束事件
      if (result && this.hookRegistry) {
        await this.hookRegistry.emit('ModelClassifierEnd', {
          sessionId: `session-${Date.now()}`,
          data: {
            userInput,
            model: this.modelClassifier.getCurrentModel(),
            scene: result.scene,
            agent: result.agent,
            complexity: result.complexity,
            durationMs,
          },
        });
      }

      return result;
    } catch (err) {
      log.warn('[IntentClassifier] 本地LLM分类失败:', err);
      return null;
    }
  }

  /**
   * 第2层：尝试向量分析
   */
  private async tryEmbedding(userInput: string): Promise<ClassificationResult | null> {
    if (!this.intentAnalyzer) {
      log.debug('[IntentClassifier] IntentAnalyzer不可用，跳过向量分析');
      return null;
    }

    try {
      const analysis = await this.intentAnalyzer.analyze(userInput);
      if (analysis.scene && analysis.matchMethod === 'embedding') {
        // IntentAnalyzer 已经分析了 complexity，直接使用
        return {
          scene: analysis.scene,
          agent: this.inferAgentFromScene(analysis.scene),
          complexity: analysis.complexity, // 直接使用，已经是 simple/standard/complex
        };
      }
      return null;
    } catch (err) {
      log.warn('[IntentClassifier] 向量分析失败:', err);
      return null;
    }
  }

  /**
   * 第3层：尝试关键字匹配
   */
  private async tryKeyword(userInput: string): Promise<ClassificationResult | null> {
    if (!this.intentAnalyzer) {
      log.debug('[IntentClassifier] IntentAnalyzer不可用，跳过关键字匹配');
      return null;
    }

    try {
      const analysis = await this.intentAnalyzer.analyze(userInput);
      if (analysis.scene && analysis.matchMethod === 'keyword') {
        // IntentAnalyzer 已经分析了 complexity，直接使用
        return {
          scene: analysis.scene,
          agent: this.inferAgentFromScene(analysis.scene),
          complexity: analysis.complexity, // 直接使用，已经是 simple/standard/complex
        };
      }
      return null;
    } catch (err) {
      log.warn('[IntentClassifier] 关键字匹配失败:', err);
      return null;
    }
  }

  /**
   * 从scene推断agent
   */
  private inferAgentFromScene(scene: string): string {
    const sceneToAgent: Record<string, string> = {
      'write_code': 'coder',
      'debug': 'coder',
      'review': 'coder',
      'test': 'coder',
      'refactor': 'coder',
      'explore': 'explore',
      'plan': 'plan',
      'explain': 'general-purpose',
      'life': 'general-purpose',
    };

    return sceneToAgent[scene] ?? 'general-purpose';
  }

  /**
   * 获取默认分类结果
   */
  private getDefault(): ClassificationResult {
    return {
      scene: 'general',
      agent: 'general-purpose',
      complexity: 'simple',
    };
  }

  /**
   * 检查分类器是否可用
   */
  isAvailable(): boolean {
    return this.modelClassifier.isAvailable();
  }

  /**
   * 获取当前使用的模型
   */
  getCurrentModel(): string {
    return this.modelClassifier.getCurrentModel();
  }

  /**
   * 切换模型
   */
  async switchModel(modelType: import('./ModelClassifier').ClassifierModelType): Promise<void> {
    await this.modelClassifier.switchModel(modelType);
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    await this.modelClassifier.dispose();
  }
}

