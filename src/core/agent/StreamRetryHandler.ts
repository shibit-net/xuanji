// ============================================================
// StreamRetryHandler — Stream 重试处理
// ============================================================
//
// 处理 LLM Stream 调用、重试逻辑、错误恢复

import type { Message, ToolSchema, AgentConfig, ILLMProvider } from '@/core/types';
import type { StreamProcessor, ProcessResult } from './StreamProcessor';
import type { ErrorRecovery } from './ErrorRecovery';
import type { PerfCollector } from '@/core/telemetry/PerfCollector';
import { shouldRetry, calculateBackoff, isRateLimitError, DEFAULT_RETRY_CONFIG, type RetryConfig } from '@/core/providers/RetryPolicy';
import { sleep } from '@/shared/utils/sleep';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'StreamRetryHandler' });

/**
 * Stream 调用结果
 */
export interface StreamCallResult {
  /** 处理结果 */
  result: ProcessResult | null;
  /** 最后的错误 */
  lastError: unknown;
  /** 是否因用户中断而失败 */
  interrupted: boolean;
}

/**
 * StreamRetryHandler — Stream 重试处理器
 */
export class StreamRetryHandler {
  constructor(
    private provider: ILLMProvider,
    private streamProcessor: StreamProcessor,
    private errorRecovery: ErrorRecovery,
    private perfCollector: PerfCollector,
    private config: AgentConfig,
    private thinkingConfig?: import('@/core/types').ThinkingConfig,
  ) {}

  /**
   * 执行 Stream 调用（带重试）
   */
  async executeWithRetry(
    messages: Message[],
    toolSchemas: ToolSchema[],
    iteration: number,
    originalTextHandler?: (text: string) => void,
    callbacks?: {
      onInfo?: (message: string) => void;
    },
    interruptChecker?: {
      isInterrupted: () => boolean;
      getCurrentStream: () => AsyncIterable<import('@/core/types').StreamEvent> | null;
      setCurrentStream: (stream: AsyncIterable<import('@/core/types').StreamEvent> | null) => void;
    },
    rateLimitRetryCount: number = 0,  // ★ 新增：429 错误重试计数（限制递归深度） ★
    signal?: AbortSignal,  // 🔧 新增：AbortSignal 支持
  ): Promise<StreamCallResult> {
    const perfTimer = this.perfCollector.createTimer(this.config.model, iteration);
    const retryConfig = this.config.retry ?? DEFAULT_RETRY_CONFIG;

    let result: ProcessResult | undefined;
    let lastStreamError: unknown;

    // 注册首 token 计时 handler
    let firstTokenMarked = false;
    this.streamProcessor.onTextDelta((text) => {
      if (!firstTokenMarked) {
        perfTimer.markFirstToken();
        firstTokenMarked = true;
      }
      originalTextHandler?.(text);
    });

    // 重试循环
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
            thinking: this.thinkingConfig,
            signal,  // 🔧 传递 AbortSignal
          },
        );
        
        interruptChecker?.setCurrentStream(stream);

        // 每次重试重置首 token 标记
        firstTokenMarked = false;
        result = await this.streamProcessor.consume(stream);
        
        interruptChecker?.setCurrentStream(null);
        break; // 成功，退出重试循环
      } catch (streamError) {
        interruptChecker?.setCurrentStream(null);

        // 用户中断追加：不重试，跳出 retry 循环
        if (interruptChecker?.isInterrupted()) {
          log.debug('Stream interrupted by user append, breaking retry loop');
          break;
        }

        lastStreamError = streamError;
        const errDetail = streamError instanceof Error
          ? `${streamError.name}: ${streamError.message}`
          : String(streamError);

        if (!shouldRetry(streamError, attempt, retryConfig)) {
          // ★ rate_limit 错误：不直接抛出，而是 break 到外层处理冷却逻辑
          // 直接 throw 会跳过 if (!result) 处的 60 秒冷却代码
          if (isRateLimitError(streamError)) {
            lastStreamError = streamError;
            break;
          }
          throw streamError; // 不可重试的其他错误，直接抛出
        }

        const delay = calculateBackoff(attempt, retryConfig);
        log.warn(
          `API call failed (attempt ${attempt + 1}/${retryConfig.maxRetries + 1}), retrying in ${Math.round(delay)}ms: ${errDetail}`
        );
        callbacks?.onInfo?.(
          `⚠️ API 请求失败 [${errDetail}]，${Math.round(delay / 1000)}s 后重试 (${attempt + 1}/${retryConfig.maxRetries})...`
        );
        await sleep(delay);
      }
    }

    // 处理结果
    const interrupted = interruptChecker?.isInterrupted() ?? false;

    if (!result) {
      // ★ 用户中断追加：处理 rate limit 冷却并自动重试 ★
      if (interrupted && lastStreamError && isRateLimitError(lastStreamError)) {
        const cooldown = 10_000;
        log.warn(`Rate limit detected after interrupt, cooling down for ${cooldown}ms`);
        callbacks?.onInfo?.(`⏸️ API 请求频率超限，等待 ${cooldown / 1000} 秒后继续...`);
        await sleep(cooldown);
      }

      // ★ 非中断场景：429 错误自动冷却并重试（限制 1 次递归） ★
      if (!interrupted && lastStreamError && isRateLimitError(lastStreamError) && rateLimitRetryCount === 0) {
        const cooldown = 60_000;  // 60 秒冷却
        log.warn(`Rate limit error, cooling down for ${cooldown}ms and retrying (attempt 1/1)`);
        callbacks?.onInfo?.(`⏸️ API 请求频率超限，等待 ${cooldown / 1000} 秒后自动重试...`);
        await sleep(cooldown);

        // 递归调用，重试 1 次（rateLimitRetryCount + 1 = 1，下次不会再重试）
        return this.executeWithRetry(
          messages,
          toolSchemas,
          iteration,
          originalTextHandler,
          callbacks,
          interruptChecker,
          rateLimitRetryCount + 1,  // ★ 递归深度 +1 ★
        );
      }

      return {
        result: null,
        lastError: lastStreamError,
        interrupted,
      };
    }

    // 记录性能指标
    perfTimer.finish(result.usage.input, result.usage.output).catch((err) => {
      log.debug('perfTimer.finish failed:', err);
    });

    // 错误恢复：成功调用重置计数
    this.errorRecovery.reset();

    log.debug(
      `Result: stopReason=${result.stopReason}, toolCalls=${result.toolCalls.length}, contentBlocks=${result.contentBlocks.length}`
    );

    return {
      result,
      lastError: null,
      interrupted: false,
    };
  }
}
