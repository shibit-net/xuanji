/**
 * 子代理上下文配置
 *
 * 封装子代理的运行参数，包括:
 * - 超时控制
 * - 工具过滤（排除 TaskTool 防止递归）
 * - 嵌套深度追踪
 *
 * 注意：子代理不自动继承父代理上下文。
 * 父代理的 LLM 负责在 task description 中内嵌必要的上下文。
 */

import type { AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import { getSubAgentConfig } from '@/core/config/RuntimeConfig';

/**
 * 子代理隔离模式
 */
export type IsolationMode = 'none' | 'worktree';

/**
 * 子代理角色类型
 */
export type AgentRoleType = 'general-purpose' | 'explore' | 'plan' | 'coder' | 'memory-extractor';

/**
 * 子代理创建选项
 */
export interface SubAgentOptions {
  /** 任务描述（作为子代理的初始 user message） */
  task: string;
  /** 超时（毫秒），默认 300_000（5 分钟） */
  timeout?: number;
  /** 最大迭代次数，默认 30 */
  maxIterations?: number;
  /** 需要排除的工具列表 */
  restrictedTools?: string[];
  /** 当前嵌套深度（从 0 开始） */
  depth?: number;
  /** 隔离模式（默认 'none'） */
  isolation?: IsolationMode;
  /** 代理角色类型（默认 'general-purpose'） */
  role?: AgentRoleType;
  /** 是否使用轻量模型 */
  useLightModel?: boolean;
}

/**
 * 最大嵌套深度（硬编码限制）
 */
export const MAX_NESTING_DEPTH = 3;

/**
 * 默认超时（5 分钟）
 */
export const DEFAULT_TIMEOUT = 300_000;

/**
 * 默认最大迭代次数
 */
export const DEFAULT_MAX_ITERATIONS = 30;

/**
 * 最大并发子代理数
 */
export const MAX_CONCURRENT_SUBAGENTS = 3;

/**
 * 始终排除的工具（防止递归）
 */
export const ALWAYS_RESTRICTED_TOOLS = ['task'];

/**
 * 子代理上下文
 */
export class SubAgentContext {
  readonly task: string;
  readonly timeout: number;
  readonly maxIterations: number;
  readonly restrictedTools: string[];
  readonly depth: number;
  readonly isolation: IsolationMode;
  readonly role: AgentRoleType;
  readonly useLightModel: boolean;
  private maxNestingDepth: number;

  constructor(options: SubAgentOptions) {
    this.task = options.task;
    const subAgentCfg = getSubAgentConfig();
    this.timeout = options.timeout ?? subAgentCfg?.timeout ?? DEFAULT_TIMEOUT;
    this.maxIterations = options.maxIterations ?? subAgentCfg?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.maxNestingDepth = subAgentCfg?.maxNestingDepth ?? MAX_NESTING_DEPTH;
    this.depth = options.depth ?? 0;
    this.isolation = options.isolation ?? 'none';
    this.role = options.role ?? 'general-purpose';
    this.useLightModel = options.useLightModel ?? SubAgentContext.inferUseLightModel(this.role);

    // 合并用户指定的受限工具和始终受限的工具
    const restricted = new Set([
      ...ALWAYS_RESTRICTED_TOOLS,
      ...(options.restrictedTools ?? []),
    ]);

    // 探索型和规划型代理仅允许只读工具
    if (this.role === 'explore' || this.role === 'plan') {
      restricted.add('write_file');
      restricted.add('edit_file');
      restricted.add('bash');
    }

    this.restrictedTools = Array.from(restricted);
  }

  /**
   * 根据角色推断是否使用轻量模型
   */
  private static inferUseLightModel(role: AgentRoleType): boolean {
    return role === 'explore';
  }

  /**
   * 检查嵌套深度是否超限
   */
  isDepthExceeded(): boolean {
    return this.depth >= this.maxNestingDepth;
  }

  /**
   * 构建子代理的 AgentConfig
   */
  buildAgentConfig(parentConfig: AgentConfig): AgentConfig {
    let systemPrompt = parentConfig.systemPrompt ?? '';

    // 按角色定制系统提示
    const roleSuffix = this.getRolePromptSuffix();

    // 追加子代理角色说明
    const subAgentHeader = [
      `\n\n---\n[SubAgent Mode - Depth: ${this.depth}, Role: ${this.role}]`,
      roleSuffix,
      `Do NOT ask clarifying questions. Do NOT start new sub-tasks.`,
    ].join('\n');

    systemPrompt += subAgentHeader;

    return {
      ...parentConfig,
      systemPrompt,
      maxIterations: this.maxIterations,
    };
  }

  /**
   * 获取角色特定的系统提示后缀
   */
  private getRolePromptSuffix(): string {
    // 🆕 所有子 Agent 的记忆使用指南
    const memoryGuideline = `

**Memory System**: You have access to \`retrieve_memory\` tool.
- Use it when task references "previous work", "like last time", or "my usual style"
- Use it when you need user preferences or project context
- Do NOT use it for self-contained atomic tasks
- Query example: "user's coding preferences", "previous similar implementations"`;

    switch (this.role) {
      case 'explore':
        return `You are a fast exploration agent. Quickly search codebases, find files, and answer questions. Use Glob, Grep, and Read tools. Be concise.${memoryGuideline}`;
      case 'plan':
        return `You are a software architect. Design implementation plans, identify critical files, and consider architectural trade-offs. Return step-by-step plans.${memoryGuideline}`;
      case 'coder':
        return `You are a coding agent. Write, edit, and test code. Focus on correctness and following existing patterns.
${memoryGuideline}
- IMPORTANT: Use \`retrieve_memory\` when task says "continue", "modify previous", or "follow my style"`;
      default:
        return `You are a sub-agent executing a specific task. Focus on the task and return results concisely.${memoryGuideline}`;
    }
  }

  /**
   * 检查工具是否被排除
   */
  isToolRestricted(toolName: string): boolean {
    return this.restrictedTools.includes(toolName);
  }
}
