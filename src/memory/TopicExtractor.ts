// ============================================================
// M4 记忆系统 — 主题提取器
// ============================================================

import type { MemoryEntry, MemoryEntryType } from './types';
import type { ILLMProvider } from '@/core/types';
import type { EmbeddingService } from '@/embedding/EmbeddingService';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'topic-extractor' });

export interface TopicExtractorOptions {
  /** LLM Provider（用于提取核心知识） */
  llmProvider: ILLMProvider;
  /** Provider 配置（模型、温度等） */
  providerConfig?: import('@/core/types').ProviderConfig;
  /** Embedding Service（可选，用于语义相似度） */
  embeddingService?: EmbeddingService;
  /** 主题合并相似度阈值（默认 0.85） */
  mergeThreshold?: number;
  /** 最小提取条目数（默认 2，少于此数不提取） */
  minEntriesForExtraction?: number;
}

/**
 * 主题提取器
 *
 * 自动从 timeline 记忆中提取可复用的 topic 记忆：
 * - 每天自动运行（或手动触发）
 * - 识别重复主题并聚类
 * - 使用 LLM 提取核心知识
 * - 去重和合并相似主题
 * - 保留追溯链路（extractedFrom, relatedMemories）
 *
 * 借鉴 OpenClaw 的主题组织，但完全自动化。
 */
export class TopicExtractor {
  private llmProvider: ILLMProvider;
  private providerConfig: import('@/core/types').ProviderConfig;
  private embeddingService?: EmbeddingService;
  private mergeThreshold: number;
  private minEntriesForExtraction: number;

  /** 主题 ID 推断规则（可配置） */
  private topicIdRules: Map<string, string[]> = new Map([
    // 用户偏好相关
    ['user-preferences', ['preference', 'prefer', 'like', 'dislike', 'favorite']],
    ['package-manager', ['bun', 'npm', 'yarn', 'pnpm', 'package']],
    ['editor', ['vscode', 'vim', 'emacs', 'editor', 'ide']],
    ['language', ['typescript', 'javascript', 'python', 'rust', 'go']],

    // 项目知识相关
    ['project-xuanji', ['xuanji', 'project']],
    ['coding-patterns', ['pattern', 'best-practice', 'anti-pattern']],
    ['debugging', ['debug', 'error', 'fix', 'bug', 'issue']],
    ['tool-usage', ['tool', 'command', 'cli', 'usage']],

    // 通用主题
    ['performance', ['performance', 'optimize', 'speed', 'slow', 'fast']],
    ['testing', ['test', 'testing', 'unit-test', 'integration']],
  ]);

  constructor(options: TopicExtractorOptions) {
    this.llmProvider = options.llmProvider;
    this.providerConfig = options.providerConfig || {
      model: 'claude-haiku-4-5',
      temperature: 0.2,
      maxTokens: 200,
    };
    this.embeddingService = options.embeddingService;
    this.mergeThreshold = options.mergeThreshold ?? 0.85;
    this.minEntriesForExtraction = options.minEntriesForExtraction ?? 2;
  }

  /**
   * 从 timeline 记忆中提取主题
   *
   * @param timelineMemories - timeline 分类的记忆列表
   * @param existingTopics - 已存在的 topic 记忆（用于去重）
   * @returns 提取的 topic 记忆列表
   */
  async extractTopicsFromTimeline(
    timelineMemories: MemoryEntry[],
    existingTopics: MemoryEntry[]
  ): Promise<MemoryEntry[]> {
    if (timelineMemories.length === 0) {
      log.debug('No timeline memories to extract');
      return [];
    }

    log.info(`Extracting topics from ${timelineMemories.length} timeline memories`);

    // 1. 按主题分组
    const grouped = this.groupByTopic(timelineMemories);

    log.debug(`Grouped into ${grouped.size} potential topics`);

    const extractedTopics: MemoryEntry[] = [];

    // 2. 遍历每个主题组
    for (const [topicId, memories] of grouped) {
      // 跳过条目数太少的组
      if (memories.length < this.minEntriesForExtraction) {
        log.debug(`Skipping topic ${topicId}: only ${memories.length} entries`);
        continue;
      }

      try {
        // 3. 提取核心知识
        const coreKnowledge = await this.extractCoreKnowledge(memories, topicId);

        if (!coreKnowledge || coreKnowledge.trim().length === 0) {
          log.debug(`No core knowledge extracted for topic ${topicId}`);
          continue;
        }

        // 4. 检查是否已存在相似 topic
        const similar = await this.findSimilarTopic(coreKnowledge, topicId, existingTopics);

        if (similar) {
          // 5. 合并到已有 topic
          const merged = this.mergeTopic(similar, coreKnowledge, memories);
          extractedTopics.push(merged);
          log.debug(`Merged topic ${topicId} into existing topic ${similar.id}`);
        } else {
          // 6. 创建新 topic
          const newTopic = this.createTopic(coreKnowledge, topicId, memories);
          extractedTopics.push(newTopic);
          log.debug(`Created new topic ${topicId}`);
        }
      } catch (err) {
        log.warn(`Failed to extract topic ${topicId}:`, err);
        continue;
      }
    }

    log.info(`Extracted ${extractedTopics.length} topics`);

    return extractedTopics;
  }

  /**
   * 按主题分组（基于关键词聚类）
   */
  private groupByTopic(memories: MemoryEntry[]): Map<string, MemoryEntry[]> {
    const groups = new Map<string, MemoryEntry[]>();

    for (const memory of memories) {
      // 推断主题 ID
      const topicId = this.inferTopicId(memory);

      if (!groups.has(topicId)) {
        groups.set(topicId, []);
      }
      groups.get(topicId)!.push(memory);
    }

    return groups;
  }

  /**
   * 推断主题 ID
   *
   * 策略：
   * 1. 匹配预定义规则（基于关键词）
   * 2. 根据 type 推断
   * 3. 降级到 "general"
   */
  private inferTopicId(memory: MemoryEntry): string {
    const keywords = memory.keywords.map(k => k.toLowerCase());

    // 1. 匹配规则
    for (const [topicId, patterns] of this.topicIdRules) {
      for (const pattern of patterns) {
        if (keywords.some(k => k.includes(pattern) || pattern.includes(k))) {
          return topicId;
        }
      }
    }

    // 2. 根据 type 推断
    const typeToTopic: Record<string, string> = {
      user_preference: 'user-preferences',
      project_fact: 'project-knowledge',
      tool_pattern: 'tool-usage',
      error_resolution: 'debugging',
    };

    if (typeToTopic[memory.type]) {
      return typeToTopic[memory.type];
    }

    // 3. 降级
    return 'general';
  }

  /**
   * 使用 LLM 提取核心知识
   */
  private async extractCoreKnowledge(
    memories: MemoryEntry[],
    topicId: string
  ): Promise<string> {
    const prompt = `
请从以下对话片段中提取核心知识点。

## 主题
${this.getTopicName(topicId)}

## 对话内容
${memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n')}

## 输出要求
- 简洁：1-2 句话
- 准确：反映核心事实或决策
- 可复用：未来遇到相同主题时有参考价值
- 自包含：不依赖上下文也能理解

请直接输出提取的知识点，不要其他解释。

示例：
- 输入："用户说更喜欢 Bun"、"讨论 npm 和 Bun 的区别"
- 输出："User prefers Bun over npm for package management"
    `.trim();

    try {
      // 使用流式 API（ILLMProvider 只有 stream 方法）
      const messages: import('@/core/types').Message[] = [
        { role: 'user', content: prompt },
      ];

      let result = '';
      for await (const event of this.llmProvider.stream(messages, [], this.providerConfig)) {
        if (event.type === 'text_delta' && event.text) {
          result += event.text;
        }
      }

      return result.trim();
    } catch (err) {
      log.warn('LLM extraction failed:', err);
      // 降级：返回第一条记忆的内容
      return memories[0]?.content || '';
    }
  }

  /**
   * 查找相似的已存在 topic
   */
  private async findSimilarTopic(
    newContent: string,
    topicId: string,
    existingTopics: MemoryEntry[]
  ): Promise<MemoryEntry | null> {
    // 1. 先按 topicId 过滤
    const sameTopicId = existingTopics.filter(t => t.topicId === topicId);

    if (sameTopicId.length === 0) {
      return null;
    }

    // 2. 如果有 embeddingService，使用语义相似度
    if (this.embeddingService) {
      try {
        const newEmbedding = await this.embeddingService.embed(newContent);

        let maxSimilarity = 0;
        let mostSimilar: MemoryEntry | null = null;

        for (const existing of sameTopicId) {
          const existingEmbedding = await this.embeddingService.embed(existing.content);
          const similarity = this.cosineSimilarity(newEmbedding, existingEmbedding);

          if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
            mostSimilar = existing;
          }
        }

        if (maxSimilarity >= this.mergeThreshold) {
          log.debug(`Found similar topic with similarity ${maxSimilarity.toFixed(2)}`);
          return mostSimilar;
        }
      } catch (err) {
        log.debug('Embedding similarity check failed:', err);
      }
    }

    // 3. 降级：简单关键词匹配
    const newKeywords = new Set(this.extractKeywords(newContent));

    for (const existing of sameTopicId) {
      const existingKeywords = new Set(this.extractKeywords(existing.content));

      // 计算 Jaccard 相似度
      const intersection = new Set([...newKeywords].filter(k => existingKeywords.has(k)));
      const union = new Set([...newKeywords, ...existingKeywords]);
      const jaccard = intersection.size / union.size;

      if (jaccard >= 0.6) {
        log.debug(`Found similar topic with Jaccard ${jaccard.toFixed(2)}`);
        return existing;
      }
    }

    return null;
  }

  /**
   * 合并到已有 topic
   */
  private mergeTopic(
    existing: MemoryEntry,
    newContent: string,
    sourceMemories: MemoryEntry[]
  ): MemoryEntry {
    // 合并内容（简单拼接，可优化为 LLM 智能合并）
    const mergedContent = `${existing.content}; ${newContent}`;

    // 合并关联记忆
    const existingRelated = existing.relatedMemories || [];
    const newRelated = sourceMemories.map(m => m.id);
    const mergedRelated = [...new Set([...existingRelated, ...newRelated])];

    return {
      ...existing,
      content: mergedContent.length > 500 ? newContent : mergedContent, // 避免过长
      relatedMemories: mergedRelated,
      lastAccessedAt: new Date().toISOString(),
      accessCount: existing.accessCount + 1,
    };
  }

  /**
   * 创建新 topic
   */
  private createTopic(
    content: string,
    topicId: string,
    sourceMemories: MemoryEntry[]
  ): MemoryEntry {
    const now = new Date().toISOString();

    // 推断记忆类型
    const type = this.inferMemoryType(topicId);

    // 提取关键词
    const keywords = this.extractKeywords(content);

    // 推断重要性
    const importance = this.inferImportance(sourceMemories);

    return {
      id: `mem-topic-${topicId}-${Date.now()}`,
      category: 'topic',
      topicId,
      type,
      content,
      keywords,
      source: 'topic-extractor',
      confidence: 0.8,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      relatedMemories: sourceMemories.map(m => m.id),
      extractedFrom: sourceMemories[0]?.id,
      metadata: { importance },
    };
  }

  /**
   * 推断记忆类型（根据 topicId）
   */
  private inferMemoryType(topicId: string): MemoryEntryType {
    if (topicId.startsWith('user-')) {
      return 'user_preference';
    }
    if (topicId.startsWith('project-')) {
      return 'project_fact';
    }
    if (topicId.includes('tool')) {
      return 'tool_pattern';
    }
    if (topicId.includes('debug') || topicId.includes('error')) {
      return 'error_resolution';
    }
    return 'decision'; // 默认
  }

  /**
   * 推断重要性（基于来源记忆的特征）
   */
  private inferImportance(sourceMemories: MemoryEntry[]): 'high' | 'medium' | 'low' {
    // 规则：
    // - 如果有任一来源是 high，则 high
    // - 如果平均访问次数 > 5，则 high
    // - 如果来源数量 >= 5，则 medium
    // - 否则 low

    const hasHighImportance = sourceMemories.some(m => m.metadata?.importance === 'high');
    if (hasHighImportance) {
      return 'high';
    }

    const avgAccessCount = sourceMemories.reduce((sum, m) => sum + m.accessCount, 0) / sourceMemories.length;
    if (avgAccessCount > 5) {
      return 'high';
    }

    if (sourceMemories.length >= 5) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * 提取关键词（简单实现）
   */
  private extractKeywords(text: string): string[] {
    // 简单分词并过滤停用词
    const words = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 3);

    // 简单的停用词列表
    const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'has', 'have']);

    return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 10);
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 获取主题显示名称
   */
  private getTopicName(topicId: string): string {
    const nameMap: Record<string, string> = {
      'user-preferences': 'User Preferences',
      'package-manager': 'Package Manager',
      'project-xuanji': 'Project Xuanji',
      'coding-patterns': 'Coding Patterns',
      'debugging': 'Debugging',
      'tool-usage': 'Tool Usage',
      'general': 'General',
    };

    return nameMap[topicId] || topicId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
