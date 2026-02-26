// ============================================================
// LongTermMemory 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { LongTermMemory } from '@/memory/LongTermMemory';
import { StorageBackend } from '@/memory/StorageBackend';
import type { MemoryEntry } from '@/memory/types';
import { randomUUID } from 'node:crypto';

function createEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    type: 'project_fact',
    content: 'test content',
    keywords: ['test'],
    source: 'test',
    confidence: 0.8,
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...overrides,
  };
}

/**
 * 创建隔离的 LongTermMemory 实例
 * 通过 mock 全局目录避免使用 ~/.xuanji/memory/
 */
function createIsolatedLTM(globalDir: string, projectDir: string) {
  const storage = new StorageBackend();
  // 使用 projectRoot 参数创建 LTM，但需要 hack 全局目录
  // LongTermMemory 使用 homedir() 作为全局目录，我们通过子类化来覆盖
  const ltm = new LongTermMemory(projectDir, {}, storage);
  // 覆盖私有属性以实现测试隔离
  ltm['globalDir'] = globalDir;
  return ltm;
}

describe('LongTermMemory', () => {
  let tempGlobalDir: string;
  let tempProjectDir: string;

  beforeEach(async () => {
    tempGlobalDir = await mkdtemp(join(tmpdir(), 'xuanji-ltm-global-'));
    tempProjectDir = await mkdtemp(join(tmpdir(), 'xuanji-ltm-project-'));
  });

  afterEach(async () => {
    for (const dir of [tempGlobalDir, tempProjectDir]) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('should save global entries', async () => {
    const ltm = createIsolatedLTM(tempGlobalDir, tempProjectDir);
    const entry = createEntry({ type: 'session_summary' });
    await ltm.save(entry);

    const results = await ltm.readGlobal();
    expect(results).toHaveLength(1);
  });

  it('should save project entries when projectPath is set', async () => {
    const ltm = createIsolatedLTM(tempGlobalDir, tempProjectDir);
    const entry = createEntry({ type: 'project_fact', projectPath: tempProjectDir });
    await ltm.save(entry);

    const results = await ltm.readProject();
    expect(results).toHaveLength(1);
  });

  it('should route types to correct files', async () => {
    const ltm = createIsolatedLTM(tempGlobalDir, tempProjectDir);

    await ltm.save(createEntry({ type: 'session_summary' }));
    await ltm.save(createEntry({ type: 'decision' }));
    await ltm.save(createEntry({ type: 'tool_pattern' }));

    const all = await ltm.readGlobal();
    expect(all).toHaveLength(3);
  });

  it('should batch save entries', async () => {
    const ltm = createIsolatedLTM(tempGlobalDir, tempProjectDir);
    const entries = [
      createEntry({ type: 'project_fact' }),
      createEntry({ type: 'decision' }),
      createEntry({ type: 'session_summary' }),
    ];

    await ltm.saveBatch(entries);
    const all = await ltm.readGlobal();
    expect(all).toHaveLength(3);
  });

  it('should merge global and project entries in readAll', async () => {
    const ltm = createIsolatedLTM(tempGlobalDir, tempProjectDir);

    await ltm.save(createEntry({ type: 'project_fact' })); // global
    await ltm.save(createEntry({ type: 'project_fact', projectPath: tempProjectDir })); // project

    const all = await ltm.readAll();
    expect(all).toHaveLength(2);
  });

  it('should respect limit in readAll', async () => {
    const ltm = createIsolatedLTM(tempGlobalDir, tempProjectDir);

    for (let i = 0; i < 10; i++) {
      await ltm.save(createEntry());
    }

    const limited = await ltm.readAll(3);
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it('should replaceAll for global scope', async () => {
    const ltm = createIsolatedLTM(tempGlobalDir, tempProjectDir);

    // 保存初始数据
    await ltm.save(createEntry({ type: 'project_fact' }));
    await ltm.save(createEntry({ type: 'project_fact' }));

    // 覆盖
    const newEntries = [createEntry({ type: 'project_fact', content: 'replaced' })];
    await ltm.replaceAll('global', newEntries);

    const results = await ltm.readGlobal();
    const factResults = results.filter((e) => e.type === 'project_fact');
    expect(factResults).toHaveLength(1);
    expect(factResults[0]?.content).toBe('replaced');
  });

  it('should handle non-existent project dir gracefully', async () => {
    const ltm = createIsolatedLTM(tempGlobalDir, '');
    // 覆盖私有属性
    ltm['projectDir'] = null;
    const results = await ltm.readProject();
    expect(results).toEqual([]);
  });
});
