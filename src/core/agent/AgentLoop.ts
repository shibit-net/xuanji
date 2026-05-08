// ============================================================
// M2 Agent — ReAct 循环核心（精简版）
//
// 内部依赖：ContextManager + StreamPipeline + ToolGateway
// 已移除：MessageManager, TokenManager, ContextCompressor,
//   StreamProcessor, ToolDispatcher, ErrorRecovery,
//   StreamRetryHandler, ResultProcessor, ToolExecutionCoordinator,
//   MessagePreparationHandler, MessageContextHandler,
//   interrupt/append 状态机, TaskCompletionHandler
// ============================================================

import type { AgentConfig, AgentState, TokenUsage, ILLMProvider, IToolRegistry, ToolSchema, Message, ToolCall, ToolResult, CompressionResult } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { ContextManager } from '@/core/context/ContextManager';
import { StreamPipeline } from '@/core/stream/StreamPipeline';
import { ToolGateway } from '@/core/tools/ToolGateway';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { logger } from '@/core/logger';

/**
 * Agent 事件回调
 */
export interface AgentCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolDelta?: (id: string, name: string, receivedBytes: number) => void;
  onToolEnd?: (id: string, name: string, result: string, isError: boolean, metadata?: Record<string, unknown>) => void;
  onToolGrouped?: (groups: { parallelIds: string[]; serialIds: string[] }) => void;
  onFileChanges?: (changes: import('@/core/types').FileChange[]) => void;
  onUsage?: (usage: TokenUsage) => void;
  onInfo?: (message: string) => void;
  onError?: (error: Error) => void;
  onEnd?: (state: AgentState) => void;
}

/**
 * AgentLoop — ReAct 推理循环核心（精简版）
 */
export class AgentLoop {
  private log = logger.child({ module: 'AgentLoop' });

  private contextManager: ContextManager;
  private streamPipeline: StreamPipeline;
  private toolGateway: ToolGateway;

  private provider: ILLMProvider;
  private registry: IToolRegistry;
  private config: AgentConfig;
  private callbacks: AgentCallbacks = {};
  private running = false;
  private currentIteration = 0;
  private hookRegistry: HookRegistry | null = null;
  private thinkingConfig: import('@/core/types').ThinkingConfig | undefined = undefined;
  private _userId?: string;

  // 卡住检测
  private _lastToolNames: string[] = [];
  private _lastFileReads: string[] = [];
  private _lastOutputText: string = '';
  private _sameToolFailCount = 0;
  private _consecutiveSameFileCount = 0;
  private _consecutiveSameOutputCount = 0;

  /**
   * 当为 true 时，不向 EventBus 发射 text/thinking/tool/text_delta 事件。
   * 用于 ACP fallback 场景——子 agent 的同进程执行不应将流式内容混入主 agent 的 EventBus 通道。
   */
  private _suppressEventBus = false;

  /** 外部注入的待处理消息队列引用（来自 ChatSession._pendingQueue） */
  private _pendingQueue: string[] | null = null;

  /** 终止按钮标志——用户点击终止时置 true，在迭代边界检查中止 */
  private _abortRequested = false;

  setSuppressEventBus(v: boolean): void {
    this._suppressEventBus = v;
  }

  /** 注入 ChatSession 的待处理队列引用 */
  setPendingQueue(queue: string[]): void {
    this._pendingQueue = queue;
  }

  /** 用户点击终止按钮时调用——在当前工具调用或流式输出结束后平稳停止 */
  requestAbort(): void {
    this._abortRequested = true;
  }

  /** 当前迭代结束时检查新消息或终止请求，返回 true 表示需要注入并继续 */
  private checkIterationBoundary(): boolean {
    // 终止请求
    if (this._abortRequested) {
      this._abortRequested = false;
      this.running = false;
      this.callbacks.onInfo?.('🛑 已终止');
      return false;
    }
    // 有新消息则注入到 ContextManager 并继续
    if (this._pendingQueue && this._pendingQueue.length > 0) {
      const newInput = this._pendingQueue.shift()!;
      this.log.info(`[IterationBoundary] 检测到新消息，中断当前流程处理: "${newInput.substring(0, 60)}"`);
      this.currentIteration = 0;
      this.contextManager.setSystemPromptSuffix('', 'delegation-complete');
      this.contextManager.setSystemPromptSuffix('', 'async-task-completion');
      this.contextManager.setSystemPromptSuffix('', 'stuck-detect-same-file');
      this.contextManager.setSystemPromptSuffix('', 'stuck-detect-tool-fail');
      this.contextManager.addUserMessage(newInput);
      return true;
    }
    return false;
  }

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

    this.contextManager = new ContextManager(config.maxTokens, config.maxTokens ? Math.floor(config.maxTokens * 0.2) : undefined);
    this.contextManager.setSystemPrompt(config.systemPrompt ?? '');

    this.streamPipeline = new StreamPipeline(provider);

    this.toolGateway = new ToolGateway(registry);

    // 让 StreamPipeline 的 for-await 循环能检测到终止请求
    this.streamPipeline.setInterruptChecker(() => !this.running || this._abortRequested);

    this.streamPipeline.on({
      onText: (text) => {
        this.callbacks.onText?.(text);
        if (!this._suppressEventBus) {
          eventBus.emit(XuanjiEvent.AGENT_TEXT_DELTA, { text, agentId: this._userId });
        }
      },
      onThinking: (thinking) => {
        this.callbacks.onThinking?.(thinking);
        if (!this._suppressEventBus) {
          eventBus.emit(XuanjiEvent.AGENT_THINKING_DELTA, { content: thinking, agentId: this._userId });
        }
      },
      onToolStart: (id, name, input) => this.callbacks.onToolStart?.(id, name, input),
      onToolDelta: (id, name, receivedBytes) => this.callbacks.onToolDelta?.(id, name, receivedBytes),
      onUsage: (usage) => {
        this.contextManager.recordUsage(usage);
        this.callbacks.onUsage?.(usage);
      },
    });
  }

  on(callbacks: AgentCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /** 运行一轮对话（纯 ReAct 循环） */
  async run(userMessage: string, signal?: AbortSignal): Promise<void> {
    if (this.running) {
      this.log.warn('run() called while already running, ignoring');
      return;
    }
    this.running = true;
    this.currentIteration = 0;
    const maxIterations = this.config.maxIterations ?? Infinity;

    eventBus.emit(XuanjiEvent.AGENT_STARTED, {
      userId: this._userId,
      model: this.config.model,
    });

    try {
      this.contextManager.setSystemPromptSuffix('', 'delegation-complete');

      const permCtrl = (this.registry.getPermissionController?.() ?? {}) as Record<string, unknown>;
      if (typeof permCtrl.setCurrentUserIntent === 'function') {
        (permCtrl.setCurrentUserIntent as (msg: string) => void)(userMessage);
      }

      this.contextManager.addUserMessage(userMessage);

      let budgetCompacted = false;

      while (this.running && this.currentIteration < maxIterations) {
        if (signal?.aborted) break;
        this.currentIteration++;
        this.log.info(`[Iteration ${this.currentIteration}] Starting LLM call (tools: ${this.registry.getSchemas().length})`);

        if (!budgetCompacted && this.contextManager.getHistoryLength() > 10) {
          const budget = this.contextManager.checkBudget();
          if (budget.level === 'red') {
            this.callbacks.onInfo?.('💰 Token 用量较高，正在压缩上下文...');
            await this.contextManager.compress('aggressive');
            budgetCompacted = true;
          } else if (budget.level === 'yellow') {
            this.callbacks.onInfo?.(budget.suggestion ?? '');
            await this.contextManager.compress('summarize_early');
          }
        }

        const messages = this.contextManager.getMessages();
        const toolSchemas: ToolSchema[] = this.registry.getSchemas();

        const result = await this.streamPipeline.execute(messages, toolSchemas, {
          signal: signal,
          maxRetries: 3,
          config: {
            model: (this.config as any).model?.primary || (this.config as any).model || '',
            apiKey: (this.config as any).apiKey || '',
            baseURL: (this.config as any).baseURL || '',
          },
        });

        if (signal?.aborted) break;

        this.contextManager.addAssistantMessage(result.contentBlocks as import('@/core/types').ContentBlock[]);
        this.contextManager.recordUsage(result.usage);

        // ▶ 检查点 A：流式输出结束 — 有新消息或终止请求则跳出
        if (this.checkIterationBoundary()) {
          continue;  // 新消息已注入，进入下一轮 while
        }
        if (!this.running) break;  // 终止请求

        if (!result.toolCalls || result.toolCalls.length === 0) break;
        if (result.stopReason === 'end_turn' && result.toolCalls.length === 0) break;

        // ── 工具执行 ──
        const toolExecStartTime = Date.now();

        if (result.toolCalls.length > 1) {
          this.callbacks.onToolGrouped?.({
            parallelIds: result.toolCalls.map(tc => tc.id),
            serialIds: [],
          });
        }

        for (const tc of result.toolCalls) {
          this.callbacks.onToolStart?.(tc.id, tc.name, tc.input);
          eventBus.emit(XuanjiEvent.AGENT_TOOL_START, {
            id: tc.id,
            name: tc.name,
            input: tc.input,
            agentId: this._userId,
          });
        }

        const resultsMap = await this.toolGateway.executeBatch(result.toolCalls, {
          signal: signal,
          agentId: this._userId ?? 'default',
          workingDir: this.config.workingDir,
        });

        // ▶ 检查点 B：工具调用结束 — 有新消息或终止请求则跳出
        if (this.checkIterationBoundary()) {
          continue;  // 新消息已注入，不处理本轮工具结果
        }
        if (!this.running) break;  // 终止请求

        const toolExecDurationMs = Date.now() - toolExecStartTime;

        const fileChanges: import('@/core/types').FileChange[] = [];
        for (const tc of result.toolCalls) {
          const toolResult = resultsMap.get(tc.id);
          if (toolResult) {
            this.callbacks.onToolEnd?.(tc.id, tc.name, toolResult.content, toolResult.isError, toolResult.metadata);
            eventBus.emit(XuanjiEvent.AGENT_TOOL_END, {
              id: tc.id,
              name: tc.name,
              result: toolResult.content,
              isError: toolResult.isError,
              agentId: this._userId,
              metadata: toolResult.metadata,
            });
            if ((toolResult as any).fileChanges?.length > 0) {
              fileChanges.push(...(toolResult as any).fileChanges);
            }
          }
        }

        if (fileChanges.length > 0) {
          this.callbacks.onFileChanges?.(fileChanges);
          eventBus.emit(XuanjiEvent.AGENT_FILE_CHANGES, {
            changes: fileChanges,
            userId: this._userId,
          });
        }

        if (this.hookRegistry) {
          for (const tc of result.toolCalls) {
            const tr = resultsMap.get(tc.id);
            this.hookRegistry.emit('PostToolUse', {
              event: 'PostToolUse' as any,
              timestamp: Date.now(),
              toolName: tc.name,
              toolInput: tc.input as Record<string, unknown>,
              toolResult: tr?.content,
              toolIsError: tr?.isError,
              toolDuration: toolExecDurationMs,
            }).catch(() => {});
          }
        }

        this.contextManager.addToolResults(resultsMap);

        const hasCompletedDelegation = result.toolCalls.some(
          tc => (tc.name === 'task' || tc.name === 'agent_team') &&
                 resultsMap.get(tc.id) && !resultsMap.get(tc.id)!.isError
        );
        if (hasCompletedDelegation) {
          this.contextManager.setSystemPromptSuffix(
            '\n[子任务已完成] 你委托给子 agent 或 agent team 的任务已经返回结果。请检查执行结果，并使用 todo_update 将对应任务标记为 completed。',
            'delegation-complete',
          );
        }

        // ── 卡住检测 ──
        for (const tc of result.toolCalls) {
          const tr = resultsMap.get(tc.id);
          if (tr?.isError) {
            if (this._lastToolNames.length > 0 && this._lastToolNames[this._lastToolNames.length - 1] === tc.name) {
              this._sameToolFailCount++;
            } else {
              this._sameToolFailCount = 1;
            }
            this._lastToolNames.push(tc.name);
            if (this._sameToolFailCount >= 2) {
              this.log.warn(`[StuckDetect] Same tool "${tc.name}" failed ${this._sameToolFailCount} times. Breaking loop.`);
              this.contextManager.setSystemPromptSuffix(
                `\n[警告] 工具 "${tc.name}" 已连续失败 ${this._sameToolFailCount} 次。请切换实现方案，不要继续重试同一工具。`,
                'stuck-detect-tool-fail',
              );
              this._sameToolFailCount = 0;
            }
          }
        }

        const readOps = result.toolCalls.filter(
          tc => (tc.name === 'read_file' || tc.name === 'browser_navigate') && typeof tc.input === 'object' && tc.input !== null
        );
        if (readOps.length > 0) {
          const readTargets = readOps.map(tc => JSON.stringify(tc.input));
          for (const target of readTargets) {
            if (this._lastFileReads.length > 0 && this._lastFileReads[this._lastFileReads.length - 1] === target) {
              this._consecutiveSameFileCount++;
            } else {
              this._consecutiveSameFileCount = 1;
            }
            this._lastFileReads.push(target);
          }
          if (this._consecutiveSameFileCount >= 3) {
            this.log.warn(`[StuckDetect] Same file read ${this._consecutiveSameFileCount} consecutive times.`);
            this.contextManager.setSystemPromptSuffix(
              `\n[警告] 你已连续读取同一文件 ${this._consecutiveSameFileCount} 次。你已经理解了内容，请继续推进工作。`,
              'stuck-detect-same-file',
            );
            this._consecutiveSameFileCount = 0;
          }
        }

        if (result.contentBlocks && result.contentBlocks.length > 0) {
          const outputText = result.contentBlocks.map(b => (b as any).text || '').join('');
          if (outputText && outputText === this._lastOutputText) {
            this._consecutiveSameOutputCount++;
          } else {
            this._consecutiveSameOutputCount = 0;
            this._lastOutputText = outputText;
          }
          if (this._consecutiveSameOutputCount >= 2) {
            this.log.warn('[StuckDetect] Same output text 2+ consecutive iterations. Breaking loop.');
            this.contextManager.setSystemPromptSuffix('', 'stuck-detect-same-file');
            this.contextManager.setSystemPromptSuffix('', 'stuck-detect-tool-fail');
            this.callbacks.onInfo?.('⚠️ Agent 检测到循环重复，已自动终止。请重新描述需求。');
            break;
          }
        }
      }

      if (this.currentIteration >= maxIterations) {
        this.log.warn(`Max iterations reached: ${this.currentIteration}/${maxIterations}`);
        this.callbacks.onError?.(new Error(
          `⚠️ Agent 循环达到最大迭代次数 (${maxIterations})，已自动停止。如需继续，请发送新消息。`
        ));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (signal?.aborted) {
        this.log.debug('Agent aborted via signal');
        return;
      }

      const isAbort = !this.running && (
        err.name === 'AbortError' ||
        err.message.includes('aborted') ||
        err.message.includes('abort') ||
        err.message === 'terminated' ||
        err.message === 'Interrupted'
      );
      if (isAbort) {
        this.log.debug('Agent stopped by user, suppressing abort error');
        return;
      }

      if (this.hookRegistry) {
        this.hookRegistry.emit('ErrorOccurred', {
          errorMessage: err.message,
          errorStack: err.stack,
        }).catch(() => {});
      }

      eventBus.emit(XuanjiEvent.AGENT_ERROR, {
        error: err.message,
        userId: this._userId,
      });

      this.callbacks.onError?.(err);
      throw err;
    } finally {
      this.running = false;
      this.callbacks.onEnd?.(this.getState());
      eventBus.emit(XuanjiEvent.AGENT_COMPLETED, {
        userId: this._userId,
        iterations: this.currentIteration,
        tokenUsage: this.contextManager.getTokenUsage(),
      });
    }
  }

  stop(): void {
    this.running = false;
    this._abortRequested = true;
    this.streamPipeline.abort();
    this.toolGateway.abortAll();
  }

  reset(): void {
    this.contextManager.clear();
    this.currentIteration = 0;
  }

  async compact(customInstruction?: string): Promise<CompressionResult | null> {
    const result = await this.contextManager.compress('summarize_early');
    if (result.compressionRatio > 0) {
      if (this.hookRegistry) {
        this.hookRegistry.emit('PostCompact', {
          originalTokens: result.originalTokens,
          compressedTokens: result.compressedTokens,
          compressionRatio: result.compressionRatio,
          duration: 0,
        }).catch(() => {});
      }
      return {
        originalTokens: result.originalTokens,
        compressedTokens: result.compressedTokens,
        compressionRatio: result.compressionRatio,
        summary: result.summary,
        compressed: result.compressed,
      };
    }
    return null;
  }

  getState(): AgentState {
    return {
      status: this.running ? 'thinking' : 'idle',
      messages: this.contextManager.getHistory(),
      tokenUsage: this.contextManager.getTokenUsage(),
      cost: 0,
      currentIteration: this.currentIteration,
    };
  }

  getContextManager(): ContextManager {
    return this.contextManager;
  }

  getMessageHistory(): Message[] {
    return this.contextManager.getHistory();
  }

  restoreMessages(messages: Message[]): void {
    this.contextManager.replaceMessages(messages);
  }

  setHookRegistry(hookRegistry: HookRegistry): void {
    this.hookRegistry = hookRegistry;
  }

  setThinking(thinkingConfig: import('@/core/types').ThinkingConfig | undefined): void {
    this.thinkingConfig = thinkingConfig;
  }

  updateConfig(partial: { maxIterations?: number }): void {
    if (partial.maxIterations !== undefined) {
      this.config.maxIterations = partial.maxIterations;
    }
  }

  updateProvider(provider: ILLMProvider): void {
    this.provider = provider;
    this.streamPipeline = new StreamPipeline(provider);
    this.streamPipeline.on({
      onText: (text) => this.callbacks.onText?.(text),
      onThinking: (thinking) => this.callbacks.onThinking?.(thinking),
      onToolStart: (id, name, input) => this.callbacks.onToolStart?.(id, name, input),
      onToolDelta: (id, name, receivedBytes) => this.callbacks.onToolDelta?.(id, name, receivedBytes),
      onUsage: (usage) => {
        this.contextManager.recordUsage(usage);
        this.callbacks.onUsage?.(usage);
      },
    });
  }
}
