// ============================================================
// M2 Agent — ReAct 循环核心
// ============================================================

import type { AgentConfig, AgentState, TokenUsage, ILLMProvider, IToolRegistry, ToolSchema } from '@/core/types';
import { MessageManager } from './MessageManager';
import { StreamProcessor, type ProcessResult } from './StreamProcessor';
import { ToolDispatcher } from './ToolDispatcher';
import { TokenManager } from './TokenManager';
import { CostTracker } from './CostTracker';
import { ErrorRecovery } from './ErrorRecovery';

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
  private messageManager: MessageManager;
  private streamProcessor: StreamProcessor;
  private toolDispatcher: ToolDispatcher;
  private tokenManager: TokenManager;
  private costTracker: CostTracker;
  private errorRecovery: ErrorRecovery;
  private provider: ILLMProvider;
  private registry: IToolRegistry;
  private config: AgentConfig;
  private callbacks: AgentCallbacks = {};
  private running = false;
  private currentIteration = 0;

  constructor(
    provider: ILLMProvider,
    registry: IToolRegistry,
    config: AgentConfig,
  ) {
    this.provider = provider;
    this.registry = registry;
    this.config = config;
    this.messageManager = new MessageManager(config.systemPrompt);
    this.streamProcessor = new StreamProcessor();
    this.toolDispatcher = new ToolDispatcher(registry);
    this.tokenManager = new TokenManager();
    this.costTracker = new CostTracker(config.model);
    this.errorRecovery = new ErrorRecovery();

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

    try {
      // 构建初始消息
      let messages = this.messageManager.build(userMessage);

      while (this.running && this.currentIteration < maxIterations) {
        this.currentIteration++;

        // Token 窗口裁剪
        messages = this.tokenManager.fitWindow(messages);

        // 调用 LLM
        const toolSchemas: ToolSchema[] = this.registry.getSchemas();

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

        // 消费流
        const result: ProcessResult = await this.streamProcessor.consume(stream);

        // 记录 assistant 消息
        this.messageManager.addAssistantMessage(result.contentBlocks);

        // 错误恢复：成功调用重置计数
        this.errorRecovery.reset();

        // 判断是否结束
        if (result.stopReason === 'end_turn' || result.toolCalls.length === 0) {
          break;
        }

        // max_tokens 截断处理：将被截断的工具调用替换为错误结果，让 LLM 重试
        if (result.stopReason === 'max_tokens') {
          // 通知用户输出 token 不足
          this.callbacks.onError?.(new Error(
            '⚠️ 输出 token 达到上限 (max_tokens)，工具调用参数被截断。正在要求 LLM 以更简洁的方式重试...'
          ));

          // 检查是否有被截断或解析失败的工具调用
          const truncatedTools = result.toolCalls.filter(
            (tc) => (tc.input as Record<string, unknown>)?._truncated || (tc.input as Record<string, unknown>)?._parse_error
          );

          if (truncatedTools.length > 0) {
            // 将截断的工具调用结果作为错误返回给 LLM，引导它重试
            const errorResults = new Map<string, { content: string; isError: boolean }>();
            for (const tc of truncatedTools) {
              const errMsg = (tc.input as Record<string, unknown>)?._error_message as string
                ?? '工具参数被截断，请使用更简洁的方式重试';
              errorResults.set(tc.id, {
                content: `[错误] ${errMsg}。请拆分为更小的操作重试，或减少输出内容量。`,
                isError: true,
              });
              // 通知 UI
              this.callbacks.onToolEnd?.(tc.id, tc.name, errorResults.get(tc.id)!.content, true);
            }
            this.messageManager.addToolResults(errorResults);
          } else {
            // 没有工具调用（tool_use block 完全未完成），注入用户提示让 LLM 重试
            this.messageManager.addAssistantMessage([{
              type: 'text',
              text: '[系统提示] 输出 token 达到上限，响应被截断。',
            }]);
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

        const resultsMap = await this.toolDispatcher.executeAll(result.toolCalls);

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
              console.error('[AgentLoop] onToolEnd callback error:', callbackErr);
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
        this.callbacks.onError?.(new Error(
          `⚠️ Agent 循环达到最大迭代次数 (${maxIterations})，已自动停止。如需继续，请发送新消息。`
        ));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 使用友好化的错误消息
      const friendlyError = new Error(ErrorRecovery.formatError(err));
      this.callbacks.onError?.(friendlyError);

      // API 错误立即停止，不重试
      // 记录错误计数仅用于统计目的
      this.errorRecovery.recordError(err);

      // 总是抛出异常，让主进程处理
      throw friendlyError;
    } finally {
      this.running = false;
      this.callbacks.onEnd?.(this.getState());
    }
  }

  /**
   * 停止循环
   */
  stop(): void {
    this.running = false;
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
}
