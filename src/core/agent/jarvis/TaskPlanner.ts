/**
 * TaskPlanner - 任务规划器（贾维斯架构）
 *
 * 职责：
 * 1. 将意图转换为可执行的任务计划
 * 2. 智能拆分复杂任务
 * 3. 识别任务依赖关系
 * 4. 推荐最佳执行策略
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
  agentId: string;  // coder | debugger | reviewer | tester | explainer | explorer | planner | refactorer
  scene: SceneType;
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
 * TaskPlanner - 任务规划器
 */
export class TaskPlanner {
  private provider: ILLMProvider;

  constructor(provider: ILLMProvider) {
    this.provider = provider;
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
    const agentId = this.selectAgentForScene(scene);

    return {
      strategy: 'single',
      goal: userInput,
      tasks: [{
        id: 'task-1',
        agentId,
        scene,
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
4. 为每个子任务选择合适的Agent和场景

可用Agent：
- coder: 编写代码
- debugger: 排查问题
- reviewer: 代码审查
- tester: 编写测试
- explainer: 讲解原理
- explorer: 探索代码库
- planner: 方案设计
- refactorer: 代码重构

可用场景：
- write_code: 写代码（严谨、低温度）
- debug: 调试（细致、中温度）
- review: 审查（批判、中温度）
- test: 测试（全面、低温度）
- explain: 讲解（通俗、高温度）
- explore: 探索（广度、中温度）
- plan: 规划（结构化、中温度）
- refactor: 重构（改进、中温度）

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
      "agentId": "planner",
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
   * 为场景选择合适的Agent
   */
  private selectAgentForScene(scene: SceneType): string {
    const mapping: Record<string, string> = {
      'write_code': 'coder',
      'debug': 'debugger',
      'review': 'reviewer',
      'test': 'tester',
      'refactor': 'refactorer',
      'explain': 'explainer',
      'explore': 'explorer',
      'plan': 'planner',
      'coding': 'coder', // 默认
    };
    return mapping[scene] || 'coder';
  }
}
