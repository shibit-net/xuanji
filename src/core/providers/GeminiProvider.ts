// ============================================================
// M7 LLM Provider — Google Gemini 适配器
// ============================================================

import type { Message, ContentBlock, ToolSchema, ProviderConfig, StreamEvent, TokenUsage } from '@/core/types';
import { BaseLLMProvider } from './LLMProvider';
import { logger } from '@/core/logger';

/** Gemini API 支持的图片 MIME 类型 */
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// ── Gemini API 类型 ────────────────────────────────────

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { name?: string; content: string } };
  thought?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

interface GeminiRequest {
  systemInstruction?: { parts: { text: string }[] };
  contents: GeminiContent[];
  tools?: GeminiTool[];
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    thinkingConfig?: { thinkingBudget?: number };
  };
  safetySettings?: Array<{ category: string; threshold: string }>;
}

interface GeminiCandidate {
  content?: { role: string; parts: GeminiPart[] };
  finishReason?: string;
  safetyRatings?: Array<{ category: string; probability: string }>;
}

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

/**
 * Google Gemini Provider
 *
 * 通过 Gemini REST API (streamGenerateContent) 提供 LLM 服务。
 * 支持文本、图片、工具调用、思考模式。
 */
export class GeminiProvider extends BaseLLMProvider {
  readonly name = 'gemini';
  readonly models = ['gemini-'];
  private log = logger.child({ module: 'GeminiProvider' });

  // ── 内容转换：内部 ContentBlock[] → Gemini Part[] ──────

  private convertContent(content: Message['content']): GeminiPart[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }
    if (!Array.isArray(content)) {
      return [];
    }

    const parts: GeminiPart[] = [];
    for (const block of content as ContentBlock[]) {
      switch (block.type) {
        case 'text':
          if (block.text) parts.push({ text: block.text });
          break;
        case 'image':
          if (block.data) {
            if (SUPPORTED_IMAGE_TYPES.has(block.mimeType || '')) {
              parts.push({
                inlineData: {
                  mimeType: block.mimeType || 'image/png',
                  data: block.data,
                },
              });
            } else {
              parts.push({ text: `[Image: ${block.name || block.mimeType || 'image'}]` });
            }
          }
          break;
        case 'audio':
          if (block.data) {
            parts.push({
              inlineData: {
                mimeType: block.mimeType || 'audio/mpeg',
                data: block.data,
              },
            });
          }
          break;
        case 'video':
          if (block.data) {
            parts.push({
              inlineData: {
                mimeType: block.mimeType || 'video/mp4',
                data: block.data,
              },
            });
          }
          break;
        case 'tool_use': {
          const args = block.input ? { ...block.input } : {};
          parts.push({
            functionCall: {
              name: block.name || '',
              args,
            },
          });
          break;
        }
        case 'tool_result':
          parts.push({
            functionResponse: {
              name: block.name || '',
              response: { content: block.content || '' },
            },
          });
          break;
        case 'thinking':
          if (block.thinking) parts.push({ text: block.thinking });
          break;
        default:
          if ((block as any).text) parts.push({ text: (block as any).text });
      }
    }
    return parts;
  }

  // ── 消息转换：内部 Message[] → Gemini Content[] ────────

  private convertMessages(messages: Message[]): GeminiContent[] {
    const geminiContents: GeminiContent[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue; // system 由 systemInstruction 处理
      const role = msg.role === 'assistant' ? 'model' as const : 'user' as const;

      // 合并连续的相同 role 消息
      const lastContent = geminiContents[geminiContents.length - 1];
      if (lastContent && lastContent.role === role) {
        lastContent.parts.push(...this.convertContent(msg.content));
      } else {
        geminiContents.push({ role, parts: this.convertContent(msg.content) });
      }
    }
    return geminiContents;
  }

  // ── 提取 system prompt 文本 ─────────────────────────

  private extractSystemText(messages: Message[]): string | undefined {
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.role !== 'system') continue;
      if (typeof msg.content === 'string') {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            parts.push(block.text);
          }
        }
      }
    }
    const combined = parts.join('\n\n').trim();
    return combined || undefined;
  }

  // ── 工具转换：ToolSchema[] → Gemini Tool[] ──────────

  private convertTools(tools: ToolSchema[]): GeminiTool[] {
    if (tools.length === 0) return [];
    return [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema as unknown as Record<string, unknown>,
      })),
    }];
  }

  // ── 构建请求 URL ─────────────────────────────────────

  private buildUrl(model: string, apiKey: string, baseURL?: string): string {
    const base = baseURL
      ? baseURL.replace(/\/+$/, '')
      : 'https://generativelanguage.googleapis.com';
    return `${base}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  }

  // ── 核心流方法 ───────────────────────────────────────

  async *stream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent> {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('Gemini Provider: API Key 未配置');
    }

    const chatMessages = messages.filter((m) => m.role !== 'system');
    const systemText = this.extractSystemText(messages);

    const requestBody: GeminiRequest = {
      contents: this.convertMessages(chatMessages),
      generationConfig: {
        maxOutputTokens: config.maxTokens || 8192,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    if (systemText) {
      requestBody.systemInstruction = { parts: [{ text: systemText }] };
    }

    if (tools.length > 0) {
      requestBody.tools = this.convertTools(tools);
    }

    // Gemini thinking 支持 (gemini-2.5-flash 等)
    if (config.thinking) {
      const budget = config.thinking.budgetTokens || 8192;
      requestBody.generationConfig!.thinkingConfig = { thinkingBudget: budget };
    }

    const url = this.buildUrl(config.model, config.apiKey, config.baseURL);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: config.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorMsg = `Gemini API 返回 ${response.status}`;
        try {
          const errJson = JSON.parse(errorText);
          errorMsg = errJson?.error?.message || errorMsg;
        } catch {}
        throw new Error(`${errorMsg}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Gemini: 无法获取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentToolCall: { id: string; name: string; input: string } | null = null;
      let totalTokens: TokenUsage = { input: 0, output: 0 };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr || dataStr === '[DONE]') continue;

          try {
            const chunk: GeminiStreamChunk = JSON.parse(dataStr);
            const candidate = chunk.candidates?.[0];

            // ── 使用量 ──
            if (chunk.usageMetadata) {
              totalTokens = {
                input: chunk.usageMetadata.promptTokenCount,
                output: chunk.usageMetadata.candidatesTokenCount + (chunk.usageMetadata.thoughtsTokenCount || 0),
                cacheRead: chunk.usageMetadata.cachedContentTokenCount,
              };
              yield { type: 'usage', usage: totalTokens };
            }

            // ── 候选文本 ──
            if (candidate?.content?.parts) {
              for (const part of candidate.content.parts) {
                if (part.text) {
                  yield { type: 'text_delta', text: part.text };
                } else if (part.functionCall) {
                  // Gemini 在一次响应中发送完整的 functionCall
                  const toolId = `gemini-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  yield {
                    type: 'tool_use_start',
                    toolCall: { id: toolId, name: part.functionCall.name, input: {} },
                  };
                  yield {
                    type: 'tool_use_end',
                    toolCall: {
                      id: toolId,
                      name: part.functionCall.name,
                      input: part.functionCall.args || {},
                    },
                  };
                } else if (part.thought) {
                  yield { type: 'thinking_delta', thinking: part.thought };
                }
              }
            }

            // ── 完成原因 ──
            if (candidate?.finishReason) {
              const stopReason = (() => {
                switch (candidate.finishReason) {
                  case 'STOP': return 'end_turn';
                  case 'MAX_TOKENS': return 'max_tokens';
                  case 'SAFETY': return 'end_turn';
                  case 'RECITATION': return 'end_turn';
                  default: return 'end_turn';
                }
              })();
              yield { type: 'end', stopReason, usage: totalTokens };
            }
          } catch {
            // 跳过无法解析的 chunk
          }
        }
      }

      // 流的末尾：如果未收到 finishReason，则合成 end 事件
      yield { type: 'end', stopReason: 'end_turn', usage: totalTokens };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        yield { type: 'end', stopReason: 'interrupted' };
        return;
      }

      const wrapped = err instanceof Error ? err : new Error(String(err));
      yield { type: 'error', error: wrapped };
    }
  }
}
