/**
 * ExperienceCrystallizer — 经验结晶器
 *
 * 将多轮对话中积累的经验提炼为可复用的 Skill。
 * 设计文档引用 docs/memory-system-part-8-self-learning.md
 *
 * 工作流：
 *   对话完成 → 识别「值得提取」的模式 → LLM 提炼 → Skill 草稿 → 持久化
 */

import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ExperienceCrystallizer' });

// ─── 类型 ──────────────────────────────────────────

/** 一次对话的摘要（从 AGENT_COMPLETED 事件提取） */
export interface ConversationSnapshot {
  sessionId: string;
  /** 用户原始消息 */
  userMessage: string;
  /** Agent 最终响应摘要（由 crystallizer 提取，非原文） */
  outcomeSummary: string;
  /** 使用的工具列表 */
  toolsUsed: string[];
  /** 对话中出现的错误 */
  errors: string[];
  /** 时间戳 */
  timestamp: number;
}

/** 从多轮对话中提取的经验片段 */
export interface ExperienceFragment {
  id: string;
  /** 经验类型 */
  type: 'pattern' | 'anti_pattern' | 'workflow' | 'decision';
  /** 简短标题 */
  title: string;
  /** 触发条件（什么场景下相关） */
  trigger: string;
  /** 解决方案 / 最佳实践 */
  solution: string;
  /** 来源对话的 sessionId */
  sourceSessionId: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 出现次数（跨多次对话） */
  occurrenceCount: number;
}

/** 提炼后的 Skill 草稿 */
export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  category: 'prompt' | 'workflow';
  tags: string[];
  content: string;
  /** 来源的经验片段 */
  fromFragments: string[];
  /** 版本 */
  version: string;
  /** 状态 */
  status: 'draft' | 'refining' | 'ready';
  createdAt: string;
  updatedAt: string;
}

// ─── 主类 ──────────────────────────────────────────

export class ExperienceCrystallizer {
  /** 对话快照缓冲区（攒够 N 条后触发提炼） */
  private snapshotBuffer: ConversationSnapshot[] = [];
  /** 经验片段累积器 */
  private fragmentStore: Map<string, ExperienceFragment> = new Map();
  /** Skill 草稿 */
  private drafts: Map<string, SkillDraft> = new Map();

  /** 触发提炼的缓冲区阈值 */
  private readonly BUFFER_THRESHOLD = 3;
  /** 同一 fragment 出现多少次才值得生成 Skill */
  private readonly MIN_OCCURRENCE = 2;

  constructor(
    private cheapLLM: any,
    private baseDir: string,
  ) {}

  /**
   * 收到一个对话快照。
   * 外部调用者（SessionFactory）在 AGENT_COMPLETED 时调用此方法。
   */
  async ingest(snapshot: ConversationSnapshot): Promise<void> {
    this.snapshotBuffer.push(snapshot);
    log.debug(`Ingested snapshot ${snapshot.sessionId}, buffer: ${this.snapshotBuffer.length}`);

    // 缓冲区满，触发提炼
    if (this.snapshotBuffer.length >= this.BUFFER_THRESHOLD) {
      await this.crystallize();
    }
  }

  /**
   * 强制立即提炼（忽略缓冲区阈值）
   */
  async forceCrystallize(): Promise<SkillDraft[]> {
    if (this.snapshotBuffer.length === 0) return [];
    return this.crystallize();
  }

  /**
   * 核心提炼流程
   */
  private async crystallize(): Promise<SkillDraft[]> {
    const snapshots = this.snapshotBuffer.splice(0);
    if (snapshots.length === 0) return [];

    log.info(`Crystallizing ${snapshots.length} conversation snapshots...`);

    // Step 1: 从快照列表中提取经验片段
    const fragments = await this.extractFragments(snapshots);
    if (fragments.length === 0) {
      log.debug('No meaningful fragments extracted');
      return [];
    }

    // Step 2: 合并新片段到累积器（去重计数）
    this.mergeFragments(fragments);

    // Step 3: 找出出现次数足够多的片段，生成 Skill 草稿
    const newDrafts = await this.synthesizeDrafts();
    for (const draft of newDrafts) {
      this.drafts.set(draft.id, draft);
    }

    // Step 4: 持久化草稿
    for (const draft of newDrafts) {
      await this.persistDraft(draft);
    }

    log.info(`Crystallization complete: ${fragments.length} fragments → ${newDrafts.length} drafts`);
    return newDrafts;
  }

  /**
   * Step 1: LLM 从对话快照中提取经验片段
   */
  private async extractFragments(snapshots: ConversationSnapshot[]): Promise<ExperienceFragment[]> {
    if (!this.cheapLLM) return [];

    const prompt = `分析以下 ${snapshots.length} 条对话摘要，提取可复用的经验模式。

每条对话：
${snapshots.map((s, i) => `${i + 1}. 用户: ${s.userMessage.slice(0, 200)}
   工具: [${s.toolsUsed.join(', ')}]
   结果: ${s.outcomeSummary.slice(0, 300)}
   ${s.errors.length > 0 ? `错误: [${s.errors.join(', ')}]` : ''}`).join('\n\n')}

请提取以下类型的经验：
- **pattern**: "当用户说 X 时，应该做 Y" — 成功的操作模式
- **anti_pattern**: "不要做 Z，因为会导致 W" — 避开陷阱
- **workflow**: "完成 A 的步骤：1→2→3" — 多步工作流
- **decision**: "在 B 和 C 之间选择 C，因为..." — 技术决策

返回 JSON 数组（只返回有把握的，无则返回空数组）：
[{
  "type": "pattern|anti_pattern|workflow|decision",
  "title": "10字以内的简短标题",
  "trigger": "什么场景下触发这个经验",
  "solution": "具体做法或决策理由（50字以内）",
  "confidence": 0.8
}]`;

    try {
      const response = await this.cheapLLM.complete(prompt);
      const parsed = JSON.parse(response);
      if (!Array.isArray(parsed)) return [];

      const sourceSessionId = snapshots[0]?.sessionId || 'unknown';
      return parsed
        .filter((f: any) => f.title && f.type && f.solution)
        .map((f: any) => ({
          id: `exp-${randomUUID().slice(0, 8)}`,
          type: f.type as ExperienceFragment['type'],
          title: f.title,
          trigger: f.trigger || '',
          solution: f.solution,
          sourceSessionId,
          confidence: typeof f.confidence === 'number' ? f.confidence : 0.7,
          occurrenceCount: 1,
        }));
    } catch (err) {
      log.warn('Fragment extraction failed:', err);
      return [];
    }
  }

  /**
   * Step 2: 合并新片段到累积器
   */
  private mergeFragments(newFragments: ExperienceFragment[]): void {
    for (const frag of newFragments) {
      // 通过 title 相似度查找已有片段
      const existing = [...this.fragmentStore.values()].find(
        f => f.title === frag.title || this.similarTitle(f.title, frag.title),
      );
      if (existing) {
        existing.occurrenceCount += 1;
        // 用新数据更新 solution（取最新的）
        existing.solution = frag.solution;
        existing.confidence = Math.max(existing.confidence, frag.confidence);
      } else {
        this.fragmentStore.set(frag.id, frag);
      }
    }
    log.debug(`Fragment store: ${this.fragmentStore.size} total (after merge)`);
  }

  /**
   * 简易标题相似度检测
   */
  private similarTitle(a: string, b: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    return norm(a) === norm(b);
  }

  /**
   * Step 3: 将高频经验片段合成为 Skill 草稿
   */
  private async synthesizeDrafts(): Promise<SkillDraft[]> {
    const newDrafts: SkillDraft[] = [];

    // 按出现次数排序，取高频片段
    const sortedFragments = [...this.fragmentStore.values()]
      .filter(f => f.occurrenceCount >= this.MIN_OCCURRENCE)
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount);

    if (sortedFragments.length === 0) return [];

    // 用 LLM 将片段合成 Skill 内容
    if (this.cheapLLM) {
      // 批量合成（每次最多 5 个）
      for (let i = 0; i < sortedFragments.length; i += 5) {
        const batch = sortedFragments.slice(i, i + 5);
        try {
          const drafts = await this.synthesizeBatch(batch);
          newDrafts.push(...drafts);
        } catch (err) {
          log.warn('Draft synthesis failed for batch:', err);
          // 降级：直接生成简单草稿
          for (const f of batch) {
            newDrafts.push(this.createSimpleDraft(f));
          }
        }
      }
    } else {
      // 无 LLM 时生成简单草稿
      for (const f of sortedFragments) {
        newDrafts.push(this.createSimpleDraft(f));
      }
    }

    return newDrafts;
  }

  /**
   * LLM 批量合成 Skill 草稿
   */
  private async synthesizeBatch(fragments: ExperienceFragment[]): Promise<SkillDraft[]> {
    const prompt = `将以下经验片段合成为可复用的 Skill（技能）提示词：

${fragments.map((f, i) => `${i + 1}. [${f.type}] ${f.title}
   触发: ${f.trigger}
   做法: ${f.solution}
   出现次数: ${f.occurrenceCount}`).join('\n\n')}

以 JSON 数组返回 Skill 定义：
[{
  "name": "Skill 名称（中文，20字内）",
  "description": "一句话描述这个技能解决什么问题",
  "tags": ["标签1", "标签2"],
  "content": "提示词内容（200字内），告诉 AI 怎么做。包含：触发条件、执行步骤、注意事项"
}]`;

    const response = await this.cheapLLM.complete(prompt);
    const parsed = JSON.parse(response);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((d: any) => d.name && d.content).map((d: any) => ({
      id: `skill-${randomUUID().slice(0, 8)}`,
      name: d.name,
      description: d.description || '',
      category: 'prompt' as const,
      tags: Array.isArray(d.tags) ? d.tags : ['learned'],
      content: d.content,
      fromFragments: fragments.map(f => f.id),
      version: '0.1.0',
      status: 'draft' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  /**
   * 降级：从单个片段生成简单草稿
   */
  private createSimpleDraft(fragment: ExperienceFragment): SkillDraft {
    const content = `## 触发条件
${fragment.trigger}

## 执行方案
${fragment.solution}

## 类型
${fragment.type}

> 此 Skill 由 Xuanji 自动从 ${fragment.occurrenceCount} 次对话中提炼。`;

    return {
      id: `skill-${randomUUID().slice(0, 8)}`,
      name: fragment.title,
      description: `自动提炼的经验: ${fragment.type === 'anti_pattern' ? '避免' : '执行'} ${fragment.title}`,
      category: fragment.type === 'workflow' ? 'workflow' : 'prompt',
      tags: ['learned', fragment.type],
      content,
      fromFragments: [fragment.id],
      version: '0.1.0',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 持久化草稿到 learned/ 目录
   */
  private async persistDraft(draft: SkillDraft): Promise<void> {
    if (!this.baseDir) return;
    const dir = join(this.baseDir, 'skills', 'learned', 'drafts');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const skillJson = {
      id: draft.id,
      name: draft.name,
      version: draft.version,
      description: draft.description,
      category: draft.category,
      tags: draft.tags,
      author: 'Xuanji ExperienceCrystallizer',
      source: 'learned',
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      content: draft.content,
      fromFragments: draft.fromFragments,
      status: draft.status,
      requiredTools: [],
      enabled: false, // 草稿默认禁用，需用户确认后启用
    };

    await writeFile(join(dir, `${draft.id}.json`), JSON.stringify(skillJson, null, 2), 'utf-8');
    log.info(`Draft persisted: ${draft.id} (${draft.name})`);
  }

  /**
   * 获取所有草稿
   */
  async getDrafts(status?: 'draft' | 'refining' | 'ready'): Promise<SkillDraft[]> {
    const all = [...this.drafts.values()];
    return status ? all.filter(d => d.status === status) : all;
  }

  /**
   * 获取一个草稿
   */
  getDraft(id: string): SkillDraft | undefined {
    return this.drafts.get(id);
  }

  /**
   * 更新草稿状态
   */
  updateDraftStatus(id: string, status: SkillDraft['status']): void {
    const draft = this.drafts.get(id);
    if (draft) {
      draft.status = status;
      draft.updatedAt = new Date().toISOString();
    }
  }
}
