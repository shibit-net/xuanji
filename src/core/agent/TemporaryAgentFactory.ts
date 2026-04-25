/**
 * ============================================================
 * TemporaryAgentFactory - 临时 Agent 工厂
 * ============================================================
 *
 * 当 match_agent 无法找到合适的 Agent 时（score < 0.5），
 * 动态创建临时 Agent 来完成任务。
 *
 * 临时 Agent 的特点：
 * - 不保存到配置文件
 * - 任务完成后自动清理
 * - 使用通用的 systemPrompt 模板
 * - 可以动态创建临时 Scene
 */

import type { ConfigurableAgentConfig } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TemporaryAgentFactory' });

/**
 * 临时 Agent 创建选项
 */
export interface TemporaryAgentOptions {
  /** 角色名称（如 "Technical Writer", "Data Analyst"） */
  role: string;
  /** 需要的能力列表 */
  capabilities: string[];
  /** 关联的场景 ID（可选，如果没有合适的场景，会动态创建） */
  scene?: string;
  /** 任务描述（用于生成更精准的 prompt） */
  taskDescription?: string;
  /** 使用的模型（可选，默认使用系统配置） */
  model?: string;
  /** 父agent配置（用于继承provider配置） */
  parentConfig?: ConfigurableAgentConfig;
}

/**
 * 临时 Scene 配置
 */
export interface TemporarySceneConfig {
  id: string;
  name: string;
  content: string;
}

/**
 * 临时 Agent 工厂
 */
export class TemporaryAgentFactory {
  private temporaryAgents = new Map<string, ConfigurableAgentConfig>();
  private temporaryScenes = new Map<string, TemporarySceneConfig>();

  /**
   * 创建临时 Agent
   */
  createTemporaryAgent(options: TemporaryAgentOptions): ConfigurableAgentConfig {
    const { role, capabilities, scene, taskDescription, model, parentConfig } = options;

    // 生成临时 ID
    const tempId = `temp-${role.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    log.info(`创建临时 Agent: ${tempId} (${role})`);

    // 生成 systemPrompt
    const systemPrompt = this.generateSystemPrompt(role, capabilities, taskDescription);

    // 🔧 从父agent继承完整的provider配置（支持所有类型：anthropic、openai、ollama等）
    const provider = parentConfig?.provider
      ? {
          ...parentConfig.provider, // 继承所有provider字段
        }
      : {
          adapter: 'anthropic', // 默认使用anthropic
        };

    log.info(`临时 Agent provider 配置:`, {
      adapter: provider.adapter,
      hasApiKey: !!provider.apiKey,
      hasBaseURL: !!provider.baseURL,
    });

    // 创建临时 Agent 配置
    const tempAgent: ConfigurableAgentConfig = {
      id: tempId,
      name: role,
      description: `临时创建的 ${role}，用于完成特定任务`,
      avatar: '🤖',
      color: 'from-gray-500 to-gray-600',
      category: 'custom',
      model: {
        primary: model || 'claude-sonnet-4-6',
        maxTokens: 64000,
        thinking: {
          type: 'adaptive',
          effort: 'medium',
        },
      },
      provider,  // 🔧 使用继承的provider配置
      systemPrompt,
      capabilities,
      tools: [
        // 🔧 临时agent默认只有只读工具，危险工具需要父agent明确授予
        { name: 'read_file', required: true },
        { name: 'grep', required: true },
        { name: 'glob', required: true },
      ],
      execution: {
        mode: 'react',
        maxIterations: 20,
        timeout: 600000,
        streaming: true,
        parallelTools: true,
      },
      permissions: {
        fileRead: 'always',
        fileWrite: 'ask',
        bashExec: 'ask',
        network: 'ask',
        allowedPaths: [],
        deniedPaths: [],
        allowedCommands: [],
        deniedCommands: [],
      },
      enabled: true,
      metadata: {
        isTemporary: true,
        createdAt: new Date().toISOString(),
        scene,
      },
    };

    // 缓存临时 Agent
    this.temporaryAgents.set(tempId, tempAgent);

    return tempAgent;
  }

  /**
   * 生成临时 Agent 的 systemPrompt
   */
  private generateSystemPrompt(
    role: string,
    capabilities: string[],
    taskDescription?: string
  ): string {
    const prompt = `你是一位 ${role}。

## 核心职责

${capabilities.map(cap => `- ${cap}`).join('\n')}

## 工作原则

- 专注于你的职责范围
- 提供高质量的输出
- 遵循最佳实践
- 清晰明了地表达

## 工作方式

你会根据任务需求，采用合适的方法完成工作。
具体的场景指导会通过 Scene 动态加载。

${taskDescription ? `\n## 当前任务\n\n${taskDescription}\n` : ''}`;

    return prompt.trim();
  }

  /**
   * 创建临时 Scene
   */
  createTemporaryScene(role: string, capabilities: string[]): TemporarySceneConfig {
    const sceneId = `temp-scene-${role.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    log.info(`创建临时 Scene: ${sceneId} (${role})`);

    const content = `# ${role} 场景

## 思维框架

1. 理解任务需求
2. 制定执行计划
3. 完成任务
4. 验证结果

## 核心原则

- 质量优先
- 清晰明了
- 符合规范

## 工作流程

1. **分析需求**：仔细理解任务要求
2. **执行任务**：按照最佳实践完成工作
3. **输出结果**：提供完整、准确的输出

## 能力要求

${capabilities.map(cap => `- ${cap}`).join('\n')}
`;

    const sceneConfig: TemporarySceneConfig = {
      id: sceneId,
      name: `${role} Scene`,
      content: content.trim(),
    };

    // 缓存临时 Scene
    this.temporaryScenes.set(sceneId, sceneConfig);

    return sceneConfig;
  }

  /**
   * 获取临时 Agent
   */
  getTemporaryAgent(id: string): ConfigurableAgentConfig | undefined {
    return this.temporaryAgents.get(id);
  }

  /**
   * 获取临时 Scene
   */
  getTemporaryScene(id: string): TemporarySceneConfig | undefined {
    return this.temporaryScenes.get(id);
  }

  /**
   * 清理临时 Agent
   */
  cleanupTemporaryAgent(id: string): void {
    if (this.temporaryAgents.has(id)) {
      log.info(`清理临时 Agent: ${id}`);
      this.temporaryAgents.delete(id);
    }
  }

  /**
   * 清理临时 Scene
   */
  cleanupTemporaryScene(id: string): void {
    if (this.temporaryScenes.has(id)) {
      log.info(`清理临时 Scene: ${id}`);
      this.temporaryScenes.delete(id);
    }
  }

  /**
   * 清理所有临时资源
   */
  cleanupAll(): void {
    log.info(`清理所有临时资源: ${this.temporaryAgents.size} 个 Agent, ${this.temporaryScenes.size} 个 Scene`);
    this.temporaryAgents.clear();
    this.temporaryScenes.clear();
  }

  /**
   * 检查是否是临时 Agent
   */
  isTemporaryAgent(id: string): boolean {
    return id.startsWith('temp-') || this.temporaryAgents.has(id);
  }

  /**
   * 获取所有临时 Agent
   */
  getAllTemporaryAgents(): ConfigurableAgentConfig[] {
    return Array.from(this.temporaryAgents.values());
  }

  /**
   * 获取所有临时 Scene
   */
  getAllTemporaryScenes(): TemporarySceneConfig[] {
    return Array.from(this.temporaryScenes.values());
  }
}
