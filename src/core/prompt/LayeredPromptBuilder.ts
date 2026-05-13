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
import { PromptComponentRegistry } from './PromptComponentRegistry';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LayeredPromptBuilder' });

export class LayeredPromptBuilder {
  private components: Map<string, PromptComponent> = new Map();
  private listener: import('@/core/events/EventBus').Unsubscribe | null = null;
  private userRegistry: PromptComponentRegistry | null = null;
  private currentScene: SceneType | null = null;
  private currentComplexity: IntentComplexity = 'standard';
  private componentsLoaded = false;
  private eventListeners: PromptBuildEventListener[] = [];
  private agentId: string = 'main';
  private defaultComplexity: IntentComplexity = 'standard';
  private defaultScene: SceneType | null = null;

  constructor(
    userId?: string,
    projectRoot?: string,
    agentId?: string,
    options?: {
      defaultComplexity?: IntentComplexity;
      defaultScene?: SceneType;
    }
  ) {
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
            }
          }
          log.debug(`加载用户组件: ${id}`);
        }
      } else {
        log.warn('未提供 projectRoot，无法加载项目自定义组件');
      }
      this.componentsLoaded = true;
    }
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
 * 获取场景组件的完整 L1 内容（供 TaskTool/TeamTool 加载子 agent L1 prompt）
 * 
 * 主 agent 通过 list_scenes 工具查看可用 scene；子 agent 执行时通过此方法加载 L1 全文。
 */
async loadSceneContent(scene: string): Promise<string | null> {
  if (!this.componentsLoaded) {
    await this.init();
  }

  // 查找匹配该场景的 L1 组件
  const l1Components = Array.from(this.components.values()).filter(
    (c) => c.layer === 'L1' && c.scenes?.includes(scene)
  );

  if (l1Components.length === 0) {
    log.warn(`No L1 component found for scene: ${scene}`);
    return null;
  }

  // 取优先级最高的 L1 组件
  const component = l1Components.sort((a, b) => b.priority - a.priority)[0];
  try {
    const rendered = await component.render({});
    return rendered?.trim() || null;
  } catch (err) {
    log.error(`Failed to render L1 component for scene ${scene}:`, err);
    return null;
  }
}

/**
 * 构建 Prompt
 *
 * 主 agent 模式（默认）：只加载 L0 + scene 摘要列表，不加载 L1/L2
 * 子 agent 模式：通过 buildForSubAgent 或外部直接调用 loadSceneContent
 */
async build(options: LayeredPromptBuildOptions = {}): Promise<PromptBuildResult> {
  const { language = 'zh', toolList = [] } = options;

  // 发射构建开始事件
  this.emitEvent({
    type: 'build:start',
    timestamp: Date.now(),
    agentId: this.agentId,
    data: { options },
  });

  // 动态 prompt 构建：有 scene 时激活 L1/L2 分层，无 scene 时回退 L0+L3
  const scene = options.scene && options.scene !== 'auto' ? options.scene : null;
  const complexity: IntentComplexity = options.complexity || 'standard';

  log.debug(`Building main agent prompt: scene=${scene}, complexity=${complexity}`);

  // 加载组件
  const selectedComponents: PromptComponent[] = scene
    ? this.selectComponents(scene, complexity)
    : this.getDefaultComponents();
  const requiredTools = new Set<string>();
  let thinkingResult: import('@/core/types').ThinkingConfig | undefined;
  let estimatedTokens = 0;

  selectedComponents.sort((a, b) => b.priority - a.priority);

  const context: PromptBuildContext = {
    language,
    toolList,
    config: {
      ...options.config,
      userId: this.userRegistry?.getUserId(),
    },
  };

  const parts: string[] = [];
  const componentIds: string[] = [];

  for (const component of selectedComponents) {
    try {
      const rendered = await component.render(context);
      if (rendered) {
        parts.push(rendered);
        componentIds.push(component.id);
        estimatedTokens += component.estimatedTokens;
        if (component.requiredTools) {
          component.requiredTools.forEach((tool) => requiredTools.add(tool));
        }
        if (component.thinking && !thinkingResult) {
          thinkingResult = component.thinking;
        }
      }
    } catch (error) {
      log.warn(`Failed to render component "${component.id}":`, error);
    }
  }

  const prompt = parts.join('\n\n');
  const allRequiredTools = [...requiredTools];

  log.info(
    `Main agent prompt built: components=[${componentIds.join(', ')}], ~${estimatedTokens} tokens`,
  );

  const result: PromptBuildResult = {
    prompt,
    components: componentIds,
    scene,
    complexity,
    requiredTools: allRequiredTools,
    thinking: thinkingResult,
    estimatedTokens,
  };

  // 发射构建完成事件
  this.emitEvent({
    type: 'build:complete',
    timestamp: Date.now(),
    agentId: this.agentId,
    data: {
      totalComponents: componentIds.length,
      estimatedTokens,
      layers: this.groupComponentsByLayer(selectedComponents),
    },
  });

  return result;
}

  /**
   * 根据场景和复杂度选择组件
   */
  /**
   * 默认组件选择（L0 + L3，向后兼容）
   */
  private getDefaultComponents(): PromptComponent[] {
    const selected: PromptComponent[] = [];
    for (const component of this.components.values()) {
      if (component.layer === 'L0' || component.layer === 'L3') {
        selected.push(component);
      }
    }
    selected.sort((a, b) => b.priority - a.priority);
    return selected;
  }

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
   * 判断 scene 是否匹配组件的 scenes 列表。
   * 支持逗号分隔的多 scene 字符串（如 "coding,debugging"），
   * 只要任一 scene 命中组件就返回 true。
   */
  private sceneMatches(componentScenes: SceneType[] | undefined, routeScene: SceneType | null): boolean {
    if (!routeScene) return false;
    if (!componentScenes || componentScenes.length === 0) return true; // 未指定 scenes 的组件匹配所有场景
    const inputScenes = routeScene.split(',').map((s) => s.trim()).filter(Boolean);
    return inputScenes.some((s) => componentScenes.includes(s as SceneType));
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
      if (!scene) return false;
      if (component.scenes && !this.sceneMatches(component.scenes, scene)) return false;
      return true;
    }

    // L2: 仅 complex 加载，且场景匹配（如果指定了 scenes）
    if (layer === 'L2') {
      if (complexity !== 'complex') {
        if (component.id === 'l2-team-coordination') {
          log.debug(`[LayeredPromptBuilder] ❌ Skipping ${component.id}: complexity=${complexity} (need complex)`);
        }
        return false;
      }

      if (component.scenes && component.scenes.length > 0) {
        if (!scene) return false;
        if (!this.sceneMatches(component.scenes, scene)) return false;
      }

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

  /** 获取 scene 的关键词正则字符串（供 SceneClassifier 注入 prompt） */
  getSceneKeywords(scene: SceneType): string {
    for (const component of this.components.values()) {
      if (component.layer === 'L1' && component.scenes?.includes(scene) && component.match) {
        return component.match.keywords.source;
      }
    }
    return '';
  }

  /** 重置状态（新会话时调用） */
  reset(): void {
    this.currentScene = null;
    this.currentComplexity = 'standard';
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
