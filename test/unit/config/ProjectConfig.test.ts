import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectConfig, PROJECT_CONFIG_DIR_NAME } from '@/infrastructure/config/ProjectConfig';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

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
    it('应加载存在的项目配置文件', async () => {
      const configDir = join(testDir, '.xuanji');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, 'config.json'),
        JSON.stringify({ provider: { model: 'test-model' } }),
        'utf-8',
      );

      const config = await ProjectConfig.loadProjectConfig(testDir);
      expect(config).toEqual({ provider: { model: 'test-model' } });
    });

    it('配置文件 JSON 格式错误时应返回空对象', async () => {
      const configDir = join(testDir, '.xuanji');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'config.json'), 'not valid json', 'utf-8');

      const config = await ProjectConfig.loadProjectConfig(testDir);
      expect(config).toEqual({});
    });
  });

  describe('Auto-Init', () => {
    it('首次加载时应自动创建 config.json', async () => {
      const configPath = join(testDir, '.xuanji', 'config.json');

      // 初始不存在
      expect(existsSync(configPath)).toBe(false);

      // 首次加载触发自动初始化
      const config = await ProjectConfig.loadProjectConfig(testDir);

      // 验证文件已创建
      expect(existsSync(configPath)).toBe(true);

      // 验证返回的配置包含完整模板
      expect(config.provider).toBeDefined();
      expect(config.ui).toBeDefined();
      expect(config.tools).toBeDefined();
    });

    it('首次加载时应同时创建 rules.md', async () => {
      const rulesPath = join(testDir, '.xuanji', 'rules.md');

      expect(existsSync(rulesPath)).toBe(false);

      await ProjectConfig.loadProjectConfig(testDir);

      expect(existsSync(rulesPath)).toBe(true);
    });

    it('已有配置文件不应被自动覆盖', async () => {
      const configDir = join(testDir, '.xuanji');
      await mkdir(configDir, { recursive: true });
      const configPath = join(configDir, 'config.json');

      // 手动创建自定义配置
      await writeFile(configPath, '{"custom": "value"}', 'utf-8');

      // 加载配置
      const config = await ProjectConfig.loadProjectConfig(testDir);

      // 验证未被覆盖
      expect(config).toEqual({ custom: 'value' });
      const content = await readFile(configPath, 'utf-8');
      expect(content).toContain('custom');
    });

    it('自动生成的 config.json 应包含完整配置项', async () => {
      await ProjectConfig.loadProjectConfig(testDir);

      const configPath = join(testDir, '.xuanji', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      // 验证顶层结构
      expect(parsed.provider).toBeDefined();
      expect(parsed.ui).toBeDefined();
      expect(parsed.tools).toBeDefined();

      // 验证嵌套字段
      expect(parsed.provider.model).toBeDefined();
      expect(parsed.ui.theme).toBeDefined();
      expect(parsed.tools.permissions).toBeDefined();
      expect(parsed.tools.permissions.fileRead).toBe('always');
      expect(parsed.tools.permissions.fileWrite).toBe('ask');
      expect(parsed.tools.permissions.bashExec).toBe('ask');
    });
  });

  describe('getProjectRulesPath()', () => {
    it('应返回正确的 rules.md 路径', () => {
      const path = ProjectConfig.getProjectRulesPath('/my/project');
      expect(path).toBe('/my/project/.xuanji/rules.md');
    });

    it('不传参数应使用 process.cwd()', () => {
      const path = ProjectConfig.getProjectRulesPath();
      expect(path).toContain('.xuanji/rules.md');
    });
  });

  describe('PROJECT_CONFIG_DIR_NAME', () => {
    it('应为 .xuanji', () => {
      expect(PROJECT_CONFIG_DIR_NAME).toBe('.xuanji');
    });
  });
});
