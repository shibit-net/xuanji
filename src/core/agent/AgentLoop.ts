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
import { shouldRetry, calculateBackoff, DEFAULT_RETRY_CONFIG } from '@/core/providers/RetryPolicy';
import { logger } from '@/core/logger';
import { SessionRecorder } from '@/core/telemetry';
import { UsageStatsRecorder } from '@/core/telemetry';
import { PerfCollector } from '@/core/telemetry';

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
  private provider: ILLMProvider;
  private registry: IToolRegistry;
  private config: AgentConfig;
  private callbacks: AgentCallbacks = {};
  private running = false;
  private currentIteration = 0;
  private memoryStore: IMemoryStore | null = null;
  private hookRegistry: HookRegistry | null = null;
  /** 当前活跃的 stream 引用（用于 stop() 时中止流） */
  private _currentStream: AsyncIterable<import('@/core/types').StreamEvent> | null = null;

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

    // 注册流处理回调
    this.streamProcessor.onTextDelta((text) => this.callbacks.onText?.(text));
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
    this.currentIteration = 0;
    const maxIterations = this.config.maxIterations ?? 50;
    const startTime = Date.now();
    const sessionId = `session-${startTime}`;
    const toolStatsMap = new Map<string, { count: number; durationMs: number; errorCount: number }>();
    const sessionToolCalls: ToolCallRecord[] = [];

    try {
      // 构建初始消息
      let messages = this.messageManager.build(userMessage);

      // 保存原始 textHandler（在循环外保存一次，避免嵌套包装堆积）
      const originalTextHandler = this.streamProcessor.getTextHandler();

      while (this.running && this.currentIteration < maxIterations) {
        this.currentIteration++;

        // 主动通知 UI 进入 thinking 状态（每轮开始时）
        this.callbacks.onThinking?.('');

        this.log.debug(`Iteration ${this.currentIteration}/${maxIterations}, running=${this.running}, messages=${messages.length}`);

        // 智能压缩（在硬截断之前，支持 LLM 语义压缩）
        const compressionResult = await this.contextCompressor.compressAsync(messages, this.tokenManager);
        messages = compressionResult.compressed;
        if (compressionResult.compressionRatio > 0) {
          // 同步压缩结果到 MessageManager，防止下轮循环通过 getMessages() 恢复为未压缩版本
          this.messageManager.replaceMessages(messages.slice(1)); // 去掉 system prompt
          this.callbacks.onInfo?.(
            `📦 压缩了 ${compressionResult.originalTokens - compressionResult.compressedTokens} tokens` +
            ` (${Math.round(compressionResult.compressionRatio * 100)}% 压缩率)`
          );
        }

        // Token 窗口裁剪（兜底保护）
        messages = this.tokenManager.fitWindow(messages);

        // 调用 LLM（带重试）
        const toolSchemas: ToolSchema[] = this.registry.getSchemas();
        const perfTimer = this.perfCollector.createTimer(this.config.model, this.currentIteration);
        const retryConfig = this.config.retry ?? DEFAULT_RETRY_CONFIG;

        let result: ProcessResult | undefined;
        let lastStreamError: unknown;

        // 注册首 token 计时 handler（复用外部保存的 originalTextHandler，避免嵌套）
        let firstTokenMarked = false;
        this.streamProcessor.onTextDelta((text) => {
          if (!firstTokenMarked) {
            perfTimer.markFirstToken();
            firstTokenMarked = true;
          }
          // 委托给原始 handler（构造函数中注册的，会调用 this.callbacks.onText）
          originalTextHandler?.(text);
        });

        for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
          try {
            const stream = this.provider.stream(
              messages,
              toolSchemas,
              {
                model: this.config.model,
                apiKey: this.config.apiKey,
                baseURL: this.config.baseURL,
                maxTokens: this.config.maxTokens,
                temperature: this.config.temperature,
              },
            );
            this._currentStream = stream;

            // 每次重试重置首 token 标记
            firstTokenMarked = false;
            result = await this.streamProcessor.consume(stream);
            this._currentStream = null;
            break; // 成功，退出重试循环
          } catch (streamError) {
            this._currentStream = null;
            lastStreamError = streamError;
            if (!shouldRetry(streamError, attempt, retryConfig)) {
              throw streamError; // 不可重试，直接抛出
            }
            const delay = calculateBackoff(attempt, retryConfig);
            this.log.warn(`API call failed (attempt ${attempt + 1}/${retryConfig.maxRetries + 1}), retrying in ${Math.round(delay)}ms: ${streamError instanceof Error ? streamError.message : String(streamError)}`);
            this.callbacks.onInfo?.(`⚠️ API 请求失败，${Math.round(delay / 1000)}s 后重试 (${attempt + 1}/${retryConfig.maxRetries})...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
        if (!result) {
          throw lastStreamError ?? new Error('API call failed after retries');
        }

        // 记录性能指标
        perfTimer.finish(result.usage.input, result.usage.output).catch(() => {});

        // 记录 assistant 消息
        this.messageManager.addAssistantMessage(result.contentBlocks);

        // 错误恢复：成功调用重置计数
        this.errorRecovery.reset();

        this.log.debug(`Result: stopReason=${result.stopReason}, toolCalls=${result.toolCalls.length}, contentBlocks=${result.contentBlocks.length}`);

        // 判断是否结束
        if (result.stopReason === 'end_turn' || result.toolCalls.length === 0) {
          this.log.debug(`Loop ended: stopReason=${result.stopReason}, toolCalls=${result.toolCalls.length}`);
          break;
        }

        // max_tokens 截断或 interrupted 中断处理：将被截断的工具调用替换为错误结果，让 LLM 重试
        if (result.stopReason === 'max_tokens' || result.stopReason === 'interrupted') {
          // 友好提示用户（非异常）
          const infoMessage = result.stopReason === 'interrupted'
            ? '🔄 流传输中断，正在自动恢复...'
            : '📝 输出内容过多，正在自动分段写入...';
          this.callbacks.onInfo?.(infoMessage);

          // 检查是否有被截断或解析失败的工具调用
          const truncatedTools = result.toolCalls.filter(
            (tc) => (tc.input as Record<string, unknown>)?._truncated || (tc.input as Record<string, unknown>)?._parse_error
          );

          if (truncatedTools.length > 0) {
            // 将截断的工具调用结果作为错误返回给 LLM，引导它重试
            const errorResults = new Map<string, { content: string; isError: boolean }>();
            for (const tc of truncatedTools) {
              errorResults.set(tc.id, {
                content: [
                  `[ERROR] Tool call "${tc.name}" failed: output token limit reached, arguments were truncated.`,
                  ``,
                  `The content was too large to fit in a single tool call.`,
                  `REQUIRED: Split this into MULTIPLE SMALL tool calls:`,
                  `  - Each write_file call: max 200 lines`,
                  `  - Each edit_file call: max 50 lines of old_string/new_string`,
                  `  - Write the first chunk with write_file, then use edit_file to append remaining chunks`,
                  `  - For edit_file append: use the last few lines as old_string, and those lines + new content as new_string`,
                ].join('\n'),
                isError: true,
              });
              // 通知 UI
              this.callbacks.onToolEnd?.(tc.id, tc.name, errorResults.get(tc.id)!.content, true);
            }
            this.messageManager.addToolResults(errorResults);
          } else {
            // 没有工具调用（tool_use block 完全未完成），注入用户提示让 LLM 重试
            this.messageManager.addUserMessage(
              '[System] Output token limit reached. Split large operations into MULTIPLE SMALL tool calls (write_file max 200 lines, edit_file max 50 lines). DO NOT retry with large content in a single call.',
            );
          }

          // 重建消息继续循环
          messages = this.messageManager.getMessages();
          continue;
        }

        // 执行工具（批量执行，自动并行+串行）
        // 先通知 UI 层工具分组信息（并行 vs 串行）
        const parallelIds: string[] = [];
        const serialIds: string[] = [];
        for (const tc of result.toolCalls) {
          const tool = this.registry.get(tc.name);
          if (tool?.readonly === true) {
            parallelIds.push(tc.id);
          } else {
            serialIds.push(tc.id);
          }
        }
        if (parallelIds.length > 1) {
          this.callbacks.onToolGrouped?.({ parallelIds, serialIds });
        }

        // 触发 PreToolUse Hook（同步，可阻塞）
        const blockedToolIds = new Set<string>();
        if (this.hookRegistry) {
          for (const tc of result.toolCalls) {
            try {
              const hookResult = await this.hookRegistry.emitSync('PreToolUse', {
                toolName: tc.name,
                toolInput: tc.input as Record<string, unknown>,
              });
              if (hookResult.blocked) {
                blockedToolIds.add(tc.id);
                this.log.info(`Tool ${tc.name} blocked by PreToolUse hook`);
                this.callbacks.onInfo?.(`⛔ Hook 阻止了工具 ${tc.name} 的执行`);
              }
            } catch (hookErr) {
              // Hook 异常不阻塞工具执行
              this.log.debug(`PreToolUse hook error for ${tc.name}:`, hookErr);
            }
          }
        }

        // 过滤被 Hook 阻塞的工具，为其生成错误结果
        const allowedToolCalls = result.toolCalls.filter((tc) => !blockedToolIds.has(tc.id));
        const blockedResults = new Map<string, { content: string; isError: boolean }>();
        for (const tc of result.toolCalls) {
          if (blockedToolIds.has(tc.id)) {
            blockedResults.set(tc.id, {
              content: `[BLOCKED] 工具 "${tc.name}" 被 PreToolUse Hook 阻止执行。请检查 Hook 配置或尝试其他方式。`,
              isError: true,
            });
            this.callbacks.onToolEnd?.(tc.id, tc.name, blockedResults.get(tc.id)!.content, true);
          }
        }

        const toolExecStartTime = Date.now();
        const resultsMap = await this.toolDispatcher.executeAll(allowedToolCalls);
        const toolExecDurationMs = Date.now() - toolExecStartTime;

        // 将被阻塞工具的错误结果合并到 resultsMap
        for (const [id, result] of blockedResults) {
          resultsMap.set(id, result);
        }

        // 触发 PostToolUse Hook（异步，不阻塞）
        if (this.hookRegistry) {
          for (const toolCall of result.toolCalls) {
            const toolResult = resultsMap.get(toolCall.id);
            this.hookRegistry.emit('PostToolUse', {
              toolName: toolCall.name,
              toolInput: toolCall.input as Record<string, unknown>,
              toolResult: toolResult?.content?.slice(0, 2000),
              toolIsError: toolResult?.isError,
              toolDuration: Math.round(toolExecDurationMs / result.toolCalls.length),
            }).catch(() => {});
          }
        }

        // 统计工具调用（按工具名聚合）
        for (const toolCall of result.toolCalls) {
          const toolResult = resultsMap.get(toolCall.id);
          const existing = toolStatsMap.get(toolCall.name) ?? { count: 0, durationMs: 0, errorCount: 0 };
          existing.count++;
          // 将总耗时按工具数量均分（近似值，无法精确到单个工具）
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

        // 触发 onToolEnd 回调（按原始顺序）
        // try-catch 保护：回调异常（如 Ink 渲染/stdout.write 异常）不应终止 ReAct 循环
        for (const toolCall of result.toolCalls) {
          const toolResult = resultsMap.get(toolCall.id);
          if (toolResult) {
            try {
              this.callbacks.onToolEnd?.(
                toolCall.id,
                toolCall.name,
                toolResult.content,
                toolResult.isError
              );
            } catch (callbackErr) {
              // 回调失败（如 stdout.write 异常）不中断工具执行流程
              this.log.error('onToolEnd callback error:', callbackErr);
            }
          }
        }

        // 批量添加工具结果到消息历史
        this.messageManager.addToolResults(resultsMap);

        // 重建消息 (system prompt + 历史 + 工具结果)
        messages = this.messageManager.getMessages();
      }

      // 迭代达到上限时通知用户
      if (this.currentIteration >= maxIterations) {
        this.log.warn(`Max iterations reached: ${this.currentIteration}/${maxIterations}`);
        this.callbacks.onError?.(new Error(
          `⚠️ Agent 循环达到最大迭代次数 (${maxIterations})，已自动停止。如需继续，请发送新消息。`
        ));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 触发 ErrorOccurred Hook
      if (this.hookRegistry) {
        this.hookRegistry.emit('ErrorOccurred', {
          errorMessage: err.message,
          errorStack: err.stack,
        }).catch(() => {});
      }

      // 使用友好化的错误消息
      const friendlyError = new Error(ErrorRecovery.formatError(err));
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
          } catch (memoryErr) {
            this.log.debug('Failed to save session memory:', memoryErr);
          }
        }
      }
    }
  }

  /**
   * 停止循环（同时中止活跃的 stream）
   */
  stop(): void {
    this.running = false;
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
  }

  /**
   * 注入 PricingResolver（由 ChatSession 调用）
   */
  setPricingResolver(resolver: PricingResolver): void {
    this.costTracker.setPricingResolver(resolver);
  }
}
