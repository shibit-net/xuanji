// ============================================================
// Multi-Agent 系统 - 核心类型定义
// ============================================================

import type { AgentConfig, Message, TokenUsage } from '@/infrastructure/core-types';
import type { IToolRegistry } from '@/infrastructure/core-types';
import type { ILLMProvider } from '@/infrastructure/core-types';

/**
 * Agent 角色类型
 */
export type AgentRole = 'router' | 'specialist' | 'coordinator';

/**
 * Agent 分类（三大类）
 * - system: 系统 agent，框架自动调用（意图分析、上下文压缩、记忆整理、分类）
 * - app: 应用 agent，执行具体工作（主 agent、各场景角色 agent）
 * - custom: 用户自定义 agent
 */
export type AgentCategory = 'system' | 'app' | 'custom';

/**
 * Agent 输入
 */
export interface AgentInput {
  /** 用户消息 */
  userMessage: string;
  /** 上下文信息（由 Router 或 Coordinator 传递） */
  context?: {
    /** 意图分析结果 */
    intent?: string;
    /** 问题领域 */
    domain?: string;
    /** 置信度 */
    confidence?: number;
    /** 额外元数据 */
    metadata?: Record<string, unknown>;
  };
  /** 历史消息（用于多轮对话） */
  history?: Message[];
}

/**
 * Agent 输出
 */
export interface AgentOutput {
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  content?: string;
  /** 错误信息 */
  error?: string;
  /** Token 使用量 */
  usage?: TokenUsage;
  /** 费用 */
  cost?: number;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Router Agent 输出（意图分析结果）
 */
export interface RouterOutput extends AgentOutput {
  /** 用户意图描述 */
  intent: string;
  /** 问题领域 */
  domain: string;
  /** 推荐的 Specialist Agent ID */
  recommendedAgent: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 推荐理由 */
  reasoning: string;
}

/**
 * Agent 配置
 */
export interface AgentDefinition {
  /** Agent 唯一标识 */
  id: string;
  /** Agent 名称 */
  name: string;
  /** Agent 角色 */
  role: AgentRole;
  /** Agent 描述 */
  description: string;
  /** 适用领域（用于 Router 匹配） */
  domains?: string[];
  /** 关键词（用于意图匹配） */
  keywords?: string[];
  /** 优先级（多个 Agent 匹配时使用） */
  priority?: number;
  /** 是否启用 */
  enabled?: boolean;

  /** Agent 独立配置 */
  config: {
    /** 使用的模型 */
    model: string;
    /** System Prompt（可以是字符串或 Skill ID） */
    systemPrompt: string | string[];
    /** 允许使用的工具列表 */
    tools: string[];
    /** 最大迭代次数 */
    maxIterations?: number;
    /** 温度参数 */
    temperature?: number;
    /** 最大输出 token */
    maxTokens?: number;
    /** Extended Thinking 配置 */
    thinking?: import('@/infrastructure/core-types').ThinkingConfig;
  };
}

/**
 * Agent 接口
 */
export interface IAgent {
  /** Agent 定义 */
  readonly definition: AgentDefinition;

  /** 执行 Agent 任务 */
  execute(input: AgentInput): Promise<AgentOutput>;

  /** 停止执行 */
  stop(): void;

  /** 重置状态 */
  reset(): void;

  /** 获取当前状态 */
  getState(): {
    running: boolean;
    currentIteration: number;
    tokenUsage: TokenUsage;
    cost: number;
  };
}

/**
 * Agent 工厂接口
 */
export interface IAgentFactory {
  /** 创建 Agent 实例 */
  createAgent(definition: AgentDefinition): Promise<IAgent>;

  /** 获取已创建的 Agent */
  getAgent(id: string): IAgent | undefined;

  /** 列出所有 Agent */
  listAgents(): AgentDefinition[];
}

/**
 * Agent 协调器接口（管理多个 Agent 的协作）
 */
export interface IAgentCoordinator {
  /** 路由用户请求到合适的 Agent */
  route(userMessage: string): Promise<RouterOutput>;

  /** 执行 Specialist Agent */
  executeSpecialist(agentId: string, input: AgentInput): Promise<AgentOutput>;

  /** 停止所有 Agent */
  stopAll(): void;
}

// ============================================================
// Configurable Agent System - 可配置 Agent 系统类型定义
// ============================================================

/**
 * 自定义 Skill 配置
 */
export interface CustomSkill {
  /** Skill ID */
  id: string;
  /** Skill 名称 */
  name: string;
  /** Skill 类别 */
  category: 'prompt' | 'workflow';
  /** 优先级（越大越优先） */
  priority?: number;
  /** Skill 内容（Markdown 格式） */
  content: string;
  /** 依赖的其他 Skill ID */
  dependencies?: string[];
}

/**
 * 知识源配置
 */
export interface KnowledgeSource {
  /** 数据源类型 */
  type: 'csv' | 'json' | 'markdown' | 'pdf';
  /** 文件路径（相对于 knowledge 目录） */
  path: string;
  /** 描述 */
  description?: string;
  /** CSV 列定义 */
  columns?: Record<string, string>;
  /** JSON Schema */
  schema?: Record<string, string>;
}

/**
 * 工具配置
 */
export interface ToolConfig {
  /** 工具名称 */
  name: string;
  /** 工具描述（覆盖默认描述） */
  description?: string;
  /** 自定义配置参数 */
  config?: Record<string, any>;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/**
 * Embedding 配置
 */
export interface EmbeddingConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 模型名称 */
  model?: string;
  /** 分块大小 */
  chunkSize?: number;
  /** 重叠大小 */
  overlapSize?: number;
}

/**
 * 检索配置
 */
export interface RetrievalConfig {
  /** 最大返回结果数 */
  maxResults?: number;
  /** 相似度阈值 */
  similarityThreshold?: number;
  /** 混合检索权重 */
  hybridWeight?: {
    /** 向量相似度权重 */
    vector: number;
    /** 关键词权重 */
    keyword: number;
    /** 时效性权重 */
    recency: number;
  };
}

/**
 * 可配置 Agent 配置
 */
export interface ConfigurableAgentConfig {
  // ========== 基础信息 ==========
  /** Agent ID */
  id: string;
  /** Agent 名称 */
  name: string;
  /** Agent 分类 */
  category?: AgentCategory;
  /** 版本号 */
  version?: string;
  /** 作者 */
  author?: string;
  /** 描述 */
  description: string;

  // ========== 意图匹配 ==========
  /** 标签（已废弃，保留向后兼容） */
  tags?: string[];
  /** 触发关键词 */
  triggers?: string[];
  /** 能力描述 */
  capabilities: string[];
  /** 示例（Few-shot learning） */
  examples?: Array<{ input: string; output: string }>;

  // ========== Skills（未来扩展） ==========
  /**
   * Agent 拥有的 Skills（未来支持）
   * 用于接入 clawHub 等 Skill 系统
   * @future
   */
  skills?: string[];  // Skill IDs
  // ========== 专属知识库 ==========
  /** 知识库配置 */
  knowledgeBase?: {
    /** 存储路径 */
    path: string;
    /** 数据源 */
    sources: KnowledgeSource[];
    /** Embedding 配置 */
    embedding?: EmbeddingConfig;
    /** 检索配置 */
    retrieval?: RetrievalConfig;
  };

  // ========== 专属工具 ==========
  /** 工具配置 */
  tools: ToolConfig[];

  // ========== System Prompt ==========
  /** System Prompt */
  systemPrompt: string | null;

  // ========== 模型配置 ==========
  /** 模型配置 */
  model: {
    /** 主模型 */
    primary: string;
    /** 最大 Token */
    maxTokens?: number;
    /** 温度 */
    temperature?: number;
    /** 上下文窗口大小（tokens），用于 local-llama 等本地模型 */
    contextSize?: number;
    /** Thinking 配置 */
    thinking?: {
      type?: 'enabled' | 'disabled' | 'adaptive';
      effort?: 'low' | 'medium' | 'high';
    };
  };

  // ========== Provider 配置 ==========
  /** Provider 配置（可选，用于独立 API Key/BaseURL） */
  provider?: {
    /** Adapter 类型 */
    adapter?: string;
    /** API Key */
    apiKey?: string;
    /** Base URL */
    baseURL?: string;
    /** 模型名称（覆盖 model.primary） */
    model?: string;
  };

  // ========== 执行配置 ==========
  /** 执行配置 */
  execution: {
    /** 执行模式 */
    mode?: 'react' | 'plan' | 'chain';
    /** 最大迭代次数 */
    maxIterations: number;
    /** 超时时间（毫秒） */
    timeout: number;
    /** 是否流式输出 */
    streaming?: boolean;
    /** 是否并行工具 */
    parallelTools?: boolean;
    /** 错误时重试 */
    retryOnError?: boolean;
  };

  // ========== 权限配置 ==========
  /** 权限配置 */
  permissions?: {
    fileRead?: 'always' | 'ask' | 'deny';
    fileWrite?: 'always' | 'ask' | 'deny';
    bashExec?: 'always' | 'ask' | 'deny';
    network?: 'always' | 'ask' | 'deny';
    allowedPaths?: string[];
    deniedPaths?: string[];
    allowedCommands?: string[];
    deniedCommands?: string[];
  };

  // ========== 成本控制 ==========
  /** 成本控制 */
  cost?: {
    /** 单任务最大 Token */
    maxTokensPerTask: number;
    /** 预算警告阈值 */
    budgetAlert?: number;
  };

  // ========== 显示配置 ==========
  /** 头像 */
  avatar?: string;
  /** 颜色 */
  color?: string;

  // ========== 启用状态 ==========
  /** 是否启用 */
  enabled: boolean;

  // ========== 元数据 ==========
  /** 元数据（运行时添加，不保存到配置文件） */
  metadata?: {
    /** 文件路径 */
    filePath?: string;
    /** 加载时间 */
    loadedAt?: string;
    /** 是否为内置 Agent */
    internal?: boolean;
    /**
     * Agent 分类（统一三大类）
     * - system: 系统 agent，框架自动调用（意图分析、上下文压缩、记忆整理、分类）
     * - app: 应用 agent，执行具体工作（主 agent、各场景角色 agent）
     * - custom: 用户自定义 agent
     */
    category?: AgentCategory;
    /** 额外元数据 */
    [key: string]: any;
  };
}

/**
 * Agent 上下文（传递给 Worker Agent 的上下文）
 */
export interface AgentContext {
  /** 核心任务 */
  task: string;
  /** 约束条件 */
  constraints?: string[];
  /** 偏好设置 */
  preferences?: Record<string, any>;
  /** 其他上下文变量（用于模板替换） */
  [key: string]: any;
}

/**
 * Agent 委派决策（Orchestrator 的分析结果）
 */
export interface AgentDelegation {
  /** 分析过程（为什么选择这个 Agent） */
  reasoning: string;
  /** 选择的 Agent ID */
  agentId: string;
  /** 传递的上下文 */
  context: AgentContext;
  /** 是否需要协作 */
  collaborative: boolean;
  /** 协作的 Agent ID 列表 */
  agentIds?: string[];
}
