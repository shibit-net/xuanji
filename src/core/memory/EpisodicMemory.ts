/**
 * EpisodicMemory — 叙事记忆
 *
 * 存储完整的对话情节，支持语义搜索 + FTS5 交叉检索。
 * 设计文档：docs/memory-system-part-7-episodic.md
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '@/core/logger';
import type { SemanticIndex, SearchResult } from '@/core/memory/SemanticIndex';
import type { Episode } from '@/core/memory/types';

const log = logger.child({ module: 'EpisodicMemory' });

export class EpisodicMemory {
  constructor(
    private db: Database.Database,
    private semanticIndex?: SemanticIndex,
    private cheapLLM?: any,
  ) {}

  // ─── 搜索 ────────────────────────────────────────────────

  /**
   * 搜索叙事：语义×实体×时间 交叉评分
   */
  async search(query: string, limit: number = 10, opts?: { entityIds?: string[]; recencyBias?: number }): Promise<Episode[]> {
    const now = Date.now();
    const recencyBias = opts?.recencyBias ?? 0.3;

    // 收集候选 episode
    const candidates = new Map<string, { episode: Episode; score: number }>();

    // 来源 1: 语义搜索
    if (this.semanticIndex) {
      try {
        const semanticResults = await this.semanticIndex.searchEpisodes(query, limit * 2);
        for (const r of semanticResults) {
          candidates.set(r.sourceId, { episode: null as any, score: r.score * 0.5 });
        }
      } catch (err) {
        log.warn('Semantic episode search failed:', err);
      }
    }

    // 来源 2: FTS5 文本搜索
    try {
      const ftsResults = this.searchByFTS(query, limit * 2);
      for (const ep of ftsResults) {
        const existing = candidates.get(ep.id);
        if (existing) {
          existing.score += 0.3;
        } else {
          candidates.set(ep.id, { episode: ep, score: 0.3 });
        }
      }
    } catch { /* FTS5 可能不可用 */ }

    // 来源 3: 实体关联
    if (opts?.entityIds && opts.entityIds.length > 0) {
      const placeholders = opts.entityIds.map(() => '?').join(',');
      const rows = this.db.prepare(`
        SELECT e.*, COUNT(ee.entity_id) as entity_match_count FROM episodes e
        JOIN episode_entities ee ON e.id = ee.episode_id
        WHERE ee.entity_id IN (${placeholders})
        GROUP BY e.id
        ORDER BY entity_match_count DESC
        LIMIT ?
      `).all(...opts.entityIds, limit * 2) as any[];
      for (const row of rows) {
        const existing = candidates.get(row.id);
        const entityScore = Math.min(row.entity_match_count * 0.1, 0.2);
        if (existing) {
          existing.score += entityScore;
          existing.episode = this.rowToEpisode(row);
        } else {
          candidates.set(row.id, { episode: this.rowToEpisode(row), score: entityScore });
        }
      }
    }

    // 来源 4: 时间衰减 (recencyBias)
    for (const [id, candidate] of candidates) {
      if (!candidate.episode) {
        candidate.episode = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as any;
        if (candidate.episode) candidate.episode = this.rowToEpisode(candidate.episode);
      }
      if (candidate.episode) {
        const ageDays = (now - candidate.episode.timestamp) / (24 * 3600 * 1000);
        candidate.score += recencyBias * Math.exp(-ageDays / 30);
      }
    }

    // 按总分排序
    return Array.from(candidates.values())
      .filter(c => c.episode)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(c => c.episode);
  }

  /**
   * 按实体查找叙事
   */
  async findByEntity(entityId: string, limit: number = 10): Promise<Episode[]> {
    const rows = this.db.prepare(`
      SELECT e.* FROM episodes e
      JOIN episode_entities ee ON e.id = ee.episode_id
      WHERE ee.entity_id = ?
      ORDER BY e.timestamp DESC
      LIMIT ?
    `).all(entityId, limit) as any[];
    return rows.map((r: any) => this.rowToEpisode(r));
  }

  /**
   * 按事件 ID 查找叙事（通过 entity_ids 解析实体）
   */
  async findByEvent(eventId: string, limit: number = 10): Promise<Episode[]> {
    const event = this.db.prepare('SELECT entity_ids FROM events WHERE id = ?').get(eventId) as any;
    if (!event?.entity_ids) return [];

    const ids = event.entity_ids.split(',').filter(Boolean);
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT DISTINCT e.* FROM episodes e
      JOIN episode_entities ee ON e.id = ee.episode_id
      WHERE ee.entity_id IN (${placeholders})
      ORDER BY e.timestamp DESC
      LIMIT ?
    `).all(...ids, limit) as any[];
    return rows.map((r: any) => this.rowToEpisode(r));
  }

  // ─── 创建 ────────────────────────────────────────────────

  /**
   * 从消息列表创建叙事记忆（ContextManager 压缩时调用）
   */
  async createFromMessages(messages: any[], title?: string): Promise<Episode | null> {
    if (messages.length === 0) return null;

    const now = Date.now();
    const id = randomUUID();

    // 构建消息文本
    const parts = messages.slice(0, 30).map((m: any) => {
      const role = m.role || m.type || 'unknown';
      const content = typeof m.content === 'string' ? m.content.slice(0, 300) : JSON.stringify(m.content).slice(0, 300);
      return `[${role}]: ${content}`;
    });

    const rawText = parts.join('\n');

    // 使用 cheapLLM 生成连贯叙事摘要
    let narrative: string;
    let narrativeTitle: string;
    if (this.cheapLLM) {
      try {
        const prompt = `从以下对话片段生成一段流畅的叙事摘要（中文，200 字以内），并给出一个简短标题。
对话中涉及的事实、决策和用户偏好请保留。

对话:
${rawText.slice(0, 3000)}

返回 JSON: { "title": "标题", "narrative": "叙事摘要" }`;

        const response = await this.cheapLLM.complete(prompt);
        const parsed = JSON.parse(response);
        narrativeTitle = parsed.title || (title || `对话片段 ${new Date(now).toLocaleDateString('zh-CN')}`);
        narrative = parsed.narrative || rawText.slice(0, 500);
      } catch (err) {
        log.warn('LLM narrative generation failed, falling back to raw text:', err);
        narrative = rawText;
        narrativeTitle = title || `对话片段 ${new Date(now).toLocaleDateString('zh-CN')}`;
      }
    } else {
      narrative = rawText;
      narrativeTitle = title || `对话片段 ${new Date(now).toLocaleDateString('zh-CN')}`;
    }

    // 提取实体名称（简单关键词匹配）
    const entityNames = this.extractEntityNames(narrative);

    // 写入数据库
    this.db.prepare(`
      INSERT INTO episodes (id, timestamp, title, narrative, scene_tag, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', ?, ?, ?)
    `).run(id, now, narrativeTitle, narrative, 2, now, now);

    // 关联实体
    for (const ename of entityNames) {
      const entity = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(ename) as any;
      if (entity) {
        this.db.prepare(`
          INSERT OR IGNORE INTO episode_entities (episode_id, entity_id) VALUES (?, ?)
        `).run(id, entity.id);
      }
    }

    // 索引到语义搜索
    if (this.semanticIndex) {
      try {
        await this.semanticIndex.indexEpisode(id, narrative);
      } catch (err) {
        log.warn('Failed to index episode:', err);
      }
    }

    return this.getById(id);
  }

  /**
   * 从任务序列创建叙事记忆
   */
  async createFromTaskSequence(tasks: any[], title?: string): Promise<Episode | null> {
    if (tasks.length === 0) return null;

    const now = Date.now();
    const id = randomUUID();

    const parts = tasks.map((t: any) => {
      const status = t.status || 'unknown';
      const desc = t.description || t.subject || t.name || 'unknown task';
      return `[${status}] ${desc}${t.result ? ` → ${t.result}` : ''}`;
    });

    const narrative = parts.join('\n');
    const narrativeTitle = title || `任务执行记录 ${new Date(now).toLocaleDateString('zh-CN')}`;

    this.db.prepare(`
      INSERT INTO episodes (id, timestamp, title, narrative, scene_tag, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 3, ?, ?)
    `).run(id, now, narrativeTitle, narrative, now, now);

    if (this.semanticIndex) {
      try {
        await this.semanticIndex.indexEpisode(id, narrative);
      } catch (err) {
        log.warn('Failed to index episode:', err);
      }
    }

    return this.getById(id);
  }

  /**
   * 从学习输入创建叙事记忆
   */
  async createFromLearning(input: {
    title: string;
    narrative: string;
    participants?: string[];
    scene_tag?: string;
    importance?: number;
  }): Promise<Episode | null> {
    const now = Date.now();
    const id = randomUUID();

    const narrative = input.narrative;
    const title = input.title.slice(0, 100);
    const sceneTag = input.scene_tag || '';
    const importance = input.importance ?? 4;

    this.db.prepare(`
      INSERT INTO episodes (id, timestamp, title, narrative, scene_tag, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, now, title, narrative, sceneTag, importance, now, now);

    // 关联参与者实体
    if (input.participants && input.participants.length > 0) {
      for (const pname of input.participants) {
        const entity = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(pname) as any;
        if (entity) {
          this.db.prepare(`
            INSERT OR IGNORE INTO episode_entities (episode_id, entity_id) VALUES (?, ?)
          `).run(id, entity.id);
        }
      }
    }

    if (this.semanticIndex) {
      try {
        await this.semanticIndex.indexEpisode(id, narrative);
      } catch (err) {
        log.warn('Failed to index episode:', err);
      }
    }

    return this.getById(id);
  }

  // ─── CRUD ────────────────────────────────────────────────

  async getById(id: string): Promise<Episode | null> {
    const row = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as any;
    return row ? this.rowToEpisode(row) : null;
  }

  async listByTime(limit: number = 20, offset: number = 0): Promise<Episode[]> {
    const rows = this.db.prepare(
      'SELECT * FROM episodes ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as any[];
    return rows.map((r: any) => this.rowToEpisode(r));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
  }

  // ─── 内部方法 ────────────────────────────────────────────

  private searchByFTS(query: string, limit: number): Episode[] {
    const sanitized = query
      .replace(/['"]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => `"${w}"`)
      .join(' AND ');

    if (!sanitized) return [];

    try {
      const rows = this.db.prepare(`
        SELECT episodes.* FROM episodes
        JOIN memory_fts ON memory_fts.source_id = episodes.id AND memory_fts.source_table = 'episodes'
        WHERE memory_fts.content MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(sanitized, limit) as any[];
      return rows.map((r: any) => this.rowToEpisode(r));
    } catch {
      // FTS5 未覆盖 episodes 时降级到 LIKE
      const likePattern = `%${query}%`;
      const rows = this.db.prepare(
        'SELECT * FROM episodes WHERE title LIKE ? OR narrative LIKE ? ORDER BY timestamp DESC LIMIT ?'
      ).all(likePattern, likePattern, limit) as any[];
      return rows.map((r: any) => this.rowToEpisode(r));
    }
  }

  private hydrateEpisodes(semanticResults: SearchResult[]): Episode[] {
    const episodes: Episode[] = [];
    for (const result of semanticResults) {
      const episode = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(result.sourceId) as any;
      if (episode) {
        episodes.push(this.rowToEpisode(episode));
      }
    }
    return episodes;
  }

  /**
   * 简单实体名称提取（基于中文分词关键词匹配）
   */
  private extractEntityNames(text: string): string[] {
    const names: string[] = [];
    const allEntities = this.db.prepare('SELECT name FROM entities').all() as any[];
    for (const entity of allEntities) {
      if (text.includes(entity.name) && entity.name.length >= 2) {
        names.push(entity.name);
      }
    }
    return names;
  }

  private rowToEpisode(row: any): Episode {
    return {
      id: row.id,
      timestamp: row.timestamp,
      title: row.title,
      narrative: row.narrative,
      scene_tag: row.scene_tag ?? '',
      importance: row.importance ?? 3,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
