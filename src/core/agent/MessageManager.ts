// ============================================================
// M2 Agent — 消息管理器
// ============================================================

import type { Message, ContentBlock, ToolResult } from '@/core/types';

/**
 * 消息管理器接口
 */
export interface IMessageManager {
  build(userMessage: string): Message[];
  addAssistantMessage(content: ContentBlock[]): void;
  addToolResult(toolUseId: string, result: ToolResult): void;
  getHistory(): Message[];
  clear(): void;
}

/**
 * 消息管理器
 * 负责管理对话历史、构建消息数组
 */
export class MessageManager implements IMessageManager {
  private systemPrompt: string;
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
      { role: 'system', content: this.systemPrompt },
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
   * 添加工具执行结果到历史
   */
  addToolResult(toolUseId: string, result: ToolResult): void {
    this.messages.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: result.content,
        is_error: result.isError,
      }],
    });
  }

  /**
   * 获取完整对话历史
   */
  getHistory(): Message[] {
    return [...this.messages];
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
   * 默认系统提示词
   */
  private getDefaultSystemPrompt(): string {
    return `你是璇玑 (Xuanji)，一个 AI 助手。你可以帮助用户读取、编辑文件和执行命令。

你有以下工具可用:
- read_file: 读取文件内容
- write_file: 写入文件
- edit_file: 精确编辑文件 (字符串替换)
- bash: 执行 bash 命令

规则:
1. 始终使用工具来操作文件，不要猜测文件内容
2. 在修改文件之前先读取文件了解当前内容
3. 执行可能有副作用的命令前，先告知用户
4. 使用简洁明确的回复`;
  }
}
