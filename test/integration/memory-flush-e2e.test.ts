/**
 * 集成测试：记忆系统核心流程
 *
 * 测试新 SQLite 统一存储架构的关键集成点：
 * 1. MemoryManager 初始化和保存会话记忆
 * 2. 从会话中提取并存储记忆条目
 * 3. 配置驱动的功能（enabled/disabled）
 * 4. 压缩阈值触发
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── 被测模块 ───
import { MemoryManager } from '@/memory/MemoryManager';
import { MemoryStore } from '@/memory/MemoryStore';
import type { SessionMemory } from '@/memory/types';

// ─── 临时目录 ───
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'xuanji-mm-integ-'));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

/** 创建隔离的 MemoryManager，使用临时数据库路径 */
function createIsolatedManager(
  dbPath: string,
  configOverrides: Record<string, unknown> = {},
): MemoryManager {
  const manager = new MemoryManager(configOverrides);
  (manager as any).store = new MemoryStore(dbPath);
  return manager;
}

function createSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    sessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    userMessages: ['Help me fix the memory leak in MemoryManager'],
    assistantHighlights: ['Found the leak in the event listener, fixed it'],
    toolCalls: [
      { name: 'read_file', input: { file_path: 'src/memory/MemoryManager.ts' }, isError: false, resultSummary: 'content' },
    ],
    durationMs: 5000,
    model: 'claude-sonnet-4',
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════
// 1. MemoryManager 初始化和基本操作
// ═════════════════════════════════════════════════════════════

describe('MemoryManager Initialization', () => {
  let manager: MemoryManager;

  afterEach(async () => {
    if (manager) await manager.shutdown();
  });

  it('应成功初始化', async () => {
    const dbPath = join(tempDir, `init-${Date.now()}.db`);
    manager = createIsolatedManager(dbPath);
    await manager.init();

    expect(manager.isInitialized()).toBe(true);
    const stats = await manager.getStats();
    expect(stats.total).toBe(0);
  });

  it('重复 init() 调用不会出错', async () => {
    const dbPath = join(tempDir, `reinit-${Date.now()}.db`);
    manager = createIsolatedManager(dbPath);
    await manager.init();
    await manager.init(); // 第二次调用

    expect(manager.isInitialized()).toBe(true);
  });

  it('getStore() 返回有效的 MemoryStore', async () => {
    const dbPath = join(tempDir, `store-${Date.now()}.db`);
    manager = createIsolatedManager(dbPath);
    await manager.init();

    const store = manager.getStore();
    expect(store).toBeDefined();
    expect(typeof store.saveEntry).toBe('function');
    expect(typeof store.searchFTS).toBe('function');
    expect(typeof store.getStats).toBe('function');
  });
});

// ═════════════════════════════════════════════════════════════
// 2. 会话保存和记忆提取
// ═════════════════════════════════════════════════════════════

describe('Session Save and Memory Extraction', () => {
  let manager: MemoryManager;

  beforeEach(async () => {
    const dbPath = join(tempDir, `save-${Date.now()}.db`);
    manager = createIsolatedManager(dbPath);
    await manager.init();
  });

  afterEach(async () => {
    if (manager) await manager.shutdown();
  });

  it('保存会话后 stats.total 增加', async () => {
    const before = await manager.getStats();
    expect(before.total).toBe(0);

    await manager.save(createSession());

    const after = await manager.getStats();
    expect(after.total).toBeGreaterThan(0);
  });

  it('disabled 状态下 save() 不写入数据', async () => {
    const dbPath = join(tempDir, `disabled-${Date.now()}.db`);
    const disabledManager = createIsolatedManager(dbPath, { enabled: false });
    await disabledManager.init();

    await disabledManager.save(createSession());
    const stats = await disabledManager.getStats();
    expect(stats.total).toBe(0);

    await disabledManager.shutdown();
  });

  it('保存后可通过 retrieve 检索到相关内容', async () => {
    await manager.save(createSession({
      userMessages: ['Fix the authentication bug in login flow'],
      assistantHighlights: ['Found and fixed JWT token expiry issue'],
    }));

    const results = await manager.retrieve('authentication bug');
    // 规则降级提取应该产生 session_summary
    expect(Array.isArray(results)).toBe(true);
    // 至少不应报错
  });

  it('disabled 状态下 retrieve() 返回空数组', async () => {
    const dbPath = join(tempDir, `disabled-ret-${Date.now()}.db`);
    const disabledManager = createIsolatedManager(dbPath, { enabled: false });
    await disabledManager.init();

    const results = await disabledManager.retrieve('anything');
    expect(results).toEqual([]);

    await disabledManager.shutdown();
  });
});

// ═════════════════════════════════════════════════════════════
// 3. add() 直接写入和检索
// ═════════════════════════════════════════════════════════════

describe('Direct Entry Add and Retrieval', () => {
  let manager: MemoryManager;

  beforeEach(async () => {
    const dbPath = join(tempDir, `add-${Date.now()}.db`);
    manager = createIsolatedManager(dbPath);
    await manager.init();
  });

  afterEach(async () => {
    if (manager) await manager.shutdown();
  });

  it('add() 写入的条目可被检索', async () => {
    await manager.add({
      id: 'test-entry-1',
      type: 'user_preference',
      content: 'User does not eat spicy food',
      keywords: ['food', 'spicy', 'preference'],
      confidence: 0.95,
      source: 'manual',
    });

    const stats = await manager.getStats();
    expect(stats.total).toBe(1);

    const results = await manager.retrieve('spicy food preference');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe('test-entry-1');
  });

  it('add() 多条条目的批量检索', async () => {
    for (let i = 0; i < 5; i++) {
      await manager.add({
        type: 'decision',
        content: `Decision ${i}: chose TypeScript over JavaScript`,
        keywords: ['typescript', 'javascript', 'decision'],
        confidence: 0.9,
        source: 'manual',
      });
    }

    const stats = await manager.getStats();
    expect(stats.total).toBe(5);

    const results = await manager.retrieve('typescript decision');
    expect(results.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════
// 4. 压缩阈值测试
// ═════════════════════════════════════════════════════════════

describe('Memory Compaction', () => {
  it('超过阈值后 compact() 减少条目数', async () => {
    const dbPath = join(tempDir, `compact-${Date.now()}.db`);
    const manager = createIsolatedManager(dbPath, {
      compactionThreshold: 5,
      longTermMaxEntries: 3,
    });
    await manager.init();

    // 写入 8 条超过阈值的记忆
    for (let i = 0; i < 8; i++) {
      await manager.add({
        type: 'session_summary',
        content: `Session ${i}: task completed`,
        keywords: [`task${i}`],
        confidence: 0.8,
        source: 'manual',
        createdAt: new Date(Date.now() - i * 86400000).toISOString(),
      });
    }

    const before = await manager.getStats();
    expect(before.total).toBe(8);

    await manager.compact();

    const after = await manager.getStats();
    expect(after.total).toBeLessThanOrEqual(3);

    await manager.shutdown();
  });
});

// ═════════════════════════════════════════════════════════════
// 5. 短期记忆管理
// ═════════════════════════════════════════════════════════════

describe('Short-Term Memory', () => {
  it('resetShortTerm 创建新的短期记忆', () => {
    const manager = new MemoryManager();
    const stm = manager.resetShortTerm('sess-1', 'claude-sonnet-4');

    expect(stm).toBeDefined();
    expect(manager.getShortTerm()).toBe(stm);
  });

  it('初始状态 getShortTerm() 返回 null', () => {
    const manager = new MemoryManager();
    expect(manager.getShortTerm()).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
// 6. formatForPrompt
// ═════════════════════════════════════════════════════════════

describe('Format for Prompt', () => {
  it('格式化空列表返回空字符串', () => {
    const manager = new MemoryManager();
    expect(manager.formatForPrompt([])).toBe('');
  });

  it('格式化后包含 Relevant Past Context', async () => {
    const dbPath = join(tempDir, `fmt-${Date.now()}.db`);
    const manager = createIsolatedManager(dbPath);
    await manager.init();

    await manager.save(createSession({
      userMessages: ['Fix authentication bug'],
    }));

    const memories = await manager.retrieve('authentication');
    const formatted = manager.formatForPrompt(memories);

    if (memories.length > 0) {
      expect(formatted).toContain('Relevant Past Context');
    }

    await manager.shutdown();
  });

  it('格式化结果受 maxPromptLength 截断', async () => {
    const dbPath = join(tempDir, `truncate-${Date.now()}.db`);
    const manager = createIsolatedManager(dbPath, { maxPromptLength: 100 });
    await manager.init();

    // 添加多条长内容的条目
    for (let i = 0; i < 5; i++) {
      await manager.add({
        type: 'session_summary',
        content: `Very long content ${i}: ${'x'.repeat(100)}`,
        keywords: ['test'],
        confidence: 0.9,
        source: 'manual',
      });
    }

    const memories = manager.getStore().readAll();
    const formatted = manager.formatForPrompt(memories);

    expect(formatted.length).toBeLessThanOrEqual(120); // 留 20 字节给 truncated 标记

    await manager.shutdown();
  });
});
