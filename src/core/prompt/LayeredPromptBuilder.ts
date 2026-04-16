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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PromptComponent,
  PromptBuildContext,
  PromptBuildResult,
  LayeredPromptBuildOptions,
  SceneType,
  IntentComplexity,
} from './types';
import { IntentAnalyzer } from './IntentAnalyzer';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LayeredPromptBuilder' });

export class LayeredPromptBuilder {
  private components: Map<string, PromptComponent> = new Map();
  private intentAnalyzer: IntentAnalyzer;
  private currentScene: SceneType | null = null;
  private currentComplexity: IntentComplexity = 'standard';
  private componentsLoaded = false;

  constructor(intentAnalyzer?: IntentAnalyzer) {
    this.intentAnalyzer = intentAnalyzer ?? new IntentAnalyzer();
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
   * 初始化：扫描 components/ 目录自动注册所有组件，预计算 embeddings
   */
  async init(): Promise<void> {
    if (!this.componentsLoaded) {
      await this.loadComponents();
      this.componentsLoaded = true;
    }
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
   * 扫描 components/ 目录，自动注册所有 PromptComponent。
   *
   * 约定：components/ 下每个 .ts/.js 文件可导出任意数量的 PromptComponent，
   * 只要导出值满足 { id, layer, render } 即可被自动识别并注册。
   * 新增场景只需新建 l1-xxx.ts，无需修改本文件。
   */
  private async loadComponents(): Promise<void> {
    // 兼容 ESM（import.meta.url）和 CommonJS（__dirname）
    const selfUrl = typeof __filename !== 'undefined'
      ? __filename
      : fileURLToPath(import.meta.url);
    const componentsDir = path.join(path.dirname(selfUrl), 'components');

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(componentsDir, { withFileTypes: true });
    } catch {
      log.warn('components/ directory not found, no components loaded');
      return;
    }

    const fileExts = new Set(['.ts', '.js', '.mjs']);

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!fileExts.has(ext)) continue;
      // 跳过 index 文件（只是聚合导出，组件本体在各自文件中）
      if (entry.name === 'index.ts' || entry.name === 'index.js') continue;

      const filePath = path.join(componentsDir, entry.name);
      try {
        const mod = await import(filePath);
        for (const value of Object.values(mod)) {
          if (this.isPromptComponent(value)) {
            this.register(value);
          }
        }
      } catch (err) {
        log.warn(`Failed to load component file ${entry.name}:`, err);
      }
    }

    log.info(`Loaded ${this.components.size} prompt components from ${componentsDir}`);
  }

  /**
   * 判断一个值是否符合 PromptComponent 接口
   */
  private isPromptComponent(value: unknown): value is PromptComponent {
    return (
      value !== null &&
      typeof value === 'object' &&
      typeof (value as any).id === 'string' &&
      typeof (value as any).layer === 'string' &&
      typeof (value as any).render === 'function' &&
      typeof (value as any).priority === 'number'
    );
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

  /**
   * 为子 Agent 构建 Prompt
   *
   * 构建逻辑：
   * 1. 加载 L0 基础层（base-identity + base-memory-guide + base-task-execution）
   * 2. 加载角色专用 prompt（agentConfig.systemPrompt）
   * 3. 可选加载 L3 项目层（如果 includeProjectContext = true）
   *
   * @param options 构建选项
   * @returns 构建结果
   */
  async buildForSubAgent(options: {
    agentId: string;
    agentConfig: any; // ConfigurableAgentConfig
    includeProjectContext?: boolean;
    parentContext?: PromptBuildContext;
  }): Promise<PromptBuildResult> {
    const { agentId, agentConfig, includeProjectContext = false, parentContext } = options;

    if (!this.componentsLoaded) {
      await this.init();
    }

    const context: PromptBuildContext = {
      language: parentContext?.language || 'zh',
      toolList: parentContext?.toolList || [],
      config: parentContext?.config,
    };

    const selectedComponents: PromptComponent[] = [];
    const requiredTools = new Set<string>();
    let thinking: any = undefined;
    let estimatedTokens = 0;

    // 1. 加载 L0 基础层（base-identity, base-memory-guide, base-task-execution）
    const baseComponents = ['base-identity', 'base-memory-guide', 'base-task-execution'];
    for (const componentId of baseComponents) {
      const component = this.components.get(componentId);
      if (component) {
        selectedComponents.push(component);
        estimatedTokens += component.estimatedTokens;
        if (component.requiredTools) {
          component.requiredTools.forEach((tool) => requiredTools.add(tool));
        }
        if (component.thinking && !thinking) {
          thinking = component.thinking;
        }
      }
    }

    // 2. 加载 L3 项目层（可选）
    if (includeProjectContext) {
      const l3Component = this.components.get('l3-project');
      if (l3Component) {
        selectedComponents.push(l3Component);
        estimatedTokens += l3Component.estimatedTokens;
        if (l3Component.requiredTools) {
          l3Component.requiredTools.forEach((tool) => requiredTools.add(tool));
        }
      }
    }

    // 3. 按优先级排序
    selectedComponents.sort((a, b) => b.priority - a.priority);

    // 4. 渲染所有组件
    const renderedParts: string[] = [];
    for (const component of selectedComponents) {
      try {
        const rendered = await component.render(context);
        if (rendered?.trim()) {
          renderedParts.push(rendered.trim());
        }
      } catch (err) {
        log.error(`Failed to render component ${component.id}:`, err);
      }
    }

    // 5. 添加角色专用 prompt（如果存在）
    if (agentConfig.systemPrompt && agentConfig.systemPrompt.trim()) {
      renderedParts.push(agentConfig.systemPrompt.trim());
      // 角色专用 prompt 预估 token 数（粗略估计）
      estimatedTokens += Math.ceil(agentConfig.systemPrompt.length / 4);
    }

    // 6. 合并为最终 prompt
    const finalPrompt = renderedParts.join('\n\n');

    log.debug(
      `Built prompt for sub-agent "${agentId}": ${selectedComponents.length} components, ~${estimatedTokens} tokens`,
    );

    return {
      prompt: finalPrompt,
      components: selectedComponents.map((c) => c.id),
      scene: null, // 子 Agent 不使用场景
      complexity: 'standard', // 子 Agent 默认 standard
      requiredTools: Array.from(requiredTools),
      thinking,
      estimatedTokens,
    };
  }
}
