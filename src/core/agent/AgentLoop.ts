// ============================================================
// M2 Agent — ReAct 循环核心
// ============================================================

import type { AgentConfig, AgentState, TokenUsage, ILLMProvider, IToolRegistry, ToolSchema, Message, ToolCall, ToolResult } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { MessageManager } from './MessageManager';
import { StreamProcessor, type ProcessResult } from './StreamProcessor';
import { ToolDispatcher } from './ToolDispatcher';
import { TokenManager } from './TokenManager';
import { ContextCompressor } from './ContextCompressor';
import { ErrorRecovery } from './ErrorRecovery';
import { MessagePreparationHandler } from './MessagePreparationHandler';
import { MessageContextHandler } from './MessageContextHandler';
import { StreamRetryHandler } from './StreamRetryHandler';
import { ResultProcessor } from './ResultProcessor';
import { ToolExecutionCoordinator } from './ToolExecutionCoordinator';
import { logger } from '@/core/logger';
import { isContentTooLargeError } from '@/core/providers/RetryPolicy';
import { SessionRecorder } from '@/core/telemetry';
import { UsageStatsRecorder } from '@/core/telemetry';
import { PerfCollector } from '@/core/telemetry';
import { AgentLoopLogger } from '@/core/telemetry';
import { AsyncAgentTaskManager } from '@/core/agent/async';
import type { AgentTaskCompletionResult } from '@/core/agent/async';

/**
 * Agent 事件回调
 */
export interface AgentCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolDelta?: (id: string, name: string, receivedBytes: number) => void;
  onToolEnd?: (id: string, name: string, result: string, isError: boolean, metadata?: Record<string, unknown>) => void;
  /** 工具执行分组通知（在执行前触发，通知 UI 哪些工具将并行执行） */
  onToolGrouped?: (groups: { parallelIds: string[]; serialIds: string[] }) => void;
  /** 文件变更通知（在工具执行后触发，批量通知所有文件变更） */
  onFileChanges?: (changes: import('@/core/types').FileChange[]) => void;
  onUsage?: (usage: TokenUsage) => void;
  /** 非致命提示信息（如 max_tokens 自动重试） */
  onInfo?: (message: string) => void;
  onError?: (error: Error) => void;
  onEnd?: (state: AgentState) => void;
  /** 后台任务完成，agent 空闲时自动触发汇总 */
  onAutoSummarize?: () => void;
  /** 引用原文数据推送（task/team 工具结果），供前端 citation 组件使用 */
  onCitationData?: (citations: Array<{ agentName: string; originalOutput: string; duration: number; tokensUsed: { input: number; output: number } }>) => void;
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
  /** 用户 ID，用于遥测数据用户维度隔离 */
  private _userId?: string;
  /** 待处理的后台任务完成通知（groupIds 列表） */
  private _pendingTaskCompletions: AgentTaskCompletionResult[] = [];
  /** 是否为自动汇总运行（后台任务结果汇总），区别于用户触发的普通运行 */
  private _isAutoSummarizeRun = false;

  constructor(
    provider: ILLMProvider,
    registry: IToolRegistry,
    config: AgentConfig,
    userId?: string,
  ) {
    this.provider = provider;
    this.registry = registry;
    this.config = config;
    this._userId = userId;
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
    this.errorRecovery = new ErrorRecovery();
    this.sessionRecorder = new SessionRecorder(undefined, userId);
    this.usageStatsRecorder = new UsageStatsRecorder(undefined, userId);
    this.perfCollector = new PerfCollector(undefined, userId);

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
    // 防止并发调用
    if (this.running) {
      this.log.warn('run() called while already running, queuing as append');
      this.appendMessage(userMessage);
      return;
    }
    this.running = true;
    this._interrupted = false;  // 每次新运行前重置中断标志
    this.currentIteration = 0;
    const maxIterations = this.config.maxIterations ?? Infinity;
    const startTime = Date.now();
    const sessionId = `session-${startTime}`;
    const toolStatsMap = new Map<string, { count: number; durationMs: number; errorCount: number }>();
    const sessionToolCalls: Array<{ name: string; input: Record<string, unknown>; isError: boolean; resultSummary: string }> = [];
    // 🔧 创建新的 AbortController（用于级联终止所有子任务）
    // 保存本地引用，防止 stop() 中途将 this._abortController 置 null 导致 signal 丢失
    const abortController = new AbortController();
    this._abortController = abortController;

    // 🆕 初始化 AgentLoop 执行日志记录器
    this.agentLoopLogger = new AgentLoopLogger(sessionId, this.config.model, undefined, this._userId);

    try {
      // 清除上轮的子任务完成提示（新用户消息到来）
      this.messageManager.setSystemPromptSuffix('', 'delegation-complete');
      this.messageManager.setSystemPromptSuffix('', 'async-task-completion');

      // 注册后台任务完成回调
      this.registerAsyncTaskCompletionCallback();

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

      // 🔑 恢复状态标志（用于精细恢复点）
      let aggressiveCompacted = false;  // 413 恢复：是否已触发激进压缩
      let budgetCompacted = false;      // Token 预算：是否已触发预算压缩

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

        // ── 后台任务完成通知 ──
        // 仅在自动汇总运行时注入（避免在用户触发的运行中拉长运行时间）
        if (this._isAutoSummarizeRun && this._pendingTaskCompletions.length > 0) {
          const completions = this._pendingTaskCompletions.splice(0);
          for (const completion of completions) {
            const statusText = completion.status === 'completed' ? '✅ 已完成' :
              completion.status === 'failed' ? '❌ 失败' :
              completion.status === 'cancelled' ? '🚫 已取消' : completion.status;
            const output = completion.result?.content ?? '';
            const hint = [
              `\n[后台任务完成通知] 任务组 ${completion.groupId} ${statusText}`,
              completion.status === 'completed'
                ? '请直接将以下结果汇总后告知用户，不要再次调用 task_control 查询。'
                : completion.status === 'failed'
                ? `失败原因: ${completion.error ?? '未知'}。请告知用户并询问是否需要重试。`
                : '任务已取消。请告知用户。',
              completion.status === 'completed' && output
                ? `\n--- 任务输出 ---\n${output}\n--- 输出结束 ---`
                : '',
            ].filter(Boolean).join('\n');
            this.messageManager.setSystemPromptSuffix(hint, 'async-task-completion');
            this.log.info(`Async task completion: ${completion.groupId} ${completion.status}`);
          }
          // 重建消息数组以包含注入的 completion suffix
          // setSystemPromptSuffix 只修改内部状态，必须重建 message[0] 才能生效
          const updatedMessages = this.messageManager.getMessages();
          messages[0] = updatedMessages[0];
        }

        // ── 消息上下文处理 ──

        // 🔑 恢复点 1: Token 预算监控（接近上限时提前压缩，避免后续 413）
        if (!budgetCompacted && messages.length > 10) {
          const contextWindow = this.tokenManager.getMaxInputTokens();
          const cumulativeInput = this.tokenManager.getTotalUsage().input;
          // 累计输入超过 2.5x 上下文窗口 → 触发预算压缩
          if (cumulativeInput > contextWindow * 2.5) {
            this.callbacks.onInfo?.('💰 Token 用量较高，正在压缩早期上下文...');
            const compactResult = await this.contextCompressor.compressAsync(messages, this.tokenManager);
            if (compactResult.compressionRatio > 0) {
              this.messageManager.replaceMessages(compactResult.compressed);
              messages = compactResult.compressed;
              budgetCompacted = true;
              this.log.info(
                `Budget compact: ${compactResult.originalTokens} → ${compactResult.compressedTokens} tokens ` +
                `(${Math.round(compactResult.compressionRatio * 100)}%), cumulative=${cumulativeInput}`
              );
            }
          }
        }

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

        // ★ 保存消息索引作快照（O(1)，LLM 失败时回滚用） ★
        const snapshotIndex = this.messageManager.getHistoryLength();

        // 调用 LLM（带重试 + 并发工具执行）
        const toolSchemas: ToolSchema[] = this.registry.getSchemas();
        const llmRequestStartTime = Date.now();

        // 🆕 记录 LLM 请求
        await this.agentLoopLogger?.logLLMRequest(
          this.currentIteration,
          messages.length,
          toolSchemas.length,
          this.tokenManager.getTotalUsage().input,
          this.config.maxTokens,
          {
            temperature: this.config.temperature,
            hasThinking: !!this.thinkingConfig,
          }
        );

        // 🔑 定义工具执行器：在流消费期间并发执行
        const executor = async (toolCall: ToolCall): Promise<ToolResult> => {
          this.callbacks.onToolStart?.(toolCall.id, toolCall.name, toolCall.input);
          const toolResult = await this.toolDispatcher.execute(toolCall, abortController.signal);
          this.callbacks.onToolEnd?.(toolCall.id, toolCall.name, toolResult.content, toolResult.isError, toolResult.metadata);
          return toolResult;
        };

        const streamResult = await this.streamRetryHandler.executeWithRetryConcurrent(
          messages,
          toolSchemas,
          this.currentIteration,
          executor,
          originalTextHandler,
          {
            onInfo: this.callbacks.onInfo,
          },
          {
            isInterrupted: () => this._interrupted,
            getCurrentStream: () => this._currentStream,
            setCurrentStream: (stream) => { this._currentStream = stream; },
          },
          abortController.signal,
        );

        // 处理 Stream 结果
        if (!streamResult.result) {
          if (streamResult.interrupted) {
            this.log.debug('No result due to interrupt, continuing to process append message');
            continue;
          }

          // 🔑 恢复点 2: 413 Content Too Large → 激进压缩 → 重试
          if (isContentTooLargeError(streamResult.lastError) && !aggressiveCompacted) {
            this.callbacks.onInfo?.('⚠️ 请求内容过大，正在压缩历史上下文后重试...');
            const compacted = this.contextCompressor.aggressiveCompact(
              this.messageManager.getMessages(),
              this.tokenManager,
            );
            this.messageManager.replaceMessages(compacted);
            aggressiveCompacted = true;
            messages = this.messageManager.getMessages();
            this.log.warn('413 recovered: aggressive compact applied, retrying loop iteration');
            continue; // 回到循环顶部，用压缩后的上下文重试
          }

          // ★ API 调用失败：截断到快照索引（O(1)） ★
          this.messageManager.truncateTo(snapshotIndex);
          this.log.warn('API call failed, message history rolled back to pre-tool state');
          throw streamResult.lastError ?? new Error('API call failed after retries');
        }

        const result = streamResult.result;
        const concurrentResultsMap = streamResult.executionResults; // 流式期间并发执行的工具结果

        // 🔑 成功获取结果：重置 413 恢复标志（允许后续再次触发恢复）
        if (aggressiveCompacted) {
          this.log.info('413 recovery succeeded, resetting aggressive compact flag');
          aggressiveCompacted = false;
        }

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
          // 检查用户是否已停止（避免浪费一次 API 调用）
          if (!this.running) break;
          messages = processResult.messages!;
          continue;
        }

        // ── 工具执行 ──
        let resultsMap: Map<string, ToolResult>;
        let toolExecDurationMs: number;
        const hasConcurrentResults = concurrentResultsMap && concurrentResultsMap.size > 0;

        if (hasConcurrentResults) {
          // 🔑 工具已在流消费期间并发执行完毕，直接使用结果
          resultsMap = concurrentResultsMap!;
          toolExecDurationMs = 0; // 工具执行时间已分摊到流消费中

          // 通知 UI 工具分组（并发执行时所有工具视为并行组）
          if (result.toolCalls.length > 1) {
            this.callbacks.onToolGrouped?.({
              parallelIds: result.toolCalls.map(tc => tc.id),
              serialIds: []
            });
          }

          // 收集文件变更
          const fileChanges: import('@/core/types').FileChange[] = [];
          for (const toolResult of resultsMap.values()) {
            if ((toolResult as any).fileChanges?.length > 0) {
              fileChanges.push(...(toolResult as any).fileChanges);
            }
          }
          if (fileChanges.length > 0) {
            this.callbacks.onFileChanges?.(fileChanges);
          }

          this.log.debug(`Tools executed concurrently during streaming: ${resultsMap.size} results`);
        } else {
          // Fallback: 串行/分组执行（保留向后兼容，正常不应触发）
          const grouping = await this.toolExecutionCoordinator.groupAndPrepareTools(result);

          await this.agentLoopLogger?.logToolGroup(
            this.currentIteration,
            grouping.parallelIds,
            grouping.serialIds
          );

          if (grouping.parallelIds.length > 1) {
            this.callbacks.onToolGrouped?.({
              parallelIds: grouping.parallelIds,
              serialIds: grouping.serialIds
            });
          }

          const toolExecStartTime = Date.now();
          const toolStartTimes = new Map<string, number>();
          const execResult = await this.toolExecutionCoordinator.executeTools(
            result,
            grouping,
            {
              onToolStart: async (id, name, input) => {
                this.callbacks.onToolStart?.(id, name, input);
                toolStartTimes.set(id, Date.now());
                await this.agentLoopLogger?.logToolExecute(
                  this.currentIteration, id, name, input,
                  grouping.parallelIds.includes(id)
                );
              },
              onToolDelta: this.callbacks.onToolDelta,
              onToolEnd: async (id, name, resultContent, isError, metadata) => {
                this.callbacks.onToolEnd?.(id, name, resultContent, isError, metadata);
                const toolDuration = toolStartTimes.has(id)
                  ? Date.now() - toolStartTimes.get(id)!
                  : Date.now() - toolExecStartTime;
                await this.agentLoopLogger?.logToolResult(
                  this.currentIteration, id, name, !isError,
                  resultContent?.length || 0, toolDuration,
                  isError ? resultContent : undefined
                );
              },
            },
            abortController.signal,
          );
          toolExecDurationMs = Date.now() - toolExecStartTime;
          resultsMap = execResult.resultsMap;

          if (execResult.fileChanges.length > 0) {
            this.callbacks.onFileChanges?.(execResult.fileChanges);
          }
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
          if (toolResult?.isError) existing.errorCount++;
          toolStatsMap.set(toolCall.name, existing);

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

        // 检查是否有 task/agent_team 工具完成，提醒主 agent 更新 todo
        const hasCompletedDelegation = result.toolCalls.some(
          tc => (tc.name === 'task' || tc.name === 'agent_team') &&
                 resultsMap.get(tc.id) && !resultsMap.get(tc.id)!.isError
        );
        if (hasCompletedDelegation) {
          this.messageManager.setSystemPromptSuffix(
            '\n[子任务已完成] 你委托给子 agent 或 agent team 的任务已经返回结果。请检查执行结果，并使用 todo_update 将对应任务标记为 completed。',
            'delegation-complete'
          );
        }

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

      // 用户主动停止（Ctrl+C 或 stop()）或 undici fetch 终止导致的 abort
      const isAbort = !this.running && (
        err.name === 'AbortError' ||
        err.message.includes('aborted') ||
        err.message.includes('abort') ||
        err.message === 'terminated'
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

      // 触发 onError 回调，通知前端显示错误消息
      this.callbacks.onError?.(friendlyError);

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
      }
    }

    // 主循环结束后，检查是否有后台任务完成通知待处理
    if (this._pendingTaskCompletions.length > 0) {
      this.log.info(`run() finished, found ${this._pendingTaskCompletions.length} pending task completions`);
      this.autoSummarizeTaskCompletion().catch((err) => {
        this.log.error(`Post-run auto-summarize failed: ${err}`);
      });
    }
  }

  /**
   * 停止循环（同时中止活跃的 stream 和正在执行的工具）
   */
  stop(): void {
    this.running = false;
    this._interrupted = false;
    this._pendingAppendMessage = null;

    // 🔧 先保存引用再 abort，避免竞态：run() 中正通过 signal 检查 abort 状态
    const abortController = this._abortController;
    this._abortController = null;
    if (abortController) {
      abortController.abort();
    }

    // 🆕 记录用户停止
    this.agentLoopLogger?.logInterrupt(
      this.currentIteration,
      'user_stop',
      undefined,
      !!this._currentStream,
      []
    ).catch(() => {
      // 忽略日志写入失败
    });

    // 中止所有正在执行的工具（Bash 进程、SubAgent 等）
    this.toolDispatcher.abortAll();

    // 中止当前活跃的 stream（先保存引用再操作）
    const currentStream = this._currentStream;
    this._currentStream = null;
    if (currentStream) {
      try {
        const streamAny = currentStream as unknown as Record<string, { abort?: () => void }>;
        if (streamAny.controller?.abort) {
          streamAny.controller.abort();
        }
        const iterator = (currentStream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
        if (typeof iterator.return === 'function') {
          iterator.return(undefined);
        }
      } catch {
        // 中止失败不影响 stop 逻辑
      }
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
      cost: 0,
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
   * 注册后台任务完成回调
   *
   * 运行中完成 → 推入 _pendingTaskCompletions，下个迭代注入 system_prompt_suffix
   * 空闲时完成 → 主动触发 run() 将结果汇总给用户
   */
  private registerAsyncTaskCompletionCallback(): void {
    const manager = AsyncAgentTaskManager.getInstance();
    manager.onTaskCompleted((result) => {
      this._pendingTaskCompletions.push(result);
      this.log.info(`Async task completion queued: ${result.groupId} ${result.status} (running=${this.running})`);

      // 🔧 从异步任务结果中提取引用原文数据，推送至前端
      if (result.result?.metadata) {
        const meta = result.result.metadata;
        const citations: Array<{ agentName: string; originalOutput: string; duration: number; tokensUsed: { input: number; output: number } }> = [];
        if (Array.isArray(meta.citations)) {
          citations.push(...(meta.citations as any[]));
        } else if (meta.originalOutput) {
          citations.push({
            agentName: (meta.agentName as string) || 'unknown-agent',
            originalOutput: meta.originalOutput as string,
            duration: (meta.duration as number) || 0,
            tokensUsed: (meta.tokensUsed as { input: number; output: number }) || { input: 0, output: 0 },
          });
        }
        if (citations.length > 0) {
          this.callbacks?.onCitationData?.(citations);
        }
      }

      if (!this.running) {
        this.log.info(`Agent idle, auto-summarizing async task: ${result.groupId}`);
        this.autoSummarizeTaskCompletion().catch((err) => {
          this.log.error(`Auto-summarize failed: ${err}`);
        });
      }
    });
  }

  /**
   * 后台任务完成时 agent 空闲 → 通知 renderer 并触发 run()
   */
  private async autoSummarizeTaskCompletion(): Promise<void> {
    this.log.info(`autoSummarizeTaskCompletion called, completions count: ${this._pendingTaskCompletions.length}`);
    // 通知 renderer 这是自动汇总，不是用户触发的执行
    this.callbacks?.onAutoSummarize?.();

    this._isAutoSummarizeRun = true;
    try {
      await this.run('[系统通知] 后台任务已完成，请汇总结果告知用户');
    } catch (err) {
      this.log.error(`Auto-run after task completion failed: ${err}`);
    } finally {
      this._isAutoSummarizeRun = false;
    }
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
      this.log.warn('Failed to inject todo context hint:', err instanceof Error ? err.message : String(err));
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
    this.contextCompressor.setHookRegistry(hookRegistry);
    this.toolExecutionCoordinator.setHookRegistry(hookRegistry);
  }

  /**
   * 🆕 P1 优化：设置 Extended Thinking 配置（由 ChatSession 调用）
   */
  setThinking(thinkingConfig: import('@/core/types').ThinkingConfig | undefined): void {
    this.thinkingConfig = thinkingConfig;
    this.streamRetryHandler.setThinkingConfig(thinkingConfig);
  }

  /**
   * 动态更新 Agent 配置（由 agent-bridge 在设置保存时调用）
   * 无需重启 session 即可生效
   */
  updateConfig(partial: { maxIterations?: number }): void {
    if (partial.maxIterations !== undefined) {
      this.config.maxIterations = partial.maxIterations;
      this.log.debug(`maxIterations 动态更新为: ${partial.maxIterations}`);
    }
  }

  /**
   * 动态更新 Provider（由 agent-bridge 在 provider 配置变更时调用）
   */
  updateProvider(provider: ILLMProvider): void {
    this.provider = provider;
    // 同步更新 ContextCompressor 的 provider 引用（用于 LLM 语义压缩）
    this.contextCompressor.setProvider(provider, {
      model: this.config.model,
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
    });
    this.log.debug('Provider 已动态更新（含 ContextCompressor）');
  }
}
