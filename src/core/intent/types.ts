/**
 * 意图识别核心类型定义
 */

import type { Message } from '../types/index.js';

/**
 * 领域类型
 */
export type IntentDomain = 'coding' | 'life' | 'finance' | 'learning' | 'health' | 'general';

/**
 * 意图元数据（通用）
 */
export interface IntentMetadata {
  /** 意图类型（唯一标识，如 'finance.stock-analysis'） */
  type: string;

  /** 所属领域 */
  domain: IntentDomain;

  /** 训练样本（5-10 个典型表达） */
  trainingExamples: string[];

  /** 意图描述（可选） */
  description?: string;

  /** 意图名称（可选，用于显示） */
  name?: string;

  /** 是否启用意图识别（默认 true） */
  enabled?: boolean;

  /** 优先级（默认 50，数值越大优先级越高） */
  priority?: number;
}

/**
 * 模块类型
 */
export type ModuleType = 'skill' | 'prompt-component' | 'mcp-tool' | 'agent' | 'custom';

/**
 * 可注册意图的模块接口
 *
 * 任何模块实现此接口即可被自动发现和注册到意图系统
 */
export interface IntentRegistrable {
  /** 意图元数据 */
  intentMeta: IntentMetadata;

  /** 模块类型 */
  moduleType: ModuleType;

  /** 模块 ID（唯一标识） */
  id: string;
}

/**
 * 意图识别结果
 */
export interface Intent {
  /** 意图 ID */
  id: string;

  /** 意图类型 */
  type: string;

  /** 所属领域 */
  domain: IntentDomain;

  /** 置信度 (0-1) */
  confidence: number;

  /** 提取的参数（可选） */
  params?: Record<string, any>;

  /** 原始文本片段（可选） */
  text?: string;

  /** 来源（rule/vector/llm） */
  source?: 'rule' | 'vector' | 'llm';
}

/**
 * 意图上下文
 */
export interface IntentContext {
  /** 用户输入 */
  userInput: string;

  /** 识别到的意图 */
  intent: Intent;

  /** 历史消息 */
  messageHistory: Message[];

  /** 当前工作目录 */
  cwd?: string;

  /** 其他上下文数据 */
  [key: string]: any;
}

/**
 * 意图回调函数
 *
 * 当意图被识别时调用
 */
export type IntentCallback = (context: IntentContext) => Promise<void> | void;

/**
 * 意图定义（用于向量生成）
 */
export interface IntentDefinition {
  /** 意图类型 */
  type: string;

  /** 所属领域 */
  domain: IntentDomain;

  /** 意图名称 */
  name: string;

  /** 意图描述 */
  description: string;

  /** 训练样本 */
  examples: string[];
}

/**
 * 意图向量
 */
export interface IntentVector {
  /** 意图类型 */
  type: string;

  /** 所属领域 */
  domain: IntentDomain;

  /** 质心向量（384 维） */
  vector: number[];

  /** 样本向量列表 */
  exampleVectors: number[][];

  /** 最后更新时间 */
  lastUpdated: number;
}

/**
 * 向量缓存数据
 */
export interface VectorCacheData {
  /** 版本号 */
  version: string;

  /** 生成时间 */
  generatedAt: number;

  /** 意图向量映射 */
  vectors: Record<string, IntentVector>;
}

/**
 * 意图匹配选项
 */
export interface IntentMatchOptions {
  /** 相似度阈值 (0-1，默认 0.7) */
  threshold?: number;

  /** 返回前 K 个结果（默认 3） */
  topK?: number;

  /** 是否启用规则匹配（默认 true） */
  enableRules?: boolean;

  /** 是否启用向量匹配（默认 true） */
  enableVector?: boolean;

  /** 是否启用 LLM 分类（默认 false） */
  enableLLM?: boolean;
}
