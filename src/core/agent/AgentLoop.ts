// ============================================================
// M2 Agent — ReAct 循环核心
// ============================================================

import type { AgentConfig, AgentState, TokenUsage, ILLMProvider, IToolRegistry, ToolSchema, Message } from '@/core/types';
import type { IMemoryStore, SessionMemory, ToolCallRecord } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { MessageManager } from './MessageManager';
import { StreamProcessor, type ProcessResult } from './StreamProcessor';
import { ToolDispatcher } from './ToolDispatcher';
import { TokenManager } from './TokenManager';
import { ContextCompressor } from './ContextCompressor';
import { CostTracker } from './CostTracker';
import { PricingResolver } from './PricingResolver';
import { ErrorRecovery } from './ErrorRecovery';
import { MessagePreparationHandler } from './MessagePreparationHandler';
import { MessageContextHandler } from './MessageContextHandler';
import { StreamRetryHandler } from './StreamRetryHandler';
import { ResultProcessor } from './ResultProcessor';
import { ToolExecutionCoordinator } from './ToolExecutionCoordinator';
import { logger } from '@/core/logger';
import { SessionRecorder } from '@/core/telemetry';
import { UsageStatsRecorder } from '@/core/telemetry';
import { PerfCollector } from '@/core/telemetry';
import { AgentLoopLogger } from '@/core/telemetry';

/**
 * Agent 事件回调
 */
export interface AgentCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolDelta?: (id: string, name: string, receivedBytes: number) => void;
  onToolEnd?: (id: string, name: string, result: string, isError: boolean) => void;
  /** 工具执行分组通知（在执行前触发，通知 UI 哪些工具将并行执行） */
  onToolGrouped?: (groups: { parallelIds: string[]; serialIds: string[] }) => void;
  /** 文件变更通知（在工具执行后触发，批量通知所有文件变更） */
  onFileChanges?: (changes: import('@/core/types').FileChange[]) => void;
  onUsage?: (usage: TokenUsage) => void;
  /** 非致命提示信息（如 max_tokens 自动重试） */
  onInfo?: (message: string) => void;
  onError?: (error: Error) => void;
  onEnd?: (state: AgentState) => void;
}

/**
 * AgentLoop — ReAct 推理循环核心
 *
 * 循环流程:
 * 1. 构建消息数组
 * 2. 调用 LLM API (流式)
 * 3. 解析响应 (文本/工具调用)
 * 4. 如果有工具调用 → 执行工具 → 结果回传 → 回到 2
 * 5. 如果没有工具调用 (end_turn) → 结束
 */
export class AgentLoop {
  private log = logger.child({ module: 'AgentLoop' });
  private messageManager: MessageManager;
  private streamProcessor: StreamProcessor;
  private toolDispatcher: ToolDispatcher;
  private tokenManager: TokenManager;
  private contextCompressor: ContextCompressor;
  private costTracker: CostTracker;
  private errorRecovery: ErrorRecovery;
  private sessionRecorder: SessionRecorder;
  private usageStatsRecorder: UsageStatsRecorder;
  private perfCollector: PerfCollector;
  private agentLoopLogger: AgentLoopLogger | null = null;  // 🆕 AgentLoop 执行日志记录器
  private provider: ILLMProvider;
  private registry: IToolRegistry;
  private config: AgentConfig;
  private callbacks: AgentCallbacks = {};
  private running = false;
  private currentIteration = 0;
  private memoryStore: IMemoryStore | null = null;
  private hookRegistry: HookRegistry | null = null;
  /** 🆕 消息准备处理器 */
  private messagePreparationHandler: MessagePreparationHandler;
  /** 🆕 消息上下文处理器 */
  private messageContextHandler: MessageContextHandler;
  /** 🆕 Stream 重试处理器 */
  private streamRetryHandler: StreamRetryHandler;
  /** 🆕 结果处理器 */
  private resultProcessor: ResultProcessor;
  /** 🆕 工具执行协调器 */
  private toolExecutionCoordinator: ToolExecutionCoordinator;
  /** 🆕 P1 优化：Extended Thinking 配置（由 ChatSession 动态设置） */
  private thinkingConfig: import('@/core/types').ThinkingConfig | undefined = undefined;
  /** 当前活跃的 stream 引用（用于 stop() 时中止流） */
  private _currentStream: AsyncIterable<import('@/core/types').StreamEvent> | null = null;
  /** 原始 textHandler（构造函数中注册的，避免 stop()+run() 循环时 handler 链无限增长） */
  private _originalTextHandler: ((text: string) => void) | undefined;
  /** 中断追加标志：用户在执行中输入了补充指令 */
  private _interrupted = false;
  /** 待追加的用户消息（interrupt 时设置，循环中消费） */
  private _pendingAppendMessage: string | null = null;
  /** 🔧 全局 AbortController：用于级联终止所有子任务（工具、sub-agent、team） */
  private _abortController: AbortController | null = null;

  constructor(
    provider: ILLMProvider,
    registry: IToolRegistry,
    config: AgentConfig,
    memoryStore?: IMemoryStore,
  ) {
    this.provider = provider;
    this.registry = registry;
    this.config = config;
    this.memoryStore = memoryStore ?? null;
    this.messageManager = new MessageManager(config.systemPrompt);
    this.streamProcessor = new StreamProcessor();
    this.toolDispatcher = new ToolDispatcher(registry);
    this.tokenManager = new TokenManager();
    this.contextCompressor = new ContextCompressor(config.compressor);
    // 注入 LLM Provider 以启用语义压缩
    this.contextCompressor.setProvider(provider, {
      model: config.model,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });
    this.costTracker = new CostTracker(config.model);
    this.errorRecovery = new ErrorRecovery();
    this.sessionRecorder = new SessionRecorder();
    this.usageStatsRecorder = new UsageStatsRecorder();
    this.perfCollector = new PerfCollector();

    // 初始化辅助模块
    this.messagePreparationHandler = new MessagePreparationHandler(this.messageManager);
    this.messageContextHandler = new MessageContextHandler(
      this.contextCompressor,
      this.tokenManager,
      this.messageManager,
    );
    this.streamRetryHandler = new StreamRetryHandler(
      provider,
      this.streamProcessor,
      this.errorRecovery,
      this.perfCollector,
      config,
      undefined, // thinkingConfig 稍后通过 setThinking() 设置
    );
    this.resultProcessor = new ResultProcessor(
      this.messageManager,
      this.contextCompressor,
      this.tokenManager,
    );
    this.toolExecutionCoordinator = new ToolExecutionCoordinator(
      registry,
      this.toolDispatcher,
      null, // hookRegistry 稍后通过 setHookRegistry() 注入
    );

    // 注册流处理回调
    this.streamProcessor.onTextDelta((text) => this.callbacks.onText?.(text));
    this._originalTextHandler = this.streamProcessor.getTextHandler();
    this.streamProcessor.onThinkingDelta((thinking) => this.callbacks.onThinking?.(thinking));
    this.streamProcessor.onToolStart((toolCall) => {
      // tool_use_start：立即通知 UI 展示工具名（此时 input 为空）
      this.callbacks.onToolStart?.(toolCall.id, toolCall.name, toolCall.input);
    });
    this.streamProcessor.onToolUse((toolCall) => {
      // tool_use_end：input 已完整，再次通知 UI 补充指令（覆盖更新）
      this.callbacks.onToolStart?.(toolCall.id, toolCall.name, toolCall.input);
    });
    this.streamProcessor.onToolDelta((id, name, receivedBytes) => {
      this.callbacks.onToolDelta?.(id, name, receivedBytes);
    });
    this.streamProcessor.onUsage((usage) => {
      this.tokenManager.recordUsage(usage);
      this.costTracker.record(usage);
      this.callbacks.onUsage?.(usage);
    });

    // 设置中断检查器：StreamProcessor 在每次事件循环时检查是否被中断
    this.streamProcessor.setInterruptChecker(() => this._interrupted);
  }

  /**
   * 注册回调
   */
  on(callbacks: AgentCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * 运行一轮对话
   */
  async run(userMessage: string): Promise<void> {
    this.running = true;
    this._interrupted = false;  // 每次新运行前重置中断标志
    this.currentIteration = 0;
    const maxIterations = this.config.maxIterations ?? Infinity;
    const startTime = Date.now();
    const sessionId = `session-${startTime}`;
    const toolStatsMap = new Map<string, { count: number; durationMs: number; errorCount: number }>();
    const sessionToolCalls: ToolCallRecord[] = [];

    // 🔧 创建新的 AbortController（用于级联终止所有子任务）
    this._abortController = new AbortController();

    // 🆕 初始化 AgentLoop 执行日志记录器
    this.agentLoopLogger = new AgentLoopLogger(sessionId, this.config.model);

    try {
      // 🆕 注入任务状态提示到 system prompt
      await this.injectTodoContextHint(userMessage);

      // 🆕 设置当前用户意图到权限控制器（用于跟踪同一意图下的拒绝操作）
      const permissionController = this.registry.getPermissionController?.();
      if (permissionController && typeof permissionController === 'object' && permissionController !== null && 'setCurrentUserIntent' in permissionController && typeof permissionController.setCurrentUserIntent === 'function') {
        (permissionController as any).setCurrentUserIntent(userMessage);
      }

      // 构建初始消息
      let messages = this.messageManager.build(userMessage);

      // 使用构造函数中保存的原始 textHandler（避免 stop()+run() 循环时嵌套包装堆积）
      const originalTextHandler = this._originalTextHandler;

      // ★ 消息历史快照（用于 API 失败时回滚） ★
      let messageSnapshot: Message[] = [];

      while (this.running && this.currentIteration < maxIterations) {
        this.currentIteration++;
        const iterationStartTime = Date.now();

        // 🆕 记录迭代开始
        await this.agentLoopLogger?.logIterationStart(
          this.currentIteration,
          maxIterations,
          messages.length,
          !!this._pendingAppendMessage
        );

        // ── 追加消息检查 ──
        // 使用 MessagePreparationHandler 处理消息追加
        if (this._pendingAppendMessage) {
          const appendMsg = this._pendingAppendMessage;
          const wasInterrupted = this._interrupted;

          const result = this.messagePreparationHandler.handlePendingAppend(
            this._pendingAppendMessage,
            this._interrupted
          );
          this._interrupted = false;
          this._pendingAppendMessage = null;
          this.running = true;
          messages = result.messages;

          // 🆕 记录消息追加
          await this.agentLoopLogger?.logMessageAppend(
            this.currentIteration,
            appendMsg,
            wasInterrupted,
            result.delayMs
          );

          await this.messagePreparationHandler.applyDelay(result.delayMs);
        }

        // ── 消息上下文处理 ──
        this.messageContextHandler.logIteration(
          this.currentIteration,
          maxIterations,
          this.running,
          messages.length
        );

        const contextResult = await this.messageContextHandler.processContext(
          messages,
          {
            onInfo: this.callbacks.onInfo,
            onThinking: this.callbacks.onThinking,
          }
        );
        messages = contextResult.messages;

        // 🆕 记录上下文压缩（如果发生）
        if (contextResult.compressed && contextResult.compressionInfo) {
          const ci = contextResult.compressionInfo;
          await this.agentLoopLogger?.logContextCompress(
            this.currentIteration,
            ci.originalTokens,
            ci.compressedTokens,
            ci.ratio,
            0  // durationMs 在 compressionInfo 中没有，使用 0
          );
        }

        // ★ 保存消息历史快照（在 LLM 调用前，包含最新的工具结果） ★
        // 如果 LLM 调用失败，可以回滚到这个完整状态，避免上下文不一致
        messageSnapshot = this.messageManager.saveSnapshot();

        // 调用 LLM（带重试）
        const toolSchemas: ToolSchema[] = this.registry.getSchemas();
        const llmRequestStartTime = Date.now();

        // 🆕 记录 LLM 请求
        await this.agentLoopLogger?.logLLMRequest(
          this.currentIteration,
          messages.length,
          toolSchemas.length,
          this.tokenManager.getTotalUsage().input,  // 使用 getTotalUsage()
          this.config.maxTokens,
          {
            temperature: this.config.temperature,
            hasThinking: !!this.thinkingConfig,
          }
        );

        const streamResult = await this.streamRetryHandler.executeWithRetry(
          messages,
          toolSchemas,
          this.currentIteration,
          originalTextHandler,
          {
            onInfo: this.callbacks.onInfo,
          },
          {
            isInterrupted: () => this._interrupted,
            getCurrentStream: () => this._currentStream,
            setCurrentStream: (stream) => { this._currentStream = stream; },
          },
          0,  // rateLimitRetryCount
          this._abortController?.signal,  // 🔧 传递 AbortSignal
        );

        // 处理 Stream 结果
        if (!streamResult.result) {
          if (streamResult.interrupted) {
            this.log.debug('No result due to interrupt, continuing to process append message');
            continue;
          }
          // ★ API 调用失败：回滚消息历史到工具执行前的快照状态 ★
          this.messageManager.restoreSnapshot(messageSnapshot);
          this.log.warn('API call failed, message history rolled back to pre-tool state');
          throw streamResult.lastError ?? new Error('API call failed after retries');
        }

        const result = streamResult.result;

        // 🆕 记录 LLM 响应
        const llmDurationMs = Date.now() - llmRequestStartTime;
        await this.agentLoopLogger?.logLLMResponse(
          this.currentIteration,
          result.stopReason,
          result.contentBlocks.length,
          result.toolCalls?.length ?? 0,
          result.usage,
          llmDurationMs
        );

        // 记录 assistant 消息
        this.messageManager.addAssistantMessage(result.contentBlocks);

        // ── 结果处理 ──
        const processResult = this.resultProcessor.processResult(result, {
          hasPendingAppend: !!this._pendingAppendMessage,
          callbacks: { onInfo: this.callbacks.onInfo },
        });

        if (processResult.shouldBreak) {
          this.log.debug(`Loop ended: stopReason=${result.stopReason}, toolCalls=${result.toolCalls?.length ?? 0}`);

          // 🆕 记录迭代结束
          await this.agentLoopLogger?.logIterationEnd(
            this.currentIteration,
            result.stopReason,
            result.toolCalls?.length ?? 0,
            Date.now() - iterationStartTime
          );

          break;
        }

        // 🆕 如果需要压缩上下文，执行压缩
        if (processResult.needsCompression) {
          this.log.info('Triggering context compression due to max_tokens');
          const compressionStartTime = Date.now();
          const compressionResult = await this.contextCompressor.compressAsync(
            this.messageManager.getMessages(),
            this.tokenManager,
          );

          if (compressionResult.compressionRatio > 0) {
            const compressionDuration = Date.now() - compressionStartTime;
            this.log.info(
              `Context compressed: ${compressionResult.originalTokens} → ${compressionResult.compressedTokens} tokens ` +
              `(${(compressionResult.compressionRatio * 100).toFixed(1)}% reduction, ${compressionDuration}ms)`
            );
            this.messageManager.replaceMessages(compressionResult.compressed);
            this.callbacks.onInfo?.(
              `✅ 上下文已压缩：${compressionResult.originalTokens} → ${compressionResult.compressedTokens} tokens`
            );

            // 触发 PostCompact Hook（补充 duration）
            if (this.hookRegistry) {
              this.hookRegistry.emit('PostCompact', {
                originalTokens: compressionResult.originalTokens,
                compressedTokens: compressionResult.compressedTokens,
                compressionRatio: compressionResult.compressionRatio,
                duration: compressionDuration,
              }).catch(() => {});
            }
          }
        }

        if (processResult.shouldContinue) {
          messages = processResult.messages!;
          continue;
        }

        // ── 工具执行 ──
        const grouping = await this.toolExecutionCoordinator.groupAndPrepareTools(result);

        // 🆕 记录工具分组
        await this.agentLoopLogger?.logToolGroup(
          this.currentIteration,
          grouping.parallelIds,
          grouping.serialIds
        );

        // 通知 UI 工具分组
        if (grouping.parallelIds.length > 1) {
          this.callbacks.onToolGrouped?.({
            parallelIds: grouping.parallelIds,
            serialIds: grouping.serialIds
          });
        }

        // 执行工具
        const toolExecStartTime = Date.now();
        const toolStartTimes = new Map<string, number>();
        const execResult = await this.toolExecutionCoordinator.executeTools(
          result,
          grouping,
          {
            onToolStart: async (id, name, input) => {
              // 通知 UI
              this.callbacks.onToolStart?.(id, name, input);

              // 🆕 记录工具执行开始
              toolStartTimes.set(id, Date.now());
              await this.agentLoopLogger?.logToolExecute(
                this.currentIteration,
                id,
                name,
                input,
                grouping.parallelIds.includes(id)
              );
            },
            onToolDelta: this.callbacks.onToolDelta,
            onToolEnd: async (id, name, resultContent, isError) => {
              // 通知 UI
              this.callbacks.onToolEnd?.(id, name, resultContent, isError);

              // 🆕 记录工具结果
              const toolDuration = toolStartTimes.has(id)
                ? Date.now() - toolStartTimes.get(id)!
                : Date.now() - toolExecStartTime;
              await this.agentLoopLogger?.logToolResult(
                this.currentIteration,
                id,
                name,
                !isError,
                resultContent.length,
                toolDuration,
                isError ? resultContent : undefined
              );
            },
          },
          this._abortController?.signal, // 🔧 传递 AbortSignal
        );
        const toolExecDurationMs = Date.now() - toolExecStartTime;
        const resultsMap = execResult.resultsMap;

        // 🆕 通知 UI 文件变更
        if (execResult.fileChanges.length > 0) {
          this.callbacks.onFileChanges?.(execResult.fileChanges);
        }

        // 触发 PostToolUse Hook
        await this.toolExecutionCoordinator.triggerPostToolUseHooks(
          result,
          resultsMap,
          toolExecDurationMs
        );

        // 统计工具调用
        for (const toolCall of result.toolCalls) {
          const toolResult = resultsMap.get(toolCall.id);
          const existing = toolStatsMap.get(toolCall.name) ?? { count: 0, durationMs: 0, errorCount: 0 };
          existing.count++;
          existing.durationMs += Math.round(toolExecDurationMs / result.toolCalls.length);
          if (toolResult?.isError) existing.errorCount++;
          toolStatsMap.set(toolCall.name, existing);

          // 记录工具调用详情（用于记忆系统）
          if (toolResult) {
            sessionToolCalls.push({
              name: toolCall.name,
              input: toolCall.input as Record<string, unknown>,
              isError: toolResult.isError,
              resultSummary: toolResult.content.slice(0, 200),
            });
          }
        }

        // 批量添加工具结果到消息历史
        this.messageManager.addToolResults(resultsMap);

        // ★ 边界检查：工具执行完毕，检查是否有排队的用户消息 ★
        // Claude Code 风格 Boundary-Aware Injection：
        // 将用户消息注入到 tool_result 同一条 user 消息中，
        // 使 LLM 在下一轮同时看到工具结果和用户补充消息。
        // 这比在 while 循环顶部单独注入更自然，避免连续 user 消息问题。
        if (this._pendingAppendMessage) {
          const appendMsg = this._pendingAppendMessage;
          this._pendingAppendMessage = null;
          const injected = this.messageManager.appendTextToLastMessage(appendMsg);
          this.log.info(`Boundary inject: user message ${injected ? 'appended to tool_result' : 'failed to append'}, msg="${appendMsg.slice(0, 80)}"`);
        }

        // 重建消息 (system prompt + 历史 + 工具结果)
        messages = this.messageManager.getMessages();

        // 🆕 记录迭代结束
        await this.agentLoopLogger?.logIterationEnd(
          this.currentIteration,
          result.stopReason,
          result.toolCalls.length,
          Date.now() - iterationStartTime
        );
      }

      // 迭代达到上限时通知用户
      if (this.currentIteration >= maxIterations) {
        this.log.warn(`Max iterations reached: ${this.currentIteration}/${maxIterations}`);

        // 🆕 记录中断（达到最大迭代次数）
        await this.agentLoopLogger?.logInterrupt(
          this.currentIteration,
          'max_iterations',
          undefined,
          false,
          []
        );

        this.callbacks.onError?.(new Error(
          `⚠️ Agent 循环达到最大迭代次数 (${maxIterations})，已自动停止。如需继续，请发送新消息。`
        ));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 🆕 记录异常捕获
      await this.agentLoopLogger?.logErrorCaught(
        this.currentIteration,
        err,
        {
          running: this.running,
          messageCount: this.messageManager.getHistory().length,
          pendingAppend: !!this._pendingAppendMessage,
          interrupted: this._interrupted,
        },
        err.name !== 'AbortError'
      );

      // 用户中断追加导致的 abort 不视为错误（防御性兜底）
      if (this._interrupted) {
        this.log.debug('Caught error during interrupt, suppressing and continuing');
        // 清理 interrupted 状态，让 finally 正常执行
        this._interrupted = false;
        this._pendingAppendMessage = null;
        return;
      }

      // 用户主动停止（Ctrl+C 或 stop()）导致的 abort 不视为错误
      const isAbort = !this.running && (
        err.name === 'AbortError' ||
        err.message.includes('aborted') ||
        err.message.includes('abort')
      );

      if (isAbort) {
        this.log.debug('Agent stopped by user, suppressing abort error');
        return;
      }

      // 触发 ErrorOccurred Hook
      if (this.hookRegistry) {
        this.hookRegistry.emit('ErrorOccurred', {
          errorMessage: err.message,
          errorStack: err.stack,
        }).catch((err) => {
          this.log.debug('ErrorOccurred hook emit failed:', err);
        });
      }

      // 使用友好化的错误消息
      const friendlyError = new Error(ErrorRecovery.formatError(err));

      // 移除这里的 onError 调用，避免重复通知
      // 异常会被外层捕获并调用 onError
      // this.callbacks.onError?.(friendlyError);

      // API 错误已在 stream 层重试过，此处记录统计
      this.errorRecovery.recordError(err);

      // 总是抛出异常，让主进程处理
      throw friendlyError;
    } finally {
      this.log.debug(`Finally: running=${this.running}, iterations=${this.currentIteration}/${maxIterations}`);
      this.running = false;
      const state = this.getState();
      this.callbacks.onEnd?.(state);

      // 确定会话完成状态
      let sessionStatus: 'completed' | 'stopped' | 'error' | 'max_iterations' = 'completed';
      if (this.currentIteration >= maxIterations) {
        sessionStatus = 'max_iterations';
      } else if (this.currentIteration === 0) {
        sessionStatus = 'error';
      } else if (!this.running) {
        sessionStatus = 'stopped';
      }

      // 🆕 记录会话完成
      const toolStats = Array.from(toolStatsMap.entries()).map(([name, stats]) => ({
        name,
        count: stats.count,
        totalDurationMs: stats.durationMs,
        errorCount: stats.errorCount,
      }));
      await this.agentLoopLogger?.logSessionComplete(
        this.currentIteration,
        state.tokenUsage,
        state.cost,
        toolStats,
        sessionStatus
      );

      // 记录会话统计到 JSONL (仅当有实际对话时)
      if (this.currentIteration > 0) {
        const durationMs = Date.now() - startTime;
        await this.sessionRecorder.record({
          timestamp: new Date().toISOString(),
          model: this.config.model,
          input: state.tokenUsage.input,
          output: state.tokenUsage.output,
          cacheRead: state.tokenUsage.cacheRead,
          cacheWrite: state.tokenUsage.cacheWrite,
          durationMs,
        });

        // 记录使用统计（含工具调用详情）
        const toolCalls = Array.from(toolStatsMap.entries()).map(([name, stats]) => ({
          name,
          ...stats,
        }));
        await this.usageStatsRecorder.record({
          timestamp: new Date().toISOString(),
          sessionId,
          model: this.config.model,
          input: state.tokenUsage.input,
          output: state.tokenUsage.output,
          cacheRead: state.tokenUsage.cacheRead,
          cacheWrite: state.tokenUsage.cacheWrite,
          durationMs,
          iterations: this.currentIteration,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });

        // 保存会话记忆
        if (this.memoryStore) {
          try {
            const history = this.messageManager.getHistory();
            const sessionMemory: SessionMemory = {
              sessionId,
              startTime: new Date(startTime).toISOString(),
              endTime: new Date().toISOString(),
              userMessages: history
                .filter((m) => m.role === 'user')
                .map((m) => (typeof m.content === 'string' ? m.content : '[complex]'))
                .slice(0, 10),
              assistantHighlights: history
                .filter((m) => m.role === 'assistant')
                .flatMap((m) => {
                  if (typeof m.content === 'string') return [m.content];
                  if (Array.isArray(m.content)) {
                    return m.content
                      .filter((b: { type: string }) => b.type === 'text')
                      .map((b: { type: string; text?: string }) => b.text ?? '');
                  }
                  return [];
                })
                .filter((t: string) => t.length > 0)
                .slice(0, 5),
              toolCalls: sessionToolCalls,
              durationMs: Date.now() - startTime,
              model: this.config.model,
            };
            await this.memoryStore.save(sessionMemory);

            // 🆕 记录记忆保存成功
            await this.agentLoopLogger?.logMemorySave(
              this.currentIteration,
              'session',
              `session ${sessionId}: ${sessionToolCalls.length} tool calls`,
              JSON.stringify(sessionMemory).length,
              true
            );
          } catch (memoryErr) {
            this.log.debug('Failed to save session memory:', memoryErr);

            // 🆕 记录记忆保存失败
            await this.agentLoopLogger?.logMemorySave(
              this.currentIteration,
              'session',
              `session ${sessionId}`,
              0,
              false,
              memoryErr instanceof Error ? memoryErr.message : String(memoryErr)
            );
          }
        }
      }
    }
  }

  /**
   * 停止循环（同时中止活跃的 stream 和正在执行的工具）
   */
  stop(): void {
    this.running = false;
    this._interrupted = false;
    this._pendingAppendMessage = null;

    // 🔧 触发 AbortController，级联终止所有子任务
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    // 🆕 记录用户停止
    this.agentLoopLogger?.logInterrupt(
      this.currentIteration,
      'user_stop',
      undefined,
      !!this._currentStream,
      []  // 暂时使用空数组，因为 ToolDispatcher 没有 getActiveToolNames 方法
    ).catch(() => {
      // 忽略日志写入失败
    });

    // 中止所有正在执行的工具（Bash 进程、SubAgent 等）
    this.toolDispatcher.abortAll();

    // 中止当前活跃的 stream
    if (this._currentStream) {
      try {
        // 尝试 Anthropic/OpenAI SDK 的 controller.abort()
        const streamAny = this._currentStream as unknown as Record<string, { abort?: () => void }>;
        if (streamAny.controller?.abort) {
          streamAny.controller.abort();
        }
        // 尝试 AsyncIterator 标准的 return()
        const iterator = (this._currentStream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
        if (typeof iterator.return === 'function') {
          iterator.return(undefined);
        }
      } catch {
        // 中止失败不影响 stop 逻辑
      }
      this._currentStream = null;
    }
  }

  /**
   * 🆕 获取最后一个消息的边界类型（供 UI 判断追加时机）
   */
  getLastBoundary(): 'user' | 'assistant' | 'tool_result' | null {
    const history = this.messageManager.getHistory();
    if (history.length === 0) return null;
    
    const lastMsg = history[history.length - 1];
    if (lastMsg.role === 'user') {
      // 检查是否包含 tool_result
      const hasToolResult = Array.isArray(lastMsg.content) &&
        lastMsg.content.some((block: unknown) => {
          return typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_result';
        });
      return hasToolResult ? 'tool_result' : 'user';
    }
    if (lastMsg.role === 'assistant') {
      return 'assistant';
    }
    return null;
  }

  /**
   * 🆕 检查是否有待处理的追加消息
   */
  hasPendingAppend(): boolean {
    return this._pendingAppendMessage !== null;
  }

  /**
   * 🆕 获取并清空待处理的追加消息
   * 用于在 run() 结束后，由 ChatSession 触发新一轮对话
   */
  consumePendingAppend(): string | null {
    const message = this._pendingAppendMessage;
    this._pendingAppendMessage = null;
    this._interrupted = false;
    return message;
  }

  /**
   * 温和追加用户消息（不中断当前执行）
   *
   * Claude Code 风格 Boundary-Aware Queuing：
   * 消息排队后，在下一个"自然边界点"被消费：
   * - 工具执行完毕后 → 注入到 tool_result 同一条 user 消息中（首选）
   * - LLM end_turn 后 → 作为新的 user 消息注入
   *
   * 不 abort 当前 stream，不 abort 正在执行的工具。
   *
   * 与 interrupt() 的区别：
   * - interrupt() 会 abort stream 和工具，强制中断后注入消息
   * - appendMessage() 不中断任何正在进行的工作，消息排队等待自然消费
   *
   * @param message 用户追加的补充指令
   */
  appendMessage(message: string): void {
    if (!this.running) {
      this.log.debug('appendMessage() called but not running, ignoring');
      return;
    }
    this.log.info(`Append message queued: "${message.slice(0, 100)}"`);
    this._pendingAppendMessage = message;
    // 注意：不设置 _interrupted，不 abort 工具和 stream
  }

  /**
   * 中断当前执行并追加用户消息（Interrupt & Append）
   *
   * 与 stop() 的区别：
   * - stop() 终止 run()，触发 onEnd
   * - interrupt() 中止当前 stream/工具，但 run() 继续循环，
   *   在下一次迭代开始时注入用户追加消息并重新调用 LLM
   *
   * 🆕 UI 行为：触发 onEnd 回调，让前端结束当前 assistant 消息气泡，
   *    下一轮回复将在新的消息气泡中显示
   *
   * @param appendMessage 用户追加的补充指令
   */
  interrupt(appendMessage: string): void {
    if (!this.running) {
      this.log.debug('interrupt() called but not running, ignoring');
      return;
    }

    this.log.info(`Interrupt requested with append message: "${appendMessage.slice(0, 100)}"`);

    // 🆕 记录用户中断
    this.agentLoopLogger?.logInterrupt(
      this.currentIteration,
      'user_interrupt',
      appendMessage,
      !!this._currentStream,
      []  // 暂时使用空数组，因为 ToolDispatcher 没有 getActiveToolNames 方法
    ).catch(() => {
      // 忽略日志写入失败
    });

    this._interrupted = true;
    this._pendingAppendMessage = appendMessage;

    // 中止所有正在执行的工具
    this.toolDispatcher.abortAll();

    // 中止当前活跃的 stream
    if (this._currentStream) {
      try {
        const streamAny = this._currentStream as unknown as Record<string, { abort?: () => void }>;
        if (streamAny.controller?.abort) {
          streamAny.controller.abort();
        }
        const iterator = (this._currentStream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
        if (typeof iterator.return === 'function') {
          iterator.return(undefined);
        }
      } catch {
        // 中止失败不影响逻辑
      }
      this._currentStream = null;
    }

    // 🆕 触发 onEnd 回调，通知前端结束当前消息气泡
    // 注意：不改变 this.running 状态，循环会继续执行
    if (this.callbacks.onEnd) {
      this.callbacks.onEnd(this.getState());
    }
  }

  /**
   * 手动触发上下文压缩
   * @param customInstruction 用户自定义保留指令（如 "保留所有文件路径"）
   * 返回压缩结果，如果不需要压缩则返回 null
   */
  async compact(customInstruction?: string): Promise<import('@/core/types').CompressionResult | null> {
    const messages = this.messageManager.getMessages();
    const result = await this.contextCompressor.compressAsync(messages, this.tokenManager, customInstruction);
    if (result.compressionRatio > 0) {
      // 更新 MessageManager 内部状态（去掉 system prompt）
      this.messageManager.replaceMessages(result.compressed.slice(1));
      this.log.info(`Manual compact: ${result.originalTokens} → ${result.compressedTokens} tokens`);
    }
    return result.compressionRatio > 0 ? result : null;
  }

  /**
   * 获取当前状态
   */
  getState(): AgentState {
    return {
      status: this.running ? 'thinking' : 'idle',
      messages: this.messageManager.getHistory(),
      tokenUsage: this.tokenManager.getTotalUsage(),
      cost: this.costTracker.getTotalCost(),
      currentIteration: this.currentIteration,
    };
  }

  /**
   * 清空会话
   */
  reset(): void {
    this.messageManager.clear();
    this.tokenManager.reset();
    this.currentIteration = 0;
  }

  /**
   * 获取 TokenManager（用于 session resume 时恢复用量）
   */
  getTokenManager(): TokenManager {
    return this.tokenManager;
  }

  /**
   * 获取 CostTracker（用于 session resume 时恢复费用）
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /**
   * 获取消息管理器（用于动态注入 system prompt 后缀）
   */
  getMessageManager(): MessageManager {
    return this.messageManager;
  }

  /**
   * 获取完整消息历史（不含 system prompt）
   * 便捷方法，供 SessionManager 保存会话时使用
   */
  getMessageHistory(): Message[] {
    return this.messageManager.getHistory();
  }

  /**
   * 注入任务状态提示到 system prompt
   * 让 LLM 自动感知何时该清理任务列表
   */
  private async injectTodoContextHint(userMessage: string): Promise<void> {
    try {
      const { generateTodoContextHint, detectNewWorkContext } = await import('@/core/tools/TodoContextInjector');
      const { getTodoManager } = await import('@/core/tools/TodoManager');

      const todoManager = getTodoManager();
      const todos = await todoManager.list();

      let hint = '';

      // 1. 生成任务状态提示（如果有大量已完成任务、孤儿任务等）
      const contextHint = await generateTodoContextHint();
      if (contextHint) {
        hint += contextHint;
      }

      // 2. 检测是否开始新工作（如果是，提示清理旧任务）
      const newWorkHint = detectNewWorkContext(userMessage, todos.length > 0);
      if (newWorkHint) {
        hint += '\n' + newWorkHint;
      }

      // 3. 注入到 system prompt（使用 'todo-context' 作为 key，避免覆盖其他后缀）
      if (hint) {
        this.messageManager.setSystemPromptSuffix(hint, 'todo-context');
      } else {
        // 清空之前的提示
        this.messageManager.setSystemPromptSuffix('', 'todo-context');
      }
    } catch (err) {
      // 静默失败，不影响主流程
      log.warn('Failed to inject todo context hint:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 恢复消息历史（用于 session resume）
   * 替换当前消息历史为给定的消息列表
   */
  restoreMessages(messages: Message[]): void {
    this.messageManager.replaceMessages(messages);
  }

  /**
   * 注入 HookRegistry（由 ChatSession 调用）
   */
  setHookRegistry(hookRegistry: HookRegistry): void {
    this.hookRegistry = hookRegistry;
    // 传递给 ContextCompressor 以触发 PreCompact/PostCompact 事件
    this.contextCompressor.setHookRegistry(hookRegistry);
    // 更新 ToolExecutionCoordinator 的 hookRegistry
    this.toolExecutionCoordinator = new ToolExecutionCoordinator(
      this.registry,
      this.toolDispatcher,
      hookRegistry,
    );
  }

  /**
   * 🆕 P1 优化：设置 Extended Thinking 配置（由 ChatSession 调用）
   */
  setThinking(thinkingConfig: import('@/core/types').ThinkingConfig | undefined): void {
    this.thinkingConfig = thinkingConfig;
    // 更新 StreamRetryHandler 的 thinkingConfig
    this.streamRetryHandler = new StreamRetryHandler(
      this.provider,
      this.streamProcessor,
      this.errorRecovery,
      this.perfCollector,
      this.config,
      thinkingConfig,
    );
  }

  /**
   * 注入 PricingResolver（由 ChatSession 调用）
   */
  setPricingResolver(resolver: PricingResolver): void {
    this.costTracker.setPricingResolver(resolver);
  }
}
