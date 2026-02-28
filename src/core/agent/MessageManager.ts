// ============================================================
// M2 Agent — 消息管理器
// ============================================================

import type { Message, ContentBlock, ToolResult } from '@/core/types';
import { middleTruncate, getMaxToolResultLength } from '@/core/utils/truncation';

/**
 * 消息管理器接口
 */
export interface IMessageManager {
  build(userMessage: string): Message[];
  addAssistantMessage(content: ContentBlock[]): void;
  addUserMessage(content: string): void;
  addToolResult(toolUseId: string, result: ToolResult): void;
  addToolResults(results: Map<string, ToolResult>): void;
  getHistory(): Message[];
  getMessages(): Message[];
  clear(): void;
}

/**
 * 消息管理器
 * 负责管理对话历史、构建消息数组
 */
export class MessageManager implements IMessageManager {
  private systemPrompt: string;
  /** 多来源 system prompt 后缀（支持 hook、memory 等同时注入，互不覆盖） */
  private systemPromptSuffixes: Map<string, string> = new Map();
  private messages: Message[] = [];

  constructor(systemPrompt?: string) {
    this.systemPrompt = systemPrompt ?? this.getDefaultSystemPrompt();
  }

  /**
   * 构建完整消息数组 (system + history + user)
   */
  build(userMessage: string): Message[] {
    // 添加用户消息到历史
    this.messages.push({
      role: 'user',
      content: userMessage,
    });

    // 返回 system + 完整历史
    // system content 使用 ContentBlock[] 格式，区分稳定部分和动态后缀
    // Provider 可据此决定各自的 Prompt Caching 策略
    return [
      { role: 'system', content: this.getSystemPromptBlocks() },
      ...this.messages,
    ];
  }

  /**
   * 添加 assistant 消息到历史
   */
  addAssistantMessage(content: ContentBlock[]): void {
    this.messages.push({
      role: 'assistant',
      content,
    });
  }

  /**
   * 添加 user 消息到历史（用于注入系统级提示）
   */
  addUserMessage(content: string): void {
    this.messages.push({
      role: 'user',
      content,
    });
  }

  /**
   * 批量添加工具结果到历史（合并为单个 user 消息）
   *
   * Anthropic API 推荐格式:
   * {
   *   role: 'user',
   *   content: [
   *     { type: 'tool_result', tool_use_id: '1', content: '...' },
   *     { type: 'tool_result', tool_use_id: '2', content: '...' },
   *   ]
   * }
   */
  addToolResults(results: Map<string, ToolResult>): void {
    if (results.size === 0) return;

    const toolResultBlocks: ContentBlock[] = [];

    for (const [toolUseId, result] of results) {
      // 对每条 tool_result 内容做截断保护，防止超大内容发给 LLM API
      const content = middleTruncate(result.content, getMaxToolResultLength());

      // 如果有多模态内容块（如图片），构建 content 数组
      // Anthropic API tool_result 的 content 字段支持 string | ContentBlock[]
      // 但我们的 ContentBlock 类型定义 content 为 string，此处将多模态内容序列化为 JSON
      // Provider 层负责在发送前解析还原
      if (result.contentBlocks && result.contentBlocks.length > 0) {
        const multiContent = [
          { type: 'text', text: content },
          ...result.contentBlocks.map(block => ({ ...block })),
        ];
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: JSON.stringify(multiContent),
          is_error: result.isError,
        });
      } else {
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: result.isError,
        });
      }
    }

    this.messages.push({
      role: 'user',
      content: toolResultBlocks,
    });
  }

  /**
   * 添加工具执行结果到历史（向后兼容）
   */
  addToolResult(toolUseId: string, result: ToolResult): void {
    const resultsMap = new Map<string, ToolResult>();
    resultsMap.set(toolUseId, result);
    this.addToolResults(resultsMap);
  }

  /**
   * 获取完整对话历史（不含 system prompt）
   */
  getHistory(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取完整消息数组（system prompt + 对话历史）
   * 用于 ReAct 循环中重建消息，确保 system prompt 不丢失
   */
  getMessages(): Message[] {
    return [
      { role: 'system', content: this.getSystemPromptBlocks() },
      ...this.messages,
    ];
  }

  /**
   * 替换内部消息历史（用于上下文压缩后更新）
   * 注意：传入的消息不应包含 system prompt
   */
  replaceMessages(messages: Message[]): void {
    this.messages = messages;
  }

  /**
   * 清空对话历史
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * 更新系统提示词
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 设置系统提示词后缀（用于动态注入记忆上下文等）
   */
  /**
   * 设置系统提示词后缀（按来源 key 区分，互不覆盖）
   * @param suffix 后缀内容（空字符串则移除该 key）
   * @param key 来源标识，默认 'default'
   */
  setSystemPromptSuffix(suffix: string, key: string = 'default'): void {
    if (suffix) {
      this.systemPromptSuffixes.set(key, suffix);
    } else {
      this.systemPromptSuffixes.delete(key);
    }
  }

  /**
   * 获取完整系统提示词（基础 + 后缀）— 纯字符串格式
   * 保留为 fallback，供需要纯文本的场景使用
   */
  getFullSystemPromptText(): string {
    const suffixes = Array.from(this.systemPromptSuffixes.values()).filter(Boolean);
    return suffixes.length > 0
      ? `${this.systemPrompt}\n\n${suffixes.join('\n\n')}`
      : this.systemPrompt;
  }

  /**
   * 构建结构化 system prompt blocks
   *
   * 将 system prompt 拆分为独立的 ContentBlock[]，区分稳定基础部分和动态后缀：
   * - Block 0: 基础 system prompt（含 Skill 描述）— 每轮稳定，适合缓存
   * - Block 1+: 动态后缀（memory/reminder/hooks 注入）— 可能每轮变化
   *
   * 各 Provider 根据此结构实现各自的 Prompt Caching 策略：
   * - Anthropic: 在稳定 block 上标记 cache_control
   * - OpenAI: 拼接为字符串，利用自动前缀缓存
   * - 其他: 直接拼接为字符串
   */
  private getSystemPromptBlocks(): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    // Block 0: 基础 system prompt（最稳定的部分）
    if (this.systemPrompt) {
      blocks.push({ type: 'text', text: this.systemPrompt });
    }

    // Block 1+: 动态后缀（memory context, reminder context, hooks 等）
    for (const suffix of this.systemPromptSuffixes.values()) {
      if (suffix) {
        blocks.push({ type: 'text', text: suffix });
      }
    }

    return blocks;
  }

  /**
   * 默认系统提示词（fallback）
   * 仅在 Skill 系统未启用 xuanji-assistant 时使用
   * 正式的系统提示词定义在 src/core/skills/builtin/prompts/xuanji-assistant.ts
   */
  private getDefaultSystemPrompt(): string {
    return 'You are Xuanji, an AI coding assistant. Use your tools to help the user.';
  }
}
