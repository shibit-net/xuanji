// ============================================================
// StorageBackend 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { StorageBackend } from '@/memory/StorageBackend';

describe('StorageBackend', () => {
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-storage-test-'));
    storage = new StorageBackend();
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('append', () => {
    it('should create file and append record', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      await storage.append(filePath, { foo: 'bar' });

      const content = await readFile(filePath, 'utf-8');
      expect(content.trim()).toBe('{"foo":"bar"}');
    });

    it('should append multiple records', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      await storage.append(filePath, { id: 1 });
      await storage.append(filePath, { id: 2 });

      const content = await readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should create nested directories', async () => {
      const filePath = join(tempDir, 'nested', 'deep', 'test.jsonl');
      await storage.append(filePath, { data: 'value' });

      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('readAll', () => {
    it('should read all records', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      await storage.append(filePath, { id: 1 });
      await storage.append(filePath, { id: 2 });
      await storage.append(filePath, { id: 3 });

      const records = await storage.readAll<{ id: number }>(filePath);
      expect(records).toHaveLength(3);
      expect(records[0]?.id).toBe(1);
      expect(records[2]?.id).toBe(3);
    });

    it('should return empty array for non-existent file', async () => {
      const records = await storage.readAll(join(tempDir, 'nonexistent.jsonl'));
      expect(records).toEqual([]);
    });

    it('should skip malformed lines', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      await storage.append(filePath, { id: 1 });
      await appendFile(filePath, 'invalid json\n', 'utf-8');
      await storage.append(filePath, { id: 2 });

      const records = await storage.readAll<{ id: number }>(filePath);
      expect(records).toHaveLength(2);
    });
  });

  describe('readRecent', () => {
    it('should read last N records', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      for (let i = 0; i < 5; i++) {
        await storage.append(filePath, { id: i });
      }

      const records = await storage.readRecent<{ id: number }>(filePath, 3);
      expect(records).toHaveLength(3);
      expect(records[0]?.id).toBe(4); // 最后一条
      expect(records[2]?.id).toBe(2);
    });
  });

  describe('overwrite', () => {
    it('should atomically overwrite file', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      await storage.append(filePath, { id: 1 });
      await storage.append(filePath, { id: 2 });

      await storage.overwrite(filePath, [{ id: 10 }]);

      const records = await storage.readAll<{ id: number }>(filePath);
      expect(records).toHaveLength(1);
      expect(records[0]?.id).toBe(10);
    });

    it('should not leave .tmp file on success', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      await storage.overwrite(filePath, [{ id: 1 }]);

      expect(existsSync(filePath + '.tmp')).toBe(false);
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('clear', () => {
    it('should delete file', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      await storage.append(filePath, { id: 1 });
      expect(existsSync(filePath)).toBe(true);

      await storage.clear(filePath);
      expect(existsSync(filePath)).toBe(false);
    });

    it('should not throw for non-existent file', async () => {
      await expect(
        storage.clear(join(tempDir, 'nonexistent.jsonl')),
      ).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const filePath = join(tempDir, 'test.jsonl');
      await storage.append(filePath, { id: 1 });
      expect(storage.exists(filePath)).toBe(true);
    });

    it('should return false for non-existent file', () => {
      expect(storage.exists(join(tempDir, 'nonexistent.jsonl'))).toBe(false);
    });
  });
});
