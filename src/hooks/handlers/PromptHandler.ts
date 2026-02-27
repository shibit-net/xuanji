/**
 * Prompt Handler — 动态注入 system prompt
 *
 * 功能:
 * - 将配置的 prompt 内容注入到当前 system prompt
 * - 支持环境变量占位符替换
 * - 返回注入的内容（由 HookRegistry 负责实际注入）
 */

import type {
  PromptHookHandler,
  HookEventContext,
  HookHandlerResult,
} from '../types.js';

/**
 * 执行 Prompt Hook Handler
 */
export async function executePromptHandler(
  handler: PromptHookHandler,
  context: HookEventContext,
): Promise<HookHandlerResult> {
  const startTime = Date.now();

  try {
    // 替换内容中的占位符
    const content = interpolateContent(handler.content, context);

    return {
      success: true,
      promptContent: content,
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
 * 替换内容中的 ${VAR} 占位符
 */
function interpolateContent(
  content: string,
  context: HookEventContext,
): string {
  const vars: Record<string, string> = {
    EVENT: context.event,
    TIMESTAMP: String(context.timestamp),
  };

  if (context.toolName) vars.TOOL_NAME = context.toolName;
  if (context.toolDuration !== undefined) vars.DURATION = String(context.toolDuration);
  if (context.errorMessage) vars.ERROR_MESSAGE = context.errorMessage;
  if (context.sessionId) vars.SESSION_ID = context.sessionId;
  if (context.checkpointId) vars.CHECKPOINT_ID = context.checkpointId;
  if (context.checkpointLabel) vars.CHECKPOINT_LABEL = context.checkpointLabel;
  if (context.originalTokens !== undefined) vars.ORIGINAL_TOKENS = String(context.originalTokens);
  if (context.compressedTokens !== undefined) vars.COMPRESSED_TOKENS = String(context.compressedTokens);

  return content.replace(/\$\{(\w+)\}/g, (_, key) => {
    return vars[key] ?? '';
  });
}
