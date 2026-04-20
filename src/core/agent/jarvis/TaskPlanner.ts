/**
 * TaskPlanner - 任务规划器（贾维斯架构）
 *
 * 职责：
 * 1. 将意图转换为可执行的任务计划
 * 2. 智能拆分复杂任务
 * 3. 识别任务依赖关系
 * 4. 推荐最佳执行策略
 *
 * 🎯 Agent 和 Scene 完全解耦：
 * - Agent：执行者（coder/explore/plan/general-purpose）
 * - Scene：场景增强Prompt（write_code/debug/review...）
 * - 两者可以任意组合
 */

import type { ILLMProvider } from '@/core/types';
import type { Intent, IntentComplexity } from '@/core/intent/types';
import type { SceneType } from '@/core/prompt/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TaskPlanner' });

/**
 * 子任务定义
 */
export interface SubTask {
  id: string;
  agentId: string;  // 执行者：coder | explore | plan | general-purpose
  scene: SceneType; // 场景增强：write_code | debug | review | test | ...
  description: string;
  systemPrompt?: string;
  priority?: number;
  dependencies?: string[];
}

/**
 * 任务计划
 */
export interface TaskPlan {
  strategy: 'single' | 'sequential' | 'parallel' | 'hierarchical' | 'debate' | 'pipeline';
  tasks: SubTask[];
  goal: string;
  reasoning?: string;
}

/**
 * Agent 选择策略配置
 */
export interface AgentSelectionConfig {
  /** 默认 Agent（当无法匹配时使用） */
  defaultAgent: string;
  /** 场景到 Agent 的推荐映射（可选） */
  sceneToAgentHints?: Record<string, string>;
}

/**
 * TaskPlanner - 任务规划器
 */
export class TaskPlanner {
  private provider: ILLMProvider;
  private config: AgentSelectionConfig;

  constructor(
    provider: ILLMProvider,
    config?: AgentSelectionConfig
  ) {
    this.provider = provider;
    this.config = {
      defaultAgent: 'coder',
      sceneToAgentHints: {
        // 这只是推荐，不是强制绑定
        'explore': 'explore',
        'plan': 'plan',
        'explain': 'general-purpose',
      },
      ...config,
    };
  }

  /**
   * 规划任务执行方案
   */
  async plan(
    intent: Intent | null,
    scene: SceneType,
    complexity: IntentComplexity,
    userInput: string
  ): Promise<TaskPlan> {
    // 简单任务：直接执行
    if (complexity === 'simple' || complexity === 'standard') {
      return this.createSimplePlan(intent, scene, userInput);
    }

    // 复杂任务：智能拆分
    return this.createComplexPlan(intent, scene, userInput);
  }

  /**
   * 创建简单任务计划
   */
  private createSimplePlan(
    intent: Intent | null,
    scene: SceneType,
    userInput: string
  ): TaskPlan {
    // 根据场景推荐 Agent（可配置）
    const agentId = this.selectAgentForScene(scene);

    return {
      strategy: 'single',
      goal: userInput,
      tasks: [{
        id: 'task-1',
        agentId,    // Agent：执行者
        scene,      // Scene：场景增强Prompt
        description: userInput,
        priority: 10,
      }],
    };
  }

  /**
   * 创建复杂任务计划（调用LLM拆分）
   */
  private async createComplexPlan(
    intent: Intent | null,
    scene: SceneType,
    userInput: string
  ): Promise<TaskPlan> {
    const prompt = `你是任务规划专家，将复杂编程任务拆分为可执行的子任务。

用户需求：${userInput}

拆分原则：
1. 每个子任务职责单一、可独立执行
2. 识别任务间的依赖关系
3. 推荐最佳执行策略
4. 为每个子任务选择合适的 Agent 和 Scene

🎯 Agent 和 Scene 的区别：
- Agent：执行者（谁来做）
- Scene：场景增强Prompt（怎么做）
- 两者可以任意组合

可用 Agent（执行者）：
- coder: 通用编程 Agent，能处理代码编写、调试、审查、测试、重构
- explore: 代码探索 Agent，擅长快速定位文件和理解项目结构
- plan: 方案设计 Agent，擅长架构设计和技术选型
- general-purpose: 通用 Agent，处理讲解、解释等非编程任务

可用 Scene（场景增强）：
- write_code: 写代码场景（严谨、低温度、可直接运行）
- debug: 调试场景（细致、步骤清晰、定位根因）
- review: 审查场景（批判性、关注质量和安全）
- test: 测试场景（全面、覆盖边界情况）
- refactor: 重构场景（改进结构、保持功能）
- explain: 讲解场景（通俗易懂、循序渐进）
- explore: 探索场景（快速定位、理解架构）
- plan: 规划场景（结构化、架构清晰）

推荐组合示例：
- 写代码：agentId='coder', scene='write_code'
- 调试：agentId='coder', scene='debug'
- 审查：agentId='coder', scene='review'
- 探索代码库：agentId='explore', scene='explore'
- 方案设计：agentId='plan', scene='plan'
- 讲解原理：agentId='general-purpose', scene='explain'

可用策略：
- sequential: 串行执行（任务有依赖）
- parallel: 并行执行（任务独立）
- hierarchical: 层级执行（planner规划 + workers执行）
- pipeline: 流水线（数据流式处理）

输出JSON格式：
{
  "strategy": "sequential",
  "tasks": [
    {
      "id": "task-1",
      "agentId": "plan",
      "scene": "plan",
      "description": "设计用户系统架构",
      "priority": 10
    },
    {
      "id": "task-2",
      "agentId": "coder",
      "scene": "write_code",
      "description": "实现用户注册接口",
      "dependencies": ["task-1"],
      "priority": 8
    }
  ],
  "reasoning": "选择sequential策略，因为需要先规划架构，再实现功能"
}`;

    try {
      const response = await this.provider.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        maxTokens: 2000,
      });

      const content = typeof response === 'string' ? response : response.content;
      const plan = JSON.parse(content);

      log.info(`Complex task decomposed: ${plan.tasks.length} tasks, strategy=${plan.strategy}`);

      return {
        ...plan,
        goal: userInput,
      };
    } catch (error) {
      log.error(`LLM decompose failed:`, error);
      // 降级：返回简单计划
      return this.createSimplePlan(intent, scene, userInput);
    }
  }

  /**
   * 为场景推荐 Agent（可配置，不强制绑定）
   */
  private selectAgentForScene(scene: SceneType): string {
    // 优先使用配置的推荐映射
    if (this.config.sceneToAgentHints?.[scene]) {
      return this.config.sceneToAgentHints[scene];
    }

    // 默认使用 coder（通用编程 Agent）
    return this.config.defaultAgent;
  }

  /**
   * 更新 Agent 选择配置
   */
  updateConfig(config: Partial<AgentSelectionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
