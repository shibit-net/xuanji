import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RulesLoader } from '@/infrastructure/config/RulesLoader';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RulesLoader', () => {
  let testDir: string;
  let loader: RulesLoader;

  beforeEach(async () => {
    testDir = join(tmpdir(), `xuanji-test-rules-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    loader = new RulesLoader();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should load XUANJI.md from project root', async () => {
    await writeFile(join(testDir, 'XUANJI.md'), '# Project Rules\n- Rule 1');

    const result = loader.loadRulesSync(testDir);

    expect(result.xuanjiMd).toBe('# Project Rules\n- Rule 1');
  });

  it('should load .xuanji/rules.md', async () => {
    await mkdir(join(testDir, '.xuanji'), { recursive: true });
    await writeFile(join(testDir, '.xuanji', 'rules.md'), '# Custom Rules');

    const result = loader.loadRulesSync(testDir);

    expect(result.projectRules).toBe('# Custom Rules');
  });

  it('should handle missing files gracefully', async () => {
    const result = loader.loadRulesSync(testDir);

    expect(result.xuanjiMd).toBeUndefined();
    expect(result.projectRules).toBeUndefined();
    // globalRules 取决于是否存在 .xuanji/rules.md，不强断言
  });

  it('should truncate oversized files', async () => {
    // 创建 600KB 的文件
    const largeContent = 'x'.repeat(600 * 1024);
    await writeFile(join(testDir, 'XUANJI.md'), largeContent);

    const result = loader.loadRulesSync(testDir);

    expect(result.xuanjiMd).toBeDefined();
    expect(Buffer.byteLength(result.xuanjiMd!, 'utf-8')).toBeLessThanOrEqual(500 * 1024);
  });

  it('should load multiple rules with correct structure', async () => {
    await writeFile(join(testDir, 'XUANJI.md'), '# Main');
    await mkdir(join(testDir, '.xuanji'), { recursive: true });
    await writeFile(join(testDir, '.xuanji', 'rules.md'), '# Custom');

    const result = loader.loadRulesSync(testDir);

    expect(result.xuanjiMd).toBe('# Main');
    expect(result.projectRules).toBe('# Custom');
  });

  it('should not crash on directory instead of file', async () => {
    // 创建一个同名目录而非文件
    await mkdir(join(testDir, 'XUANJI.md'), { recursive: true });

    const result = loader.loadRulesSync(testDir);

    expect(result.xuanjiMd).toBeUndefined();
  });

  it('should handle empty file', async () => {
    await writeFile(join(testDir, 'XUANJI.md'), '');

    const result = loader.loadRulesSync(testDir);

    // 空文件返回 undefined（因为 trim 后长度为 0）
    expect(result.xuanjiMd).toBeUndefined();
  });
});
