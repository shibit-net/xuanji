/**
 * Provider Integration Example
 * 
 * This file demonstrates how to integrate stats collection into the Agent loop.
 * 
 * Integration Points:
 * 1. In Agent.run() - after each LLM stream completes
 * 2. Capture usage event from StreamEvent
 * 3. Record to globalStatsCollector
 */

import type { StreamEvent, ProviderConfig } from '@/shared/types/provider';
import type { ToolCall } from '@/shared/types/tools';
import { globalStatsCollector } from '../stats/index.js';

/**
 * Example: Process stream events and record token usage
 * 
 * This should be integrated into src/core/agent/Agent.ts
 * in the main run() loop where stream events are processed.
 */
export async function processStreamWithStats(
  stream: AsyncIterable<StreamEvent>,
  config: ProviderConfig,
  currentToolName?: string
): Promise<{ text: string; toolCalls: ToolCall[]; totalTokens: number }> {
  let text = '';
  const toolCalls: ToolCall[] = [];
  let totalTokens = 0;

  for await (const event of stream) {
    switch (event.type) {
      case 'text_delta':
        if (event.text) {
          text += event.text;
        }
        break;

      case 'thinking_delta':
        // Handle thinking output
        break;

      case 'tool_use_start':
      case 'tool_use_delta':
      case 'tool_use_end':
        // Collect tool calls
        if (event.toolCall) {
          // Merge or add tool call
        }
        break;

      case 'usage':
        // 🎯 KEY INTEGRATION POINT: Record token usage
        if (event.usage) {
          const inputTokens = event.usage.input || 0;
          const outputTokens = event.usage.output || 0;
          totalTokens = inputTokens + outputTokens;

          // Record to stats collector
          await globalStatsCollector.recordUsage({
            provider: extractProviderName(config),
            model: config.model,
            inputTokens,
            outputTokens,
            toolName: currentToolName,
          });
        }
        break;

      case 'end':
        // Stream completed
        break;

      case 'error':
        // Handle error
        throw event.error || new Error('Stream error');
    }
  }

  return { text, toolCalls, totalTokens };
}

/**
 * Extract provider name from config
 */
function extractProviderName(config: ProviderConfig): string {
  if (config.adapter) {
    return config.adapter;
  }

  // Infer from model name
  if (config.model.includes('claude')) {
    return 'anthropic';
  }
  if (config.model.includes('gpt')) {
    return 'openai';
  }

  return 'unknown';
}

/**
 * Integration Instructions:
 * 
 * 1. Import globalStatsCollector in src/core/agent/Agent.ts:
 *    import { globalStatsCollector } from '../stats/index.js';
 * 
 * 2. In the Agent.run() method, after processing each stream event with type='usage':
 *    
 *    if (event.type === 'usage' && event.usage) {
 *      await globalStatsCollector.recordUsage({
 *        provider: this.getProviderName(),
 *        model: this.config.model,
 *        inputTokens: event.usage.input,
 *        outputTokens: event.usage.output,
 *        toolName: currentExecutingTool?.name,
 *      });
 *    }
 * 
 * 3. The stats will be automatically persisted to .xuanji/stats/YYYY-MM.json
 */
