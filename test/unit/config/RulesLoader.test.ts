import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RulesLoader } from '@/infrastructure/config/RulesLoader';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RulesLoader', () => {
  const loader = new RulesLoader();
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `rules-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('应加载目录中的 XUANJI.md', async () => {
    await writeFile(join(testDir, 'XUANJI.md'), '# 项目规则\n- 使用 TypeScript', 'utf-8');

    const rules = await loader.loadRules(testDir);
    expect(rules.length).toBeGreaterThanOrEqual(1);

    const projectRule = rules.find((r) => r.path.includes(testDir));
    expect(projectRule).toBeDefined();
    expect(projectRule!.content).toContain('项目规则');
  });

  it('应加载 .xuanji/rules.md', async () => {
    const xuanjiDir = join(testDir, '.xuanji');
    await mkdir(xuanjiDir, { recursive: true });
    await writeFile(join(xuanjiDir, 'rules.md'), '# 备选规则', 'utf-8');

    const rules = await loader.loadRules(testDir);
    const altRule = rules.find((r) => r.path.includes('.xuanji/rules.md'));
    expect(altRule).toBeDefined();
    expect(altRule!.content).toContain('备选规则');
  });

  it('空目录应返回空规则', async () => {
    const rules = await loader.loadRules(testDir);
    // 可能有全局规则，但不应有项目规则
    const projectRules = rules.filter((r) => r.path.includes(testDir));
    expect(projectRules.length).toBe(0);
  });

  it('loadAsText 应合并所有规则为文本', async () => {
    await writeFile(join(testDir, 'XUANJI.md'), '# 规则内容\n\nSome rule text', 'utf-8');
    const text = await loader.loadAsText(testDir);
    expect(text).toContain('XUANJI Rules');
    expect(text).toContain('规则内容');
  });

  it('空文件应被忽略', async () => {
    await writeFile(join(testDir, 'XUANJI.md'), '   \n  ', 'utf-8');
    const rules = await loader.loadRules(testDir);
    const projectRules = rules.filter((r) => r.path.includes(testDir));
    expect(projectRules.length).toBe(0);
  });
});
