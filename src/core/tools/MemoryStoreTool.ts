// ============================================================
// M6 工具系统 — MemoryStoreTool 存储记忆
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import type { IMemoryStore, MemoryEntry, MemoryEntryType } from '@/memory/types';
import { inferMemoryAttributes } from '@/memory/MemoryAttributeInferrer';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'memory-store-tool' });

/**
 * MemoryStoreTool — LLM 主动存储记忆
 *
 * 允许 LLM 在对话过程中主动调用此工具存储有价值的信息到长期记忆。
 * 适用场景：
 * - 用户陈述个人偏好："我不吃辣"
 * - 用户分享人际信息："Alice 喜欢日料"
 * - 用户提及重要日期："Bob 的生日是 3 月 8 号"
 * - 用户做出决策："决定使用 TypeScript"
 */
export class MemoryStoreTool extends BaseTool {
  readonly name = 'memory_store';
  readonly description = [
    'Store important information to long-term memory for future retrieval across conversations.',
    '',
    'Use this when the user:',
    '- States a personal preference (food, work habits, etc.)',
    '- Mentions a person and their details (name, relationship, preferences)',
    '- Shares important dates (birthdays, deadlines, anniversaries)',
    '- Makes a significant decision',
    '- Corrects previous information ("Actually I can eat mild spice now")',
    '',
    'Do NOT use for:',
    '- Transient requests (format code, what time is it)',
    '- Greetings and acknowledgments',
    '- Information already in code/project files',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [
          'user_preference',
          'user_fact',
          'relationship',
          'important_date',
          'decision',
          'tool_pattern',
          'error_resolution',
        ],
        description: [
          'Type of memory to store:',
          '- user_fact: Objective facts about user or assistant (names, nicknames, job, location, family)',
          '  * Examples: "Assistant\'s name is Jarvis", "User\'s name is Kevin", "User works as a software engineer"',
          '- user_preference: Subjective preferences and habits (food, entertainment, work style)',
          '  * Examples: "Prefers dark mode", "Does not eat spicy food", "Likes to work in the morning"',
          '- relationship: Info about people user knows (name, relationship, preferences)',
          '- important_date: Dates that matter (birthdays, anniversaries, deadlines)',
          '- decision: Significant decisions made during work',
          '- tool_pattern: Useful tool usage patterns discovered',
          '- error_resolution: How errors were fixed',
        ].join('\n'),
      },
      content: {
        type: 'string',
        description: [
          'The information to remember (concise, factual statement).',
          'Examples:',
          '- user_fact: "Assistant\'s name is Jarvis", "User\'s name is Kevin", "User is a software engineer"',
          '- user_preference: "Prefers mild Sichuan cuisine", "Likes to work in the morning"',
          '- relationship: "Alice is a colleague who likes Japanese cuisine"',
          '- important_date: "Alice\'s birthday is March 8th"',
          '- decision: "Decided to use TypeScript for new project"',
        ].join('\n'),
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: '3-5 keywords for future retrieval (e.g., ["food", "spicy", "preference"])',
      },
      confidence: {
        type: 'number',
        description: [
          'Confidence level 0.6-1.0 (default 0.8):',
          '- 0.9-1.0: Direct statement from user',
          '- 0.7-0.9: Clear but indirect',
          '- 0.6-0.7: Inferred from context',
        ].join('\n'),
      },
    },
    required: ['type', 'content', 'keywords'],
  };

  /** 写工具：会修改状态 */
  readonly readonly = false;

  private memoryManager: IMemoryStore | null = null;

  /**
   * 注入记忆管理器（由 ChatSession 调用）
   */
  setMemoryManager(manager: IMemoryStore): void {
    this.memoryManager = manager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 参数验证
    const type = input.type as MemoryEntryType;
    const content = input.content as string;
    const keywords = input.keywords as string[];
    const confidence = (input.confidence as number | undefined) ?? 0.8;

    if (!type) {
      return this.error('Parameter "type" is required');
    }

    if (!content?.trim()) {
      return this.error('Parameter "content" is required and cannot be empty');
    }

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return this.error('Parameter "keywords" is required and must be a non-empty array');
    }

    if (confidence < 0.6 || confidence > 1.0) {
      return this.error('Parameter "confidence" must be between 0.6 and 1.0');
    }

    if (!this.memoryManager) {
      return this.error('Memory system is not available');
    }

    // 构造 MemoryEntry
    const attrs = inferMemoryAttributes(type);

    const entry: MemoryEntry = {
      id: this.generateId(),
      type,
      content: content.trim(),
      keywords: keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0),
      source: 'llm-explicit',
      confidence,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
      // 仅 project_fact 类型标记为项目级记忆
      projectPath: type === 'project_fact' ? process.cwd() : undefined,
      // 自动解析元数据（特别是 important_date 类型）
      metadata: this.parseMetadata(type, content),
      // M5 分层记忆字段
      scope: attrs.scope,
      volatility: attrs.volatility,
      significance: attrs.significance,
      categoryLabel: attrs.categoryLabel,
    };

    // 保存
    try {
      await this.memoryManager.add(entry);

      log.info(`Memory stored: [${type}] ${content.slice(0, 50)}...`);

      return this.success(`Memory stored successfully: [${type}] ${content.slice(0, 60)}...`, {
        id: entry.id,
        type,
        keywords: keywords.length,
        confidence,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to store memory:', err);
      return this.error(`Failed to store memory: ${message}`);
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 解析记忆元数据（自动从 content 提取结构化信息）
   */
  private parseMetadata(type: MemoryEntryType, content: string): import('@/memory/types').MemoryMetadata | undefined {
    if (type !== 'important_date') return undefined;

    const metadata: import('@/memory/types').MemoryMetadata = {};

    // 提取日期（支持多种格式）
    // 格式 1: 2026-03-15, 2026/03/15
    let dateMatch = content.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (dateMatch) {
      metadata.dateValue = `${dateMatch[1]}-${dateMatch[2]!.padStart(2, '0')}-${dateMatch[3]!.padStart(2, '0')}`;
    } else {
      // 格式 2: 3月15日, 3月15号, March 15
      dateMatch = content.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
      if (dateMatch) {
        const now = new Date();
        const year = now.getFullYear();
        metadata.dateValue = `${year}-${dateMatch[1]!.padStart(2, '0')}-${dateMatch[2]!.padStart(2, '0')}`;
      }
    }

    // 判断日期类型
    if (content.match(/deadline|截止|due|提交|交付/i)) {
      metadata.dateType = 'deadline';
      metadata.recurring = 'none';
    } else if (content.match(/birthday|生日|诞辰/i)) {
      metadata.dateType = 'birthday';
      metadata.recurring = 'yearly';
    } else if (content.match(/anniversary|纪念日|周年/i)) {
      metadata.dateType = 'anniversary';
      metadata.recurring = 'yearly';
    } else {
      metadata.dateType = 'reminder';
      metadata.recurring = 'none';
    }

    // 提取关联人物（姓名通常在内容开头或 's birthday 前）
    const personMatch = content.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'?s?\s+(?:birthday|生日)/i) ||
                       content.match(/^([\u4e00-\u9fa5]{2,4})\s*(?:的)?\s*(?:生日|纪念日)/);
    if (personMatch) {
      metadata.relatedPerson = personMatch[1];
    }

    return metadata;
  }

}
