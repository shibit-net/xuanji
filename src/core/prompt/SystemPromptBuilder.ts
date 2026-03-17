/**
 * ============================================================
 * SystemPromptBuilder — System Prompt 组装器
 * ============================================================
 * 将 System Prompt 的组装从 SkillRegistry 中分离出来，
 * 让 Skill 回归"具体技能"的本质。
 *
 * 职责：
 * 1. 管理 Core Blocks（identity, memory, tool-guidance, security, agent-rules）
 * 2. 管理 Scene Templates（coding, life）
 * 3. 根据场景选择动态组装 System Prompt
 * 4. 提供工具需求和 thinking 配置（给 DynamicToolFilter 和 AgentLoop 用）
 */

import type { PromptBlock, SceneTemplate, SceneType, PromptBuildOptions, PromptBuildContext } from './types';
import { identityBlock, memoryBlock, toolGuidanceBlock, securityBlock, agentRulesBlock } from './blocks/index';
import { codingScene, lifeScene } from './scenes/index';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SystemPromptBuilder' });

/**
 * SystemPromptBuilder — System Prompt 组装器
 */
export class SystemPromptBuilder {
  private coreBlocks: PromptBlock[];
  private scenes: Map<SceneType, SceneTemplate>;
  private currentScene: SceneType | null = null;

  constructor() {
    // 注册 Core Blocks（按 priority 降序）
    this.coreBlocks = [
      identityBlock,      // 100
      memoryBlock,        // 95
      securityBlock,      // 85
      toolGuidanceBlock,  // 80
      agentRulesBlock,    // 80
    ].sort((a, b) => b.priority - a.priority);

    // 注册 Scene Templates
    this.scenes = new Map([
      ['coding', codingScene],
      ['life', lifeScene],
    ]);

    log.info(`SystemPromptBuilder initialized: ${this.coreBlocks.length} core blocks, ${this.scenes.size} scenes`);
  }

  /**
   * 构建完整 System Prompt
   *
   * @param options - 构建选项
   * @returns System Prompt 字符串
   */
  async build(options: PromptBuildOptions = {}): Promise<string> {
    const { scene = 'auto', language = 'zh', toolList = [] } = options;

    // 1. 确定场景
    const selectedScene = scene === 'auto' ? this.autoSelectScene() : scene;
    this.currentScene = selectedScene;

    log.debug(`Building system prompt: scene=${selectedScene}, language=${language}`);

    // 2. 构建上下文
    const context: PromptBuildContext = {
      language,
      toolList,
    };

    // 3. 渲染 Core Blocks
    const corePrompts: string[] = [];
    for (const block of this.coreBlocks) {
      try {
        const rendered = await block.render(context);
        if (rendered) {
          corePrompts.push(rendered);
        }
      } catch (error) {
        log.warn(`Failed to render block "${block.id}":`, error);
      }
    }

    // 4. 渲染 Scene Template（如果有）
    let scenePrompt = '';
    if (selectedScene) {
      const template = this.scenes.get(selectedScene);
      if (template) {
        try {
          scenePrompt = await template.render(context);
        } catch (error) {
          log.warn(`Failed to render scene "${selectedScene}":`, error);
        }
      }
    }

    // 5. 组装最终 prompt
    const parts = [...corePrompts];
    if (scenePrompt) {
      parts.push(scenePrompt);
    }

    const finalPrompt = parts.join('\n\n');
    log.info(`System prompt built: ${finalPrompt.length} chars, ${parts.length} parts`);

    return finalPrompt;
  }

  /**
   * 获取当前场景需要的工具列表（给 DynamicToolFilter 用）
   */
  getRequiredTools(): string[] {
    if (!this.currentScene) {
      return [];
    }

    const template = this.scenes.get(this.currentScene);
    return template?.requiredTools || [];
  }

  /**
   * 获取当前场景的 thinking 配置（给 AgentLoop 用）
   */
  getThinkingConfig(): import('@/core/types').ThinkingConfig | undefined {
    if (!this.currentScene) {
      return undefined;
    }

    const template = this.scenes.get(this.currentScene);
    return template?.thinking;
  }

  /**
   * 设置当前场景（由 SceneMatcher 调用）
   */
  setScene(scene: SceneType | null): void {
    this.currentScene = scene;
    log.debug(`Scene set to: ${scene || 'none'}`);
  }

  /**
   * 获取当前场景
   */
  getScene(): SceneType | null {
    return this.currentScene;
  }

  /**
   * 自动选择场景（默认策略：coding）
   * 实际场景选择由 SceneMatcher 负责，这里只是降级方案
   */
  private autoSelectScene(): SceneType {
    return 'coding';
  }

  /**
   * 获取所有可用场景
   */
  getAvailableScenes(): SceneType[] {
    return Array.from(this.scenes.keys());
  }

  /**
   * 获取场景描述（给 SceneMatcher 用于向量匹配）
   */
  getSceneDescription(scene: SceneType): string {
    const template = this.scenes.get(scene);
    return template?.description || '';
  }
}
