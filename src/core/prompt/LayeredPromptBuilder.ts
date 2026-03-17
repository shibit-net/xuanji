/**
 * ============================================================
 * LayeredPromptBuilder — 分层意图感知 Prompt 构建器
 * ============================================================
 * 替代 SystemPromptBuilder。
 *
 * 根据 IntentAnalyzer 的分析结果，按层级选择性加载组件：
 *   simple  → L0 only (~600 tokens)
 *   standard → L0 + L1 (~1,400 tokens)
 *   complex  → L0 + L1 + L2 (~2,400 tokens)
 *   L3 始终加载（项目上下文）
 *
 * 记忆通过 ChatSession 的 suffix 机制独立管理，不在此处处理。
 */

import type {
  PromptComponent,
  PromptBuildContext,
  PromptBuildResult,
  LayeredPromptBuildOptions,
  SceneType,
  IntentComplexity,
} from './types';
import { IntentAnalyzer } from './IntentAnalyzer';
import {
  l0Identity,
  l0Safety,
  l1Coding,
  l1Life,
  l2Planning,
  l2AgentRules,
  l2Safety,
  l3Project,
} from './components';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LayeredPromptBuilder' });

export class LayeredPromptBuilder {
  private components: Map<string, PromptComponent> = new Map();
  private intentAnalyzer: IntentAnalyzer;
  private currentScene: SceneType | null = null;
  private currentComplexity: IntentComplexity = 'standard';

  constructor(intentAnalyzer?: IntentAnalyzer) {
    this.intentAnalyzer = intentAnalyzer ?? new IntentAnalyzer();

    // 注册默认组件
    this.registerDefaults();
  }

  /**
   * 注册组件
   */
  register(component: PromptComponent): void {
    this.components.set(component.id, component);

    // 如果是 L1 组件且有 match 配置，注册到 IntentAnalyzer
    if (component.layer === 'L1' && component.match && component.scenes?.length) {
      for (const scene of component.scenes) {
        this.intentAnalyzer.registerScene(scene, component.match);
      }
    }

    log.debug(`Component registered: ${component.id} (${component.layer})`);
  }

  /**
   * 初始化（预计算 embeddings 等）
   */
  async init(): Promise<void> {
    await this.intentAnalyzer.init();
  }

  /**
   * 构建 Prompt
   */
  async build(options: LayeredPromptBuildOptions = {}): Promise<PromptBuildResult> {
    const { userMessage, language = 'zh', toolList = [] } = options;

    // 1. 意图分析
    let scene: SceneType | null = null;
    let complexity: IntentComplexity = 'standard';

    if (options.scene && options.scene !== 'auto') {
      scene = options.scene;
    }
    if (options.complexity) {
      complexity = options.complexity;
    }

    if (userMessage && (!scene || !options.complexity)) {
      const analysis = await this.intentAnalyzer.analyze(
        userMessage,
        !this.currentScene, // isFirstTurn
      );
      if (!scene) scene = analysis.scene;
      if (!options.complexity) complexity = analysis.complexity;
    }

    // 默认场景
    if (!scene) scene = 'coding';

    this.currentScene = scene;
    this.currentComplexity = complexity;

    log.debug(`Building prompt: scene=${scene}, complexity=${complexity}`);

    // 2. 选择组件
    const selectedComponents = this.selectComponents(scene, complexity);

    // 3. 构建上下文
    const context: PromptBuildContext = { language, toolList };

    // 4. 渲染组件
    const parts: string[] = [];
    const componentIds: string[] = [];
    const allRequiredTools: string[] = [];
    let totalEstimatedTokens = 0;
    let thinking: import('@/core/types').ThinkingConfig | undefined;

    for (const component of selectedComponents) {
      try {
        const rendered = await component.render(context);
        if (rendered) {
          parts.push(rendered);
          componentIds.push(component.id);
          totalEstimatedTokens += component.estimatedTokens;

          if (component.requiredTools) {
            allRequiredTools.push(...component.requiredTools);
          }
          if (component.thinking && !thinking) {
            thinking = component.thinking;
          }
        }
      } catch (error) {
        log.warn(`Failed to render component "${component.id}":`, error);
      }
    }

    const prompt = parts.join('\n\n');
    const requiredTools = [...new Set(allRequiredTools)];

    log.info(
      `Prompt built: ${componentIds.length} components, ~${totalEstimatedTokens} tokens, ` +
      `scene=${scene}, complexity=${complexity}`,
    );

    return {
      prompt,
      components: componentIds,
      scene,
      complexity,
      requiredTools,
      thinking,
      estimatedTokens: totalEstimatedTokens,
    };
  }

  /**
   * 根据场景和复杂度选择组件
   */
  private selectComponents(scene: SceneType, complexity: IntentComplexity): PromptComponent[] {
    const selected: PromptComponent[] = [];

    for (const component of this.components.values()) {
      if (this.shouldInclude(component, scene, complexity)) {
        selected.push(component);
      }
    }

    // 按 priority 降序排列
    selected.sort((a, b) => b.priority - a.priority);
    return selected;
  }

  /**
   * 判断组件是否应该包含
   */
  private shouldInclude(
    component: PromptComponent,
    scene: SceneType,
    complexity: IntentComplexity,
  ): boolean {
    const { layer } = component;

    // L0: 始终加载
    if (layer === 'L0') return true;

    // L1: standard/complex 加载，且场景匹配
    if (layer === 'L1') {
      if (complexity === 'simple') return false;
      if (component.scenes && !component.scenes.includes(scene)) return false;
      return true;
    }

    // L2: 仅 complex 加载
    if (layer === 'L2') {
      return complexity === 'complex';
    }

    // L3: 始终加载
    if (layer === 'L3') return true;

    return false;
  }

  /**
   * 注册默认组件
   */
  private registerDefaults(): void {
    // L0
    this.register(l0Identity);
    this.register(l0Safety);
    // L1
    this.register(l1Coding);
    this.register(l1Life);
    // L2
    this.register(l2Planning);
    this.register(l2AgentRules);
    this.register(l2Safety);
    // L3
    this.register(l3Project);
  }

  // ─── Getters ────────────────────────────────────────

  getScene(): SceneType | null {
    return this.currentScene;
  }

  getComplexity(): IntentComplexity {
    return this.currentComplexity;
  }

  getIntentAnalyzer(): IntentAnalyzer {
    return this.intentAnalyzer;
  }

  /** 获取所有可用场景（从已注册的 L1 组件中提取） */
  getAvailableScenes(): SceneType[] {
    const scenes = new Set<SceneType>();
    for (const component of this.components.values()) {
      if (component.layer === 'L1' && component.scenes) {
        for (const scene of component.scenes) {
          scenes.add(scene);
        }
      }
    }
    return Array.from(scenes);
  }

  /** 获取场景描述（给 SceneMatcher 兼容用） */
  getSceneDescription(scene: SceneType): string {
    for (const component of this.components.values()) {
      if (component.layer === 'L1' && component.scenes?.includes(scene) && component.match) {
        return component.match.description;
      }
    }
    return '';
  }

  /** 重置状态（新会话时调用） */
  reset(): void {
    this.currentScene = null;
    this.currentComplexity = 'standard';
    this.intentAnalyzer.reset();
  }
}
