// ============================================================
// MemoryRefiner — 记忆提炼器
// ============================================================
// 职责：
// 1. 升级：将 error_resolution 升级为 lesson_learned
// 2. 提炼：从多条相关记忆中提炼出更抽象的知识
// 3. 权重调整：根据访问频率调整记忆权重

import type { MemoryStore } from './MemoryStore.js';
import type { MemoryEntry, MemoryVolatility } from './types.js';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryRefiner' });

export interface RefinementResult {
  upgraded: number;
  refined: number;
  weightsAdjusted: number;
  duration: number;
}

/**
 * MemoryRefiner — 记忆提炼器
 */
export class MemoryRefiner {
  private store: MemoryStore;
  private subAgentFactory: SubAgentFactory | null;
  private refining = false;

  constructor(store: MemoryStore, subAgentFactory?: SubAgentFactory) {
    this.store = store;
    this.subAgentFactory = subAgentFactory || null;
  }

  async refine(options?: {
    dryRun?: boolean;
    maxUpgrades?: number;
    useLLM?: boolean;
  }): Promise<RefinementResult> {
    if (this.refining) {
      log.warn('Refinement already in progress, skipping');
      return { upgraded: 0, refined: 0, weightsAdjusted: 0, duration: 0 };
    }

    this.refining = true;
    const startTime = Date.now();
    const dryRun = options?.dryRun ?? false;
    const maxUpgrades = options?.maxUpgrades ?? 10;
    const useLLM = options?.useLLM ?? (this.subAgentFactory !== null);

    try {
      log.info(`Starting memory refinement (dryRun: ${dryRun}, maxUpgrades: ${maxUpgrades}, useLLM: ${useLLM})`);

      let upgraded = 0;
      let refined = 0;
      let weightsAdjusted = 0;

      // 如果有 LLM 支持，使用智能提炼
      if (useLLM && this.subAgentFactory) {
        refined = await this.refineWithLLM(dryRun, maxUpgrades);
      } else {
        // 否则使用规则升级
        upgraded = await this.upgradeToLessons(dryRun, maxUpgrades);
      }

      weightsAdjusted = await this.adjustWeights(dryRun);

      const duration = Date.now() - startTime;
      log.info(`Refinement completed in ${duration}ms: ${upgraded} upgraded, ${refined} refined, ${weightsAdjusted} weights adjusted`);

      return { upgraded, refined, weightsAdjusted, duration };
    } finally {
      this.refining = false;
    }
  }

  private async upgradeToLessons(dryRun: boolean, maxUpgrades: number): Promise<number> {
    const candidates = this.store.readAll({ limit: 10000 })
      .filter(m =>
        m.type === 'error_resolution' &&
        !m.obsolete &&
        m.accessCount >= 2 &&  // 降低门槛：3 → 2
        m.content.length > 50 &&
        this.hasLessonKeywords(m.content)
      )
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, maxUpgrades);

    if (candidates.length === 0) {
      log.debug('No error_resolution candidates for upgrade');
      return 0;
    }

    log.info(`Found ${candidates.length} error_resolution candidates for upgrade`);

    let upgraded = 0;
    for (const candidate of candidates) {
      const lesson = this.extractLessonFromError(candidate);

      if (lesson) {
        log.info(`Upgrading to lesson_learned: ${candidate.content.slice(0, 60)}...`);
        if (!dryRun) {
          const now = new Date().toISOString();
          const newMemory: MemoryEntry = {
            id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            type: 'lesson_learned',
            content: lesson.content,
            keywords: lesson.keywords,
            source: 'memory-refiner',
            confidence: 0.85,
            createdAt: candidate.createdAt,
            lastAccessedAt: now,
            accessCount: 0,
            category: 'lesson',
            scope: 'knowledge',
            volatility: 'normal',
            significance: 0.75,
            categoryLabel: '经验/知识库',
            lessonType: lesson.lessonType,
            problemDescription: lesson.problemDescription,
            solution: lesson.solution,
            metadata: {
              upgradedFrom: candidate.id,
              originalType: candidate.type,
            },
          };

          this.store.saveEntry(newMemory);
          this.store.updateEntry(candidate.id, { obsolete: true });
        }
        upgraded++;
      }
    }

    return upgraded;
  }

  private async adjustWeights(dryRun: boolean): Promise<number> {
    const allMemories = this.store.readAll({ limit: 10000 });
    const now = Date.now();
    let adjusted = 0;

    for (const memory of allMemories) {
      if (memory.obsolete) continue;

      const oldSignificance = memory.significance ?? 0.5;
      const newSignificance = this.calculateWeight(memory, now);

      if (Math.abs(newSignificance - oldSignificance) > 0.05) {
        log.debug(`Adjusting weight: [${memory.type}] ${memory.content.slice(0, 40)}... (${oldSignificance.toFixed(2)} → ${newSignificance.toFixed(2)})`);
        if (!dryRun) {
          this.store.updateEntry(memory.id, { significance: newSignificance });
        }
        adjusted++;
      }
    }

    return adjusted;
  }

  private calculateWeight(memory: MemoryEntry, now: number): number {
    const baseWeight = memory.significance ?? 0.5;
    const accessBonus = Math.log(memory.accessCount + 1) * 0.1;

    const ageMs = now - new Date(memory.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const halfLife = this.getHalfLife(memory.volatility);
    const timeDecay = Math.pow(0.5, ageDays / halfLife);

    const finalWeight = Math.min(1.0, baseWeight * (1 + accessBonus) * timeDecay);
    return Math.round(finalWeight * 100) / 100;
  }

  private getHalfLife(volatility?: MemoryVolatility): number {
    switch (volatility) {
      case 'permanent': return 36500;
      case 'stable': return 365;
      case 'normal': return 90;
      case 'transient': return 30;
      default: return 90;
    }
  }

  private hasLessonKeywords(content: string): boolean {
    const keywords = [
      '错误', '问题', '解决', '避免', '不该', '应该', '改进', '优化', '陷阱', '教训',
      '失败', '成功', '经验', '注意', '警告', '建议', '最佳', '实践', '模式', '方案'
    ];
    return keywords.some(kw => content.includes(kw));
  }

  private extractLessonFromError(error: MemoryEntry): {
    content: string;
    keywords: string[];
    lessonType: 'mistake' | 'improvement' | 'best_practice';
    problemDescription?: string;
    solution?: string;
  } | null {
    const parts = error.content.split('→');
    if (parts.length < 2) return null;

    const problem = parts[0]?.trim();
    const solution = parts.slice(1).join('→').trim();

    if (!problem || !solution) return null;

    const lessonType = this.inferLessonType(error.content);
    const content = `${problem.replace(/^.*错误:\s*/, '')} 的解决方案：${solution.replace(/^解决:\s*/, '')}`;

    return {
      content,
      keywords: error.keywords || [],
      lessonType,
      problemDescription: problem,
      solution,
    };
  }

  private inferLessonType(content: string): 'mistake' | 'improvement' | 'best_practice' {
    if (content.includes('错误') || content.includes('失败')) return 'mistake';
    if (content.includes('改进') || content.includes('优化')) return 'improvement';
    return 'best_practice';
  }

  /**
   * 使用 LLM 智能提炼记忆
   * 从多条相关记忆中提炼出更抽象的知识
   */
  private async refineWithLLM(dryRun: boolean, maxRefinements: number): Promise<number> {
    if (!this.subAgentFactory) {
      log.warn('SubAgentFactory not available, skipping LLM refinement');
      return 0;
    }

    log.info('Starting LLM-based memory refinement');

    // 使用 memory-refiner Agent 进行提炼
    // Agent 会自主决定处理多少记忆，使用分页机制
    const task = `Analyze and refine error_resolution memories.

**Your Task:**
1. Use memory_stats to understand the scale
2. Use memory_query with pagination to process memories in batches
3. Upgrade high-value memories to lesson_learned (up to ${maxRefinements} total)
4. Focus on high-frequency memories first (minAccessCount >= 3)
5. Process in batches of 20 memories at a time
6. Report progress and results

**Goal:** Extract general, reusable lessons from error resolutions.`;

    try {
      const result = await this.subAgentFactory.createAndRun('memory-refiner', {
        task,
        depth: 1,
        timeout: 120_000, // 2 minutes for large-scale processing
      });

      // 解析结果中的升级数量
      const upgraded = this.parseUpgradeCount(result.result);
      log.info(`LLM refinement completed: ${upgraded} memories upgraded`);

      return upgraded;
    } catch (err) {
      log.warn('LLM refinement failed:', err);
      return 0;
    }
  }

  /**
   * 解析升级数量
   */
  private parseUpgradeCount(response: string): number {
    const match = response.match(/upgraded[:\s]+(\d+)/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * 构建 LLM 提炼 Prompt
   */
  private buildRefinementPrompt(memories: MemoryEntry[]): string {
    const memoryList = memories.map((m, idx) =>
      `${idx + 1}. [${m.type}] ${m.content} (accessed: ${m.accessCount} times)`
    ).join('\n');

    return `Analyze the following memories and extract general lessons learned.

## Memories to Analyze
${memoryList}

## Task
Extract **general, reusable lessons** from these memories. Focus on:
- Common patterns across multiple memories
- Root causes rather than specific technical details
- Principles that apply to similar situations
- Mistakes to avoid or best practices to follow

## Extraction Criteria
- Only extract if there's a **clear pattern** across 2+ memories
- Lessons should be **more abstract** than the original memories
- Skip overly specific technical details
- Focus on "why" and "how to avoid"

## Output Format (JSON)
\`\`\`json
{
  "lessons": [
    {
      "lessonType": "mistake|improvement|best_practice",
      "content": "Concise lesson description (50-100 words)",
      "problemDescription": "What problem was encountered",
      "solution": "How to solve or avoid it",
      "applicableScenarios": ["scenario1", "scenario2"],
      "keywords": ["keyword1", "keyword2"],
      "sourceMemoryIds": ["id1", "id2"],
      "confidence": 0.85
    }
  ]
}
\`\`\`

If no general lessons can be extracted, return empty lessons array.`;
  }

  /**
   * 解析 LLM 提炼结果
   */
  private parseRefinementResult(response: string): {
    lessons: Array<{
      lessonType: 'mistake' | 'improvement' | 'best_practice';
      content: string;
      problemDescription?: string;
      solution?: string;
      applicableScenarios?: string[];
      keywords?: string[];
      sourceMemoryIds?: string[];
      confidence?: number;
    }>;
  } {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
        ?? response.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        return { lessons: [] };
      }

      const parsed = JSON.parse(jsonMatch[1]!);
      return {
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      };
    } catch {
      return { lessons: [] };
    }
  }

  /**
   * 保存提炼出的经验教训
   */
  private async saveLessonLearned(
    lesson: any,
    sourceMemories: MemoryEntry[]
  ): Promise<void> {
    const now = new Date().toISOString();
    const newMemory: MemoryEntry = {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: 'lesson_learned',
      content: lesson.content,
      keywords: lesson.keywords || [],
      source: 'memory-refiner-llm',
      confidence: lesson.confidence || 0.85,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      category: 'lesson',
      scope: 'knowledge',
      volatility: 'normal',
      significance: 0.8,
      categoryLabel: 'Experience/Knowledge',
      lessonType: lesson.lessonType,
      problemDescription: lesson.problemDescription,
      solution: lesson.solution,
      applicableScenarios: lesson.applicableScenarios,
      metadata: {
        refinedFrom: lesson.sourceMemoryIds || sourceMemories.map(m => m.id),
        refinementMethod: 'llm',
      },
    };

    this.store.saveEntry(newMemory);

    // 标记源记忆为已过时（可选）
    if (lesson.sourceMemoryIds) {
      for (const sourceId of lesson.sourceMemoryIds) {
        const source = sourceMemories.find(m => m.id === sourceId);
        if (source) {
          this.store.updateEntry(sourceId, { obsolete: true });
        }
      }
    }
  }
}
