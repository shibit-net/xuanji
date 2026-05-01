// ============================================================
// Intent Classifier - 统一的意图分类器（3层降级策略）
// ============================================================

import { ModelClassifier, type ClassificationResult } from './ModelClassifier';
import { IntentAnalyzer } from '@/core/prompt/IntentAnalyzer';
import type { AgentRegistry } from '../AgentRegistry';
import type { HookRegistry } from '@/hooks/HookRegistry';
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
  private lastResult: ClassificationResult | null = null;
  private lastResultTime: number = 0;
  private static readonly LAST_RESULT_TTL_MS = 5 * 60 * 1000; // 5分钟过期

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
   * @param force - 强制重新初始化，即使已经初始化过
   */
  async init(force: boolean = false): Promise<void> {
    log.info('[IntentClassifier] init() called, initialized=' + this.initialized + ', force=' + force);

    if (this.initialized && !force) {
      log.info('[IntentClassifier] already initialized, checking for config changes');
      try {
        await this.modelClassifier.init();
        this.syncSceneMetadata();
        log.info('[IntentClassifier] Config check completed');
      } catch (err) {
        log.warn('[IntentClassifier] Config check failed:', err);
      }
      return;
    }

    try {
      await this.modelClassifier.init();
      this.syncSceneMetadata();
      log.info('[IntentClassifier] Initialized successfully');
    } catch (err) {
      log.warn('[IntentClassifier] Failed to initialize ModelClassifier:', err);
    }

    this.initialized = true;
  }

  /**
   * 从 IntentAnalyzer 的 L1 组件收集 scene 元数据，同步到 ModelClassifier
   * 这样 ModelClassifier 的 buildSceneList() 就不需要硬编码 scene 列表了
   */
  private syncSceneMetadata(): void {
    if (!this.intentAnalyzer) return;

    const sceneConfigs = this.intentAnalyzer.getSceneConfigs();
    if (sceneConfigs.size === 0) return;

    const metadata: import('./ModelClassifier').SceneMetadata[] = [];
    for (const [scene, config] of sceneConfigs) {
      metadata.push({
        scene,
        description: config.description,
        keywords: config.keywords instanceof RegExp ? config.keywords.source : undefined,
      });
    }

    if (metadata.length > 0) {
      this.modelClassifier.setSceneMetadata(metadata);
      log.info(`[IntentClassifier] Synced ${metadata.length} scene metadata entries from L1 components`);
    }
  }

  /**
   * 分类用户输入（3层降级策略）
   *
   * @param userInput - 用户输入文本
   * @returns 分类结果 {scene, agent, complexity}
   */
  async classify(userInput: string): Promise<ClassificationResult> {
    // 检测续写/重复执行语义：直接复用上次分类结果（带 TTL 防止过期）
    if (this.lastResult && this.isContinuationPhrase(userInput)) {
      const elapsed = Date.now() - this.lastResultTime;
      if (elapsed < IntentClassifier.LAST_RESULT_TTL_MS) {
        log.info(`[IntentClassifier] 🔁 检测到续写语义，复用上次分类 (${Math.round(elapsed / 1000)}s 前): scene=${this.lastResult.scene} agent=${this.lastResult.agent} complexity=${this.lastResult.complexity}`);
        return this.lastResult;
      }
      log.info(`[IntentClassifier] ⏰ 上次分类已过期 (${Math.round(elapsed / 1000)}s)，重新分类`);
    }

    // 第1层：尝试本地LLM
    const llmResult = await this.tryLocalModel(userInput);
    if (llmResult) {
      log.info(`[IntentClassifier] ✅ 本地LLM分类成功: scene=${llmResult.scene} agent=${llmResult.agent} complexity=${llmResult.complexity}`);
      this.lastResultTime = Date.now();
      this.lastResult = llmResult;
      return llmResult;
    }

    // 第2层：降级到向量分析
    const embeddingResult = await this.tryEmbedding(userInput);
    if (embeddingResult) {
      log.info(`[IntentClassifier] ✅ 向量分析成功: scene=${embeddingResult.scene} agent=${embeddingResult.agent}`);
      this.lastResultTime = Date.now();
      this.lastResult = embeddingResult;
      return embeddingResult;
    }

    // 第3层：降级到关键字匹配
    const keywordResult = await this.tryKeyword(userInput);
    if (keywordResult) {
      log.info(`[IntentClassifier] ✅ 关键字匹配成功: scene=${keywordResult.scene} agent=${keywordResult.agent}`);
      this.lastResultTime = Date.now();
      this.lastResult =keywordResult;
      return keywordResult;
    }

    // 最终降级：返回默认
    log.info('[IntentClassifier] ⚠️ 所有策略失败，使用默认配置');
    const defaultResult = this.getDefault();
    this.lastResultTime = Date.now();
    this.lastResult = defaultResult;
    return defaultResult;
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

    // 触发分类开始事件
    if (this.hookRegistry) {
      log.info('[IntentClassifier] 触发 ModelClassifierStart 事件');
      await this.hookRegistry.emit('IntentAnalysisStart', {
        sessionId: `session-${Date.now()}`,
        timestamp: Date.now(),
        data: {
          userInput,
          model: this.modelClassifier.getCurrentModel(),
        },
      });
      await this.hookRegistry.emit('ModelClassifierStart', {
        sessionId: `session-${Date.now()}`,
        timestamp: Date.now(),
        data: {
          userInput,
          model: this.modelClassifier.getCurrentModel(),
        },
      });
      log.info('[IntentClassifier] ModelClassifierStart 事件已触发');
    } else {
      log.warn('[IntentClassifier] hookRegistry 不存在，无法触发 ModelClassifierStart');
    }

    try {
      const startTime = Date.now();
      const result = await this.modelClassifier.classify(userInput);
      const durationMs = Date.now() - startTime;

      // LLM 分类结果补充 matchMethod
      if (result && !result.matchMethod) {
        result.matchMethod = 'llm';
      }

      // 🔧 无论分类成功还是失败，都触发分类结束事件
      if (this.hookRegistry) {
        log.info('[IntentClassifier] 触发 ModelClassifierEnd 事件');
        await this.hookRegistry.emit('IntentAnalysisEnd', {
          sessionId: `session-${Date.now()}`,
          timestamp: Date.now(),
          data: {
            userInput,
            model: this.modelClassifier.getCurrentModel(),
            scene: result?.scene || null,
            agent: result?.agent || null,
            complexity: result?.complexity || null,
            matchMethod: result?.matchMethod || null,
            durationMs,
            success: !!result, // 🔧 添加成功标志
          },
        });
        await this.hookRegistry.emit('ModelClassifierEnd', {
          sessionId: `session-${Date.now()}`,
          timestamp: Date.now(),
          data: {
            userInput,
            model: this.modelClassifier.getCurrentModel(),
            scene: result?.scene || null,
            agent: result?.agent || null,
            complexity: result?.complexity || null,
            matchMethod: result?.matchMethod || null,
            durationMs,
            success: !!result,
          },
        });
        log.info('[IntentClassifier] ModelClassifierEnd 事件已触发');
      } else {
        log.warn('[IntentClassifier] hookRegistry 不存在，无法触发 ModelClassifierEnd');
      }

      return result;
    } catch (err) {
      log.warn('[IntentClassifier] 本地LLM分类失败:', err);

      // 🔧 即使发生异常，也触发分类结束事件
      if (this.hookRegistry) {
        const errorData = {
          userInput,
          model: this.modelClassifier.getCurrentModel(),
          scene: null,
          agent: null,
          complexity: null,
          durationMs: 0,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
        await this.hookRegistry.emit('IntentAnalysisEnd', {
          sessionId: `session-${Date.now()}`,
          timestamp: Date.now(),
          data: errorData,
        }).catch(() => {});
        await this.hookRegistry.emit('ModelClassifierEnd', {
          sessionId: `session-${Date.now()}`,
          timestamp: Date.now(),
          data: errorData,
        }).catch(() => {});
      }

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
        // 🔧 尝试通过向量匹配推荐 agent
        const agentMatch = await this.intentAnalyzer.matchAgent(userInput);
        const agent = agentMatch?.agentId || this.inferAgentFromScene(analysis.scene);

        log.debug(`[IntentClassifier] Embedding match: scene=${analysis.scene}, agent=${agent}${agentMatch ? ` (similarity=${agentMatch.similarity.toFixed(3)})` : ' (inferred from scene)'}`);

        return {
          scene: analysis.scene,
          agent,
          complexity: analysis.complexity,
          matchMethod: 'embedding',
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
          matchMethod: 'keyword',
        };
      }
      return null;
    } catch (err) {
      log.warn('[IntentClassifier] 关键字匹配失败:', err);
      return null;
    }
  }

  /**
   * 从scene推断agent（优先从 agent tags 动态推导，回退到硬编码映射）
   */
  private inferAgentFromScene(scene: string): string {
    const agentRegistry = this.modelClassifier.getAgentRegistry();
    if (agentRegistry) {
      const agents = agentRegistry.getEnabled();
      // 优先：找 tags 中包含该 scene 的 agent
      for (const agent of agents) {
        if (agent.tags && Array.isArray(agent.tags) && agent.tags.includes(scene)) {
          return agent.id;
        }
      }
      // 其次：模糊匹配（tags 包含场景前缀）
      for (const agent of agents) {
        if (agent.tags && Array.isArray(agent.tags)) {
          for (const tag of agent.tags) {
            if (tag.includes(scene) || scene.includes(tag)) {
              return agent.id;
            }
          }
        }
      }
    }

    // 回退映射（通用 scene → agent 推断）
    const fallback: Record<string, string> = {
      'write_code': 'software-engineer',
      'debug': 'software-engineer',
      'review': 'software-engineer',
      'test': 'software-engineer',
      'refactor': 'software-engineer',
      'explore': 'software-engineer',
      'plan': 'product-manager',
      'explain': 'general-purpose',
    };

    return fallback[scene] ?? 'general-purpose';
  }

  /**
   * 检测是否为续写/重复执行语义，此时应复用上次分类结果
   */
  private isContinuationPhrase(input: string): boolean {
    const trimmed = input.trim();
    if (trimmed.length > 10) return false;

    const patterns = [
      /^再(执行|来|跑|做|试)(一次|一遍|一下|下)?$/,
      /^继续(执行|运行|做)?$/,
      /^重(试|做|来|跑|执行)(一次|一遍)?$/,
      /^(again|retry|redo|rerun)$/i,
      /^(do it )?again$/i,
    ];

    return patterns.some(p => p.test(trimmed));
  }

  /**
   * 获取默认分类结果
   */
  private getDefault(): ClassificationResult {
    return {
      scene: 'general',
      agent: 'general',
      complexity: 'simple',
      matchMethod: 'default',
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

