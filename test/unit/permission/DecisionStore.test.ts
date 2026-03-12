import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DecisionStore } from '@/permission/DecisionStore';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('DecisionStore', () => {
  let tempDir: string;
  let store: DecisionStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-decision-test-'));
    store = new DecisionStore(join(tempDir, 'decisions.json'));
  });

  afterEach(async () => {
    // 等待异步 save 完成后再清理
    await new Promise(r => setTimeout(r, 300));
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('不存在文件时应正常加载（空）', async () => {
      await store.load();
      expect(store.isLoaded()).toBe(true);
      expect(store.get('nonexistent')).toBeUndefined();
    });
  });

  describe('set / get', () => {
    it('应保存和读取决策', async () => {
      await store.load();
      await store.set('fileWrite:test.ts', true, 'write_file');
      expect(store.get('fileWrite:test.ts')).toBe(true);
    });

    it('应保存拒绝决策', async () => {
      await store.load();
      await store.set('bash:rm -rf', false, 'bash');
      expect(store.get('bash:rm -rf')).toBe(false);
    });

    it('未设置的 key 应返回 undefined', async () => {
      await store.load();
      expect(store.get('unknown')).toBeUndefined();
    });
  });

  describe('持久化', () => {
    it('应写入 JSON 文件', async () => {
      await store.load();
      await store.set('test-key', true, 'test_tool');

      // 等待异步写入完成
      await new Promise(r => setTimeout(r, 200));

      const content = await readFile(join(tempDir, 'decisions.json'), 'utf-8');
      const data = JSON.parse(content);
      expect(data.version).toBe(1);
      expect(data.decisions).toBeInstanceOf(Array);
      expect(data.decisions.some((d: { cacheKey: string }) => d.cacheKey === 'test-key')).toBe(true);
    });

    it('重新加载后应恢复决策', async () => {
      await store.load();
      await store.set('persist-key', true, 'test_tool');
      await new Promise(r => setTimeout(r, 200));

      // 创建新实例加载同一文件
      const store2 = new DecisionStore(join(tempDir, 'decisions.json'));
      await store2.load();
      expect(store2.get('persist-key')).toBe(true);
    });
  });

  describe('clear', () => {
    it('应清空所有决策', async () => {
      await store.load();
      await store.set('key1', true, 'tool1');
      await store.set('key2', false, 'tool2');
      // 等待异步写入完成
      await new Promise(r => setTimeout(r, 300));
      await store.clear();
      expect(store.get('key1')).toBeUndefined();
      expect(store.get('key2')).toBeUndefined();
    });
  });
});
