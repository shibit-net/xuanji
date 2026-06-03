/**
 * Agent Handler — LLM 驱动的 Hook 分析
 *
 * 功能:
 * - 将 Hook 事件上下文发送给 LLM 进行分析
 * - 返回 LLM 的分析结果（如代码审查建议、错误诊断）
 * - 超时保护（默认 10s，LLM 调用可能较慢）
 * - 流式消费 LLM 响应，提取纯文本结果
 */

import type { ILLMProvider, ProviderConfig, Message } from '@/infrastructure/core-types';
import type {
  AgentHookHandler,
  HookEventContext,
  HookHandlerResult,
} from '../types.js';

/**
 * AgentHandler 运行时依赖
 */
export interface AgentHandlerDeps {
  provider: ILLMProvider;
  providerConfig: ProviderConfig;
}

/** 全局依赖（由 HookRegistry 注入） */
let globalDeps: AgentHandlerDeps | null = null;

/**
 * 注入 LLM Provider 依赖
 */
export function setAgentHandlerDeps(deps: AgentHandlerDeps): void {
  globalDeps = deps;
}

/**
 * 获取当前依赖
 */
export function getAgentHandlerDeps(): AgentHandlerDeps | null {
  return globalDeps;
}

/**
 * 执行 Agent Hook Handler
 */
export async function executeAgentHandler(
  handler: AgentHookHandler,
  context: HookEventContext,
): Promise<HookHandlerResult> {
  const startTime = Date.now();
  const timeout = handler.timeout ?? 10000;

  if (!globalDeps) {
    return {
      success: false,
      error: 'Agent handler not available: LLM provider not injected',
      duration: Date.now() - startTime,
      blocked: false,
    };
  }

  const { provider, providerConfig } = globalDeps;

  // 构建分析 prompt
  const analysisPrompt = interpolatePrompt(handler.prompt, context);

  // 构建消息
  const messages: Message[] = [
    {
      role: 'user',
      content: analysisPrompt,
    },
  ];

  // 使用指定模型或当前模型
  const config: ProviderConfig = {
    ...providerConfig,
    model: handler.model ?? providerConfig.model,
    maxTokens: 1000, // 限制输出长度
  };

  try {
    // 带超时的 LLM 调用
    const resultPromise = callLLM(provider, messages, config);

    let timeoutTimer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<string>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new Error(`Agent handler timed out after ${timeout}ms`));
      }, timeout);
    });

    const response = await Promise.race([resultPromise, timeoutPromise]);
    clearTimeout(timeoutTimer!);

    return {
      success: true,
      agentResponse: response,
      duration: Date.now() - startTime,
      blocked: false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
      blocked: false,
    };
  }
}

/**
 * 调用 LLM 并提取纯文本响应
 */
async function callLLM(
  provider: ILLMProvider,
  messages: Message[],
  config: ProviderConfig,
): Promise<string> {
  const stream = provider.stream(messages, [], config);

  let text = '';
  for await (const event of stream) {
    if (event.type === 'text_delta' && event.text) {
      text += event.text;
    }
  }

  return text.trim();
}

/**
 * 替换 prompt 中的 ${VAR} 占位符
 */
function interpolatePrompt(
  prompt: string,
  context: HookEventContext,
): string {
  const vars: Record<string, string> = {
    EVENT: context.event,
    TIMESTAMP: String(context.timestamp),
  };

  if (context.toolName) vars.TOOL_NAME = context.toolName;
  if (context.toolInput) vars.TOOL_INPUT = JSON.stringify(context.toolInput).slice(0, 5000);
  if (context.toolResult) vars.TOOL_RESULT = context.toolResult.slice(0, 5000);
  if (context.toolIsError !== undefined) vars.TOOL_IS_ERROR = String(context.toolIsError);
  if (context.toolDuration !== undefined) vars.DURATION = String(context.toolDuration);
  if (context.errorMessage) vars.ERROR_MESSAGE = context.errorMessage;
  if (context.errorStack) vars.ERROR_STACK = context.errorStack?.slice(0, 2000) ?? '';
  if (context.sessionId) vars.SESSION_ID = context.sessionId;
  if (context.memoryContent) vars.MEMORY_CONTENT = context.memoryContent.slice(0, 5000);

  return prompt.replace(/\$\{(\w+)\}/g, (_, key) => {
    return vars[key] ?? '';
  });
}
