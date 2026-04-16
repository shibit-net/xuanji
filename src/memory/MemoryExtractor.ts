// ============================================================
// MemoryExtractor — M5 规则降级提取器
// ============================================================
// 职责：当 MemoryFlushAgent（SubAgent 路径）不可用时，
// 通过纯规则方式提取 session_summary / decision / tool_pattern /
// error_resolution，保证记忆系统的基本可用性。
//
// LLM 智能提取（scope/volatility/significance/categoryLabel/CoreRule）
// 完全由 MemoryFlushAgent → memory-extractor SubAgent 负责。
// ============================================================

import { randomUUID } from 'node:crypto';
import type { SessionMemory, MemoryEntry, MemoryEntryType, MemoryConfig } from './types';
import { DEFAULT_MEMORY_CONFIG, TYPE_DEFAULT_VOLATILITY } from './types';
import { inferMemoryAttributes } from './MemoryAttributeInferrer';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryExtractor' });

// ────────── 决策关键词模式 ──────────

/** 决策关键词模式（中文） */
const DECISION_PATTERNS_ZH = /(?:选择|决定|采用|使用|改为|切换到|迁移到|升级到)\s*[^\n。]{3,}/g;
/** 决策关键词模式（英文） */
const DECISION_PATTERNS_EN = /(?:decided?\s+to|chose?\s+to|switched?\s+to|adopted?|using)\s+[^\n.]{3,}/gi;

/** 提取结果（规则降级路径，无 coreRules） */
export interface ExtractionResult {
  entries: MemoryEntry[];
  coreRules: Array<{
    rule: string;
    category: 'behavior' | 'privacy' | 'communication' | 'ethics' | 'task' | 'custom';
    description?: string;
  }>;
}

/**
 * MemoryExtractor — 规则降级提取器
 *
 * 只在 MemoryFlushAgent 不可用时作为兜底：
 * 提取 session_summary / decision / tool_pattern / error_resolution，
 * 所有 M5 字段（scope/volatility/significance/categoryLabel）使用合理默认值。
 */
export class MemoryExtractor {
  private config: MemoryConfig;
  private projectRoot: string | undefined;

  constructor(config?: Partial<MemoryConfig>, projectRoot?: string) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.projectRoot = projectRoot;
  }

  /**
   * 从会话中提取记忆（规则降级路径）
   * 只负责保证最基础的 session_summary 等条目被记录。
   */
  async extractFromSession(session: SessionMemory): Promise<ExtractionResult> {
    const entries = this.extractWithRules(session);
    return { entries, coreRules: [] };
  }

  // ────────── 规则提取 ──────────

  private extractWithRules(session: SessionMemory): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const now = new Date().toISOString();
    const keywords = this.extractSessionKeywords(session);

    const summary = this.generateSessionSummaryRule(session);
    const decisions = this.extractDecisionsRule(session);

    if (summary) {
      const attrs = inferMemoryAttributes('session_summary');
      entries.push({
        id: randomUUID(),
        type: 'session_summary',
        content: summary.slice(0, this.config.maxEntryLength ?? 500),
        keywords,
        source: session.sessionId,
        confidence: 0.7,
        significance: attrs.significance,
        scope: attrs.scope,
        volatility: attrs.volatility,
        categoryLabel: attrs.categoryLabel,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        sessionId: session.sessionId,
      });
    }

    for (const d of decisions) {
      const attrs = inferMemoryAttributes('decision');
      entries.push({
        id: randomUUID(),
        type: 'decision',
        content: d.slice(0, this.config.maxEntryLength ?? 500),
        keywords,
        source: session.sessionId,
        confidence: 0.85,
        significance: attrs.significance,
        scope: attrs.scope,
        volatility: attrs.volatility,
        categoryLabel: '决策/技术',
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        sessionId: session.sessionId,
      });
    }

    for (const pattern of this.extractToolPatternsRule(session)) {
      const attrs = inferMemoryAttributes('tool_pattern');
      entries.push({
        id: randomUUID(),
        type: 'tool_pattern',
        content: pattern.slice(0, this.config.maxEntryLength ?? 500),
        keywords: [...keywords, 'tool'],
        source: session.sessionId,
        confidence: 0.6,
        significance: attrs.significance,
        scope: attrs.scope,
        volatility: attrs.volatility,
        categoryLabel: attrs.categoryLabel,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        sessionId: session.sessionId,
      });
    }

    for (const resolution of this.extractErrorResolutionsRule(session)) {
      entries.push({
        id: randomUUID(),
        type: 'error_resolution',
        content: resolution.slice(0, this.config.maxEntryLength ?? 500),
        keywords: [...keywords, 'error', 'fix'],
        source: session.sessionId,
        confidence: 0.8,
        significance: 0.7,
        scope: 'knowledge',
        volatility: 'normal',
        categoryLabel: '经验教训/错误解决',
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        sessionId: session.sessionId,
      });
    }

    log.info(`Rule extraction: ${entries.length} entries from session ${session.sessionId}`);
    return entries;
  }

  // ────────── 规则提取辅助方法 ──────────

  private generateSessionSummaryRule(session: SessionMemory): string {
    const parts: string[] = [];
    if (session.userMessages.length > 0) {
      parts.push(`用户需求: ${session.userMessages[0]!.slice(0, 150)}`);
    }
    if (session.toolCalls.length > 0) {
      const toolNames = [...new Set(session.toolCalls.map((tc) => tc.name))];
      parts.push(`工具: ${toolNames.join(', ')}`);
      const filePaths = new Set<string>();
      for (const tc of session.toolCalls) {
        const p = tc.input?.['file_path'] ?? tc.input?.['path'] ?? tc.input?.['filePath'];
        if (typeof p === 'string') filePaths.add(p);
      }
      if (filePaths.size > 0) parts.push(`文件: ${[...filePaths].slice(0, 5).join(', ')}`);
      const errorCount = session.toolCalls.filter((tc) => tc.isError).length;
      if (errorCount > 0) parts.push(`错误: ${errorCount} 次`);
    }
    if (session.durationMs) parts.push(`时长: ${Math.round(session.durationMs / 1000)}s`);
    return parts.join(' | ');
  }

  private extractDecisionsRule(session: SessionMemory): string[] {
    const allText = [...session.userMessages, ...session.assistantHighlights].join('\n');
    const decisions: string[] = [];
    const zhMatches = allText.match(DECISION_PATTERNS_ZH);
    if (zhMatches) decisions.push(...zhMatches.slice(0, 3).map((m) => m.trim()));
    const enMatches = allText.match(DECISION_PATTERNS_EN);
    if (enMatches) decisions.push(...enMatches.slice(0, 3).map((m) => m.trim()));
    return decisions;
  }

  private extractToolPatternsRule(session: SessionMemory): string[] {
    const toolCounts = new Map<string, number>();
    for (const tc of session.toolCalls) {
      toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
    }
    const patterns: string[] = [];
    for (const [name, count] of toolCounts) {
      if (count >= 3) {
        const errorCount = session.toolCalls.filter((tc) => tc.name === name && tc.isError).length;
        const successRate = Math.round(((count - errorCount) / count) * 100);
        patterns.push(`工具 ${name}: 使用 ${count} 次，成功率 ${successRate}%`);
      }
    }
    return patterns;
  }

  private extractErrorResolutionsRule(session: SessionMemory): string[] {
    const resolutions: string[] = [];
    const calls = session.toolCalls;
    for (let i = 0; i < calls.length - 1; i++) {
      const cur = calls[i]!;
      const next = calls[i + 1]!;
      if (cur.isError && !next.isError && cur.name === next.name) {
        resolutions.push(
          `${cur.name} 错误: ${cur.resultSummary.slice(0, 100)} → 解决: ${next.resultSummary.slice(0, 100)}`,
        );
      }
    }
    return resolutions.slice(0, 3);
  }

  private extractSessionKeywords(session: SessionMemory): string[] {
    const keywords = new Set<string>();
    for (const tc of session.toolCalls) {
      keywords.add(tc.name.toLowerCase());
      const p = tc.input?.['file_path'] ?? tc.input?.['path'] ?? tc.input?.['filePath'];
      if (typeof p === 'string') {
        keywords.add(p);
        const parts = p.split('/');
        const fileName = parts[parts.length - 1];
        if (fileName) keywords.add(fileName.toLowerCase());
      }
    }
    for (const msg of session.userMessages.slice(0, 3)) {
      const words = msg
        .slice(0, 200)
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\-./]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      for (const word of words.slice(0, 10)) keywords.add(word);
    }
    return Array.from(keywords).slice(0, 20);
  }
}
