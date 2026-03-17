/**
 * ============================================================
 * SessionSummarizer — 会话摘要生成器
 * ============================================================
 *
 * 使用 LLM 分析会话历史，生成：
 * - summary: 会话整体摘要（主题、目标、进展）
 * - keyPoints: 关键点列表（决策、结论、待办）
 * - memoryRefs: 相关记忆 ID 引用
 */

import type { Message } from './types';
import type { ILLMProvider, ProviderConfig } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'session-summarizer' });

export interface SessionSummaryResult {
  /** 会话整体摘要 */
  summary: string;
  /** 关键点列表 */
  keyPoints: string[];
  /** 相关记忆 ID 引用（如果提供了 memoryManager） */
  memoryRefs?: string[];
}

export interface SessionSummarizerOptions {
  /** LLM Provider（用于生成摘要） */
  provider: ILLMProvider;
  /** 模型配置 */
  config: ProviderConfig;
  /** 记忆管理器（可选，用于关联记忆） */
  memoryManager?: any;
}

const SUMMARIZE_PROMPT = `你是一个对话摘要专家。请分析以下会话历史，生成简洁的摘要。

## 输出格式

请以 JSON 格式返回：
\`\`\`json
{
  "summary": "会话整体摘要（1-3句话，包含：主题、目标、进展）",
  "keyPoints": [
    "关键点 1（决策/结论/待办事项）",
    "关键点 2",
    "..."
  ]
}
\`\`\`

## 摘要原则

1. **summary**：
   - 用 1-3 句话概括会话的主题、目标和当前进展
   - 语言简洁、信息密度高
   - 适合作为会话标题的补充说明

2. **keyPoints**：
   - 提取重要的决策、结论、待办事项
   - 每个关键点用一句话表达（不超过 50 字）
   - 优先级：决策 > 结论 > 待办 > 其他
   - 最多 10 个关键点

## 要求

- 只返回 JSON，不要其他文字
- 使用会话中的语言（中文会话 → 中文摘要）
- 忽略闲聊、重复、无关内容
- 如果会话内容很少（< 3 轮），summary 可简短，keyPoints 可为空数组

---

## 会话历史

{MESSAGES}

---

现在请生成摘要（只返回 JSON）：`;

export class SessionSummarizer {
  private provider: ILLMProvider;
  private config: ProviderConfig;
  private memoryManager: any;

  constructor(options: SessionSummarizerOptions) {
    this.provider = options.provider;
    this.config = options.config;
    this.memoryManager = options.memoryManager;
  }

  /**
   * 生成会话摘要
   *
   * @param messages - 完整消息历史
   * @returns 摘要结果
   */
  async summarize(messages: Message[]): Promise<SessionSummaryResult> {
    if (messages.length === 0) {
      return {
        summary: '空会话',
        keyPoints: [],
      };
    }

    // 将消息历史格式化为文本
    const messageText = this.formatMessages(messages);

    // 构建 prompt
    const prompt = SUMMARIZE_PROMPT.replace('{MESSAGES}', messageText);

    try {
      // 调用 LLM 生成摘要（使用流式 API）
      let responseText = '';
      const messages = [{ role: 'user' as const, content: prompt }];

      for await (const event of this.provider.stream(messages, [], this.config)) {
        if (event.type === 'text_delta' && event.text) {
          responseText += event.text;
        }
      }

      // 解析 LLM 返回的 JSON
      const result = this.parseJSON(responseText);

      log.info(`Session summarized: ${result.keyPoints.length} key points`);

      return result;
    } catch (err) {
      log.error('Failed to generate session summary:', err);
      // 降级：返回简单摘要
      return this.fallbackSummary(messages);
    }
  }

  /**
   * 格式化消息历史为文本
   */
  private formatMessages(messages: Message[]): string {
    return messages
      .map((msg, idx) => {
        const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
        const content = typeof msg.content === 'string' ? msg.content : this.extractContentText(msg.content);
        return `[${idx + 1}] ${role}: ${content}`;
      })
      .join('\n\n');
  }

  /**
   * 提取消息内容中的文本（处理 ContentBlock 数组）
   */
  private extractContentText(content: Array<any>): string {
    return content
      .filter((block) => block.type === 'text' || block.type === 'thinking')
      .map((block) => block.text || block.thinking || '')
      .join(' ');
  }

  /**
   * 解析 LLM 返回的 JSON
   */
  private parseJSON(text: string): SessionSummaryResult {
    // 尝试提取 JSON（可能包含 markdown 代码块）
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;

    try {
      const parsed = JSON.parse(jsonText);
      return {
        summary: parsed.summary || '未生成摘要',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      };
    } catch (err) {
      log.warn('Failed to parse summary JSON, using fallback:', err);
      return {
        summary: text.slice(0, 200), // 截取前 200 字符作为摘要
        keyPoints: [],
      };
    }
  }

  /**
   * 降级方案：生成简单摘要
   */
  private fallbackSummary(messages: Message[]): SessionSummaryResult {
    const userMessages = messages.filter((m) => m.role === 'user');
    const firstUser = userMessages[0];
    const lastUser = userMessages[userMessages.length - 1];

    const firstContent = this.getMessageText(firstUser);
    const lastContent = this.getMessageText(lastUser);

    return {
      summary: `会话包含 ${messages.length} 条消息，从 "${firstContent.slice(0, 30)}..." 到 "${lastContent.slice(0, 30)}..."`,
      keyPoints: [],
    };
  }

  /**
   * 获取消息文本内容
   */
  private getMessageText(message?: Message): string {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    return this.extractContentText(message.content);
  }
}
