// ============================================================
// M4 记忆系统 — 智能记忆提取器 V2（LLM 主动决策版）
// ============================================================

import type { SessionMemory, MemoryEntry, MemoryEntryType, MemoryConfig } from './types';
import type { ILLMProvider, ProviderConfig, Message } from '@/core/types';
import type { IReminderEngine } from '@/reminder/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'smart-memory-extractor-v2' });

/**
 * 记忆决策类型
 */
type MemoryAction = 'create' | 'update' | 'merge' | 'skip';
type MemoryPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * LLM 决策结果（单条记忆）
 */
interface MemoryDecision {
  action: MemoryAction;
  type: MemoryEntryType | null;
  content: string | null;
  keywords: string[];
  confidence: number;
  priority: MemoryPriority;
  reason: string;
  relatedMemoryId?: string;
  mergedContent?: string;
}

/**
 * LLM 决策完整响应
 */
interface DecisionResponse {
  decisions: MemoryDecision[];
  summary: string;
}

/**
 * 记忆检索接口（用于获取已有相关记忆）
 */
interface MemoryRetriever {
  retrieve(query: string, options?: { maxResults?: number; types?: MemoryEntryType[] }): Promise<MemoryEntry[]>;
  getAll(): MemoryEntry[];
}

/**
 * SmartMemoryExtractorV2 — LLM 主动决策的智能记忆提取器
 *
 * 核心改进：
 * 1. 上下文感知：获取已有记忆，避免重复
 * 2. 主动决策：LLM 判断 create/update/merge/skip
 * 3. 优先级管理：critical/high/normal/low
 * 4. 容量管理：接近上限时更严格
 * 5. 自动关联：important_date 触发提醒
 */
export class SmartMemoryExtractorV2 {
  private provider: ILLMProvider;
  private config: MemoryConfig;
  private providerConfig: ProviderConfig;
  private projectRoot: string | undefined;
  private memoryRetriever: MemoryRetriever | null = null;
  private reminderEngine: IReminderEngine | null = null;
  private currentCount = 0;
  private maxEntries = 1000;

  constructor(
    provider: ILLMProvider,
    providerConfig: ProviderConfig,
    memoryConfig: MemoryConfig,
    projectRoot?: string,
  ) {
    this.provider = provider;
    this.providerConfig = providerConfig;
    this.config = memoryConfig;
    this.projectRoot = projectRoot;
    this.maxEntries = memoryConfig.longTermMaxEntries ?? 1000;
  }

  /**
   * 注入记忆检索器（用于获取已有记忆）
   */
  setMemoryRetriever(retriever: MemoryRetriever): void {
    this.memoryRetriever = retriever;
  }

  /**
   * 注入提醒引擎（用于自动创建提醒）
   */
  setReminderEngine(engine: IReminderEngine): void {
    this.reminderEngine = engine;
  }

  /**
   * 从会话中提取记忆（增强版：包含决策逻辑）
   */
  async extractFromSession(session: SessionMemory): Promise<MemoryEntry[]> {
    try {
      // 1. 获取已有相关记忆
      const existingMemories = await this.getRelevantMemories(session);
      
      // 2. 获取记忆容量状态
      const capacityStatus = this.getCapacityStatus();

      // 3. 构造决策 Prompt
      const decisionPrompt = this.buildDecisionPrompt(session, existingMemories, capacityStatus);

      // 4. 调用 LLM 决策
      const decisions = await this.makeDecisions(decisionPrompt);

      // 5. 执行决策（create/update/merge）
      const newEntries = await this.executeDecisions(decisions, session);

      log.info(`Memory decisions: ${decisions.decisions.length} analyzed, ${newEntries.length} to save`);
      log.debug(`Decision summary: ${decisions.summary}`);

      return newEntries;
    } catch (err) {
      log.warn('SmartMemoryExtractorV2 failed, returning empty array:', err);
      return [];
    }
  }

  /**
   * 获取相关记忆（用于去重和合并）
   */
  private async getRelevantMemories(session: SessionMemory): Promise<MemoryEntry[]> {
    if (!this.memoryRetriever) {
      return [];
    }

    try {
      // 从会话中提取关键词
      const keywords = this.extractKeywords(session);
      const query = keywords.join(' ');

      // 检索相关记忆（限制数量）
      const relevant = await this.memoryRetriever.retrieve(query, {
        maxResults: 10,
      });

      return relevant;
    } catch (err) {
      log.warn('Failed to retrieve relevant memories:', err);
      return [];
    }
  }

  /**
   * 从会话中提取关键词
   */
  private extractKeywords(session: SessionMemory): string[] {
    // 简单实现：提取用户消息中的名词（基于长度和频率）
    const allText = session.userMessages.join(' ');
    const words = allText
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .filter((w) => !/^\d+$/.test(w)); // 排除纯数字

    // 简单去重
    return [...new Set(words)].slice(0, 10);
  }

  /**
   * 获取记忆容量状态
   */
  private getCapacityStatus(): { currentCount: number; maxEntries: number; usagePercent: number } {
    if (this.memoryRetriever) {
      const allMemories = this.memoryRetriever.getAll();
      this.currentCount = allMemories.length;
    }

    const usagePercent = (this.currentCount / this.maxEntries) * 100;

    return {
      currentCount: this.currentCount,
      maxEntries: this.maxEntries,
      usagePercent,
    };
  }

  /**
   * 构造决策 Prompt
   */
  private buildDecisionPrompt(
    session: SessionMemory,
    existingMemories: MemoryEntry[],
    capacityStatus: { currentCount: number; maxEntries: number; usagePercent: number },
  ): string {
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

    // 格式化已有记忆
    const existingMemoriesText =
      existingMemories.length > 0
        ? existingMemories
            .map((m) => `- [${m.id}] (${m.type}, confidence: ${m.confidence.toFixed(2)}) ${m.content}`)
            .join('\n')
        : '(无相关记忆)';

    // 统计用户偏好（最常记忆的类型）
    const typeStats = this.getTypeStatistics();

    // 容量警告
    const capacityWarning =
      capacityStatus.usagePercent > 80
        ? `\n⚠️ 容量接近上限，请优先存储 critical/high 优先级记忆`
        : '';

    return `## 当前会话

\`\`\`
${conversationContent}
\`\`\`

## 已有相关记忆

${existingMemoriesText}

## 记忆容量状态

- 当前记忆数: ${capacityStatus.currentCount}
- 容量上限: ${capacityStatus.maxEntries}
- 使用率: ${capacityStatus.usagePercent.toFixed(1)}%${capacityWarning}

## 用户偏好统计

- 最常记忆类型: ${typeStats.topTypes.join(', ')}
- 平均置信度: ${typeStats.avgConfidence.toFixed(2)}

---

**请分析会话并做出记忆决策。对于每条信息：**

1. 判断是否值得记忆（参考决策原则）
2. 检查是否与已有记忆重复/冲突
3. 决定操作类型（create/update/merge/skip）
4. 评估优先级和置信度

**输出格式（JSON）：**

\`\`\`json
{
  "decisions": [
    {
      "action": "create|update|merge|skip",
      "type": "user_preference|user_fact|relationship|important_date|decision|tool_pattern|error_resolution|project_fact|session_summary",
      "content": "清晰、简洁的事实陈述（不是引用）",
      "keywords": ["关键词1", "关键词2", "关键词3"],
      "confidence": 0.6-1.0,
      "priority": "critical|high|normal|low",
      "reason": "决策理由（为什么记忆/为什么跳过）",
      "relatedMemoryId": "如果是 update/merge，提供已有记忆ID",
      "mergedContent": "如果是 merge，提供合并后的完整内容"
    }
  ],
  "summary": "本次决策总结：记忆了哪些，跳过了哪些，为什么"
}
\`\`\`

**特殊规则：**

1. **去重优先**：如果新信息与已有记忆相似度 > 80%，优先 update 或 merge
2. **更新优先**：用户明确纠正时（"其实我现在…"），必须 update，置信度 0.95+
3. **critical 优先**：important_date、relationship 默认为 critical
4. **容量管理**：当使用率 > 80%，只存储 critical/high，跳过 normal/low
5. **自动关联**：important_date 类型自动触发提醒创建（在 reason 中说明）

现在开始分析并决策：`;
  }

  /**
   * 获取用户记忆类型统计
   */
  private getTypeStatistics(): { topTypes: string[]; avgConfidence: number } {
    if (!this.memoryRetriever) {
      return { topTypes: ['N/A'], avgConfidence: 0.8 };
    }

    const allMemories = this.memoryRetriever.getAll();
    if (allMemories.length === 0) {
      return { topTypes: ['N/A'], avgConfidence: 0.8 };
    }

    // 统计类型频率
    const typeCounts: Record<string, number> = {};
    let totalConfidence = 0;

    for (const mem of allMemories) {
      typeCounts[mem.type] = (typeCounts[mem.type] || 0) + 1;
      totalConfidence += mem.confidence;
    }

    // 排序并取 Top 3
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);

    const avgConfidence = totalConfidence / allMemories.length;

    return { topTypes, avgConfidence };
  }

  /**
   * 调用 LLM 进行决策
   */
  private async makeDecisions(prompt: string): Promise<DecisionResponse> {
    const systemPrompt = this.buildSystemPrompt();

    try {
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ];

      let fullContent = '';
      const stream = this.provider.stream(messages, [], {
        ...this.providerConfig,
        model: this.config.extractorModel ?? this.providerConfig.model,
        temperature: this.config.extractorTemperature ?? 0.3,
        timeout: this.config.extractorTimeout ?? 60_000,
      });

      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          fullContent += event.text;
        }
      }

      // 解析 JSON
      const decision = this.parseDecisionResponse(fullContent);
      return decision;
    } catch (error) {
      log.error('LLM decision failed:', error);
      // 降级：返回空决策
      return {
        decisions: [
          {
            action: 'skip',
            type: null,
            content: null,
            keywords: [],
            confidence: 0,
            priority: 'low',
            reason: 'LLM decision failed, skipping',
          },
        ],
        summary: 'Decision failed, no memories extracted',
      };
    }
  }

  /**
   * 构造 System Prompt
   */
  private buildSystemPrompt(): string {
    return `你是 Xuanji 的记忆管理器，负责主动决策哪些信息值得长期记忆。

核心职责：
1. 分析会话内容，判断哪些信息有长期价值
2. 检测与已有记忆的冲突/重复，决定是新增/更新/合并
3. 评估记忆优先级，在存储空间有限时做出取舍
4. 学习用户习惯，优化记忆策略

决策原则：
✅ 记忆有价值的：
  - 用户偏好（食物、工作习惯、兴趣爱好）
  - 人际关系（联系人、喜好、重要日期）
  - 重要决策（技术选型、项目方向）
  - 用户事实（职业、居住地、家庭）
  - 工具模式（高效workflow）
  - 错误解决（调试经验）

❌ 跳过无价值的：
  - 问候语、礼貌用语
  - 工具输出（文件内容、命令结果）
  - 代码片段（除非是重要模式）
  - 一次性请求（"格式化这段代码"）
  - 已有记忆的重复（除非是更新）

优先级划分：
- critical: 重要日期、关系维护、用户核心偏好
- high: 用户决策、新偏好、工具模式
- normal: 项目事实、会话摘要
- low: 临时信息（可能不值得存储）

操作类型：
- create: 创建新记忆
- update: 更新已有记忆（提供 memoryId）
- merge: 合并到已有记忆（提供 memoryId + 合并后内容）
- skip: 跳过存储（说明理由）`;
  }

  /**
   * 解析 LLM 决策响应
   */
  private parseDecisionResponse(responseText: string): DecisionResponse {
    try {
      // 提取 JSON（可能被 markdown 代码块包裹）
      const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) 
        ?? responseText.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        log.warn('No JSON found in decision response');
        return { decisions: [], summary: 'Parse failed' };
      }

      const parsed = JSON.parse(jsonMatch[1]!) as DecisionResponse;

      // 验证格式
      if (!Array.isArray(parsed.decisions)) {
        log.warn('Invalid decision format: decisions is not an array');
        return { decisions: [], summary: 'Invalid format' };
      }

      return parsed;
    } catch (err) {
      log.warn('Failed to parse decision JSON:', err);
      return { decisions: [], summary: 'Parse error' };
    }
  }

  /**
   * 执行决策（create/update/merge）
   */
  private async executeDecisions(response: DecisionResponse, session: SessionMemory): Promise<MemoryEntry[]> {
    const newEntries: MemoryEntry[] = [];
    const now = new Date().toISOString();

    for (const decision of response.decisions) {
      // 跳过 skip 和 update/merge（update/merge 由 MemoryManager 处理）
      if (decision.action === 'skip') {
        log.debug(`Skipped: ${decision.reason}`);
        continue;
      }

      if (decision.action === 'update' || decision.action === 'merge') {
        log.debug(`Deferred to MemoryManager: ${decision.action} ${decision.relatedMemoryId}`);
        // TODO: 返回 update/merge 指令，由 MemoryManager 处理
        continue;
      }

      // create 操作
      if (decision.action === 'create' && decision.type && decision.content) {
        // 容量管理：接近上限时跳过 low/normal
        const capacityStatus = this.getCapacityStatus();
        if (capacityStatus.usagePercent > 80) {
          if (decision.priority === 'low' || decision.priority === 'normal') {
            log.debug(`Skipped due to capacity: ${decision.content}`);
            continue;
          }
        }

        const entry: MemoryEntry = {
          id: this.generateId(),
          type: decision.type,
          content: decision.content,
          keywords: decision.keywords,
          source: 'llm-decision-v2',
          confidence: decision.confidence,
          createdAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          projectPath: decision.type === 'project_fact' ? this.projectRoot : undefined,
        };

        newEntries.push(entry);
        log.info(`Created memory: [${decision.type}] ${decision.content.slice(0, 50)}...`);

        // 自动关联：important_date 触发提醒
        if (decision.type === 'important_date' && this.reminderEngine) {
          try {
            // 解析日期并创建提醒
            const dateMatch = decision.content.match(/\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}[日号]/);
            if (dateMatch) {
              let triggerDate: string;
              const matched = dateMatch[0];
              
              if (matched.includes('月')) {
                // 中文日期格式：3月8日 → 2026-03-08
                const monthMatch = matched.match(/(\d{1,2})月(\d{1,2})[日号]/);
                if (monthMatch) {
                  const month = monthMatch[1].padStart(2, '0');
                  const day = monthMatch[2].padStart(2, '0');
                  const year = new Date().getFullYear();
                  triggerDate = `${year}-${month}-${day}`;
                }
              } else {
                // ISO 格式：2026-03-08
                triggerDate = matched;
              }

              if (triggerDate!) {
                // 提前2天提醒（生日/纪念日需要准备）
                const reminderDate = new Date(triggerDate);
                reminderDate.setDate(reminderDate.getDate() - 2);
                
                await this.reminderEngine.setReminder({
                  content: decision.content,
                  triggerDate: reminderDate.toISOString().split('T')[0]!,
                  recurring: 'yearly', // 重要日期通常每年重复
                  source: 'auto_extracted',
                });
                
                log.info(`Auto-created yearly reminder for: ${decision.content}`);
              }
            }
          } catch (err) {
            log.warn(`Failed to create auto reminder: ${err}`);
          }
        }
      }
    }

    return newEntries;
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
