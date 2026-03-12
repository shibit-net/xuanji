// ============================================================
// M4 记忆系统 — 会话摘要 + 长期压缩（LLM 增强）
// ============================================================

import { randomUUID } from 'node:crypto';
import type { MemoryEntry, SessionMemory, MemoryConfig } from './types';
import type { ILLMProvider, ProviderConfig, Message } from '@/core/types';
import { DEFAULT_MEMORY_CONFIG } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'memory-compactor' });

/** 决策关键词模式（中文） */
const DECISION_PATTERNS_ZH = /(?:选择|决定|采用|使用|改为|切换到|迁移到|升级到)\s*[^\n。]{3,}/g;

/** 决策关键词模式（英文） */
const DECISION_PATTERNS_EN = /(?:decided?\s+to|chose?\s+to|switched?\s+to|adopted?|using)\s+[^\n.]{3,}/gi;

/** LLM 会话摘要 Prompt */
const SESSION_SUMMARY_PROMPT = `Analyze this conversation and extract:
1. A concise session summary (1-2 sentences, what was accomplished)
2. Key decisions made (if any)

Output ONLY a JSON object:
{
  "summary": "...",
  "decisions": ["decision 1", "decision 2"]
}

Rules:
- Write in the same language as the conversation
- Summary should capture the main task and outcome
- Decisions include explicit choices AND implicit agreements (e.g., "那就用这个方案吧")
- If no meaningful content, return {"summary": "", "decisions": []}
- Keep summary under 200 chars, each decision under 100 chars

Conversation:
`;

/**
 * 记忆压缩器
 *
 * - compactSession()：将 SessionMemory 压缩为 MemoryEntry[]（支持 LLM 增强）
 * - compactLongTerm()：压缩长期记忆（删除过期、合并重复、截断）
 */
export class MemoryCompactor {
  private config: MemoryConfig;
  private provider: ILLMProvider | null = null;
  private providerConfig: ProviderConfig | null = null;

  constructor(config?: Partial<MemoryConfig>) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  /**
   * 注入 LLM Provider（启用智能会话摘要）
   */
  setProvider(provider: ILLMProvider, config: ProviderConfig): void {
    this.provider = provider;
    this.providerConfig = config;
  }

  /** 将会话记忆压缩为持久化条目（异步，支持 LLM） */
  async compactSessionAsync(session: SessionMemory): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    const now = new Date().toISOString();
    const sessionKeywords = this.extractSessionKeywords(session);

    // 1. 生成会话摘要 + 提取决策（LLM 优先，规则降级）
    let summary: string;
    let decisions: string[];

    if (this.provider && this.providerConfig) {
      const llmResult = await this.generateWithLLM(session);
      summary = llmResult.summary || this.generateSessionSummary(session);
      decisions = llmResult.decisions.length > 0 ? llmResult.decisions : this.extractDecisions(session);
    } else {
      summary = this.generateSessionSummary(session);
      decisions = this.extractDecisions(session);
    }

    if (summary) {
      entries.push({
        id: randomUUID(),
        type: 'session_summary',
        content: summary.slice(0, this.config.maxEntryLength),
        keywords: sessionKeywords,
        source: session.sessionId,
        confidence: 0.7,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }

    // 2. 添加决策条目
    for (const decision of decisions) {
      entries.push({
        id: randomUUID(),
        type: 'decision',
        content: decision.slice(0, this.config.maxEntryLength),
        keywords: sessionKeywords,
        source: session.sessionId,
        confidence: 0.85,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }

    // 3. 提取工具使用模式
    const toolPatterns = this.extractToolPatterns(session);
    for (const pattern of toolPatterns) {
      entries.push({
        id: randomUUID(),
        type: 'tool_pattern',
        content: pattern.slice(0, this.config.maxEntryLength),
        keywords: [...sessionKeywords, 'tool'],
        source: session.sessionId,
        confidence: 0.6,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }

    // 4. 提取错误解决方案
    const errorResolutions = this.extractErrorResolutions(session);
    for (const resolution of errorResolutions) {
      entries.push({
        id: randomUUID(),
        type: 'error_resolution',
        content: resolution.slice(0, this.config.maxEntryLength),
        keywords: [...sessionKeywords, 'error', 'fix'],
        source: session.sessionId,
        confidence: 0.8,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }

    return entries;
  }

  /** 将会话记忆压缩为持久化条目（同步，纯规则，向后兼容） */
  compactSession(session: SessionMemory): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const now = new Date().toISOString();
    const sessionKeywords = this.extractSessionKeywords(session);

    // 1. 生成会话摘要
    const summary = this.generateSessionSummary(session);
    if (summary) {
      entries.push({
        id: randomUUID(),
        type: 'session_summary',
        content: summary.slice(0, this.config.maxEntryLength),
        keywords: sessionKeywords,
        source: session.sessionId,
        confidence: 0.7,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }

    // 2. 提取关键决策
    const decisions = this.extractDecisions(session);
    for (const decision of decisions) {
      entries.push({
        id: randomUUID(),
        type: 'decision',
        content: decision.slice(0, this.config.maxEntryLength),
        keywords: sessionKeywords,
        source: session.sessionId,
        confidence: 0.85,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }

    // 3. 提取工具使用模式
    const toolPatterns = this.extractToolPatterns(session);
    for (const pattern of toolPatterns) {
      entries.push({
        id: randomUUID(),
        type: 'tool_pattern',
        content: pattern.slice(0, this.config.maxEntryLength),
        keywords: [...sessionKeywords, 'tool'],
        source: session.sessionId,
        confidence: 0.6,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }

    // 4. 提取错误解决方案
    const errorResolutions = this.extractErrorResolutions(session);
    for (const resolution of errorResolutions) {
      entries.push({
        id: randomUUID(),
        type: 'error_resolution',
        content: resolution.slice(0, this.config.maxEntryLength),
        keywords: [...sessionKeywords, 'error', 'fix'],
        source: session.sessionId,
        confidence: 0.8,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }

    return entries;
  }

  // ────────── LLM 增强 ──────────

  /**
   * 使用 LLM 生成会话摘要和提取决策
   */
  private async generateWithLLM(session: SessionMemory): Promise<{ summary: string; decisions: string[] }> {
    try {
      const conversationText = this.formatSessionForLLM(session);
      const truncated = conversationText.slice(0, 4000);

      const messages: Message[] = [
        { role: 'user', content: `${SESSION_SUMMARY_PROMPT}\n${truncated}` },
      ];

      const stream = this.provider!.stream(messages, [], {
        ...this.providerConfig!,
        maxTokens: 300,
        temperature: 0.2,
      });

      let responseText = '';
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          responseText += event.text;
        }
      }

      // 解析 JSON
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          decisions: Array.isArray(parsed.decisions)
            ? parsed.decisions.filter((d: unknown) => typeof d === 'string')
            : [],
        };
      }
    } catch (err) {
      log.debug('LLM session summary failed, using rule-based:', err);
    }

    return { summary: '', decisions: [] };
  }

  /**
   * 格式化会话内容供 LLM 分析
   */
  private formatSessionForLLM(session: SessionMemory): string {
    const lines: string[] = [];
    for (let i = 0; i < Math.max(session.userMessages.length, session.assistantHighlights.length); i++) {
      if (i < session.userMessages.length) {
        lines.push(`User: ${session.userMessages[i]!.slice(0, 300)}`);
      }
      if (i < session.assistantHighlights.length) {
        lines.push(`Assistant: ${session.assistantHighlights[i]!.slice(0, 300)}`);
      }
    }
    if (session.toolCalls.length > 0) {
      const toolNames = [...new Set(session.toolCalls.map(tc => tc.name))];
      lines.push(`[Tools used: ${toolNames.join(', ')}]`);
    }
    return lines.join('\n');
  }

  /** 压缩长期记忆 */
  compactLongTerm(entries: MemoryEntry[]): MemoryEntry[] {
    // 1. 删除过期条目
    const now = Date.now();
    let remaining = entries.filter((entry) => {
      // 特殊处理：important_date 类型的 deadline
      if (entry.type === 'important_date' && 
          entry.metadata?.dateType === 'deadline' && 
          entry.metadata.dateValue) {
        try {
          const deadlineTime = new Date(entry.metadata.dateValue).getTime();
          const daysOverdue = (now - deadlineTime) / (1000 * 60 * 60 * 24);
          // 过期超过 30 天的 deadline 删除
          if (daysOverdue > 30) {
            log.debug(`Removing overdue deadline: ${entry.id} (${daysOverdue.toFixed(1)} days overdue)`);
            return false;
          }
        } catch {
          // 日期解析失败：保留
        }
      }

      // 豁免循环记忆（生日、纪念日）：永久保留
      if (entry.type === 'important_date' && 
          entry.metadata?.recurring && 
          entry.metadata.recurring !== 'none') {
        return true;
      }

      // 原有逻辑：时间衰减过滤
      const ageMs = now - new Date(entry.createdAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decayScore = Math.pow(0.5, ageDays / this.config.decayHalfLifeDays);
      
      // 保留条件：衰减得分 >= 0.01 或 访问次数 > 5
      const shouldKeep = decayScore >= 0.01 || entry.accessCount > 5;
      if (!shouldKeep) {
        log.debug(`Removing decayed entry: ${entry.id} (decay=${decayScore.toFixed(3)}, access=${entry.accessCount})`);
      }
      return shouldKeep;
    });

    // 2. 合并重复条目（关键词重叠 > 80%）
    remaining = this.mergeOverlapping(remaining);

    // 3. 按综合得分排序，截断到上限
    remaining.sort((a, b) => this.calculatePriority(b) - this.calculatePriority(a));

    if (remaining.length > this.config.longTermMaxEntries) {
      remaining = remaining.slice(0, this.config.longTermMaxEntries);
    }

    return remaining;
  }

  // ────────── 私有方法 ──────────

  /** 生成会话摘要 */
  private generateSessionSummary(session: SessionMemory): string {
    const parts: string[] = [];

    // 用户需求概述
    if (session.userMessages.length > 0) {
      const firstMsg = session.userMessages[0]!;
      parts.push(`用户需求: ${firstMsg.slice(0, 150)}`);
    }

    // 工具调用概述
    if (session.toolCalls.length > 0) {
      const toolNames = [...new Set(session.toolCalls.map((tc) => tc.name))];
      parts.push(`工具: ${toolNames.join(', ')}`);

      // 涉及的文件路径
      const filePaths = new Set<string>();
      for (const tc of session.toolCalls) {
        const path = tc.input['file_path'] ?? tc.input['path'] ?? tc.input['filePath'];
        if (typeof path === 'string') filePaths.add(path);
      }
      if (filePaths.size > 0) {
        parts.push(`文件: ${[...filePaths].slice(0, 5).join(', ')}`);
      }

      // 错误数
      const errorCount = session.toolCalls.filter((tc) => tc.isError).length;
      if (errorCount > 0) {
        parts.push(`错误: ${errorCount} 次`);
      }
    }

    // 时长
    if (session.durationMs) {
      const seconds = Math.round(session.durationMs / 1000);
      parts.push(`时长: ${seconds}s`);
    }

    return parts.join(' | ');
  }

  /** 提取关键决策 */
  private extractDecisions(session: SessionMemory): string[] {
    const decisions: string[] = [];
    const allText = [
      ...session.userMessages,
      ...session.assistantHighlights,
    ].join('\n');

    // 中文决策模式
    const zhMatches = allText.match(DECISION_PATTERNS_ZH);
    if (zhMatches) {
      for (const match of zhMatches.slice(0, 3)) {
        decisions.push(match.trim());
      }
    }

    // 英文决策模式
    const enMatches = allText.match(DECISION_PATTERNS_EN);
    if (enMatches) {
      for (const match of enMatches.slice(0, 3)) {
        decisions.push(match.trim());
      }
    }

    return decisions;
  }

  /** 提取工具使用模式（使用 ≥3 次的工具） */
  private extractToolPatterns(session: SessionMemory): string[] {
    const toolCounts = new Map<string, number>();
    for (const tc of session.toolCalls) {
      toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
    }

    const patterns: string[] = [];
    for (const [name, count] of toolCounts) {
      if (count >= 3) {
        const errorCount = session.toolCalls.filter(
          (tc) => tc.name === name && tc.isError,
        ).length;
        const successRate = Math.round(((count - errorCount) / count) * 100);
        patterns.push(`工具 ${name}: 使用 ${count} 次，成功率 ${successRate}%`);
      }
    }

    return patterns;
  }

  /** 提取错误解决方案（错误后紧跟成功调用） */
  private extractErrorResolutions(session: SessionMemory): string[] {
    const resolutions: string[] = [];
    const calls = session.toolCalls;

    for (let i = 0; i < calls.length - 1; i++) {
      const current = calls[i]!;
      const next = calls[i + 1]!;

      if (current.isError && !next.isError && current.name === next.name) {
        resolutions.push(
          `${current.name} 错误: ${current.resultSummary.slice(0, 100)} → 解决: ${next.resultSummary.slice(0, 100)}`,
        );
      }
    }

    return resolutions.slice(0, 3);
  }

  /** 提取会话关键词 */
  private extractSessionKeywords(session: SessionMemory): string[] {
    const keywords = new Set<string>();

    // 工具名
    for (const tc of session.toolCalls) {
      keywords.add(tc.name.toLowerCase());
    }

    // 文件路径
    for (const tc of session.toolCalls) {
      const path = tc.input['file_path'] ?? tc.input['path'] ?? tc.input['filePath'];
      if (typeof path === 'string') {
        keywords.add(path);
        // 提取文件名
        const parts = path.split('/');
        const fileName = parts[parts.length - 1];
        if (fileName) keywords.add(fileName.toLowerCase());
      }
    }

    // 从用户消息提取关键词（取前 3 条消息的前 200 字符）
    for (const msg of session.userMessages.slice(0, 3)) {
      const words = msg
        .slice(0, 200)
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\-./]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      for (const word of words.slice(0, 10)) {
        keywords.add(word);
      }
    }

    return Array.from(keywords).slice(0, 20);
  }

  /** 合并关键词重叠 > 80% 的条目 */
  private mergeOverlapping(entries: MemoryEntry[]): MemoryEntry[] {
    const merged: MemoryEntry[] = [];
    const used = new Set<number>();

    for (let i = 0; i < entries.length; i++) {
      if (used.has(i)) continue;
      let current = entries[i]!;

      for (let j = i + 1; j < entries.length; j++) {
        if (used.has(j)) continue;
        const other = entries[j]!;

        // 只合并同类型
        if (current.type !== other.type) continue;

        const overlap = this.keywordOverlap(current.keywords, other.keywords);
        if (overlap > 0.8) {
          // 保留较新的、置信度更高的
          if (other.confidence > current.confidence ||
              new Date(other.createdAt) > new Date(current.createdAt)) {
            current = {
              ...other,
              accessCount: current.accessCount + other.accessCount,
              keywords: [...new Set([...current.keywords, ...other.keywords])],
            };
          } else {
            current = {
              ...current,
              accessCount: current.accessCount + other.accessCount,
              keywords: [...new Set([...current.keywords, ...other.keywords])],
            };
          }
          used.add(j);
        }
      }

      merged.push(current);
    }

    return merged;
  }

  /** 计算关键词重叠比例 */
  private keywordOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;

    const setA = new Set(a.map((k) => k.toLowerCase()));
    const setB = new Set(b.map((k) => k.toLowerCase()));
    let intersectionCount = 0;
    for (const k of setA) {
      if (setB.has(k)) intersectionCount++;
    }
    const union = new Set([...setA, ...setB]);
    return intersectionCount / union.size;
  }

  /** 计算综合优先级得分 */
  private calculatePriority(entry: MemoryEntry): number {
    const ageMs = Date.now() - new Date(entry.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const timeDecay = Math.pow(0.5, ageDays / this.config.decayHalfLifeDays);
    const accessBonus = Math.min(Math.log2(entry.accessCount + 1) / 10, 1.0);
    return entry.confidence * 0.4 + timeDecay * 0.4 + accessBonus * 0.2;
  }
}
