/**
 * PromptStore - Prompt库（贾维斯架构）
 *
 * 职责：
 * 1. 统一管理所有场景的Prompt
 * 2. 集成LayeredPromptBuilder
 * 3. 支持动态参数替换
 *
 * 🎯 替代PromptOrchestrator，统一Prompt管理
 */

import type { LayeredPromptBuilder } from '../prompt/LayeredPromptBuilder';
import type { SceneType } from '../prompt/types';
import { getCodingSceneConfigs } from '@/core/prompt/components/l1-coding-scenes';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'PromptStore' });

/**
 * Prompt上下文
 */
export interface PromptContext {
  userInput?: string;
  memoryHint?: string;
  projectContext?: string;
  [key: string]: any;
}

/**
 * PromptStore - Prompt库
 */
export class PromptStore {
  private promptBuilder: LayeredPromptBuilder;
  private sceneConfigs: Map<string, any>;

  constructor(promptBuilder: LayeredPromptBuilder) {
    this.promptBuilder = promptBuilder;
    this.sceneConfigs = getCodingSceneConfigs();
    log.info(`PromptStore initialized with ${this.sceneConfigs.size} scenes`);
  }

  /**
   * 获取场景增强指令（不覆盖，只增强）
   */
  async getSceneEnhancement(scene: SceneType): Promise<string> {
    const config = this.sceneConfigs.get(scene);
    if (!config) {
      return '';
    }

    // 返回场景专业指令（用于增强内置 agent 的 systemPrompt）
    return `
# 当前场景：${scene}

${config.description}

请特别注意：
- 遵循场景的专业要求
- 使用合适的语气和风格
- 输出符合场景预期的结果
`;
  }

  /**
   * 获取场景Prompt（集成LayeredPromptBuilder）
   * @deprecated 不再使用，改用 getSceneEnhancement
   */
  async getPromptForScene(
    scene: SceneType,
    context?: PromptContext
  ): Promise<string> {
    try {
      // 使用LayeredPromptBuilder构建完整Prompt
      const prompt = await this.promptBuilder.build({
        scene,
        complexity: 'standard',
        memoryHint: context?.memoryHint,
        projectContext: context?.projectContext,
      });

      return prompt;
    } catch (error) {
      log.error(`Failed to build prompt for scene "${scene}":`, error);
      // 降级：返回默认Prompt
      return this.getDefaultPrompt();
    }
  }

  /**
   * 获取默认Prompt
   */
  private getDefaultPrompt(): string {
    return `你是Xuanji，一个专业的AI编程助手。

核心原则：
- 代码质量：输出可直接运行的代码
- 简洁明了：附带必要的解释
- 最佳实践：遵循语言规范和设计模式`;
  }

  /**
   * 获取所有场景列表
   */
  getAllScenes(): string[] {
    return Array.from(this.sceneConfigs.keys());
  }

  /**
   * 检查场景是否存在
   */
  hasScene(scene: string): boolean {
    return this.sceneConfigs.has(scene);
  }
}
