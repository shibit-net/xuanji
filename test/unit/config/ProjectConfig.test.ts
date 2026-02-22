import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadProjectConfig, getProjectRulesPath, PROJECT_CONFIG_DIR_NAME } from '@/config/ProjectConfig';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ProjectConfig', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `xuanji-test-project-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadProjectConfig()', () => {
    it('项目配置目录不存在时应返回空对象', async () => {
      const config = await loadProjectConfig(testDir);
      expect(config).toEqual({});
    });

    it('应加载存在的项目配置文件', async () => {
      const configDir = join(testDir, '.xuanji');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.json'),
        JSON.stringify({ provider: { model: 'test-model' } }),
        'utf-8',
      );

      const config = await loadProjectConfig(testDir);
      expect(config).toEqual({ provider: { model: 'test-model' } });
    });

    it('配置文件 JSON 格式错误时应返回空对象', async () => {
      const configDir = join(testDir, '.xuanji');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'config.json'), 'not valid json', 'utf-8');

      const config = await loadProjectConfig(testDir);
      expect(config).toEqual({});
    });
  });

  describe('getProjectRulesPath()', () => {
    it('应返回正确的 rules.md 路径', () => {
      const path = getProjectRulesPath('/my/project');
      expect(path).toBe('/my/project/.xuanji/rules.md');
    });

    it('不传参数应使用 process.cwd()', () => {
      const path = getProjectRulesPath();
      expect(path).toContain('.xuanji/rules.md');
    });
  });

  describe('PROJECT_CONFIG_DIR_NAME', () => {
    it('应为 .xuanji', () => {
      expect(PROJECT_CONFIG_DIR_NAME).toBe('.xuanji');
    });
  });
});
