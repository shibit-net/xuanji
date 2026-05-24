// ============================================================
// ChatSession - 会话管理器
// ============================================================

import type { AgentLoop, AgentCallbacks } from '@/core/agent/AgentLoop';
import type { DependencyContainer } from '@/core/di';
import type { IPermissionController, ConfirmationHandler, PlanReviewHandler } from '@/permission/types';
import type { IToolRegistry, AppConfig, AgentState } from '@/core/types';
import type { AskUserHandler } from '@/core/tools/AskUserTool';
import type { PlanModeEnterHandler } from '@/core/tools/EnterPlanModeTool';
import type { PlanModeExitHandler } from '@/core/tools/ExitPlanModeTool';
import type { SessionManager } from '@/session/SessionManager';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { SkillRegistry } from '@/core/skills';
import type { MCPManager } from '@/mcp/MCPManager';
import { StateTracker } from '@/core/state/StateTracker';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import type { SessionStateMachine, SessionAction } from '@/core/state/SessionStateMachine';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { logger } from '@/core/logger';
import { setLogContext } from '@/core/logger/implementations/PinoLogger';

const log = logger.child({ module: 'ChatSession' });

export interface SessionCallbacks extends AgentCallbacks {
  onBeforeExecution?: (input: string) => void | Promise<void>;
  onAfterExecution?: () => void | Promise<void>;
  onArchiveNotification?: (result: any) => void;
}

export class ChatSession {
  private agentLoop: AgentLoop;
  private container: DependencyContainer;
  private callbacks?: SessionCallbacks;
  private stateTracker: StateTracker;
  private _pendingQueue: string[] = [];
  private userId: string;
  private workingDir: string;
  private _drainRunning = false;
  private _currentAgentId = 'xuanji';

  // Phase 2 状态机路径
  private _stateMachine: SessionStateMachine | null = null;
  private _useNewPath: boolean = false;
  private _pendingImageBlocks?: Array<{ data: string; mimeType: string; name?: string }>;
  private _pendingAudioBlocks?: Array<{ data: string; mimeType: string; name?: string }>;
  private _pendingVideoBlocks?: Array<{ data: string; mimeType: string; name?: string }>;
  private _pendingAttachments?: Array<{ name: string; path?: string; content: string; size: number; mimeType?: string }>;

  constructor(
    agentLoop: AgentLoop,
    container: DependencyContainer,
    stateTracker: StateTracker,
    callbacks?: SessionCallbacks,
    stateMachine?: SessionStateMachine,
  ) {
    this.agentLoop = agentLoop;
    this.container = container;
    this.stateTracker = stateTracker;
    this.callbacks = callbacks;
    this.userId = 'default';
    this.workingDir = process.cwd();

    try {
      const config = container.resolveSync<AppConfig>('config');
      const cfg = config as Record<string, any>;
      if (cfg.user?.id) this.userId = cfg.user.id;
      if (cfg.projectRoot) this.workingDir = cfg.projectRoot;
      else if (cfg.workspacePath) this.workingDir = cfg.workspacePath;
    } catch { /* 使用默认值 */ }

    if (callbacks) {
      this.agentLoop.on(callbacks);
    }

    // Feature flag 共存：USE_SESSION_STATE_MACHINE !== 'false' 且传入了 stateMachine 时走新路径
    this._useNewPath = process.env.USE_SESSION_STATE_MACHINE !== 'false' && !!stateMachine;
    if (this._useNewPath && stateMachine) {
      this._stateMachine = stateMachine;
      agentLoop.setInterruptChecker(stateMachine);

      // 监听工具执行开始/结束，驱动状态机 thinking ⇄ executing
      eventBus.on(XuanjiEvent.AGENT_TOOL_START, (_payload) => {
        if (stateMachine.getState() === 'thinking') {
          stateMachine.transition({ type: 'AGENT_TOOL_STARTED' });
        }
      });
      eventBus.on(XuanjiEvent.AGENT_TOOL_END, (_payload) => {
        if (stateMachine.getState() === 'executing') {
          stateMachine.transitionTo('thinking');
        }
      });

      log.info('ChatSession initialized with SessionStateMachine (new path)');
    } else {
      agentLoop.setPendingQueue(this._pendingQueue);
      log.info('ChatSession initialized with StateTracker + TaskOrchestrator');
    }
  }

  async run(input: string, opts?: { fromDrain?: boolean }): Promise<void> {
    const imageBlocks = this._pendingImageBlocks;
    const audioBlocks = this._pendingAudioBlocks;
    const videoBlocks = this._pendingVideoBlocks;
    const attachments = this._pendingAttachments;
    // 仅在确认消费时清理 pending blocks；re-entrancy 时保留供 drainPendingQueue 消费
    // 防止 re-entrancy：如果 AgentLoop 仍在运行，入队而非启动新轮次
    // fromDrain=true 时跳过守卫 —— drainPendingQueue 在 agentLoop 刚结束后调用，
    // 不需要再次检查，且检查可能导致消息被错误重排队而永久卡死
    if (!opts?.fromDrain && this.agentLoop.getState().status !== 'idle') {
      log.warn('run() called while AgentLoop is still running, queuing instead');
      if (this._useNewPath && this._stateMachine) {
        this._stateMachine.pendingMessages.push(input);
      } else {
        this._pendingQueue.push(input);
      }
      return;
    }
    // 确认消费：清理 pending blocks
    this._pendingImageBlocks = undefined;
    this._pendingAudioBlocks = undefined;
    this._pendingVideoBlocks = undefined;
    this._pendingAttachments = undefined;

    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setLogContext({ execId, depth: 0 });
    log.info(`[DIAG] Session run started: agentLoop.running=${(this.agentLoop as any).running} input="${input.substring(0, 80)}"`);

    try {
      await this.callbacks?.onBeforeExecution?.(input);

      // 自动加载记忆上下文：在 agent 执行前搜索相关记忆并注入 system prompt
      await this.autoLoadMemoryContext(input);

      if (this._useNewPath && this._stateMachine) {
        this._stateMachine.transition({ type: 'AGENT_STARTED' });
      } else {
        this.stateTracker.transitionTo('executing');
      }
      const sessionCallbacks = this.callbacks as any;
      this.agentLoop.on({
        onText: (text: string) => {
          if (text.trim()) {
            if (this._useNewPath && this._stateMachine) {
              this._stateMachine.transition({ type: 'AGENT_TEXT_STARTED' });
            } else {
              this.stateTracker.transitionTo('outputting');
            }
          }
          sessionCallbacks?.onText?.(text);
        },
        onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
          if (!this._useNewPath) {
            this.stateTracker.transitionTo('executing');
          }
          sessionCallbacks?.onToolStart?.(id, name, input);
        },
        onToolEnd: (id: string, name: string, result: string, isError: boolean, metadata?: Record<string, unknown>, contentBlocks?: Array<{ type: 'image'; mimeType: string; data: string }>) => {
          // PostToolUse 兜底：检测子 Agent 工具完成，触发 LLM 记忆提取
          this.postToolUseFallback(name, { id, result, isError });
          sessionCallbacks?.onToolEnd?.(id, name, result, isError, metadata, contentBlocks);
        },
      } as any);
      // 注入渠道标识到 system prompt
      this.agentLoop.getContextManager().setSystemPromptSuffix(
        '\n[当前渠道: xuanji 桌面客户端] 你正在通过 xuanji 桌面客户端与用户对话。消息支持完整 Markdown、代码高亮、图片发送。',
        'channel-info',
      );

      // 执行前修复：清理上次中断/异常遗留的孤立 tool_use 块，防止 API 400 错误
      this.repairOrphanedToolUse();

      log.info('[DIAG] ChatSession.run: about to call agentLoop.run, agentLoop.running=' + (this.agentLoop as any).running);
      await this.agentLoop.run(input, undefined, imageBlocks, audioBlocks, videoBlocks, attachments);
      log.info('[DIAG] ChatSession.run: agentLoop.run completed');

      // 清理后台任务 completion hint + 渠道标识
      this.agentLoop.getContextManager().setSystemPromptSuffix('', 'async-task-completion');
      this.agentLoop.getContextManager().setSystemPromptSuffix('', 'channel-info');

      if (this._useNewPath && this._stateMachine) {
        // 新路径：状态机处理完成 → 可能自动排队运行下一轮
        const action = this._stateMachine.transition({ type: 'AGENT_COMPLETED' });
        if (action.type === 'RUN_AGENT') {
          await this.run(action.message);
          return;
        }
        if (this._stateMachine.pendingMessages.length === 0) {
          eventBus.emitSync('queue:consumed');
        }
        // 检查待处理的异步任务完成通知（auto-summarize 期间到达的 completion）
        await this.checkPendingCompletions();
      } else {
        // 旧路径：StateTracker + drain
        this.stateTracker.transitionTo('idle');
        await this.checkPendingCompletions();
        await this.drainPendingQueue();
      }

      await this.callbacks?.onAfterExecution?.();
      log.info('Session run completed');
    } catch (error) {
      this.agentLoop.getContextManager().setSystemPromptSuffix('', 'channel-info');
      log.error('Session run failed', error as Error);
      const errMsg = (error as Error).message || '';
      const isInterrupt = errMsg === 'Interrupted' || errMsg.includes('abort') || errMsg.includes('aborted');

      if (this._useNewPath && this._stateMachine) {
        if (isInterrupt) {
          // 用户打断是正常流程：先修复可能因中断产生的孤立 tool_use 块，
          // 然后 handleAgentCompleted 消费 pendingMessages 并合并，
          // 通过递归 run() 用修复后的上下文处理排队消息
          this.repairOrphanedToolUse();
          const action = this._stateMachine.transition({ type: 'AGENT_COMPLETED' });
          if (action.type === 'RUN_AGENT') {
            await this.run(action.message);
            return;
          }
          if (this._stateMachine.pendingMessages.length === 0) {
            eventBus.emitSync('queue:consumed');
          }
        } else {
          // 真实错误（API 400 等）：清理孤儿 tool_use 块，切到 idle，
          // 通知 UI 队列已消费（避免前端状态卡在"排队中"），
          // 清空 pendingMessages 防止下次 userAction 合并损坏上下文
          this.repairOrphanedToolUse();
          this._stateMachine.transitionTo('idle');
          this._stateMachine.pendingMessages.length = 0;
          eventBus.emitSync('queue:consumed');
        }
      } else {
        // 旧路径：先清理孤儿 tool_use 块防止 drain 重复 400 错误，
        // 再切到 idle 排空队列
        this.repairOrphanedToolUse();
        this.stateTracker.transitionTo('idle');
        this.drainPendingQueue();
        eventBus.emitSync('queue:consumed');
      }
      if (!isInterrupt) {
        throw error;
      }
    } finally {
      // 异步提取会话记忆，不阻塞用户
      this.scheduleMemoryExtraction();
    }
  }

  /**
   * PostToolUse 兜底：子 Agent（task/agent_team）完成时检测 LLM 是否调了 memory_store。
   * 如果未调用且结果包含有意义的信息，通过 HookRegistry.emit 触发异步提取。
   */
  private postToolUseFallback(toolName: string, _ctx: { id: string; result: string; isError: boolean }): void {
    const subAgentTools = ['task', 'agent_team'];
    // 直接文件写入和命令执行也是开发活动的关键信号，触发记忆提取
    const devTools = ['write_file', 'edit_file', 'bash'];
    if (!subAgentTools.includes(toolName) && !devTools.includes(toolName)) return;

    const contextManager = this.agentLoop.getContextManager();
    const memoryManager = (contextManager as any).archiveDelegate as import('@/core/memory/MemoryManager').MemoryManager | undefined;
    if (!memoryManager) {
      log.debug('[PostToolUse] MemoryManager not available, skipping fallback');
      return;
    }

    // 检查该 tool 的 PostToolUse 是否已在 60s 内触发过（防止同一轮重复）
    if (memoryManager.wasMemoryStoredRecently(`posttooluse:${toolName}`, 60000)) {
      log.debug(`[PostToolUse] Fallback already triggered for ${toolName} in last 60s, skipping`);
      return;
    }

    // 检查子 agent 执行期间是否已主动调过 memory_store
    if (memoryManager.wasAnyMemoryStoredRecently(60000)) {
      log.debug(`[PostToolUse] memory_store was called recently, skip fallback extraction for ${toolName}`);
      return;
    }

    log.info(`[PostToolUse] Triggering fallback extraction for ${toolName}`);
    memoryManager.recordToolCall('posttooluse_dedup', undefined, `posttooluse:${toolName}`);

    // 异步提取
    setTimeout(() => {
      const messages = contextManager.getMessages().slice(-10);
      if (messages.length > 0) {
        memoryManager.extractFromSession(messages).catch(err => {
          log.error('PostToolUse fallback extraction failed:', err);
        });
      }
    }, 3000);
  }

  /**
   * 自动加载记忆上下文：每轮对话开始前搜索相关记忆并注入 system prompt。
   * 确保 agent 无需主动调用 memory_search 即可获取相关上下文。
   */
  private async autoLoadMemoryContext(input: string): Promise<void> {
    try {
      const contextManager = this.agentLoop.getContextManager();
      const memoryManager = (contextManager as any).archiveDelegate as import('@/core/memory/MemoryManager').MemoryManager | undefined;
      if (!memoryManager) return;

      // 记录用户活动 + 缓存最近消息供 buildContext Stage A 使用
      memoryManager.recordActivity();
      memoryManager.setRecentMessages(contextManager.getMessages());

      // 并行：搜索相关记忆 + 时间感知 + 轻量 buildContext
      const [results, memoryContext] = await Promise.all([
        memoryManager.search({ query: input, limit: 5 }),
        memoryManager.buildContext({ messages: contextManager.getMessages(), maxTokens: 400 }),
      ]);

      // 时间感知（CareManager）
      let timeContext = '';
      const careManager = (memoryManager as any).careManager;
      if (careManager) {
        try {
          // 从 session 获取上次活跃时间
          const lastActiveAt = (this as any)._lastActiveAt || Date.now() - 3600000;
          const awareness = careManager.buildTimeAwareness(lastActiveAt);
          if (awareness) {
            timeContext = `\n\n${awareness}`;
          }
        } catch { /* ok */ }
      }
      (this as any)._lastActiveAt = Date.now();

      const sourceLabels: Record<string, string> = {
        entities: '实体', facts: '事实', events: '事件', episodes: '叙事',
        topic_tracker: '话题', time_anchors: '提醒', user_profile: '画像',
        behavior_patterns: '模式', groups: '群组',
      };
      const lines = results.slice(0, 5).map((r: any) => {
        const source = sourceLabels[r.source_table] || r.source_table;
        return `- [${source}] ${r.title}: ${r.content}`;
      });

      const memorySection = lines.length > 0
        ? `## Relevant Memory (auto-loaded)\n${lines.join('\n')}\n\nApply these remembered facts and preferences in your response. If they conflict with the user's current request, follow the user's latest instruction and store the correction.`
        : '';

      // 合并：搜索结果 + buildContext (Stage A/C/D/E/F 的提醒/话题/模式)
      const buildContextSection = memoryContext || '';

      if (!memorySection && !timeContext && !buildContextSection) {
        contextManager.setSystemPromptSuffix('', 'memory-context');
        return;
      }

      const suffix = `${memorySection}${buildContextSection}${timeContext}`;
      contextManager.setSystemPromptSuffix(suffix, 'memory-context');
    } catch (err) {
      // 记忆加载失败不应阻塞对话
      log.warn('autoLoadMemoryContext failed:', err);
    }
  }

  /**
   * 修复因 AgentLoop 中断产生的孤立 tool_use 块。
   *
   * 当中断发生在 assistant(tool_use) 已写入但 tool_result 尚未写入之间时，
   * 消息历史中会留下孤儿 tool_use，导致后续 API 调用返回 400。
   * 扫描全部消息历史，检测并移除所有不配对的 tool_use 块。
   */
  private repairOrphanedToolUse(): void {
    const contextManager = this.agentLoop.getContextManager();
    const removedIds = contextManager.repairOrphanedToolUses();
    if (removedIds.length > 0) {
      log.info(`Repaired orphaned tool_use blocks on interrupt: [${removedIds.join(', ')}]`);
    }
  }

  /** 异步提取会话记忆，延迟 5 秒执行。先持久化到文件防止进程退出丢失。 */
  private scheduleMemoryExtraction(): void {
    const contextManager = this.agentLoop.getContextManager();
    const memoryManager = (contextManager as any).archiveDelegate as import('@/core/memory/MemoryManager').MemoryManager | undefined;
    if (!memoryManager) return;

    const messages = contextManager.getMessages();
    if (messages.length === 0) return;

    // 先持久化待提取消息到文件（进程退出保护），再异步提取
    memoryManager.savePendingExtraction(messages).catch(() => {});
    setTimeout(() => {
      memoryManager.extractFromSession(messages).catch(err => {
        log.error('Session memory extraction failed:', err);
      });
    }, 5000);
  }

  /** 由 IntentRouter 调用，设置当前执行的 agentId。
   *  仅更新 _currentAgentId，不重建 AgentLoop 配置。
   *  新代码应使用 switchForegroundAgent() 以完整替换 provider/systemPrompt/tools。 */
  setCurrentAgent(agentId: string): void {
    this._currentAgentId = agentId;
    log.info(`Current agent set to: ${agentId}`);
  }

  /** 动态切换前台 agent：完整替换 AgentLoop 的 provider/systemPrompt/tools */
  async switchForegroundAgent(agentId: string, scene?: string, complexity?: string): Promise<void> {
    try {
      // 1. SystemPrompt：builder 分层构建（始终执行以收集 prompt 组件信息）
      const builder = this.getLayeredPromptBuilder();
      let systemPrompt: string | undefined;
      if (builder) {
        const buildListener = (event: import('@/core/prompt/types').PromptBuildEvent) => {
          if (event.type === 'build:complete' && event.data?.layers) {
            eventBus.emit(XuanjiEvent.AGENT_PROMPT_COMPONENTS, {
              agentId,
              scene: scene || '',
              complexity: complexity || 'standard',
              layers: event.data.layers as Array<{ layer: number; components: Array<{ id: string; name: string }> }>,
              totalComponents: event.data.totalComponents as number,
              estimatedTokens: event.data.estimatedTokens as number,
            });
          }
        };
        builder.addEventListener(buildListener);
        const result = await builder.build({ scene, complexity: complexity as any });
        builder.removeEventListener(buildListener);
        systemPrompt = result.prompt;
      }

      const registry = this.getAgentRegistry();
      const agentConfig = registry.get(agentId);
      if (!agentConfig) {
        log.warn(`Agent "${agentId}" not found in registry, falling back to setCurrentAgent`);
        this.setCurrentAgent(agentId);
        return;
      }

      this._currentAgentId = agentId;
      this.agentLoop.setUserId(agentId);
      log.info(`Switching foreground agent to: ${agentId} (scene=${scene}, complexity=${complexity})`);

      if (agentConfig.systemPrompt) {
        systemPrompt = systemPrompt
          ? `${systemPrompt}\n\n${agentConfig.systemPrompt}`
          : agentConfig.systemPrompt;
      }

      // 2. 通过 AgentFactory 统一解析 provider + 工具列表
      const agentFactory = await this.container.resolve('agentFactory') as import('@/core/agent/factory/AgentFactory').AgentFactory;
      const { provider: newProvider, toolNames } = agentFactory.resolveAgentComponents(agentId, complexity);

      const baseRegistry = this.getBaseRegistry();
      const { FilteredToolRegistry } = await import('@/core/tools/FilteredToolRegistry');
      const toolRegistry: IToolRegistry = new FilteredToolRegistry(baseRegistry, toolNames);

      // 3. 应用 agent 自身配置到 AgentLoop
      const agentProvider = agentConfig.provider;

      this.agentLoop.applyAgentConfig({
        provider: newProvider,
        apiKey: agentProvider?.apiKey,
        baseURL: agentProvider?.baseURL,
        systemPrompt,
        toolRegistry,
        model: agentConfig.model.primary,
        maxIterations: agentConfig.execution?.maxIterations,
        temperature: agentConfig.model.temperature,
        maxTokens: agentConfig.model.maxTokens,
      });

      log.info(`Foreground agent switched: ${agentId}, tools=[${toolNames.join(',')}]`);
    } catch (error) {
      // builder/provider/tool 任一步骤异常 → 退化为简单 setCurrentAgent，保证 AgentLoop 不崩
      log.error(`Failed to switch foreground agent to "${agentId}"`, error as Error);
      this.setCurrentAgent(agentId);
    }
  }

  get currentAgentId(): string {
    return this._currentAgentId;
  }

  /**
   * 统一处理用户输入 — 根据 StateTracker 状态自动决策
   *
   * - idle / waiting_async → 直接 run
   * - executing / outputting → append 到队列，等当前工具调用或流式输出结束后自动处理
   *
   * 不再强制中断当前工具执行。用户新消息会被注入到 AgentLoop 的迭代边界检查点。
   * 终止请使用 stop() 或 requestAbort()。
   */
  handleUserInput(input: string, imageBlocks?: Array<{ data: string; mimeType: string; name?: string }>, audioBlocks?: Array<{ data: string; mimeType: string; name?: string }>, videoBlocks?: Array<{ data: string; mimeType: string; name?: string }>, attachments?: Array<{ name: string; path?: string; content: string; size: number; mimeType?: string }>): 'running' | 'queued' | 'interrupted' {
    if (imageBlocks) {
      this._pendingImageBlocks = imageBlocks;
    }
    if (audioBlocks) {
      this._pendingAudioBlocks = audioBlocks;
    }
    if (videoBlocks) {
      this._pendingVideoBlocks = videoBlocks;
    }
    if (attachments) {
      this._pendingAttachments = attachments;
    }
    const state = this.stateTracker.getState();
    const agentLoopStatus = this.agentLoop.getState().status;
    log.info(`[DIAG] handleUserInput: state=${state} agentLoopStatus=${agentLoopStatus} _useNewPath=${this._useNewPath} _stateMachine=${!!this._stateMachine} input="${input.substring(0, 60)}"`);

    switch (state) {
      case 'idle':
      case 'waiting_async':
        // 二次确认 AgentLoop 确实空闲 — StateTracker 可能因竞态短暂不一致
        if (this.agentLoop.getState().status !== 'idle') {
          log.warn(`[handleUserInput] StateTracker=${state} but AgentLoop is still running, queuing`);
          this.appendMessage(input);
          return 'queued';
        }
        if (state === 'waiting_async') {
          this.agentLoop.getContextManager().setSystemPromptSuffix('', 'delegation-complete');
          this.agentLoop.getContextManager().setSystemPromptSuffix('', 'async-task-completion');
          this.agentLoop.getContextManager().setSystemPromptSuffix(
            '\\n用户发了新消息。后台任务完成后会自动通知你，不用主动查询或等待。直接处理用户的最新请求。',
            'new-message-during-async',
          );
        }
        this.run(input).catch((err) => {
          log.error('handleUserInput run failed:', err);
        });
        return 'running';

      case 'executing':
      case 'outputting':
        // 执行工具中或流式输出中 → 入队，等待当前迭代边界（工具结束/流式输出结束）自动处理
        this.appendMessage(input);
        return 'queued';

      default:
        this.run(input).catch((err) => {
          log.error('handleUserInput run failed:', err);
        });
        return 'running';
    }
  }

  /**
   * 统一用户操作入口（Phase 2 新路径）。
   *
   * flag off 时委托旧方法 (handleUserInput / interrupt)。
   * flag on 时走状态机 transition → 执行 SessionAction。
   */
  async userAction(action: { type: string; message?: string; imageBlocks?: Array<{ data: string; mimeType: string; name?: string }>; audioBlocks?: Array<{ data: string; mimeType: string; name?: string }>; videoBlocks?: Array<{ data: string; mimeType: string; name?: string }>; attachments?: Array<{ name: string; path?: string; content: string; size: number; mimeType?: string }> }): Promise<void> {
    // 存储 content blocks 供 run() 使用（新旧路径均需）
    if (action.imageBlocks) {
      this._pendingImageBlocks = action.imageBlocks;
    }
    if (action.audioBlocks) {
      this._pendingAudioBlocks = action.audioBlocks;
    }
    if (action.videoBlocks) {
      this._pendingVideoBlocks = action.videoBlocks;
    }
    if (action.attachments) {
      this._pendingAttachments = action.attachments;
    }
    if (!this._useNewPath || !this._stateMachine) {
      // 回退到旧路径
      if (action.type === 'SEND_MESSAGE' && action.message) {
        this.handleUserInput(action.message, action.imageBlocks, action.audioBlocks, action.videoBlocks, action.attachments);
      } else if (action.type === 'INTERRUPT') {
        this.interrupt(action.message ?? '');
      }
      return;
    }
    return this.userActionNewPath(action);
  }

  /** 新路径：状态机驱动的用户操作处理 */
  private async userActionNewPath(action: { type: string; message?: string }): Promise<void> {
    const sm = this._stateMachine!;

    // 将 IPC UserAction 映射为 SessionEvent
    const event: import('@/core/state/SessionStateMachine').SessionEvent =
      action.type === 'INTERRUPT'
        ? { type: 'USER_INTERRUPT', message: action.message }
        : { type: 'USER_MESSAGE', message: action.message || '' };

    const result: SessionAction = sm.transition(event);

    switch (result.type) {
      case 'RUN_AGENT':
        await this.run(result.message);
        break;
      case 'ABORT_AGENT':
        this.agentLoop.stop();
        break;
      case 'QUEUE_ONLY':
        eventBus.emitSync('queue:message-queued');
        break;
      case 'EMIT_SESSION_IDLE':
      case 'RUN_AUTO_SUMMARIZE':
      case 'NOOP':
        break;
    }
  }

  /** 消费 pendingQueue 中的消息 */
  private async drainPendingQueue(): Promise<void> {
    if (this._pendingQueue.length === 0) return;
    if (this._drainRunning) return;

    this._drainRunning = true;
    log.info(`[drainPendingQueue] start draining, queue size=${this._pendingQueue.length}`);

    try {
      while (this._pendingQueue.length > 0) {
        const next = this._pendingQueue.shift()!;
        log.info(`[drainPendingQueue] processing: "${next.substring(0, 80)}"`);
        try {
          // 把队列里剩余的消息也合并进来，一次性处理
          const combined = [next];
          while (this._pendingQueue.length > 0) {
            combined.push(this._pendingQueue.shift()!);
          }
          await this.run(combined.join('\n'), { fromDrain: true });
        } catch (err) {
          log.error('Drain pending message failed:', err);
        }
      }
    } finally {
      this._drainRunning = false;
      log.info('[drainPendingQueue] draining complete');
    }
  }

  private async checkPendingCompletions(): Promise<void> {
    try {
      const handler = TaskOrchestrator.getInstance().getCompletionHandler();
      if (!handler) return;

      if (handler.hasPending()) {
        await handler.checkAndAutoSummarize();
      }
    } catch (err) {
      log.warn('Failed to check pending completions:', err);
    }
  }

  stop(): void {
    this.agentLoop.requestAbort();
  }

  /**
   * 硬中断（立即停止当前流式请求和工具执行）
   * 仅在极端情况下使用，正常终止请使用 stop()
   */
  hardStop(): void {
    this.agentLoop.stop();
  }

  interrupt(input: string): void {
    log.info(`[interrupt] stopping agent, state=${this.stateTracker.getState()}, input="${input.substring(0, 60)}"`);

    // 纯停止（无新输入）：硬中断，立即中止 LLM 流 + 工具执行
    if (!input.trim()) {
      this.hardStop();
      return;
    }

    // 中断 + 新消息：软中断，排队新输入，等当前迭代结束后消费
    this._pendingQueue.unshift(input);
    this.agentLoop.requestAbort();
    // 等 AgentLoop 停稳后统一消费整个队列
    const waitAndDrain = () => {
      if (this.agentLoop.getState().status !== 'idle') {
        setTimeout(waitAndDrain, 50);
        return;
      }
      this.drainPendingQueue();
    };
    setTimeout(waitAndDrain, 50);
  }

  appendMessage(message: string): void {
    this._pendingQueue.push(message);
    log.info(`[appendMessage] queued, pendingQueue size=${this._pendingQueue.length}, state=${this.stateTracker.getState()}`);
  }

  /**
   * 检查并消费 pendingQueue
   * 每次 run 结束后自动调用，也允许外部手动触发
   */
  checkPendingQueue(): void {
    if (this._pendingQueue.length > 0 && this.stateTracker.getState() !== 'executing') {
      this.drainPendingQueue();
    }
  }

  reset(): void {
    this.agentLoop.reset();
  }

  getAgentLoop(): AgentLoop {
    return this.agentLoop;
  }

  getContainer(): DependencyContainer {
    return this.container;
  }

  getState(): AgentState {
    return this.agentLoop.getState();
  }

  getConfig(): AppConfig {
    return this.container.resolveSync<AppConfig>('config');
  }

  setConfirmationHandler(handler: ConfirmationHandler): void {
    try {
      const permissionController = this.container.resolveSync<IPermissionController>('permissionController');
      permissionController.setConfirmationHandler(handler);
    } catch (error) {
      log.warn('Failed to set confirmation handler:', error);
    }
  }

  setPlanReviewHandler(handler: PlanReviewHandler): void {
    try {
      const permissionController = this.container.resolveSync<IPermissionController>('permissionController');
      permissionController.setPlanReviewHandler(handler);
    } catch (error) {
      log.warn('Failed to set plan review handler:', error);
    }
  }

  setAskUserHandler(handler: AskUserHandler): void {
    try {
      const toolRegistry = this.container.resolveSync<IToolRegistry>('toolRegistry');
      const askUserTool = toolRegistry.get('ask_user');
      if (askUserTool && 'setHandler' in askUserTool) {
        (askUserTool as any).setHandler(handler);
      }
    } catch (error) {
      log.warn('Failed to set ask user handler:', error);
    }
  }

  setPlanModeEnterHandler(handler: PlanModeEnterHandler): void {
    try {
      const toolRegistry = this.container.resolveSync<IToolRegistry>('toolRegistry');
      const tool = toolRegistry.get('enter_plan_mode');
      if (tool && 'setHandler' in tool) {
        (tool as any).setHandler(handler);
      }
    } catch (error) {
      log.warn('Failed to set plan mode enter handler:', error);
    }
  }

  setPlanModeExitHandler(handler: PlanModeExitHandler): void {
    try {
      const toolRegistry = this.container.resolveSync<IToolRegistry>('toolRegistry');
      const tool = toolRegistry.get('exit_plan_mode');
      if (tool && 'setHandler' in tool) {
        (tool as any).setHandler(handler);
      }
    } catch (error) {
      log.warn('Failed to set plan mode exit handler:', error);
    }
  }

  getPermissionController(): IPermissionController {
    return this.container.resolveSync<IPermissionController>('permissionController');
  }

  getSessionManager(): SessionManager {
    return this.container.resolveSync<SessionManager>('sessionManager');
  }

  getAgentRegistry(): AgentRegistry {
    return this.container.resolveSync<AgentRegistry>('agentRegistry');
  }

  getSkillRegistry(): SkillRegistry | null {
    try {
      return this.container.resolveSync<SkillRegistry>('skillRegistry');
    } catch {
      return null;
    }
  }

  getBaseRegistry(): IToolRegistry {
    return this.container.resolveSync<IToolRegistry>('toolRegistry');
  }

  getMCPManager(): MCPManager | null {
    try {
      return this.container.resolveSync<MCPManager>('mcpManager');
    } catch {
      return null;
    }
  }

  getStateTracker(): StateTracker {
    return this.stateTracker;
  }

  getTaskOrchestrator(): TaskOrchestrator {
    return TaskOrchestrator.getInstance();
  }

  getUserId(): string {
    return this.userId;
  }

  getWorkingDir(): string {
    return this.workingDir;
  }

  getLayeredPromptBuilder(): import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder | null {
    try {
      return this.container.resolveSync('layeredPromptBuilder') as import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder;
    } catch {
      return null;
    }
  }

  async saveSession(name?: string, options?: any): Promise<string> {
    const sessionManager = this.getSessionManager();
    const messages = this.agentLoop.getContextManager().getMessages();
    return sessionManager.save(messages as any, name, options);
  }

  async resumeSession(sessionId: string): Promise<any> {
    return this.getSessionManager().resume(sessionId);
  }

  async listSessions(): Promise<any[]> {
    return this.getSessionManager().list();
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.getSessionManager().delete(sessionId);
  }

  async createCheckpoint(label?: string): Promise<string> {
    log.warn('createCheckpoint not implemented');
    return '';
  }

  async listCheckpoints(): Promise<any[]> {
    return [];
  }

  async rewindToCheckpoint(checkpointId: string): Promise<number> {
    return 0;
  }

  async getDiagnostics(): Promise<any> {
    return { state: this.getState(), config: this.getConfig() };
  }

  async cleanup(): Promise<void> {
    log.debug('Cleaning up session');
    if (this.agentLoop) {
      this.agentLoop.stop();
    }
    // 清理状态机 EventBus 监听器
    const unsubs = (this as any)._stateMachineEventUnsubs as Array<() => void> | undefined;
    if (unsubs) {
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
      (this as any)._stateMachineEventUnsubs = undefined;
    }
  }
}
