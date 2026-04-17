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

请严格按照以下 JSON 格式返回（不要包含 markdown 代码块标记）：
{"summary":"会话整体摘要（1-3句话）","keyPoints":["关键点1","关键点2"]}

## 重要：JSON 格式要求
- 必须是单行 JSON，不要换行
- 字符串值中不要包含换行符，用空格代替
- 字符串值中的引号必须转义为 \\"
- 不要在数组或对象末尾添加逗号
- 不要使用单引号，只用双引号

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

- 只返回单行 JSON，不要其他文字
- 使用会话中的语言（中文会话 → 中文摘要）
- 忽略闲聊、重复、无关内容
- 如果会话内容很少（< 3 轮），summary 可简短，keyPoints 可为空数组

---

## 会话历史

{MESSAGES}

---

现在请生成摘要（只返回单行 JSON，不要 markdown 代码块）：`;

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

    // 最多重试 2 次（首次 + 1 次修正）
    let lastError: string = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // 调用 LLM 生成摘要（使用流式 API）
        let responseText = '';
        const userPrompt = attempt === 0
          ? prompt
          : this.buildRetryPrompt(prompt, lastError);

        const messages = [{ role: 'user' as const, content: userPrompt }];

        for await (const event of this.provider.stream(messages, [], this.config)) {
          if (event.type === 'text_delta' && event.text) {
            responseText += event.text;
          }
        }

        // 解析 LLM 返回的 JSON
        const result = this.parseJSON(responseText);

        log.info(`Session summarized: ${result.keyPoints.length} key points (attempt ${attempt + 1})`);

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log.warn(`Attempt ${attempt + 1} failed:`, lastError);

        // 最后一次尝试失败，使用降级方案
        if (attempt === 1) {
          log.error('Failed to generate session summary after retry, using fallback');
          return this.fallbackSummary(messages);
        }
      }
    }

    // 理论上不会到这里，但为了类型安全
    return this.fallbackSummary(messages);
  }

  /**
   * 构建重试 prompt（让 LLM 感知到错误并修正）
   */
  private buildRetryPrompt(originalPrompt: string, error: string): string {
    return `${originalPrompt}

⚠️ 上一次生成的 JSON 格式有误，解析失败：
错误信息：${error}

请重新生成，务必注意：
1. 必须是严格的单行 JSON 格式
2. 字符串值中不要包含未转义的换行符、引号、反斜杠
3. 不要在数组或对象末尾添加逗号
4. 只返回 JSON，不要任何其他文字或 markdown 标记

现在请重新生成（只返回单行 JSON）：`;
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
      // 尝试直接解析
      const parsed = JSON.parse(jsonText);
      return {
        summary: parsed.summary || '未生成摘要',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      };
    } catch (err) {
      // 第一次失败，尝试修复常见的 JSON 错误
      try {
        // 修复常见的 JSON 格式问题
        let fixedJson = jsonText
          .replace(/,(\s*[}\]])/g, '$1')     // 移除对象/数组末尾的逗号
          .replace(/'/g, '"')                 // 单引号转双引号
          .replace(/\n/g, ' ')                // 移除换行符（可能在字符串值中）
          .replace(/\r/g, '')                 // 移除回车符
          .replace(/\t/g, ' ')                // 制表符转空格
          .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')  // 修复未转义的反斜杠
          .replace(/[\u0000-\u001F]+/g, '')   // 移除控制字符
          .trim();

        // 尝试修复未闭合的引号
        const quoteCount = (fixedJson.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
          // 奇数个引号，尝试在末尾补一个
          fixedJson = fixedJson + '"';
        }

        const parsed = JSON.parse(fixedJson);
        log.debug('JSON parsed after fixing format issues');
        return {
          summary: parsed.summary || '未生成摘要',
          keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        };
      } catch (err2) {
        // 第二次失败，尝试提取部分内容
        log.warn('Failed to parse summary JSON, using fallback:', err2);
        log.debug('Original JSON text:', jsonText.slice(0, 200));

        // 尝试提取 summary 字段（支持多行）
        const summaryMatch = jsonText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
        const summary = summaryMatch ? summaryMatch[1].replace(/\\n/g, ' ').trim() : text.slice(0, 200);

        // 尝试提取 keyPoints 数组
        const keyPointsMatch = jsonText.match(/"keyPoints"\s*:\s*\[([\s\S]*?)\]/);
        let keyPoints: string[] = [];
        if (keyPointsMatch) {
          const pointsText = keyPointsMatch[1];
          // 匹配所有引号包裹的字符串
          const points = pointsText.match(/"((?:[^"\\]|\\.)*)"/g);
          if (points) {
            keyPoints = points.map(p => p.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, ' ').trim());
          }
        }

        return {
          summary,
          keyPoints,
        };
      }
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
