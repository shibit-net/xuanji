// ============================================================
// MemoryManager 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { MemoryManager } from '@/memory/MemoryManager';
import { MemoryStore } from '@/memory/MemoryStore';
import type { SessionMemory } from '@/memory/types';

function createSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    sessionId: `sess-${Date.now()}`,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    userMessages: ['Fix the memory leak'],
    assistantHighlights: ['Found and fixed the issue'],
    toolCalls: [
      { name: 'read_file', input: { file_path: 'src/memory/MemoryManager.ts' }, isError: false, resultSummary: 'content' },
    ],
    durationMs: 5000,
    model: 'claude-sonnet-4',
    ...overrides,
  };
}

/**
 * 创建隔离的 MemoryManager，使用临时数据库路径
 */
function createIsolatedManager(
  dbPath: string,
  projectDir: string,
  configOverrides: Record<string, unknown> = {},
): MemoryManager {
  const manager = new MemoryManager(configOverrides, projectDir);
  // 覆盖 store 的数据库路径实现测试隔离
  (manager as any).store = new MemoryStore(dbPath);
  return manager;
}

describe('MemoryManager', () => {
  let tempDir: string;
  let tempProjectDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-mm-'));
    tempProjectDir = await mkdtemp(join(tmpdir(), 'xuanji-mm-project-'));
  });

  afterEach(async () => {
    for (const dir of [tempDir, tempProjectDir]) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('should initialize successfully', async () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir);
    await manager.init();

    expect(manager.isInitialized()).toBe(true);
    const stats = await manager.getStats();
    expect(stats.total).toBe(0);
  });

  it('should save and retrieve session memory', async () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir);
    await manager.init();

    const session = createSession();
    await manager.save(session);

    const stats = await manager.getStats();
    expect(stats.total).toBeGreaterThan(0);

    // 检索相关记忆
    const results = await manager.retrieve('memory leak');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should format memories for prompt', async () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir);
    await manager.init();

    const session = createSession();
    await manager.save(session);

    const memories = await manager.retrieve('memory');
    const formatted = manager.formatForPrompt(memories);

    expect(formatted).toContain('### Relevant Past Context');
  });

  it('should return empty for disabled memory', async () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir, { enabled: false });
    await manager.init();

    const session = createSession();
    await manager.save(session);

    const results = await manager.retrieve('test');
    expect(results).toEqual([]);
  });

  it('should handle empty format', () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir);
    const formatted = manager.formatForPrompt([]);
    expect(formatted).toBe('');
  });

  it('should truncate formatted prompt to max length', async () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir, { maxPromptLength: 100 });
    await manager.init();

    // 保存多个会话
    for (let i = 0; i < 5; i++) {
      await manager.save(createSession({
        sessionId: `sess-${i}`,
        userMessages: [`Long user message ${i} with lots of content about TypeScript memory system`],
      }));
    }

    const memories = await manager.retrieve('TypeScript memory');
    const formatted = manager.formatForPrompt(memories);

    expect(formatted.length).toBeLessThanOrEqual(120);
  });

  it('should reset short term memory', () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir);

    expect(manager.getShortTerm()).toBeNull();

    const stm = manager.resetShortTerm('sess-1', 'claude-sonnet-4');
    expect(stm).toBeDefined();
    expect(manager.getShortTerm()).toBe(stm);
  });

  it('should compact when threshold exceeded', async () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir, {
      compactionThreshold: 5,
      longTermMaxEntries: 10,
    });
    await manager.init();

    // 保存足够多的会话触发压缩
    for (let i = 0; i < 10; i++) {
      await manager.save(createSession({
        sessionId: `sess-${i}`,
        userMessages: [`Task ${i}: implement feature`],
        toolCalls: [
          { name: 'read_file', input: {}, isError: false, resultSummary: 'ok' },
          { name: 'read_file', input: {}, isError: false, resultSummary: 'ok' },
          { name: 'read_file', input: {}, isError: false, resultSummary: 'ok' },
          { name: 'edit_file', input: {}, isError: true, resultSummary: 'error' },
          { name: 'edit_file', input: {}, isError: false, resultSummary: 'ok' },
        ],
      }));
    }

    // 压缩后条目数应受限
    const stats = await manager.getStats();
    expect(stats.total).toBeLessThanOrEqual(20);
  });

  it('should expose getStore()', async () => {
    const dbPath = join(tempDir, 'memory.db');
    const manager = createIsolatedManager(dbPath, tempProjectDir);
    await manager.init();

    const store = manager.getStore();
    expect(store).toBeDefined();
    expect(typeof store.saveEntry).toBe('function');
    expect(typeof store.searchFTS).toBe('function');
  });
});
