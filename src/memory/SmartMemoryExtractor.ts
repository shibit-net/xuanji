// ============================================================
// M4 记忆系统 — 智能记忆提取器
// ============================================================

import type { SessionMemory, MemoryEntry, MemoryEntryType, MemoryConfig } from './types';
import type { ILLMProvider, ProviderConfig, Message } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'smart-memory-extractor' });

/**
 * 提取结果原始格式（LLM 返回的 JSON 格式）
 */
interface ExtractionResult {
  type: MemoryEntryType;
  content: string;
  keywords: string[];
  confidence: number;
}

/**
 * SmartMemoryExtractor — 使用 LLM 智能提取记忆
 *
 * 使用 LLM 模型分析会话内容，提取有长期价值的记忆。
 * 相比正则表达式提取，能够理解语义并识别隐含信息。
 */
export class SmartMemoryExtractor {
  private provider: ILLMProvider;
  private config: MemoryConfig;
  private providerConfig: ProviderConfig;
  private projectRoot: string | undefined;

  constructor(provider: ILLMProvider, providerConfig: ProviderConfig, memoryConfig: MemoryConfig, projectRoot?: string) {
    this.provider = provider;
    this.providerConfig = providerConfig;
    this.config = memoryConfig;
    this.projectRoot = projectRoot;
  }

  /**
   * 从会话中提取记忆
   */
  async extractFromSession(session: SessionMemory): Promise<MemoryEntry[]> {
    try {
      // 构造提取 Prompt
      const extractionPrompt = this.buildExtractionPrompt(session);

      // 调用 LLM
      const messages: Message[] = [
        {
          role: 'user',
          content: extractionPrompt,
        },
      ];

      const stream = this.provider.stream(messages, [], {
        ...this.providerConfig,
        model: this.config.extractorModel ?? this.providerConfig.model, // 使用配置的提取器模型，默认为主模型
        temperature: this.config.extractorTemperature ?? 0.3,
        timeout: this.config.extractorTimeout ?? 60_000,
      });

      // 收集响应
      let responseText = '';
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          responseText += event.text;
        }
      }

      // 解析 JSON
      const extracted = this.parseResponse(responseText);

      // 过滤低置信度
      const minConfidence = this.config.extractorMinConfidence ?? 0.6;
      const filtered = extracted.filter((e) => e.confidence >= minConfidence);

      log.debug(`Extracted ${filtered.length}/${extracted.length} memories (min confidence: ${minConfidence})`);

      return this.convertToMemoryEntries(filtered, session);
    } catch (err) {
      log.warn('Failed to extract memories, returning empty array:', err);
      return [];
    }
  }

  /**
   * 构造提取 Prompt
   */
  private buildExtractionPrompt(session: SessionMemory): string {
    // 格式化会话内容
    const conversationLines: string[] = [];

    for (let i = 0; i < Math.max(session.userMessages.length, session.assistantHighlights.length); i++) {
      if (i < session.userMessages.length) {
        conversationLines.push(`User: ${session.userMessages[i]}`);
      }
      if (i < session.assistantHighlights.length) {
        conversationLines.push(`Assistant: ${session.assistantHighlights[i]}`);
      }
    }

    const conversationContent = conversationLines.join('\n');

    return `## Task
Analyze the conversation and extract memories with long-term value.

## Memory Types

1. **user_preference**: Personal preferences (food, entertainment, work habits, etc.)
   - Example: "Does not eat spicy food", "Prefers dark mode in editors"

2. **user_fact**: Factual information about the user (job, location, family, etc.)
   - Example: "Works as a software engineer", "Lives in Beijing"

3. **relationship**: Information about people the user knows (name, relationship, preferences, interactions)
   - Example: "Alice is a colleague who likes Japanese cuisine", "Bob's birthday is March 8th"

4. **important_date**: Dates that matter (birthdays, anniversaries, deadlines)
   - Example: "Project deadline: March 15, 2026", "Mother's birthday: May 20th"

5. **decision**: Important decisions made during the conversation
   - Example: "Decided to use TypeScript for new project", "Chose React over Vue"

6. **tool_pattern**: Useful tool usage patterns discovered
   - Example: "Use grep_file before edit_file for large files", "Prefer glob_files for directory scanning"

7. **error_resolution**: How errors were fixed (for future reference)
   - Example: "Fixed 'module not found' by running npm install", "Resolved CORS by adding middleware"

8. **project_fact**: Project-specific facts (architecture, conventions, etc.)
   - Example: "Uses MySQL for main database", "API base URL is https://api.example.com"

9. **session_summary**: High-level summary of what was accomplished
   - Example: "Implemented user authentication system", "Fixed critical bug in payment flow"

## Rules

1. **Only extract information with long-term value** — skip transient details
2. **One memory per entry** (atomic) — don't combine multiple facts
3. **Extract essence, not verbatim** — rewrite as clear, factual statements
4. **Confidence scoring (0.6-1.0)**:
   - 0.9-1.0: Direct statement ("I don't eat spicy food")
   - 0.7-0.9: Clear but indirect ("I prefer mild Sichuan cuisine" → implies can't eat very spicy)
   - 0.6-0.7: Inferred from context ("I'll skip this restaurant, too spicy for me")
5. **User corrections override old information** — if user says "Actually I can handle mild spice now", extract as high confidence (0.95+)
6. **Do NOT extract**:
   - Greetings, acknowledgments ("thanks", "ok", "sure")
   - Tool outputs (file contents, command results)
   - Code snippets
   - Temporary requests ("what time is it", "format this code")

## Output Format

Return a JSON array of memory objects. Each object must have:
- \`type\`: One of the memory types above
- \`content\`: Concise, factual statement (not a quote, a summary)
- \`keywords\`: 3-5 relevant terms for future retrieval
- \`confidence\`: 0.6-1.0 (use rules above)

Example:

\`\`\`json
[
  {
    "type": "user_preference",
    "content": "Does not eat spicy food, prefers mild Sichuan cuisine",
    "keywords": ["food", "spicy", "sichuan", "preference"],
    "confidence": 0.9
  },
  {
    "type": "relationship",
    "content": "Alice is a colleague who likes Japanese cuisine",
    "keywords": ["Alice", "colleague", "japanese", "food"],
    "confidence": 0.85
  },
  {
    "type": "important_date",
    "content": "Alice's birthday is March 8th",
    "keywords": ["Alice", "birthday", "march"],
    "confidence": 0.95
  }
]
\`\`\`

## Few-Shot Examples

**Example 1: Rich extraction**

Conversation:
\`\`\`
User: 我不吃辣，但是微辣可以接受
Assistant: 好的，记住了！
User: Alice 特别喜欢日料，她生日是 3 月 8 号
Assistant: 明白，已记录 Alice 的信息
\`\`\`

Output:
\`\`\`json
[
  {
    "type": "user_preference",
    "content": "Cannot eat spicy food, but can accept mildly spicy dishes",
    "keywords": ["food", "spicy", "preference", "tolerance"],
    "confidence": 0.95
  },
  {
    "type": "relationship",
    "content": "Alice loves Japanese cuisine",
    "keywords": ["Alice", "japanese", "cuisine", "preference"],
    "confidence": 0.9
  },
  {
    "type": "important_date",
    "content": "Alice's birthday is March 8th",
    "keywords": ["Alice", "birthday", "march"],
    "confidence": 0.95
  }
]
\`\`\`

**Example 2: Correction handling**

Conversation:
\`\`\`
User: 之前说我不吃辣，但其实现在可以吃微辣了
Assistant: 好的，更新了你的偏好
\`\`\`

Output:
\`\`\`json
[
  {
    "type": "user_preference",
    "content": "Can now eat mildly spicy food (updated from previously not eating spicy)",
    "keywords": ["food", "spicy", "preference", "change", "update"],
    "confidence": 0.98
  }
]
\`\`\`

**Example 3: No valuable memories**

Conversation:
\`\`\`
User: 帮我格式化这段代码
Assistant: (使用 edit_file 格式化代码)
User: 谢谢
Assistant: 不客气！
\`\`\`

Output:
\`\`\`json
[]
\`\`\`

**Example 4: Decision and tool pattern**

Conversation:
\`\`\`
User: 我想用 TypeScript 重构这个项目
Assistant: 好的，我先用 glob_files 找到所有 JS 文件
User: 不错，以后都这样做吧
\`\`\`

Output:
\`\`\`json
[
  {
    "type": "decision",
    "content": "Decided to refactor project using TypeScript",
    "keywords": ["typescript", "refactor", "decision", "project"],
    "confidence": 0.9
  },
  {
    "type": "tool_pattern",
    "content": "Use glob_files to find all target files before refactoring",
    "keywords": ["glob", "refactor", "pattern", "workflow"],
    "confidence": 0.75
  }
]
\`\`\`

## Conversation

\`\`\`
${conversationContent}
\`\`\`

---

**Now analyze the conversation above and extract memories. Return ONLY the JSON array, no additional text.**`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(responseText: string): ExtractionResult[] {
    try {
      // 尝试提取 JSON 数组（可能包裹在 markdown 代码块中）
      const jsonMatch = responseText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
        ?? responseText.match(/(\[[\s\S]*\])/);

      if (!jsonMatch) {
        log.warn('No JSON array found in response');
        return [];
      }

      const jsonStr = jsonMatch[1];
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        log.warn('Response is not an array');
        return [];
      }

      // 验证每个条目
      return parsed.filter((item) => {
        if (!item.type || !item.content || !item.keywords || typeof item.confidence !== 'number') {
          log.warn('Invalid memory entry:', item);
          return false;
        }
        return true;
      });
    } catch (err) {
      log.warn('Failed to parse JSON response:', err);
      return [];
    }
  }

  /**
   * 转换为 MemoryEntry
   */
  private convertToMemoryEntries(results: ExtractionResult[], session: SessionMemory): MemoryEntry[] {
    const now = new Date().toISOString();

    return results.map((result) => ({
      id: this.generateId(),
      type: result.type,
      content: result.content,
      keywords: result.keywords,
      source: 'llm-extraction',
      confidence: result.confidence,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      // project_fact 类型标记 projectPath，其他类型存储为全局
      projectPath: result.type === 'project_fact' ? this.projectRoot : undefined,
    }));
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
