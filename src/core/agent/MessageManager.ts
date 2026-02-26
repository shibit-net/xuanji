// ============================================================
// M2 Agent — 消息管理器
// ============================================================

import type { Message, ContentBlock, ToolResult } from '@/core/types';
import { middleTruncate, MAX_TOOL_RESULT_LENGTH } from '@/core/utils/truncation';

/**
 * 消息管理器接口
 */
export interface IMessageManager {
  build(userMessage: string): Message[];
  addAssistantMessage(content: ContentBlock[]): void;
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
  private systemPromptSuffix: string = '';
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
    return [
      { role: 'system', content: this.getFullSystemPrompt() },
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
      const content = middleTruncate(result.content, MAX_TOOL_RESULT_LENGTH);

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
        is_error: result.isError,
      });
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
      { role: 'system', content: this.getFullSystemPrompt() },
      ...this.messages,
    ];
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
  setSystemPromptSuffix(suffix: string): void {
    this.systemPromptSuffix = suffix;
  }

  /**
   * 获取完整系统提示词（基础 + 后缀）
   */
  private getFullSystemPrompt(): string {
    return this.systemPromptSuffix
      ? `${this.systemPrompt}\n\n${this.systemPromptSuffix}`
      : this.systemPrompt;
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
