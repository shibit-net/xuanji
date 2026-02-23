/**
 * ============================================================
 * Built-in Agent Skills
 * ============================================================
 * Agent 配置和策略
 */

import type { Skill } from '../../types';
import type { AgentConfig } from '../../../types';

/**
 * 默认 ReAct 循环配置 Skill
 */
export const reactLoopDefaultSkill: Skill<any> = {
  id: 'react-loop-default',
  name: 'Default ReAct Loop',
  version: '1.0.0',
  description: 'ReAct 循环的默认配置',
  category: 'agent',
  tags: ['agent', 'react', 'default'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-23'),

  content: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
    maxIterations: 50,
  } as AgentConfig,

  parameters: {
    model: {
      name: 'model',
      type: 'string',
      description: 'LLM 模型名称',
      default: 'claude-sonnet-4-20250514',
      required: false,
    },
    maxTokens: {
      name: 'maxTokens',
      type: 'number',
      description: '最大 token 数',
      default: 4096,
      required: false,
    },
    temperature: {
      name: 'temperature',
      type: 'number',
      description: '温度参数 (0-2)',
      default: 0.7,
      required: false,
    },
    maxIterations: {
      name: 'maxIterations',
      type: 'number',
      description: '最大迭代次数',
      default: 50,
      required: false,
    },
  },

  dependencies: [],
  conflicts: [],
  requiredTools: [],
  enabled: true,
  priority: 100,

  render: (options?: any): string => {
    const params = options?.params || {};
    const config = { ...reactLoopDefaultSkill.content };

    // 应用参数覆盖
    if (params.model) config.model = params.model;
    if (params.maxTokens) config.maxTokens = params.maxTokens;
    if (params.temperature !== undefined) config.temperature = params.temperature;
    if (params.maxIterations) config.maxIterations = params.maxIterations;

    return JSON.stringify(config, null, 2);
  },

  execute: async (params?: Record<string, any>): Promise<AgentConfig> => {
    const config = { ...reactLoopDefaultSkill.content };

    // 应用参数覆盖
    if (params) {
      if (params.model) config.model = params.model;
      if (params.maxTokens) config.maxTokens = params.maxTokens;
      if (params.temperature !== undefined) config.temperature = params.temperature;
      if (params.maxIterations) config.maxIterations = params.maxIterations;
    }

    return config;
  },
};

/**
 * 多轮对话处理 Skill
 */
export const multiTurnHandlingSkill: Skill<any> = {
  id: 'multi-turn-handling',
  name: 'Multi-turn Conversation Handling',
  version: '1.0.0',
  description: '多轮对话的配置和处理策略',
  category: 'agent',
  tags: ['agent', 'multi-turn', 'conversation'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-23'),

  content: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8192,
    temperature: 0.5,
    maxIterations: 100,
  } as AgentConfig,

  parameters: {
    contextWindow: {
      name: 'contextWindow',
      type: 'number',
      description: '上下文窗口大小 (messages 数)',
      default: 20,
      required: false,
    },
    summarizeAfter: {
      name: 'summarizeAfter',
      type: 'number',
      description: '在多少 messages 后进行摘要',
      default: 10,
      required: false,
    },
  },

  dependencies: ['react-loop-default'],
  conflicts: [],
  requiredTools: [],
  enabled: true,
  priority: 90,

  render: (options?: any): string => {
    const params = options?.params || {};
    const config = { ...multiTurnHandlingSkill.content };

    if (params.model) config.model = params.model;
    if (params.maxTokens) config.maxTokens = params.maxTokens;
    if (params.temperature !== undefined) config.temperature = params.temperature;
    if (params.maxIterations) config.maxIterations = params.maxIterations;

    return JSON.stringify(config, null, 2);
  },
};
