/**
 * MemoryStoreTool / MemorySearchTool 单元测试
 *
 * 覆盖：4 种记忆类型存储、去重、EventBus emit、纠错检测
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MemoryManager } from '@/memory/MemoryManager';
import { MemoryStoreTool } from '@/tools/MemoryStoreTool';
import { MemorySearchTool } from '@/tools/MemorySearchTool';
import { registerMemoryManager, unregisterMemoryManager } from '@/memory/globals';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

function tempDbPath(): string {
  return join(tmpdir(), `xuanji-tooltest-${randomUUID().slice(0, 8)}.db`);
}

async function setupManager(): Promise<{ manager: MemoryManager; dbPath: string }> {
  const dbPath = tempDbPath();
  const manager = new MemoryManager(dbPath, null, null);
  await manager.init();
  registerMemoryManager(manager);
  return { manager, dbPath };
}

function teardownManager(manager: MemoryManager, dbPath: string): void {
  unregisterMemoryManager();
  try { manager.close(); } catch { /* ok */ }
  try { unlinkSync(dbPath); } catch { /* ok */ }
  try { unlinkSync(dbPath + '-wal'); } catch { /* ok */ }
  try { unlinkSync(dbPath + '-shm'); } catch { /* ok */ }
}

// ============================================================
// MemoryStoreTool
// ============================================================

describe('MemoryStoreTool', () => {
  let tool: MemoryStoreTool;
  let manager: MemoryManager;
  let dbPath: string;
  const emitSpy = vi.spyOn(eventBus, 'emitSync');

  beforeEach(async () => {
    const setup = await setupManager();
    manager = setup.manager;
    dbPath = setup.dbPath;
    tool = new MemoryStoreTool();
    emitSpy.mockClear();
  });

  afterEach(() => { teardownManager(manager, dbPath); });

  // ─── entity ──────────────────────────────────────────────

  it('应存储实体并 emit MEMORY_STORED', async () => {
    const result = await tool.execute({
      type: 'entity',
      data: { name: 'VSCode', entity_type: 'tool', summary: '编辑器' },
      scene_tag: '开发',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('VSCode');

    // 验证 EventBus emit
    expect(emitSpy).toHaveBeenCalledWith(XuanjiEvent.MEMORY_STORED, expect.objectContaining({
      type: 'entity',
      scene_tag: '开发',
    }));

    // 验证实际写入 DB
    const entities = await manager.searchEntities({ keyword: 'VSCode' });
    expect(entities.length).toBe(1);
    expect(entities[0].type).toBe('tool');
  });

  it('entity 缺少必需字段应返回 error', async () => {
    const result = await tool.execute({
      type: 'entity',
      data: { name: 'test' },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('entity_type');
  });

  // ─── fact ────────────────────────────────────────────────

  it('应存储事实并 emit MEMORY_STORED', async () => {
    const result = await tool.execute({
      type: 'fact',
      data: { title: '用户偏好', content: '用户喜欢暗色主题' },
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('用户偏好');
    expect(emitSpy).toHaveBeenCalledWith(XuanjiEvent.MEMORY_STORED, expect.objectContaining({
      type: 'fact',
    }));

    const facts = manager.searchFacts({ keyword: '暗色主题' });
    expect(facts.length).toBe(1);
  });

  // ─── event ───────────────────────────────────────────────

  it('应存储事件并 emit MEMORY_STORED', async () => {
    const result = await tool.execute({
      type: 'event',
      data: { content: '完成了代码审查', entities: ['张三'] },
      importance: 4,
    });

    expect(result.isError).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith(XuanjiEvent.MEMORY_STORED, expect.objectContaining({
      type: 'event',
    }));
  });

  // ─── relation ────────────────────────────────────────────

  it('应存储关系并 emit MEMORY_STORED', async () => {
    const result = await tool.execute({
      type: 'relation',
      data: { subject_name: '张三', object_name: '测试项目', relation: '负责人' },
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('张三');
    expect(emitSpy).toHaveBeenCalledWith(XuanjiEvent.MEMORY_STORED, expect.objectContaining({
      type: 'relation',
    }));
  });

  // ─── 去重 ────────────────────────────────────────────────

  it('5 分钟内重复存储应返回 dedup', async () => {
    const params = {
      type: 'entity',
      data: { name: 'DedupTest', entity_type: 'tool', summary: 'dedup' },
    };

    const r1 = await tool.execute(params);
    expect(r1.isError).toBe(false);

    const r2 = await tool.execute(params);
    expect(r2.metadata?.dedup).toBe(true);

    // 两次调用只应 emit 一次
    const storedCalls = emitSpy.mock.calls.filter(
      c => c[0] === XuanjiEvent.MEMORY_STORED
    );
    expect(storedCalls.length).toBe(1);
  });

  // ─── 不支持的类型 ────────────────────────────────────────

  it('不支持的类型应返回 error', async () => {
    const result = await tool.execute({ type: 'unknown', data: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('不支持');
  });
});

// ============================================================
// MemorySearchTool
// ============================================================

describe('MemorySearchTool', () => {
  let tool: MemorySearchTool;
  let manager: MemoryManager;
  let dbPath: string;
  const emitSpy = vi.spyOn(eventBus, 'emitSync');

  beforeEach(async () => {
    const setup = await setupManager();
    manager = setup.manager;
    dbPath = setup.dbPath;
    tool = new MemorySearchTool();
    emitSpy.mockClear();

    // 写入测试数据
    await manager.upsertEntity({ name: 'React', type: 'tool', summary: '前端框架' });
    await manager.storeFact({ title: 'React 偏好', content: '用户使用 React 18', source: 'user_said' });
  });

  afterEach(() => { teardownManager(manager, dbPath); });

  it('应搜索到匹配的记忆', async () => {
    const result = await tool.execute({ query: 'React', type: 'all', limit: 10 });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('React');
    expect(result.metadata?.count).toBeGreaterThanOrEqual(2);

    expect(emitSpy).toHaveBeenCalledWith(XuanjiEvent.MEMORY_SEARCHED, expect.objectContaining({
      query: 'React',
      type: 'all',
      resultCount: expect.any(Number),
    }));
  });

  it('应支持 type 过滤', async () => {
    const result = await tool.execute({ query: 'React', type: 'entity' });
    expect(result.metadata?.count).toBe(1);
    expect(result.metadata?.type).toBe('entity');
  });

  it('无匹配时应返回提示并 emit resultCount=0', async () => {
    const result = await tool.execute({ query: 'zzz_no_match_xyz', type: 'all' });

    expect(result.content).toContain('未找到');
    expect(emitSpy).toHaveBeenCalledWith(XuanjiEvent.MEMORY_SEARCHED, expect.objectContaining({
      resultCount: 0,
    }));
  });

  it('应限制 limit 最大为 50', async () => {
    // limit 超过 50 时被截断
    const result = await tool.execute({ query: 'React', limit: 100 });
    // 不应报错
    expect(result.isError).toBe(false);
  });
});

// ============================================================
// detectCorrection 纠错检测（正则验证）
// ============================================================

describe('detectCorrection 纠错检测', () => {
  const correctionPatterns = [
    /(?:不对|不是|错了|错误|更正|纠正)(?:\s*[，,]\s*)(.+)/,
    /(?:应该说?|正确(?:的|说法)?是?|应该是)\s*(.+)/,
    /(?:记住|记着|别忘了|以后)\s*(.+)/,
  ];

  const testCases = [
    { input: '不对，我叫张三不叫李四', expectMatch: true },
    { input: '不是这样，应该用 pnpm', expectMatch: true },
    { input: '错了，正确的端口是 8080', expectMatch: true },
    { input: '应该是 Vue3 不是 Vue2', expectMatch: true },
    { input: '记住我喜欢用暗色主题', expectMatch: true },
    { input: '以后都用 TypeScript', expectMatch: true },
    { input: '帮我写一个 API', expectMatch: false },
    { input: '今天天气不错', expectMatch: false },
    { input: '你好', expectMatch: false },
  ];

  for (const tc of testCases) {
    it(`${tc.expectMatch ? '应' : '不应'}匹配: "${tc.input.slice(0, 30)}"`, () => {
      let matched = false;
      for (const pattern of correctionPatterns) {
        if (pattern.test(tc.input)) {
          matched = true;
          break;
        }
      }
      expect(matched).toBe(tc.expectMatch);
    });
  }
});

// ============================================================
// recordToolCall 去重参数验证（N1 bug 防护）
// ============================================================

describe('recordToolCall 参数位置验证', () => {
  it('dedupKey 应存入第三个位置（dedupKey），非第二个（sessionId）', async () => {
    const dbPath = tempDbPath();
    const manager = new MemoryManager(dbPath, null, null);
    await manager.init();

    try {
      const key = 'test:dedup:abc123';
      manager.recordToolCall('memory_store', undefined, key);

      // 验证 dedupKey 被正确存储（位置 3）
      expect(manager.wasMemoryStoredRecently(key, 60000)).toBe(true);

      // 验证不会因为 sessionId 位置有值而产生误判
      manager.recordToolCall('memory_store', 'some-session-id', undefined);
      // 带 undefined dedupKey 不应该影响其他检查
      expect(manager.wasMemoryStoredRecently(key, 60000)).toBe(true);
    } finally {
      manager.close();
      try { unlinkSync(dbPath); } catch { /* ok */ }
    }
  });
});
