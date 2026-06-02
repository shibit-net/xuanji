/**
 * MemoryManager 单元测试
 *
 * 覆盖：CRUD、FTS5 搜索、关系变更、去重、推演引擎、archiveDelegate、统计
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MemoryManager } from '@/core/memory/MemoryManager';
import type { Entity, Fact, Event, Relation } from '@/core/memory/types';

// ============================================================
// Helpers
// ============================================================

function tempDbPath(): string {
  return join(tmpdir(), `xuanji-test-${randomUUID().slice(0, 8)}.db`);
}

/** 创建一个空的 MemoryManager 实例 */
async function createManager(dbPath?: string, cheapLLM?: any): Promise<MemoryManager> {
  const m = new MemoryManager(dbPath ?? tempDbPath(), cheapLLM ?? null, null);
  await m.init();
  return m;
}

// ============================================================
// Tests
// ============================================================

describe('MemoryManager', () => {
  let manager: MemoryManager;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = tempDbPath();
    manager = await createManager(dbPath);
  });

  afterEach(() => {
    try { manager.close(); } catch { /* ok */ }
    try { unlinkSync(dbPath); } catch { /* ok */ }
  });

  // ─── 初始化 & Schema ─────────────────────────────────────

  describe('init', () => {
    it('应创建核心业务表 + schema_version + FTS5 表', () => {
      const tables = manager.dbInstance.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as any[];
      const names = tables.map((t: any) => t.name);

      expect(names).toContain('entities');
      expect(names).toContain('relations');
      expect(names).toContain('relation_changes');
      expect(names).toContain('events');
      expect(names).toContain('facts');
      expect(names).toContain('episodes');
      expect(names).toContain('episode_entities');
      expect(names).toContain('schema_version');
      expect(names).toContain('memory_fts');
      // V11 新增
      expect(names).toContain('time_anchors');
      expect(names).toContain('topic_tracker');
      expect(names).toContain('user_profile');
      expect(names).toContain('behavior_patterns');
      expect(names).toContain('groups');
      expect(names).toContain('group_members');
    });

    it('schema_version 应包含 v1-v11 迁移', () => {
      const rows = manager.dbInstance.prepare(
        'SELECT version FROM schema_version ORDER BY version'
      ).all() as any[];
      const versions = rows.map((r: any) => r.version);
      // V3 已跳过，V1-V2 + V4-V11 均应存在
      for (const v of [1, 2, 4, 5, 6, 7, 8, 9, 10, 11]) {
        expect(versions).toContain(v);
      }
    });

    it('应使用 WAL 模式', () => {
      const row = manager.dbInstance.prepare('PRAGMA journal_mode').get() as any;
      expect(row.journal_mode).toBe('wal');
    });
  });

  // ─── Entity CRUD ─────────────────────────────────────────

  describe('Entity CRUD', () => {
    it('upsertEntity 应创建实体并返回完整 Entity 对象', async () => {
      const e = await manager.upsertEntity({
        name: '张三', type: 'user', summary: '测试用户',
        scene_tag: '工作', importance: 5,
      });

      expect(e.id).toBeDefined();
      expect(e.name).toBe('张三');
      expect(e.type).toBe('user');
      expect(e.summary).toBe('测试用户');
      expect(e.scene_tag).toContain('工作');
      expect(e.importance).toBe(5);
    });

    it('upsertEntity 重复调用应更新已有实体', async () => {
      const e1 = await manager.upsertEntity({ name: '李四', type: 'user', summary: 'v1' });
      const e2 = await manager.upsertEntity({ name: '李四', type: 'user', summary: 'v2' });

      expect(e2.id).toBe(e1.id);
      expect(e2.summary).toBe('v2');
      expect(e2.updated_at).toBeGreaterThan(e1.updated_at);
    });

    it('searchEntities 应支持关键字搜索', async () => {
      await manager.upsertEntity({ name: 'React', type: 'tool', summary: '前端框架' });
      await manager.upsertEntity({ name: 'Vue', type: 'tool', summary: '前端框架' });
      await manager.upsertEntity({ name: 'PostgreSQL', type: 'tool', summary: '数据库' });

      const results = await manager.searchEntities({ keyword: '前端' });
      expect(results.length).toBe(2);
      expect(results.map(r => r.name).sort()).toEqual(['React', 'Vue']);
    });

    it('searchEntities 应支持类型过滤', async () => {
      await manager.upsertEntity({ name: '张三', type: 'user', summary: '人' });
      await manager.upsertEntity({ name: 'ShiBiT', type: 'project', summary: '项目' });

      const users = await manager.searchEntities({ type: 'user' });
      expect(users.length).toBe(1);
      expect(users[0].name).toBe('张三');
    });

    it('deleteEntity 应删除实体', async () => {
      const e = await manager.upsertEntity({ name: 'tmp', type: 'concept', summary: '临时' });
      await manager.deleteEntity(e.id);
      const found = await manager.getEntity(e.id);
      expect(found).toBeNull();
    });
  });

  // ─── Fact CRUD ───────────────────────────────────────────

  describe('Fact CRUD', () => {
    it('storeFact 应存储事实', async () => {
      const f = await manager.storeFact({
        title: '用户偏好 VSCode',
        content: '用户偏好使用 VSCode 编辑器',
        source: 'user_said',
        scene_tag: '开发',
      });

      expect(f.id).toBeDefined();
      expect(f.title).toBe('用户偏好 VSCode');
      expect(f.version).toBe(1);
      expect(f.is_latest).toBe(1);
    });

    it('storeFact 重复标题应创建新版本并旧版本 is_latest=0', async () => {
      const f1 = await manager.storeFact({ title: '偏好', content: 'v1', source: 'user_said' });
      const f2 = await manager.storeFact({ title: '偏好', content: 'v2', source: 'user_correction' });

      expect(f2.version).toBe(2);

      // 旧版本应为非最新
      const old = manager.dbInstance.prepare('SELECT is_latest FROM facts WHERE id = ?').get(f1.id) as any;
      expect(old.is_latest).toBe(0);
    });

    it('searchFacts 应支持 FTS5 搜索', async () => {
      await manager.storeFact({ title: 'VSCode 偏好', content: '用户喜欢用 VSCode', source: 'user_said' });
      await manager.storeFact({ title: '主题偏好', content: '用户喜欢暗色主题', source: 'agent_discovered' });

      const results = manager.searchFacts({ keyword: 'VSCode' });
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('VSCode');
    });

    it('updateFact / rollbackFact 应正确', async () => {
      const f1 = await manager.storeFact({ title: '测试回滚', content: 'v1', source: 'manual' });
      const f2 = await manager.updateFact(f1.title, { content: 'v2' });
      expect(f2.content).toBe('v2');

      await manager.rollbackFact(f1.title, f1.version);
      const active = manager.dbInstance.prepare('SELECT * FROM facts WHERE title = ? AND is_latest = 1').get(f1.title) as any;
      expect(active).not.toBeNull();
      expect(active.version).toBe(1);
      expect(active.content).toBe('v1');
    });
  });

  // ─── Event ───────────────────────────────────────────────

  describe('Event', () => {
    it('recordEvent 应创建事件', async () => {
      const ev = await manager.recordEvent({
        entityNames: ['张三'],
        content: '张三完成了需求分析',
        importance: 4,
        scene_tag: '工作',
        operator: 'xuanji',
      });

      expect(ev.id).toBeDefined();
      expect(ev.content).toBe('张三完成了需求分析');
      expect(ev.importance).toBe(4);
      expect(ev.entity_ids).toContain(',');
    });

    it('getTimeline 应支持时间范围过滤', async () => {
      await manager.recordEvent({ entityNames: [], content: '旧事件', time: Date.now() - 100000 });
      await manager.recordEvent({ entityNames: [], content: '新事件', time: Date.now() - 100 });

      const recent = await manager.getTimeline({ from: Date.now() - 10000 });
      expect(recent.length).toBe(1);
      expect(recent[0].content).toBe('新事件');
    });

    it('handleEventFromAgent 应触发项目状态推演', async () => {
      // 先创建一个 project entity
      const proj = await manager.upsertEntity({ name: '测试项目', type: 'project', summary: '测试' });

      await manager.handleEventFromAgent({
        entityNames: ['测试项目'],
        content: '完成了需求分析，确认了所有需求',
        importance: 3,
      });

      // 应创建 project_snapshot
      const snapshots = manager.dbInstance.prepare(
        'SELECT * FROM project_snapshots WHERE project_id = ?'
      ).all(proj.id) as any[];
      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots[0].phase).toBe('设计');
    });

    it('handleEventFromAgent 应触发偏好变更推演', async () => {
      await manager.handleEventFromAgent({
        entityNames: [],
        content: '用户改用 VSCode',
        importance: 4,
        operator: 'xuanji',
      });

      // 应写入 relation_changes
      const changes = manager.dbInstance.prepare(
        "SELECT * FROM relation_changes WHERE reason LIKE '%事件推演%'"
      ).all() as any[];
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0].new_value).toBe('VSCode');
      // subject_id 应存 operator 名称（可读），非 UUID
      expect(changes[0].subject_id).toBe('xuanji');
    });
  });

  // ─── Relation ────────────────────────────────────────────

  describe('Relation', () => {
    it('relate 应创建关系', async () => {
      const rel = await manager.relate({
        subject_name: '张三', object_name: '测试项目', relation: '参与',
        strength: 4, scene_tag: '工作',
      });

      expect(rel.id).toBeDefined();
      expect(rel.relation).toBe('参与');
      expect(rel.is_active).toBe(1);
    });

    it('relate 应自动创建不存在的实体', async () => {
      await manager.relate({ subject_name: '新用户', object_name: '新项目', relation: '负责' });

      const userEntity = manager.dbInstance.prepare(
        "SELECT id FROM entities WHERE name = ?"
      ).get('新用户') as any;
      expect(userEntity).not.toBeNull();
      const user = await manager.getEntity(userEntity.id);
      expect(user).not.toBeNull();
      expect(user!.type).toBe('concept');
    });

    it('deactivateRelation 应记录变更日志（可读名称）', async () => {
      const rel = await manager.relate({ subject_name: '张三', object_name: '测试项目', relation: '参与' });

      // 获取 subject/object ID
      const sub = manager.dbInstance.prepare("SELECT id FROM entities WHERE name = '张三'").get() as any;
      const obj = manager.dbInstance.prepare("SELECT id FROM entities WHERE name = '测试项目'").get() as any;

      await manager.deactivateRelation(sub.id, obj.id, '参与', '项目结束');

      // 验证 is_active 变为 0
      const updated = manager.dbInstance.prepare('SELECT is_active FROM relations WHERE id = ?').get(rel.id) as any;
      expect(updated.is_active).toBe(0);

      // 验证 relation_changes 记录（old_value 应为名称而非 UUID）
      const changes = manager.dbInstance.prepare(
        "SELECT * FROM relation_changes WHERE relation = '参与' ORDER BY changed_at DESC LIMIT 1"
      ).get() as any;
      expect(changes).not.toBeNull();
      expect(changes.old_value).toBe('测试项目'); // 名称，非 UUID
    });

    it('getRelations 应支持方向过滤', async () => {
      await manager.relate({ subject_name: '张三', object_name: '测试项目', relation: '参与' });
      await manager.relate({ subject_name: '李四', object_name: '张三', relation: '上级' });

      const subId = (manager.dbInstance.prepare("SELECT id FROM entities WHERE name = '张三'").get() as any).id;

      const outgoing = await manager.getRelations(subId, { direction: 'outgoing' });
      expect(outgoing.length).toBe(1);

      const all = await manager.getRelations(subId, { direction: 'both' });
      expect(all.length).toBe(2);
    });
  });

  // ─── 搜索 ────────────────────────────────────────────────

  describe('search (FTS5)', () => {
    beforeEach(async () => {
      await manager.upsertEntity({ name: 'VSCode', type: 'tool', summary: '代码编辑器' });
      await manager.storeFact({ title: '编辑习惯', content: '用户使用 VSCode 进行日常开发', source: 'user_said' });
    });

    it('应跨表搜索', async () => {
      const results = await manager.search({ query: 'VSCode' });
      expect(results.length).toBeGreaterThanOrEqual(1); // at least entity found
    });

    it('应支持 source 过滤', async () => {
      const results = await manager.search({ query: 'VSCode', source: 'entity' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].source_table).toBe('entities');
    });

    it('无匹配时应返回空数组', async () => {
      const results = await manager.search({ query: 'zzzzzz_nonexistent' });
      expect(results).toEqual([]);
    });
  });

  // ─── buildContext ────────────────────────────────────────

  describe('buildContext', () => {
    it('应构建场景上下文', async () => {
      await manager.storeFact({
        title: '开发偏好', content: '使用 pnpm 管理依赖',
        source: 'user_said', scene_tag: '开发',
      });
      await manager.upsertEntity({ name: 'pnpm', type: 'tool', summary: '包管理器', scene_tag: '开发' });

      const ctx = await manager.buildContext({ scene: '开发' });
      expect(ctx).not.toBeNull();
      expect(ctx).toContain('pnpm');
    });

    it('无匹配场景时应返回 null', async () => {
      const ctx = await manager.buildContext({ scene: '不存在的场景' });
      expect(ctx).toBeNull();
    });
  });

  // ─── archiveDelegate ─────────────────────────────────────

  describe('archiveMessages', () => {
    it('应用事件形式归档消息（无 LLM 时）', async () => {
      const summary = await manager.archiveMessages([
        { role: 'user', content: '帮我写一个 API' },
        { role: 'assistant', content: '好的，这是代码...' },
      ]);

      // 应创建一个事件
      const events = await manager.getTimeline({ limit: 10 });
      expect(events.length).toBe(1);
      expect(events[0].content).toContain('会话压缩摘要');
      // 无 LLM 时返回 fallback 摘要
      expect(summary).toContain('之前对话摘要');
    });

    it('有 cheapLLM 时应用 LLM 提取并返回叙事摘要', async () => {
      const mockLLM = {
        complete: vi.fn().mockResolvedValue(JSON.stringify({
          events: [{ content: '用户请求创建一个 TestAPI 项目', entities: ['TestAPI'] }],
          facts: [{ title: 'API 需求', content: '需要 RESTful API' }],
          summary: '用户请求创建 TestAPI，助手提供了代码实现。',
        })),
      };

      const mgr = await createManager(tempDbPath(), mockLLM);
      try {
        const summary = await mgr.archiveMessages([
          { role: 'user', content: '帮我写一个 TestAPI' },
          { role: 'assistant', content: '好的' },
        ]);

        expect(mockLLM.complete).toHaveBeenCalled();

        // archiveMessages 返回 LLM 生成的叙事摘要
        expect(summary).toContain('TestAPI');

        // archiveMessages 仅处理 LLM 返回的 events 和 facts，不处理 entities
        const facts = mgr.searchFacts({ keyword: 'RESTful' });
        expect(facts.length).toBeGreaterThanOrEqual(1);

        const events = await mgr.getTimeline({ limit: 10 });
        expect(events.some(e => e.content.includes('TestAPI'))).toBe(true);
      } finally {
        mgr.close();
        try { unlinkSync((mgr as any).dbPath); } catch { /* ok */ }
      }
    });
  });

  // ─── 去重 ────────────────────────────────────────────────

  describe('去重 (recordToolCall / wasMemoryStoredRecently)', () => {
    it('相同 dedupKey 在两分钟内应被识别为重复', () => {
      manager.recordToolCall('memory_store', undefined, 'key:abc');
      expect(manager.wasMemoryStoredRecently('key:abc', 120000)).toBe(true);
    });

    it('不同 dedupKey 应不被识别为重复', () => {
      manager.recordToolCall('memory_store', undefined, 'key:abc');
      expect(manager.wasMemoryStoredRecently('key:xyz', 120000)).toBe(false);
    });

    it('仅匹配 memory_store 工具', () => {
      manager.recordToolCall('memory_search', undefined, 'key:abc');
      expect(manager.wasMemoryStoredRecently('key:abc', 120000)).toBe(false);
    });

    it('过期后应不再重复', () => {
      manager.recordToolCall('memory_store', undefined, 'key:abc');
      expect(manager.wasMemoryStoredRecently('key:abc', 0)).toBe(false);
    });
  });

  // ─── 统计 ────────────────────────────────────────────────

  describe('getStats', () => {
    it('应返回正确的计数', async () => {
      await manager.upsertEntity({ name: 'e1', type: 'user', summary: '' });
      await manager.upsertEntity({ name: 'e2', type: 'tool', summary: '' });
      await manager.storeFact({ title: 'f1', content: '', source: 'manual' });
      await manager.recordEvent({ entityNames: [], content: '事件' });

      const stats = manager.getStats();
      expect(stats.entityCount).toBeGreaterThanOrEqual(2);
      expect(stats.factCount).toBeGreaterThanOrEqual(1);
      expect(stats.eventCount).toBeGreaterThanOrEqual(1);
      expect(typeof stats.episodeCount).toBe('number');
      expect(typeof stats.dbSizeBytes).toBe('number');
      expect(stats.dbSizeBytes).toBeGreaterThan(0);
    });
  });

  // ─── 图查询 ──────────────────────────────────────────────

  describe('图查询', () => {
    it('findPaths 应找到两个实体间的路径', async () => {
      await manager.relate({ subject_name: 'A', object_name: 'B', relation: '依赖' });
      await manager.relate({ subject_name: 'B', object_name: 'C', relation: '依赖' });

      const paths = await manager.findPaths('A', 'C', 4);
      expect(paths.length).toBeGreaterThan(0);
    });

    it('getSubgraph 应返回子图', async () => {
      await manager.relate({ subject_name: '中心', object_name: '分支1', relation: '关联' });
      await manager.relate({ subject_name: '中心', object_name: '分支2', relation: '关联' });

      const sub = manager.getSubgraph('中心', 2);
      expect(sub.nodes.length).toBeGreaterThanOrEqual(3);
      expect(sub.edges.length).toBeGreaterThanOrEqual(2);
    });
  });
});
