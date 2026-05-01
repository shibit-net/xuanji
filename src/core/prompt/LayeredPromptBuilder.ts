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
  PromptBuildEventListener,
  PromptBuildEvent,
} from './types';
import { IntentAnalyzer } from './IntentAnalyzer';
import { PromptComponentRegistry } from './PromptComponentRegistry';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LayeredPromptBuilder' });

export class LayeredPromptBuilder {
  private components: Map<string, PromptComponent> = new Map();
  private intentAnalyzer: IntentAnalyzer;
  private userRegistry: PromptComponentRegistry | null = null;
  private currentScene: SceneType | null = null;
  private currentComplexity: IntentComplexity = 'standard';
  private componentsLoaded = false;
  private eventListeners: PromptBuildEventListener[] = [];
  private agentId: string = 'main';
  private defaultComplexity: IntentComplexity = 'standard';
  private defaultScene: SceneType | null = null;

  constructor(
    intentAnalyzer?: IntentAnalyzer,
    userId?: string,
    projectRoot?: string,
    agentId?: string,
    options?: {
      defaultComplexity?: IntentComplexity;
      defaultScene?: SceneType;
    }
  ) {
    this.intentAnalyzer = intentAnalyzer ?? new IntentAnalyzer();
    if (agentId) this.agentId = agentId;
    if (options?.defaultComplexity) this.defaultComplexity = options.defaultComplexity;
    if (options?.defaultScene) this.defaultScene = options.defaultScene;
    // 如果提供了 userId，创建用户+项目组件注册表
    if (userId) {
      this.userRegistry = new PromptComponentRegistry(userId, projectRoot);
    }
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: PromptBuildEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: PromptBuildEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * 发射事件
   */
  private emitEvent(event: PromptBuildEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        log.error('事件监听器执行失败:', error);
      }
    }
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
   * 初始化：加载用户自定义组件，预计算 embeddings
   */
  async init(): Promise<void> {
    if (!this.componentsLoaded) {
      // 1. 注册必需的动态 TypeScript 组件
      const { l3Project } = await import('./components/l3-project');
      this.register(l3Project);

      // 2. 加载用户自定义组件（YAML 格式）
      if (this.userRegistry) {
        await this.userRegistry.init();

        // 监听组件变化
        this.userRegistry.addChangeListener((event) => {
          this.handleComponentChange(event);
        });

        // 合并用户组件到主注册表
        const userComponents = this.userRegistry.getComponents();
        for (const [id, component] of userComponents) {
          this.components.set(id, component);
          // 如果是 L1 组件且有 match 配置，注册到 IntentAnalyzer
          if (component.layer === 'L1' && component.match && component.scenes?.length) {
            for (const scene of component.scenes) {
              this.intentAnalyzer.registerScene(scene, component.match);
            }
          }
          log.debug(`加载用户组件: ${id}`);
        }
      } else {
        log.warn('未提供 projectRoot，无法加载项目自定义组件');
      }
      this.componentsLoaded = true;
    }
    await this.intentAnalyzer.init();
  }

  /**
   * 处理组件变化事件
   */
  private handleComponentChange(event: import('./PromptComponentRegistry').ComponentChangeEvent): void {
    log.info(`组件变化: ${event.type} - ${event.componentId}`);

    switch (event.type) {
      case 'added':
      case 'updated':
        if (event.component) {
          // 更新组件
          this.components.set(event.componentId, event.component);

          // 如果是 L1 组件且有 match 配置，更新 IntentAnalyzer
          if (event.component.layer === 'L1' && event.component.match && event.component.scenes?.length) {
            for (const scene of event.component.scenes) {
              this.intentAnalyzer.registerScene(scene, event.component.match);
            }
          }

          log.info(`组件已${event.type === 'added' ? '添加' : '更新'}: ${event.componentId}`);
        }
        break;

      case 'removed':
        // 移除组件
        this.components.delete(event.componentId);
        log.info(`组件已移除: ${event.componentId}`);
        break;
    }
  }

  /**
   * 构建 Prompt
   */
  async build(options: LayeredPromptBuildOptions = {}): Promise<PromptBuildResult> {
    const { userMessage, language = 'zh', toolList = [] } = options;

    // 发射构建开始事件
    this.emitEvent({
      type: 'build:start',
      timestamp: Date.now(),
      agentId: this.agentId,
      data: { userMessage, language },
    });

    // 1. 意图分析
    let scene: SceneType | null = null;
    let complexity: IntentComplexity = this.defaultComplexity;

    // 优先级：显式传入 > IntentAnalyzer 分析 > defaultScene 兜底
    if (options.scene && options.scene !== 'auto') {
      scene = options.scene;
    }

    if (options.complexity) {
      complexity = options.complexity;
    }

    let matchMethod: string | undefined = options.matchMethod;
    if (userMessage && (!scene || !options.complexity)) {
      // 转发 intentAnalyzer 的匹配过程事件
      this.intentAnalyzer.setEventCallback((evt) => {
        log.debug(`[LayeredPromptBuilder] 收到 intentAnalyzer 事件:`, evt);
        this.emitEvent({
          type: 'intent:match',
          timestamp: Date.now(),
          agentId: this.agentId,
          data: evt,
        });
        log.debug(`[LayeredPromptBuilder] 已转发 intent:match 事件`);
      });

      const analysis = await this.intentAnalyzer.analyze(
        userMessage,
        !this.currentScene, // isFirstTurn
      );

      // 清除回调
      this.intentAnalyzer.setEventCallback(undefined as any);

      if (!scene) scene = analysis.scene;
      if (!options.complexity) complexity = analysis.complexity;
      matchMethod = analysis.matchMethod;
    }

    // 如果分析后仍为 null，不设置默认场景（让主 Agent 自己决策）
    // 这样 L1 组件不会被加载，主 Agent 会使用 list_agents/match_agent 工具
    if (!scene) {
      log.debug('No scene matched, main agent will decide autonomously');
    }

    this.currentScene = scene;
    this.currentComplexity = complexity;

    log.debug(`Building prompt: scene=${scene}, complexity=${complexity}`);

    // 发射意图分析完成事件
    this.emitEvent({
      type: 'intent:analyzed',
      timestamp: Date.now(),
      agentId: this.agentId,
      data: { scene, complexity, matchMethod, agent: options.agent },
    });

    // 2. 选择组件
    const selectedComponents = this.selectComponents(scene, complexity);

    // 🔍 调试日志：打印选择的组件详情
    log.debug(`[LayeredPromptBuilder] 🎯 Selected ${selectedComponents.length} components for scene=${scene}, complexity=${complexity}`);
    selectedComponents.forEach((c) => {
      log.debug(`[LayeredPromptBuilder]   - ${c.layer}/${c.id} (${c.name}) [${c.source}]`);
    });

    // 发射组件选择完成事件
    this.emitEvent({
      type: 'components:selected',
      timestamp: Date.now(),
      agentId: this.agentId,
      data: {
        components: selectedComponents.map((c) => ({
          id: c.id,
          name: c.name,
          layer: c.layer,
          source: c.source,
        })),
      },
    });

    // 3. 构建上下文
    const context: PromptBuildContext = {
      language,
      toolList,
      config: {
        ...options.config,
        userId: this.userRegistry?.getUserId(),
      },
    };

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
      `Prompt built: scene=${scene}, complexity=${complexity}, components=[${componentIds.join(', ')}], ~${totalEstimatedTokens} tokens`,
    );

    const result = {
      prompt,
      components: componentIds,
      scene,
      complexity,
      requiredTools,
      thinking,
      estimatedTokens: totalEstimatedTokens,
    };

    // 发射构建完成事件
    this.emitEvent({
      type: 'build:complete',
      timestamp: Date.now(),
      agentId: this.agentId,
      data: {
        totalComponents: componentIds.length,
        estimatedTokens: totalEstimatedTokens,
        scene,
        complexity,
        layers: this.groupComponentsByLayer(selectedComponents),
      },
    });

    return result;
  }

  /**
   * 根据场景和复杂度选择组件
   */
  private selectComponents(scene: SceneType | null, complexity: IntentComplexity): PromptComponent[] {
    const selected: PromptComponent[] = [];

    for (const component of this.components.values()) {
      if (this.shouldInclude(component, scene, complexity)) {
        selected.push(component);
      }
    }

    // 如果有 scene 但没有匹配到任何 L1 组件，记录警告
    if (scene) {
      const l1Components = selected.filter((c) => c.layer === 'L1');
      if (l1Components.length === 0) {
        log.warn(`Scene "${scene}" matched no L1 components. Available L1 scenes:`, this.getAvailableScenes());
      }
    }

    // 按 priority 降序排列
    selected.sort((a, b) => b.priority - a.priority);
    return selected;
  }

  /**
   * 按层级分组组件
   */
  private groupComponentsByLayer(components: PromptComponent[]): Array<{ layer: number; components: Array<{ id: string; name: string }> }> {
    const layerMap = new Map<string, Array<{ id: string; name: string }>>();

    for (const component of components) {
      const layerNum = component.layer.replace('L', '');
      if (!layerMap.has(layerNum)) {
        layerMap.set(layerNum, []);
      }
      layerMap.get(layerNum)!.push({ id: component.id, name: component.name });
    }

    return Array.from(layerMap.entries())
      .map(([layer, components]) => ({
        layer: parseInt(layer, 10),
        components,
      }))
      .sort((a, b) => a.layer - b.layer);
  }

  /**
   * 判断组件是否应该包含
   */
  private shouldInclude(
    component: PromptComponent,
    scene: SceneType | null,
    complexity: IntentComplexity,
  ): boolean {
    const { layer } = component;

    // L0: 始终加载
    if (layer === 'L0') return true;

    // L1: standard/complex 加载，且场景匹配
    if (layer === 'L1') {
      if (complexity === 'simple') return false;
      // 如果 scene 为 null（主 Agent 自己决策），不加载任何 L1 组件
      if (!scene) return false;
      if (component.scenes && !component.scenes.includes(scene)) return false;
      return true;
    }

    // L2: 仅 complex 加载，且场景匹配（如果指定了 scenes）
    if (layer === 'L2') {
      if (complexity !== 'complex') {
        // 🔍 调试日志：L2 组件因 complexity 不匹配被过滤
        if (component.id === 'l2-team-coordination') {
          log.debug(`[LayeredPromptBuilder] ❌ Skipping ${component.id}: complexity=${complexity} (need complex)`);
        }
        return false;
      }

      // 如果 L2 组件指定了 scenes，则需要场景匹配
      if (component.scenes && component.scenes.length > 0) {
        // 如果当前没有识别出场景，不加载场景特定的 L2 组件
        if (!scene) return false;
        // 当前场景必须在 scenes 列表中
        if (!component.scenes.includes(scene)) return false;
      }

      // 如果 L2 组件没有指定 scenes，则为通用组件，在所有 complex 任务时加载
      // 🔍 调试日志：L2 组件通过检查
      if (component.id === 'l2-team-coordination') {
        log.debug(`[LayeredPromptBuilder] ✅ Loading ${component.id}: complexity=${complexity}, scene=${scene}`);
      }
      return true;
    }

    // L3: 始终加载（但组件内部会判断是否真的是项目）
    if (layer === 'L3') return true;

    return false;
  }

  // ─── 移除 loadComponents() 方法，不再自动加载 TypeScript 组件 ───
  // 所有组件现在都从用户目录加载（.xuanji/users/{userId}/prompts/）

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

  /** 释放资源 */
  dispose(): void {
    if (this.userRegistry) {
      this.userRegistry.dispose();
    }
  }

  /**
   * 为子 Agent 构建 Prompt
   *
   * 构建逻辑：
   * 1. 加载 L0 基础层（base-identity + base-task-execution，来自 YAML）
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

    // 1. 加载 L0 基础层（base-identity, base-task-execution，来自 YAML）
    const baseComponents = ['base-identity', 'base-task-execution'];
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

  /** 获取所有组件（用于 GUI 管理） */
  getAllComponents(): PromptComponent[] {
    return Array.from(this.components.values());
  }

  /** 切换组件启用/禁用 */
  async toggleComponent(id: string, enabled: boolean): Promise<void> {
    const component = this.components.get(id);
    if (!component) {
      throw new Error(`Component not found: ${id}`);
    }
    component.enabled = enabled;
    if (this.userRegistry) {
      await this.userRegistry.saveComponent(component);
    }
    log.info(`Component ${id} ${enabled ? 'enabled' : 'disabled'}`);
  }

  /** 更新组件内容或 keywords */
  async updateComponent(id: string, updates: { content?: string; keywords?: string }): Promise<void> {
    const component = this.components.get(id);
    if (!component) {
      throw new Error(`Component not found: ${id}`);
    }

    if (updates.content !== undefined) {
      (component as any).content = updates.content;
    }

    if (updates.keywords !== undefined && component.match) {
      try {
        // 更新 keywords 正则
        component.match.keywords = new RegExp(updates.keywords, 'i');
        log.info(`Component ${id} keywords updated: ${updates.keywords}`);
      } catch (err) {
        throw new Error(`Invalid regex pattern: ${updates.keywords}`);
      }
    }

    if (this.userRegistry) {
      await this.userRegistry.saveComponent(component);
    }
    log.info(`Component ${id} updated`);
  }

  /** 获取场景组件（用于获取 collaborationHint） */
  async getSceneComponent(scene: string): Promise<{ collaborationHint?: string } | null> {
    // 查找匹配该场景的 L1 组件
    const sceneComponents = Array.from(this.components.values()).filter(
      (c) => c.layer === 'L1' && c.scenes?.includes(scene)
    );

    if (sceneComponents.length === 0) {
      return null;
    }

    // 返回优先级最高的组件
    const component = sceneComponents.sort((a, b) => b.priority - a.priority)[0];

    // 从 userRegistry 获取完整配置（包含 collaborationHint）
    if (this.userRegistry) {
      try {
        const config = await this.userRegistry.getComponentConfig(component.id);
        return { collaborationHint: config?.collaborationHint };
      } catch (err) {
        log.warn(`Failed to load component config for ${component.id}:`, err);
      }
    }

    return null;
  }
}
