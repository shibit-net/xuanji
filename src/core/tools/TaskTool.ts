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
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

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
    'ASYNC (async=true): Runs in background. System notifies on completion. Main agent defaults to async to handle other input.',
    'SYNC (async=false): Waits for sub-agent and returns results directly. Output streams in real-time.',
    'Use async=false when you need the sub-agent output to answer the user.',
    'Use async=true for independent background analysis where the user is not waiting.',
    '',
    '⛔ DELEGATION DISCIPLINE (VIOLATION = DUPLICATE WORK + WASTED TOKENS):',
    '',
    '1. After delegating a task to a sub-agent, YOU MUST NOT execute that same task yourself.',
    '   The sub-agent IS doing it. You doing it too = duplicated work, conflicting changes, wasted compute.',
    '',
    '2. Do NOT re-delegate the same task. If you already called task for X, do not call task again for X.',
    '   If you think the first delegation was wrong, use task_control to cancel it first, then re-delegate.',
    '',
    '3. Delegation means OFFLOADING — you are freeing your capacity for OTHER work.',
    '   While the sub-agent runs: focus on a DIFFERENT task, or wait for the result.',
    '   Never say "this is taking too long, I\'ll do it myself" — the sub-agent is already working.',
    '',
    '4. Async task: your turn ENDS after calling task(async=true). Do NOT continue execution.',
    '   The system will notify you when the sub-agent completes. Only then may you resume.',
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
        description: 'Complete task description (sub-agent has NO access to parent conversation — include goals, context, file paths, output format)',
      },
      subagent_type: {
        type: 'string',
        description: 'Agent ID (required). Use match_agent result when score >= 0.5; use custom ID with system_prompt + tools when score < 0.5',
      },
      scene: {
        type: 'string',
        description: [
          'Scene type defining sub-agent behavior and boundaries.',
          '**Must query list_scenes first and pick a valid scene ID**.',
          'Do not invent scene IDs.',
          'Omit if no suitable scene exists.',
        ].join('\n'),
      },
      isolation: {
        type: 'string',
        enum: ['none', 'worktree'],
        description: 'Isolation mode. worktree creates a temporary git worktree. Default: none',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds. Default: 1800000 (30 minutes)',
      },
      system_prompt: {
        type: 'string',
        description: 'Custom system prompt. Required for temporary agents (defines role and expertise). Optional for preset agents (overrides default)',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of tool names available to the sub-agent. Sub-agents have NO tools by default — must be explicitly provided. Minimum: read_file, glob, grep, list_directory. Coding: add write_file, edit_file, bash. Research: add web_fetch',
      },
      stream_to_user: {
        type: 'boolean',
        description: 'Whether sub-agent output streams directly to user. true = independent task output goes to user. false = multi-agent collaboration, main agent integrates',
      },
      async: {
        type: 'boolean',
        description: 'Execution mode. true = async (background, notification on completion). false = sync (wait for completion, output streams in real-time). Main agent defaults to async, sub-agents default to sync. Set false when the sub-agent output is the answer the user needs.',
      },
    },
    required: ['description', 'subagent_type'],
  };

  readonly readonly = false;

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
    layeredPromptBuilder?: import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder;
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
    if (deps.layeredPromptBuilder) {
      this.agentFactory.setLayeredPromptBuilder(deps.layeredPromptBuilder);
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
    // 层级策略 leader 在 TeamContext 内调 task 委派 worker，强制同步（leader 需等待结果汇总）
    const teamCtx = TeamContext.get();
    const inTeam = !!teamCtx;
    const isAsync = !inTeam && (input.async === true || (this.currentDepth === 0 && input.async !== false));

    this.log.debug(`TaskTool.execute: role=${params.role}, inTeam=${inTeam}, strategy=${teamCtx?.strategy}, teamId=${teamCtx?.teamId}, currentDepth=${this.currentDepth}, isAsync=${isAsync}`);

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
        'task cannot be used inside agent_team. agent_team members are execution units and cannot create sub-agents.',
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

    // 捕获 team 上下文（executeAsync 返回后上下文可能丢失，需要提前捕获）
    const capturedTeamCtx = TeamContext.get();

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

        if (capturedTeamCtx) {
          self.emitSubMemberStart(subAgentId, params, capturedTeamCtx);
        }
        const execStartTime = Date.now();

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
            skipSubAgentStartHook: !!capturedTeamCtx,
          }, abortSignal);

          try { process.chdir(savedCwd); } catch { /* ignore */ }

          if (capturedTeamCtx) {
            self.emitSubMemberEnd(subAgentId, params.role, {
              success: execResult.success,
              duration: execResult.duration,
              resultSummary: (execResult.result || '').substring(0, 200),
            }, capturedTeamCtx);
          }

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

          return self.formatResult(execResult, false, params.role, true);
        } catch (error: any) {
          try { process.chdir(savedCwd); } catch { /* ignore */ }

          if (capturedTeamCtx) {
            self.emitSubMemberEnd(subAgentId, params.role, {
              success: false,
              duration: Date.now() - execStartTime,
              resultSummary: error instanceof Error ? error.message : String(error),
            }, capturedTeamCtx);
          }

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
            content: `Background task execution failed: ${errMsg}`,
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

    const teamCtx = TeamContext.get();
    // 层级策略下匹配占位槽位：同 agentId + 同 scene 复用，否则消费新槽位
    let subAgentId: string;
    if (teamCtx?.placeholderSlots) {
      const scene = params.scene || '';
      this.log.info(`[SLOT-DUMP] 匹配前 — incoming agentId="${params.role}" scene="${scene}" slots=[${teamCtx.placeholderSlots.map(s => `${s.memberId}(assigned=${s.assignedAgentId ?? 'FREE'}, scene=${s.assignedScene ?? '-'}, subAgentId=${s.subAgentId})`).join(', ')}]`);

      // 1. 同 agentId + 同 scene → 复用槽位
      let slot = teamCtx.placeholderSlots.find(s => s.assignedAgentId === params.role && s.assignedScene === scene);
      if (slot) {
        subAgentId = slot.subAgentId;
        this.log.info(`[SLOT-MATCH] REUSE slot=${slot.memberId} subAgentId=${subAgentId} for agentId="${params.role}" scene="${scene}"`);
      } else {
        // 2. 消费下一个空闲槽位
        slot = teamCtx.placeholderSlots.find(s => s.assignedAgentId == null);
        if (slot) {
          slot.assignedAgentId = params.role;
          slot.assignedScene = scene;
          slot.name = this.getAgentName(params.role);
          subAgentId = slot.subAgentId;
          this.log.info(`[SLOT-MATCH] ASSIGN slot=${slot.memberId} subAgentId=${subAgentId} to agentId="${params.role}" scene="${scene}"`);
        } else {
          // 3. 无可用槽位，动态创建
          subAgentId = `subtask-${params.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          this.log.info(`[SLOT-MATCH] OVERFLOW — no free slots, creating dynamic subAgentId=${subAgentId} for agentId="${params.role}" scene="${scene}"`);
        }
      }
      this.log.info(`[SLOT-DUMP] 匹配后 — slots=[${teamCtx.placeholderSlots.map(s => `${s.memberId}(assigned=${s.assignedAgentId ?? 'FREE'}, scene=${s.assignedScene ?? '-'})`).join(', ')}]`);
    } else {
      subAgentId = `subtask-${params.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    }

    if (teamCtx) {
      this.emitSubMemberStart(subAgentId, params, teamCtx);
    }

    const startTime = Date.now();

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
        skipSubAgentStartHook: !!teamCtx,
      }, signal);

      // 恢复 cwd，防止子 agent 的 change_directory 影响父 agent
      try { process.chdir(savedCwd); } catch { /* ignore */ }

      this.log.debug(`executeSync: createAndRun completed, success=${result.success}, duration=${result.duration}`);

      if (teamCtx) {
        this.emitSubMemberEnd(subAgentId, params.role, {
          success: result.success,
          duration: result.duration,
          resultSummary: result.result?.substring(0, 200),
        }, teamCtx);
      }

      return this.formatResult(result, params.streamToUser, params.role, false);
    } catch (err) {
      this.log.error(`executeSync: createAndRun threw error for ${subAgentId}:`, err);
      if (teamCtx) {
        this.emitSubMemberEnd(subAgentId, params.role, {
          success: false,
          duration: Date.now() - startTime,
          resultSummary: err instanceof Error ? err.message : String(err),
        }, teamCtx);
      }
      throw err;
    } finally {
      this.activeCount--;
    }
  }

  // ── 结果格式化 ──────────────────────────────────────

  private formatAsyncResponse(groupId: string, role: string, description: string, subAgentId: string): ToolResult {
    const safeDesc = description || '';
    return this.success(
      [
        '[Task Started - Running in Background]',
        `Group ID: ${groupId}`,
        `Agent: ${this.getAgentName(role)}`,
        `Task: ${safeDesc.slice(0, 200)}`,
        '',
        '⛔ Your turn ends NOW. Do NOT continue executing. Stop immediately.',
        '',
        'The system will notify you when the background task completes. Only then should you resume your unfinished work.',
        'Until you receive the system notification, DO NOT query task status. End your response right now.',
        '',
        'IMPORTANT: Async task output is not visible to the user. The system will inject results into your context.',
        'When notified, you MUST report the results to the user verbally. Never say "the results are shown above."',
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

  private formatResult(result: SubAgentResult, streamToUser?: boolean, role?: string, isAsync?: boolean): ToolResult {
    const agentName = role ? this.getAgentName(role) : 'unknown-agent';

    const meta = [
      `[Sub-agent completed]`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      `Iterations: ${result.iterations}`,
      `Tokens: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`,
      result.timedOut ? '⚠️ Timed out' : '',
    ].filter(Boolean).join(' | ');

    const isSync = isAsync === false;
    const teamCtx = TeamContext.get();
    const inHierarchicalTeam = teamCtx?.strategy === 'hierarchical';

    // 同步任务：输出已通过对话框实时展示给用户，主 agent 不应再主动总结。
    // 但输出仍需保留在上下文中，以便用户后续追问时主 agent 能引用。
    // 策略：在输出前放置醒目的"用户已阅"标记，让 LLM 先看到指令再看内容。
    const isSyncNonTeam = isSync && !inHierarchicalTeam;
    const outputBlock = `\n\n${result.result}`;

    const streamedNote = (streamToUser && !isSync)
      ? `\n\n[Sub-agent output was displayed to the user in real-time — reference it if needed but do NOT repeat it verbatim.]\n`
      : '';

    const syncHint = isSyncNonTeam ? [
      '---',
      '⚠️ **用户已在对话框中实时看到了子Agent的完整输出，不要在本次回复中总结或复述。**',
      '以下是存档副本，仅当用户后续明确追问其中内容时才能引用。',
      `（${agentName}，约 ${Math.round((result.result?.length || 0) / 1000)}k 字符）`,
      '---',
    ].join('\n') : '';

    const metadataMarker = `\n\n<!-- SUB_AGENT_METADATA: ${JSON.stringify({
      agentName,
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      originalOutput: result.result,
    })} -->`;

    const referenceHint = isSync ? '' : [
      '',
      '---',
      `⚠️ When reporting this sub-agent's results to the user, every key finding MUST include a clickable citation.`,
      `Citation format (write inline, NOT inside code blocks or blockquotes):`,
      '',
      `📎 [${agentName}]: "Copy a sentence verbatim from the output above"`,
      '',
      `The citation name MUST be "${agentName}", otherwise the user cannot click to view the full output.`,
      `Every conclusion needs a corresponding citation. Never say "a report indicates" without a citation.`,
    ].join('\n');

    const summaryInstruction = (() => {
      const teamCtx = TeamContext.get();
      if (teamCtx?.strategy !== 'hierarchical') return '';
      return [
        '',
        '---',
        '⚠️ **Context Management Directive (execute immediately)**',
        '',
        'Above is the complete output from a sub-agent. To save context budget, in your response:',
        '1. Begin with `[SUMMARY]` on its own line',
        '2. Summarize the sub-agent\'s key findings in 3-5 bullet points',
        '3. End with `[/SUMMARY]` on its own line',
        '4. After the summary, continue your work (delegate next member or synthesize report)',
        '',
        'Note: Summary must be objective and accurate. Do not omit critical technical details or key conclusions.',
      ].join('\n');
    })();

    // 同步任务：syncHint（不要复述）必须放在 outputBlock 之前，让 LLM 先看到指令
    const content = isSyncNonTeam
      ? `${meta}\n\n${syncHint}\n\n${result.result}${referenceHint}${metadataMarker}${summaryInstruction}`
      : `${meta}${outputBlock}${streamedNote}${referenceHint}${metadataMarker}${summaryInstruction}`;

    return this.success(content, {
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

  // ── TeamSubMember 事件发射 ──────────────────────────

  private emitSubMemberStart(
    subAgentId: string,
    params: { role: string; description: string; systemPrompt?: string; scene?: string; tools?: string[] },
    teamCtx: NonNullable<ReturnType<typeof TeamContext.get>>,
  ): void {
    try {
      eventBus.emit(XuanjiEvent.HOOK_TEAM_SUB_MEMBER_START, {
        teamId: teamCtx.teamId,
        parentMemberId: teamCtx.parentMemberId,
        data: {
          memberId: subAgentId,
          subAgentId,
          name: this.getAgentName(params.role),
          role: params.role,
          task: (params.description || '').substring(0, 200),
          agentType: this.getAgentType(params.role),
          scene: params.scene?.replace(/^l[12]-/, ''),
          executionMode: 'acp',
          strategy: teamCtx.strategy,
          teamName: teamCtx.teamName || teamCtx.teamId,
          stepIndex: 0,
          totalSteps: 0,
          systemPromptHint: params.systemPrompt?.substring(0, 100),
        },
      });
    } catch (err) {
      this.log.warn('emitSubMemberStart failed:', err);
    }
  }

  private emitSubMemberEnd(
    subAgentId: string,
    role: string,
    result: { success: boolean; duration: number; resultSummary?: string },
    teamCtx: NonNullable<ReturnType<typeof TeamContext.get>>,
  ): void {
    try {
      eventBus.emit(XuanjiEvent.HOOK_TEAM_SUB_MEMBER_END, {
        teamId: teamCtx.teamId,
        parentMemberId: teamCtx.parentMemberId,
        data: {
          memberId: subAgentId,
          subAgentId,
          memberName: this.getAgentName(role),
          success: result.success,
          duration: result.duration,
          resultSummary: result.resultSummary?.substring(0, 200),
        },
      });
    } catch (err) {
      this.log.warn('emitSubMemberEnd failed:', err);
    }
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
