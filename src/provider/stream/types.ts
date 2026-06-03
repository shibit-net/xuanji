/**
 * Stream 模块类型定义
 */

export interface StreamExecuteOptions {
  signal?: AbortSignal;
  maxRetries?: number;
  timeout?: number;
}

export interface StreamParserConfig {
  maxToolCalls?: number;
  maxThinkingTokens?: number;
  parsePartialJson?: boolean;
}
