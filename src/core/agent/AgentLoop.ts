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
import type { InterruptChecker } from '@/core/agent/InterruptChecker';

/** 硬性最大迭代次数，超过此值强制终止，防止无限循环 */
const HARD_MAX_ITERATIONS = 100;

/**
 * Agent 事件回调
 */
export interface AgentCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolDelta?: (id: string, name: string, receivedBytes: number) => void;
  onToolEnd?: (id: string, name: string, result: string, isError: boolean, metadata?: Record<string, unknown>, contentBlocks?: Array<{ type: 'image'; mimeType: string; data: string }>) => void;
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

  /** 终止按钮标志——用户点击终止时置 true，在迭代边界检查中止 */
  private _abortRequested = false;

  /** 外部注入的待处理消息队列引用（来自 ChatSession._pendingQueue），仅用于思考阶段打断检测 */
  private _pendingQueue: string[] | null = null;

  /** 可选注入的中断检查器（Phase 2 状态机路径），优先级高于 _pendingQueue */
  private _interruptChecker: InterruptChecker | null = null;

  /** 当前迭代是否已开始输出文本（onText 触发后置 true，用于区分思考/输出阶段） */
  private _streamingOutputStarted = false;

  /** 整个 run() 生命周期内是否已输出过文本。一旦置 true 不再重置，防止后续迭代被补充输入打断 */
  private _hasOutputInThisRun = false;

  setSuppressEventBus(v: boolean): void {
    this._suppressEventBus = v;
  }

  /** 注入 ChatSession 的待处理队列引用 */
  setPendingQueue(queue: string[]): void {
    this._pendingQueue = queue;
  }

  /** 注入可选的 InterruptChecker（Phase 2 状态机路径），设置后 checkShouldStop 优先使用 */
  setInterruptChecker(checker: InterruptChecker | null): void {
    this._interruptChecker = checker;
  }

  /** 用户点击终止按钮时调用——在当前工具调用或流式输出结束后平稳停止 */
  requestAbort(): void {
    this._abortRequested = true;
  }

  /** 层级策略上下文提炼：检测 [SUMMARY]...[/SUMMARY] 标记，提取摘要并压缩 tool_result */
  private extractAndCompressSummary(blocks: import('@/core/types').ContentBlock[]): void {
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        const match = block.text.match(/\[SUMMARY\]\s*\n([\s\S]*?)\[\/SUMMARY\]/);
        if (match) {
          const summary = match[1].trim();
          if (summary) {
            this.contextManager.compressLastSubAgentOutput(summary);
            // 清理标记文本，避免 [SUMMARY] 块浪费后续上下文
            block.text = block.text.replace(/\[SUMMARY\][\s\S]*?\[\/SUMMARY\]/, '').trim();
          }
        }
      }
    }
  }

  /** 检查是否应停止当前 run()：优先使用 InterruptChecker，回退到 _pendingQueue 旧路径 */
  private checkShouldStop(): boolean {
    // Phase 2 路径：委托给 InterruptChecker（SessionStateMachine）
    if (this._interruptChecker) {
      if (this._interruptChecker.shouldAbort()) {
        this._abortRequested = false;
        this.running = false;
        this.callbacks.onInfo?.('🛑 已终止');
        return true;
      }
      if (this._interruptChecker.shouldStop()) {
        this.running = false;
        return true;
      }
      if (this._interruptChecker.shouldStopAtCheckpoint?.()) {
        this.running = false;
        return true;
      }
      return false;
    }

    // 旧路径：_abortRequested + _pendingQueue 补充输入
    if (this._abortRequested) {
      this._abortRequested = false;
      this.running = false;
      this.callbacks.onInfo?.('🛑 已终止');
      return true;
    }
    if (!this._hasOutputInThisRun && this._pendingQueue !== null && this._pendingQueue.length > 0) {
      this.running = false;
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

    // 中断流式请求：优先 InterruptChecker（Phase 2），回退 _abortRequested / _pendingQueue
    this.streamPipeline.setInterruptChecker(() => {
      if (!this.running) return true;
      if (this._interruptChecker) {
        if (this._interruptChecker.shouldAbort()) return true;
        if (this._interruptChecker.shouldStop()) {
          this.running = false;
          return true;
        }
        return false;
      }
      if (this._abortRequested) return true;
      if (!this._hasOutputInThisRun && this._pendingQueue !== null && this._pendingQueue.length > 0) {
        this.running = false;
        return true;
      }
      return false;
    });

    this.streamPipeline.on({
      onText: (text) => {
        this.log.info(`[DIAG] AgentLoop onText called: len=${text.length} text="${text.substring(0, 50)}"`);
        this._streamingOutputStarted = true;
        this._hasOutputInThisRun = true;
        this.callbacks.onText?.(text);
        if (!this._suppressEventBus) {
          eventBus.emitSync(XuanjiEvent.AGENT_TEXT_DELTA, { text, agentId: this._userId });
        }
      },
      onThinking: (thinking) => {
        this.callbacks.onThinking?.(thinking);
        if (!this._suppressEventBus) {
          eventBus.emitSync(XuanjiEvent.AGENT_THINKING_DELTA, { content: thinking, agentId: this._userId });
        }
      },
      onToolStart: (id, name, input) => this.callbacks.onToolStart?.(id, name, input),
      onToolDelta: (id, name, receivedBytes) => this.callbacks.onToolDelta?.(id, name, receivedBytes),
      onUsage: (usage) => {
        this.contextManager.recordUsage(usage);
        this.callbacks.onUsage?.(usage);
        if (!this._suppressEventBus) {
          eventBus.emitSync(XuanjiEvent.AGENT_USAGE, {
            userId: this._userId,
            tokenUsage: usage,
          });
        }
      },
    });
  }

  on(callbacks: AgentCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /** 运行一轮对话（纯 ReAct 循环） */
  async run(userMessage: string, signal?: AbortSignal, imageBlocks?: Array<{ data: string; mimeType: string }>): Promise<void> {
    if (this.running) {
      this.log.warn('run() called while already running, ignoring');
      return;
    }
    this.running = true;
    this.currentIteration = 0;
    this._hasOutputInThisRun = false;
    this._abortRequested = false;
    const maxIterations = Math.min(this.config.maxIterations ?? Infinity, HARD_MAX_ITERATIONS);

    this.log.info(`[DIAG] AgentLoop.run: starting, model=${(this.config as any).model} apiKey=${((this.config as any).apiKey || '').substring(0, 8)}... baseURL=${(this.config as any).baseURL} toolCount=${this.registry.getSchemas().length} maxIterations=${maxIterations}`);

    eventBus.emitSync(XuanjiEvent.AGENT_STARTED, {
      userId: this._userId,
      model: this.config.model,
    });

    try {
      this.contextManager.setSystemPromptSuffix('', 'delegation-complete');

      const permCtrl = (this.registry.getPermissionController?.() ?? {}) as Record<string, unknown>;
      if (typeof permCtrl.setCurrentUserIntent === 'function') {
        (permCtrl.setCurrentUserIntent as (msg: string) => void)(userMessage);
      }

      this.contextManager.addUserMessage(userMessage, imageBlocks);

      let lastCompressIteration = 0;

      while (this.running && this.currentIteration < maxIterations) {
        if (signal?.aborted) break;
        this.currentIteration++;
        this.log.info(`[Iteration ${this.currentIteration}] Starting LLM call (tools: ${this.registry.getSchemas().length})`);

        // 每次迭代都检查预算，允许重复压缩（冷却 3 轮避免连续压缩）
        if (this.contextManager.getHistoryLength() > 10 && this.currentIteration - lastCompressIteration > 3) {
          const budget = this.contextManager.checkBudget();
          if (budget.level === 'red') {
            this.callbacks.onInfo?.('💰 Token 用量较高，正在压缩上下文...');
            await this.contextManager.compress('aggressive');
            lastCompressIteration = this.currentIteration;
          } else if (budget.level === 'yellow') {
            this.callbacks.onInfo?.(budget.suggestion ?? '');
            await this.contextManager.compress('summarize_early');
            lastCompressIteration = this.currentIteration;
          }
        }

        // 修复因中断/异常产生的孤立 tool_use 块，防止 API 400 错误
        const orphanedIds = this.contextManager.repairOrphanedToolUses();
        if (orphanedIds.length > 0) {
          this.log.warn(`Repaired orphaned tool_use blocks: [${orphanedIds.join(', ')}]`);
        }

        const messages = this.contextManager.getMessages();
        const toolSchemas: ToolSchema[] = this.registry.getSchemas();

        this._streamingOutputStarted = false;
        const streamConfig = {
          model: (this.config as any).model?.primary || (this.config as any).model || '',
          apiKey: (this.config as any).apiKey || '',
          baseURL: (this.config as any).baseURL || '',
          maxTokens: this.config.maxTokens,
          thinking: this.thinkingConfig || (this.config as any).thinking,
        };
        this.log.info(`[DIAG] AgentLoop.run: calling streamPipeline.execute, model=${streamConfig.model} apiKey=${streamConfig.apiKey.substring(0, 8)}... baseURL=${streamConfig.baseURL} msgCount=${messages.length} toolCount=${toolSchemas.length}`);
        const result = await this.streamPipeline.execute(messages, toolSchemas, {
          signal: signal,
          maxRetries: 3,
          config: streamConfig,
          onContentTooLarge: async () => {
            this.log.warn('API 返回上下文过长错误，自动触发激进压缩');
            this.callbacks.onInfo?.('⚠️ 上下文过长，自动压缩后重试...');
            await this.contextManager.compress('aggressive');
            return true;
          },
        });
        this.log.info(`[DIAG] AgentLoop.run: streamPipeline.execute returned, contentBlocks=${result.contentBlocks?.length || 0} toolCalls=${result.toolCalls?.length || 0} stopReason=${result.stopReason}`);

        if (signal?.aborted) break;

        this.contextManager.addAssistantMessage(result.contentBlocks as import('@/core/types').ContentBlock[]);
        this.contextManager.recordUsage(result.usage);

        // 层级策略上下文提炼：检测 [SUMMARY]...[/SUMMARY] 标记，用摘要替换 worker 原文
        this.extractAndCompressSummary(result.contentBlocks as import('@/core/types').ContentBlock[]);

        // ▶ 检查点 A：流式输出结束 — 终止或补充输入则跳出
        if (this.checkShouldStop()) break;

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
          eventBus.emitSync(XuanjiEvent.AGENT_TOOL_START, {
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

        const toolExecDurationMs = Date.now() - toolExecStartTime;

        const fileChanges: import('@/core/types').FileChange[] = [];
        for (const tc of result.toolCalls) {
          const toolResult = resultsMap.get(tc.id);
          if (toolResult) {
            this.callbacks.onToolEnd?.(tc.id, tc.name, toolResult.content, toolResult.isError, toolResult.metadata, toolResult.contentBlocks);
            eventBus.emitSync(XuanjiEvent.AGENT_TOOL_END, {
              id: tc.id,
              name: tc.name,
              result: toolResult.content,
              isError: toolResult.isError,
              agentId: this._userId,
              metadata: toolResult.metadata,
              contentBlocks: toolResult.contentBlocks,
            });
            if ((toolResult as any).fileChanges?.length > 0) {
              fileChanges.push(...(toolResult as any).fileChanges);
            }
          }
        }

        if (fileChanges.length > 0) {
          this.callbacks.onFileChanges?.(fileChanges);
          eventBus.emitSync(XuanjiEvent.AGENT_FILE_CHANGES, {
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

        // ▶ 检查点 B：工具调用结束 — 终止或补充输入则跳出（必须在 addToolResults 之后，防止工具结果丢失）
        if (this.checkShouldStop()) break;

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
      this.log.error(`[DIAG] AgentLoop.run: caught error: ${err.message}`, err.stack);

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

      eventBus.emitSync(XuanjiEvent.AGENT_ERROR, {
        error: err.message,
        userId: this._userId,
      });

      this.callbacks.onError?.(err);
      throw err;
    } finally {
      this.log.info(`[DIAG] AgentLoop.run: finally block, hasOutput=${this._hasOutputInThisRun} iterations=${this.currentIteration}`);
      this.running = false;
      this.callbacks.onEnd?.(this.getState());
      eventBus.emitSync(XuanjiEvent.AGENT_COMPLETED, {
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

  getToolRegistry(): IToolRegistry {
    return this.registry;
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

  applyAgentConfig(cfg: {
    provider?: ILLMProvider;
    systemPrompt?: string;
    toolRegistry?: IToolRegistry;
    model?: string;
    apiKey?: string;
    baseURL?: string;
    maxIterations?: number;
    temperature?: number;
    maxTokens?: number;
  }): void {
    if (cfg.provider) {
      this.provider = cfg.provider;
      this.streamPipeline = new StreamPipeline(cfg.provider);
      this.streamPipeline.setInterruptChecker(() => {
        if (!this.running) return true;
        if (this._interruptChecker) {
          if (this._interruptChecker.shouldAbort()) return true;
          if (this._interruptChecker.shouldStop()) {
            this.running = false;
            return true;
          }
          return false;
        }
        if (this._abortRequested) return true;
        if (!this._hasOutputInThisRun && this._pendingQueue !== null && this._pendingQueue.length > 0) {
          this.running = false;
          return true;
        }
        return false;
      });
      this.streamPipeline.on({
        onText: (text) => {
          this.log.info(`[DIAG] AgentLoop onText(applyAgentConfig) called: len=${text.length} text="${text.substring(0, 50)}"`);
          this._streamingOutputStarted = true;
          this._hasOutputInThisRun = true;
          this.callbacks.onText?.(text);
          if (!this._suppressEventBus) {
            eventBus.emitSync(XuanjiEvent.AGENT_TEXT_DELTA, { text, agentId: this._userId });
          }
        },
        onThinking: (thinking) => {
          this.callbacks.onThinking?.(thinking);
          if (!this._suppressEventBus) {
            eventBus.emitSync(XuanjiEvent.AGENT_THINKING_DELTA, { content: thinking, agentId: this._userId });
          }
        },
        onToolStart: (id, name, input) => this.callbacks.onToolStart?.(id, name, input),
        onToolDelta: (id, name, receivedBytes) => this.callbacks.onToolDelta?.(id, name, receivedBytes),
        onUsage: (usage) => {
          this.contextManager.recordUsage(usage);
          this.callbacks.onUsage?.(usage);
          if (!this._suppressEventBus) {
            eventBus.emitSync(XuanjiEvent.AGENT_USAGE, { userId: this._userId, tokenUsage: usage });
          }
        },
      });
    }
    if (cfg.systemPrompt !== undefined) {
      this.contextManager.updateSystemPrompt(cfg.systemPrompt);
    }
    if (cfg.toolRegistry) {
      this.registry = cfg.toolRegistry;
      this.toolGateway.setRegistry(cfg.toolRegistry);
    }
    if (cfg.model) {
      this.config.model = cfg.model;
    }
    if (cfg.apiKey !== undefined) {
      (this.config as any).apiKey = cfg.apiKey;
    }
    if (cfg.baseURL !== undefined) {
      (this.config as any).baseURL = cfg.baseURL;
    }
    if (cfg.maxIterations !== undefined) {
      this.config.maxIterations = cfg.maxIterations;
    }
    if (cfg.temperature !== undefined) {
      this.config.temperature = cfg.temperature;
    }
    if (cfg.maxTokens !== undefined) {
      this.config.maxTokens = cfg.maxTokens;
    }
  }

  updateProvider(provider: ILLMProvider): void {
    this.applyAgentConfig({ provider });
  }
}
