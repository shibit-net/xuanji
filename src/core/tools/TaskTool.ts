/**
 * TaskTool — 创建子 agent 执行任务
 *
 * 每个 agent 都可以通过 task 创建下级子 agent，最深 5 层。
 * 第 0 层（主 agent）自动异步执行，第 1+ 层自动同步等待结果。
 * agent_team 成员不能调 task（成员是执行单元）。
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';
import { SubAgentContext, MAX_CONCURRENT_SUBAGENTS, type AgentRoleType, type IsolationMode } from '@/core/agent/SubAgentContext';
import type { SubAgentResult } from '@/core/agent/factory/AgentFactory';
import { AgentFactory } from '@/core/agent/factory/AgentFactory';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import { TeamContext } from './TeamContext';

// ─── TaskTool ────────────────────────────────────────

export class TaskTool extends BaseTool {
  readonly name = 'task';
  readonly description = [
    'Create a sub-agent to execute a task. Every agent can call task to create subordinates (max 5 levels deep).',
    '',
    'WHEN TO USE:',
    '• Sub-task needs specialist expertise (use match_agent first)',
    '• Task is large enough to be delegated independently',
    '• You want to create a leader that further delegates via task',
    '',
    'WHEN NOT TO USE:',
    '• You can do it yourself directly (just use tools)',
    '• Need multi-agent debate/pipeline → use agent_team instead',
    '',
    'HOW TO USE:',
    '1. First call match_agent to find the right agent',
    '2. Then call list_scenes to pick the right scene',
    '3. Call task with the agent_id, scene, complete description, AND tools',
    '',
    'TASK ASSIGNMENT — You are the assigner:',
    '• The sub-agent has NO access to parent conversation history. You MUST include ALL context in description.',
    '• Be specific: what to do, which files to touch, what output format to use, what constraints apply.',
    '• The sub-agent will ONLY see your description + system_prompt — nothing else from the conversation.',
    '• A vague description produces poor results. Invest time in writing a detailed task.',
    '',
    'IMPORTANT — tools parameter:',
    '• The sub-agent has NO tools by default — it starts with an empty toolbox.',
    '• You MUST pass the `tools` parameter listing every tool the sub-agent needs.',
    '• Minimum for any file task: read_file, glob, grep, list_directory',
    '• For coding tasks also add: write_file, edit_file, bash',
    '• For research tasks also add: web_fetch',
    '• Never assume the sub-agent can access files without these tools.',
    '',
    'ASYNC (async=true)：后台运行，完成后系统自动通知。主 agent 默认异步，可继续处理其他输入。',
    'SYNC (async=false)：等待子 agent 完成并直接返回结果。子 agent 输出会实时显示在对话框中。',
    '当你需要子 agent 的输出来回答用户时，使用 async=false 同步等待。',
    '当任务是独立的后台分析、用户不等待结果时，使用 async=true 异步执行。',
    '',
    'Example:',
    '  task({',
    '    subagent_type: "software-engineer",',
    '    scene: "write_code",',
    '    description: "Implement auth API in src/auth/... JWT tokens, bcrypt.",',
    '    tools: ["read_file", "glob", "grep", "list_directory", "write_file", "edit_file", "bash"]',
    '  })',
].join('\n');

  private log = logger.child({ module: 'TaskTool' });

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
        description: [
          '场景类型，定义子 agent 的行为模式和边界。',
          '**必须通过 list_scenes 查询后选择合适的 scene ID 填入**。',
          '不要自行编造 scene ID。',
          '如果没有合适的场景，可以不传 scene 参数。',
        ].join('\n'),
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
        description: '子 agent 可用的工具名称列表。子 agent 默认没有任何工具，必须显式传入。至少包含 read_file, glob, grep, list_directory；编码任务加 write_file, edit_file, bash；研究任务加 web_fetch',
      },
      stream_to_user: {
        type: 'boolean',
        description: '子 agent 输出是否直送用户。true=独立任务输出直达用户，false=多 agent 协作由主 agent 整合',
      },
      async: {
        type: 'boolean',
        description: '执行模式。true=异步（后台运行，完成后通知），false=同步（等待完成，输出实时显示在对话框）。主 agent 默认异步，子 agent 默认同步。当子 agent 的输出是用户当前问题所需答案时，设为 false。',
      },
    },
    required: ['description', 'subagent_type'],
  };

  readonly readonly = true;

  // ── 依赖注入 ────────────────────────────────────────

  private providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private currentDepth = 0;
  private parentProvider: ILLMProvider | null = null;
  private currentAgentId: string = 'main';

  private agentFactory: AgentFactory | null = null;
  private activeCount = 0;

  setDependencies(deps: {
    providerManager: import('@/core/providers/ProviderManager').ProviderManager;
    agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    parentProvider?: ILLMProvider;
    hookRegistry?: HookRegistry;
    depth?: number;
    agentId?: string;
  }): void {
    this.providerManager = deps.providerManager;
    this.agentRegistry = deps.agentRegistry;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.parentProvider = deps.parentProvider ?? null;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.currentDepth = deps.depth ?? 0;
    this.currentAgentId = deps.agentId ?? 'main';

    if (!this.agentFactory) {
      this.agentFactory = new AgentFactory(this.registry);
    }
    if (this.parentProvider) {
      this.agentFactory.setParentProvider(this.parentProvider);
    }
    if (this.agentConfig) {
      this.agentFactory.setParentConfig(this.agentConfig);
    }
    if (this.hookRegistry) {
      this.agentFactory.setHookRegistry(this.hookRegistry);
    }
  }

  // ── 主入口 ──────────────────────────────────────────

  async execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    // 1. 参数解析
    const params = this.parseInput(input);

    // 2. 依赖检查
    const depsErr = this.checkDependencies();
    if (depsErr) return depsErr;

    // 3. 输入验证
    const validationErr = this.validateInput(params);
    if (validationErr) return validationErr;

    // 4. 安全性检查
    const safetyErr = this.checkSafety(params);
    if (safetyErr) return safetyErr;

    // 5. 决定执行模式：async=true 强制异步，async=false 强制同步，未指定时 depth=0 默认异步
    const isAsync = input.async === true || (this.currentDepth === 0 && input.async !== false);

    if (isAsync) {
      return this.executeAsync({ ...params, role: params.role! }, input);
    }

    return this.executeSync({ ...params, role: params.role! }, input, signal);
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  // ── 输入解析与验证 ──────────────────────────────────

  private parseInput(input: Record<string, unknown>): {
    description: string;
    role: string | null;
    scene?: string;
    scenes?: string[];
    timeout?: number;
    isolation: IsolationMode;
    systemPrompt?: string;
    tools?: string[];
    streamToUser?: boolean;
    cwd?: string;
  } {
    return {
      description: input.description as string,
      role: (input.subagent_type as AgentRoleType) ?? null,
      scene: input.scene as string | undefined,
      scenes: input.scenes as string[] | undefined,
      timeout: input.timeout as number | undefined,
      isolation: (input.isolation as IsolationMode) ?? 'none',
      systemPrompt: input.system_prompt as string | undefined,
      tools: input.tools as string[] | undefined,
      streamToUser: input.stream_to_user as boolean | undefined,
      cwd: input._cwd as string | undefined,
    };
  }

  private checkDependencies(): ToolResult | null {
    if (!this.agentFactory) {
      return this.error('TaskTool not initialized. Internal error: agentFactory not injected.');
    }
    if (!this.agentConfig) {
      return this.error('TaskTool not initialized. Internal error: agentConfig not injected.');
    }
    return null;
  }

  private validateInput(params: {
    description: string;
    role: string | null;
  }): ToolResult | null {
    if (!params.role) {
      return this.error(
        'subagent_type is required. Please call match_agent first to find the best agent, ' +
        'or specify a custom agent ID if creating a temporary agent.',
      );
    }
    return null;
  }

  private checkSafety(params: {
    role: string | null;
    description: string;
  }): ToolResult | null {
    // 禁止调用自己
    if (params.role === this.currentAgentId) {
      return this.error(
        `Cannot delegate to yourself (${params.role}). You should handle this task directly instead of creating a sub-agent with the same ID.`,
      );
    }

    // 深度限制
    const depthCtx = new SubAgentContext({ task: params.description, depth: this.currentDepth + 1 });
    if (depthCtx.isDepthExceeded()) {
      return this.error(
        `Maximum nesting depth exceeded (depth=${this.currentDepth + 1}). Sub-agents cannot create further sub-agents beyond the limit.`,
      );
    }

    // agent_team 普通成员不能调 task，但 hierarchical leader 需要 task 来委派给 workers
    const teamCtx = TeamContext.get();
    if (teamCtx && teamCtx.strategy !== 'hierarchical') {
      return this.error(
        'task 不能在 agent_team 内部使用。agent_team 的成员是执行单元，不能创建子 agent。',
      );
    }

    return null;
  }

  // ── 异步执行 ────────────────────────────────────────

  private executeAsync(
    params: {
      description: string;
      role: string;
      timeout?: number;
      isolation: IsolationMode;
      systemPrompt?: string;
      scene?: string;
      tools?: string[];
      streamToUser?: boolean;
      cwd?: string;
    },
    input: Record<string, unknown>,
  ): ToolResult {
    if (!this.agentFactory) {
      return this.error('TaskTool not initialized.');
    }

    const manager = TaskOrchestrator.getInstance();
    const agentConfig = this.agentConfig!;
    const currentDepth = this.currentDepth;
    const agentFactory = this.agentFactory;
    const parentAgentId = this.currentAgentId;
    const self = this;

    // 🔧 先生成统一的 subAgentId，后续所有 thinking/tool events 共用
    const subAgentId = `subtask-${params.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const result = manager.startTask({
      type: 'task',
      goal: (params.description || '').slice(0, 120),
      members: [{ id: params.role, name: this.getAgentName(params.role), status: 'pending' }],
      workingDir: params.cwd,
      isolation: params.isolation === 'worktree' ? 'worktree' : 'none',
      subAgentId,
      executor: async (abortSignal, onProgress, groupId) => {
        onProgress({ phase: 'executing', currentMember: params.role, currentMemberStatus: '执行中...' });
        manager.updateMemberStatus(groupId, params.role, 'running');

        const savedCwd = params.cwd || process.cwd();

        try {
          // 异步执行时 stream_to_user 无意义（主 agent 不等待），强制设为 false
          // 🔧 传入预先生成的 subAgentId，确保所有事件 ID 一致
          const execResult = await agentFactory.createAndRun(params.role, {
            task: params.description,
            timeout: params.timeout,
            depth: currentDepth + 1,
            parentConfig: agentConfig,
            systemPrompt: params.systemPrompt,
            scene: params.scene,
            tools: params.tools,
            parentAgentId,
            streamToUser: false,
            workingDir: savedCwd,
            subAgentId,
            isAsync: true,
          }, abortSignal);

          try { process.chdir(savedCwd); } catch { /* ignore */ }

          // 🐛 修复: 之前用 timedOut ? 'failed' : 'completed' 忽略了 success=false 的情况
          // 创建失败但 timedOut=false 时也会被标记为 completed
          const memberStatus = execResult.success ? 'completed' : 'failed';
          this.log.info(`[TaskTool] async sub-agent result`, {
            role: params.role,
            depth: currentDepth + 1,
            success: execResult.success,
            timedOut: execResult.timedOut,
            iterations: execResult.iterations,
            duration: execResult.duration,
            memberStatus,
            resultPreview: (execResult.result || '').slice(0, 200),
          });

          manager.updateMemberStatus(groupId, params.role, memberStatus);
          onProgress({ phase: 'synthesizing', completedMembers: execResult.success ? 1 : 0 });

          return self.formatResult(execResult, false, params.role);
        } catch (error: any) {
          try { process.chdir(savedCwd); } catch { /* ignore */ }

          const errMsg = error instanceof Error ? error.message : String(error);
          const errStack = error instanceof Error ? error.stack : '';
          this.log.error(`[TaskTool] async sub-agent execution failed`, {
            role: params.role,
            depth: currentDepth + 1,
            parentAgentId,
            subAgentId,
            error: errMsg,
            stack: errStack,
          });
          console.error(`[TaskTool] 异步子 agent 执行失败: role=${params.role}, depth=${currentDepth + 1}, error=${errMsg}`);

          manager.updateMemberStatus(groupId, params.role, 'failed');
          onProgress({ phase: 'synthesizing', completedMembers: 0 });

          return {
            content: `后台任务执行失败: ${errMsg}`,
            isError: true,
            metadata: {
              agentName: self.getAgentName(params.role),
            },
          } as any;
        }
      },
    });

    if (result.error) {
      return this.error(result.error);
    }

    return this.formatAsyncResponse(result.groupId, params.role, params.description, subAgentId);
  }

  // ── 同步执行 ────────────────────────────────────────

  private async executeSync(
    params: {
      description: string;
      role: string;
      timeout?: number;
      isolation: IsolationMode;
      systemPrompt?: string;
      scene?: string;
      tools?: string[];
      streamToUser?: boolean;
      cwd?: string;
    },
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    // 并发检查
    if (this.activeCount >= MAX_CONCURRENT_SUBAGENTS) {
      return this.error(
        `Maximum concurrent sub-agents (${MAX_CONCURRENT_SUBAGENTS}) reached. Wait for current tasks to complete.`,
      );
    }

    this.activeCount++;
    const savedCwd = params.cwd || process.cwd();
    const subAgentId = `subtask-${params.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const result = await this.agentFactory!.createAndRun(params.role, {
        task: params.description,
        timeout: params.timeout,
        depth: this.currentDepth + 1,
        parentConfig: this.agentConfig!,
        systemPrompt: params.systemPrompt,
        scene: params.scene,
        tools: params.tools,
        parentAgentId: this.currentAgentId,
        streamToUser: params.streamToUser,
        workingDir: savedCwd,
        subAgentId,
        isAsync: false,
      }, signal);

      // 恢复 cwd，防止子 agent 的 change_directory 影响父 agent
      try { process.chdir(savedCwd); } catch { /* ignore */ }

      return this.formatResult(result, params.streamToUser, params.role);
    } finally {
      this.activeCount--;
    }
  }

  // ── 结果格式化 ──────────────────────────────────────

  private formatAsyncResponse(groupId: string, role: string, description: string, subAgentId: string): ToolResult {
    const safeDesc = description || '';
    return this.success(
      [
        '[Task 已启动 - 后台运行]',
        `任务组 ID: ${groupId}`,
        `Agent: ${this.getAgentName(role)}`,
        `任务: ${safeDesc.slice(0, 200)}`,
        '',
        '注意：异步任务不支持 stream_to_user。后台任务完成后系统会自动通知你汇总结果。',
        '',
        '不要主动查询任务状态或等待——系统会逐个通知你。继续做你当前的工作即可。',
        '',
        '重要：异步任务的输出结果用户不可见，系统只会通过内部上下文告诉你。',
        '你必须口头向用户汇报结果，不能说"已经呈现在上下文"之类的话。',
        '',
        '---',
      ].join('\\\\n'),
      {
        taskAsync: true,
        groupId,
        agentType: role,
        subAgentId,
      },
    );
  }

  private formatResult(result: SubAgentResult, streamToUser?: boolean, role?: string): ToolResult {
    const agentName = role ? this.getAgentName(role) : 'unknown-agent';

    const meta = [
      `[Sub-agent completed]`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      `Iterations: ${result.iterations}`,
      `Tokens: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`,
      result.timedOut ? '⚠️ Timed out' : '',
    ].filter(Boolean).join(' | ');

    const streamedNote = streamToUser
      ? `[Sub-agent output was displayed to the user in real-time — reference it if needed but do NOT repeat it verbatim.]\n\n`
      : '';

    const metadataMarker = `\n\n<!-- SUB_AGENT_METADATA: ${JSON.stringify({
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      originalOutput: result.result,
    })} -->`;

    const referenceHint = [
      '',
      '---',
      `⚠️ 当你向上汇报此子agent的执行结果时，必须为每条关键发现附带可点击引用。`,
      `引用格式（直接写在正文中，不要放在代码块或引用块里）：`,
      '',
      `📎 [${agentName}]："从上方输出中逐字复制一句原话"`,
      '',
      `引用名称必须是 "${agentName}"，否则用户无法点击查看完整输出。`,
      `每条结论都要有对应引用，不能只说"有报告指出"。`,
    ].join('\n');

    const content = `${meta}\n\n${streamedNote}${result.result}${referenceHint}${metadataMarker}`;

    return this.success(content, {
      subAgent: true,
      agentName,
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      timedOut: result.timedOut,
      iterations: result.iterations,
      originalOutput: result.result,
    });
  }

  private getAgentName(role: string): string {
    if (this.agentRegistry) {
      const agentConfig = this.agentRegistry.get(role);
      if (agentConfig?.name) {
        return agentConfig.name;
      }
    }
    return role;
  }

  /** 从 AgentRegistry 读取 agent 的 category，映射为 agentType */
  private getAgentType(role: string): string {
    if (this.agentRegistry) {
      const agentConfig = this.agentRegistry.get(role);
      if (agentConfig) {
        const category = (agentConfig as any).metadata?.category || 'custom';
        if (category === 'system') return 'builtin';
        if (category === 'app') return 'preset';
        return 'custom';
      }
    }
    return 'temporary';
  }
}
