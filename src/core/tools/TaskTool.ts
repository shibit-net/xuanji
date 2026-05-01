/**
 * TaskTool — 启动子代理执行独立任务
 *
 * LLM 可通过此工具将复杂任务分解为独立子任务，
 * 每个子任务在隔离的 SubAgentLoop 中执行。
 *
 * 安全机制:
 * - TaskTool 不在子代理中注册（防止无限递归）
 * - 最大嵌套深度 3 层
 * - 并发子代理数限制（默认 3）
 * - 超时自动终止（默认 5 分钟）
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { BaseTool } from './BaseTool';
import { SubAgentContext, MAX_CONCURRENT_SUBAGENTS, type AgentRoleType, type IsolationMode } from '@/core/agent/SubAgentContext';
import type { SubAgentResult } from '@/core/agent/SubAgentLoop';
import { SubAgentFactory } from '@/core/agent/SubAgentFactory';

export class TaskTool extends BaseTool {
  readonly name = 'task';
  readonly description = [
    '委派任务给子 agent 执行。使用前必须先调用 match_agent 查找合适的 agent。',
    '分数 >= 0.5 使用推荐 agent，分数 < 0.5 需提供 system_prompt + tools 创建临时 agent。',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: '完整任务描述（子 agent 无法访问父对话历史，须包含目标、背景、文件路径、输出格式）',
      },
      subagent_type: {
        type: 'string',
        description: 'Agent ID（必需）。优先使用 match_agent 推荐结果；分数 < 0.5 时使用自定义 ID 并搭配 system_prompt + tools',
      },
      scene: {
        type: 'string',
        description: '场景类型，决定加载哪组提示词。可用 list_scenes 查看所有场景',
      },
      isolation: {
        type: 'string',
        enum: ['none', 'worktree'],
        description: '隔离模式。worktree 创建临时 git worktree。默认 none',
      },
      timeout: {
        type: 'number',
        description: '超时（毫秒），默认 1800000（30分钟）',
      },
      system_prompt: {
        type: 'string',
        description: '自定义系统提示词。临时 agent 必需（定义角色和专长），预置 agent 可选（覆盖默认）',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: '可用工具名称列表。临时 agent 必需（只能分配父 agent 拥有的工具），预置 agent 可选',
      },
      stream_to_user: {
        type: 'boolean',
        description: '子 agent 输出是否直送用户。true=独立任务输出直达用户，false=多 agent 协作由主 agent 整合',
      },
    },
    required: ['description', 'subagent_type'],
  };

  readonly readonly = true; // 可并行执行

  // 依赖注入
  private providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private currentDepth = 0;
  private parentProvider: ILLMProvider | null = null; // 父 Provider
  private currentAgentId: string = 'main'; // 🔧 当前 Agent ID

  /** SubAgentFactory 实例 */
  private subAgentFactory: SubAgentFactory | null = null;

  /** 当前活跃的子代理数 */
  private activeCount = 0;

  /**
   * 注入运行时依赖（由 ChatSession 调用）
   */
  setDependencies(deps: {
    providerManager: import('@/core/providers/ProviderManager').ProviderManager;
    agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    parentProvider?: ILLMProvider; // 可选：父 Provider（用于继承）
    hookRegistry?: HookRegistry | null;
    depth?: number;
    agentId?: string; // 🔧 当前 Agent ID
  }): void {
    this.providerManager = deps.providerManager;
    this.agentRegistry = deps.agentRegistry;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.parentProvider = deps.parentProvider ?? null; // 保存父 Provider
    this.hookRegistry = deps.hookRegistry ?? null;
    this.currentDepth = deps.depth ?? 0;
    this.currentAgentId = deps.agentId ?? 'main'; // 🔧 保存当前 Agent ID

    // 🔧 将 AgentConfig 转换为 ConfigurableAgentConfig 格式
    // AgentConfig 的 apiKey/baseURL 是顶层字段，需要转换为 provider 对象
    const parentAgentConfig: any = this.agentConfig ? {
      id: deps.agentId ?? 'main',
      name: 'Parent Agent',
      model: {
        primary: this.agentConfig.model, // 🔧 继承父agent的模型名，避免回退到硬编码默认值
      },
      provider: {
        apiKey: this.agentConfig.apiKey,
        baseURL: this.agentConfig.baseURL,
      },
    } : null;

    // 创建 SubAgentFactory 实例
    this.subAgentFactory = new SubAgentFactory(
      this.agentRegistry,
      this.providerManager,
      this.registry,
      this.hookRegistry,
      null,
      this.parentProvider,  // 传递父 provider
      parentAgentConfig,  // 🔧 传递转换后的配置
    );
  }

  async execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const description = input.description as string;
    const timeout = input.timeout as number | undefined;
    let role = (input.subagent_type as AgentRoleType) ?? null;
    const scene = input.scene as string | undefined;
    const isolation = (input.isolation as IsolationMode) ?? 'none';
    const systemPrompt = input.system_prompt as string | undefined;
    const tools = input.tools as string[] | undefined;
    const streamToUser = input.stream_to_user as boolean | undefined;

    // 验证依赖已注入
    if (!this.subAgentFactory) {
      console.error('[TaskTool] subAgentFactory is null/undefined');
      return this.error(
        'TaskTool not initialized. Internal error: subAgentFactory not injected.',
      );
    }

    if (!this.agentConfig) {
      console.error('[TaskTool] agentConfig is null/undefined');
      return this.error(
        'TaskTool not initialized. Internal error: agentConfig not injected.',
      );
    }

    console.log('[TaskTool] execute() called, subAgentFactory:', !!this.subAgentFactory, 'agentConfig:', !!this.agentConfig, 'scene:', scene);

    // ⚠️ 要求明确指定 subagent_type
    if (!role) {
      return this.error(
        'subagent_type is required. Please call match_agent first to find the best agent, ' +
        'or specify a custom agent ID if creating a temporary agent.'
      );
    }

    // 🔧 禁止 agent 调用自己
    if (role === this.currentAgentId) {
      return this.error(
        `Cannot delegate to yourself (${role}). You should handle this task directly instead of creating a sub-agent with the same ID.`
      );
    }

    // 深度检查（在调用 SubAgentFactory 之前，避免 agentRegistry 查找失败掩盖深度错误）
    const depthCtx = new SubAgentContext({ task: description, depth: this.currentDepth + 1 });
    if (depthCtx.isDepthExceeded()) {
      return this.error(
        `Maximum nesting depth exceeded (depth=${this.currentDepth + 1}). Sub-agents cannot create further sub-agents beyond the limit.`,
      );
    }

    // 并发限制
    if (this.activeCount >= MAX_CONCURRENT_SUBAGENTS) {
      return this.error(
        `Maximum concurrent sub-agents (${MAX_CONCURRENT_SUBAGENTS}) reached. Wait for current tasks to complete.`,
      );
    }

    // 执行子代理（使用统一架构）
    this.activeCount++;
    const savedCwd = (input._cwd as string) || process.cwd();
    try {
      const result = await this.subAgentFactory.createAndRun(role, {
        task: description,
        timeout,
        depth: this.currentDepth + 1,
        isolation,
        parentConfig: this.agentConfig,
        systemPrompt,
        scene,  // 传递 scene 参数
        tools,
        parentAgentId: this.currentAgentId, // 🔧 传递父 Agent ID
        streamToUser, // 🔧 传递 streamToUser 参数
        workingDir: savedCwd, // 🆕 继承父 agent 的工作目录
      }, signal); // 🔧 传递 AbortSignal

      // 恢复 cwd，防止子 agent 的 change_directory 影响父 agent
      try { process.chdir(savedCwd); } catch (e) { /* ignore */ }

      return this.formatResult(result, streamToUser, role);
    } finally {
      this.activeCount--;
    }
  }

  /**
   * 获取当前活跃子代理数
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 格式化子代理执行结果
   */
  private formatResult(result: SubAgentResult, streamToUser?: boolean, role?: string): ToolResult {
    // 🔧 获取 agent 名称（用于引用标识）
    const agentName = role ? this.getAgentName(role) : 'unknown-agent';

    // 构建元数据行
    const meta = [
      `[Sub-agent completed]`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      `Iterations: ${result.iterations}`,
      `Tokens: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`,
      result.timedOut ? '⚠️ Timed out' : '',
    ].filter(Boolean).join(' | ');

    // streamToUser 时添加提示前言：输出已展示给用户，不要逐字重复
    const streamedNote = streamToUser
      ? `[Sub-agent output was displayed to the user in real-time — reference it if needed but do NOT repeat it verbatim.]\n\n`
      : '';

    // 🔧 在输出末尾添加隐藏的 metadata 标记（用于前端解析）
    const metadataMarker = `\n\n<!-- SUB_AGENT_METADATA: ${JSON.stringify({
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      originalOutput: result.result,
    })} -->`;

    // 🔧 添加引用提示（统一格式：📎 [Name]："quote"）
    const referenceHint = `\n\n---\n⚠️ 当你向上汇报此子agent的执行结果时，必须为每条关键发现附带可点击引用。引用格式（直接写在正文中，不要放在代码块或引用块里）：

📎 [${agentName}]："从上方输出中逐字复制一句原话"

引用名称必须是 "${agentName}"，否则用户无法点击查看完整输出。每条结论都要有对应引用，不能只说"有报告指出"。`;

    const content = `${meta}\n\n${streamedNote}${result.result}${referenceHint}${metadataMarker}`;

    return this.success(content, {
      subAgent: true,
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      timedOut: result.timedOut,
      iterations: result.iterations,
      // 🔧 保存原始输出，用于"引用原文"功能
      originalOutput: result.result,
    });
  }

  /**
   * 获取 agent 的友好名称
   */
  private getAgentName(role: string): string {
    // 尝试从 agentRegistry 获取 preset agent 的显示名称
    if (this.agentRegistry) {
      const agentConfig = this.agentRegistry.get(role);
      if (agentConfig?.name) {
        return agentConfig.name;
      }
    }

    // 临时 agent：保持原始 role 字符串不变，确保与 SubAgentStart 中的 config.name 一致
    // 这样主 agent 在引用中使用此名称时，chatStore 可以通过相同 key 查找到完整输出
    return role;
  }
}
