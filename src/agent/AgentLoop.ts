// ============================================================
// M2 Agent — ReAct 循环核心
// ============================================================

import type { AgentConfig, AgentState, TokenUsage, ILLMProvider, IToolRegistry, ToolSchema } from '@/types';
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
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string, isError: boolean) => void;
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
    this.streamProcessor.onToolUse((toolCall) => {
      this.callbacks.onToolStart?.(toolCall.name, toolCall.input);
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

        // 执行工具
        for (const toolCall of result.toolCalls) {
          const toolResult = await this.toolDispatcher.execute(toolCall);
          this.callbacks.onToolEnd?.(toolCall.name, toolResult.content, toolResult.isError);
          this.messageManager.addToolResult(toolCall.id, toolResult);
        }

        // 重建消息 (含工具结果)
        messages = [
          { role: 'system' as const, content: '' },
          ...this.messageManager.getHistory(),
        ];
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const shouldStop = this.errorRecovery.recordError(err);
      this.callbacks.onError?.(err);
      if (shouldStop) {
        throw err;
      }
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
