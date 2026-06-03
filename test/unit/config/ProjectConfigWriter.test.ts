// ============================================================
// ProjectConfigWriter 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { ProjectConfigWriter } from '@/infrastructure/config/ProjectConfigWriter';

describe('ProjectConfigWriter', () => {
  let tempDir: string;
  let writer: ProjectConfigWriter;

  beforeEach(async () => {
    // 创建临时目录作为项目根目录
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-test-'));
    writer = new ProjectConfigWriter();
  });

  afterEach(async () => {
    // 清理临时目录
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should create .xuanji directory', async () => {
    await writer.initProjectConfig({ language: 'zh' }, tempDir);

    const xuanjiDir = join(tempDir, '.xuanji');
    expect(existsSync(xuanjiDir)).toBe(true);
  });

  it('should generate config.json and rules.md', async () => {
    await writer.initProjectConfig({ language: 'zh' }, tempDir);

    const configPath = join(tempDir, '.xuanji', 'config.json');
    const rulesPath = join(tempDir, '.xuanji', 'rules.md');

    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(rulesPath)).toBe(true);

    // 验证 config.json 内容 (不带 generateFullConfig 时应为空对象)
    const configContent = await readFile(configPath, 'utf-8');
    expect(JSON.parse(configContent)).toEqual({});

    // 验证 rules.md 内容
    const rulesContent = await readFile(rulesPath, 'utf-8');
    expect(rulesContent).toContain('# 项目规则');
  });

  it('should use correct template based on language', async () => {
    // 中文模板
    await writer.initProjectConfig({ language: 'zh' }, tempDir);
    const rulesPathZh = join(tempDir, '.xuanji', 'rules.md');
    const rulesContentZh = await readFile(rulesPathZh, 'utf-8');
    expect(rulesContentZh).toContain('# 项目规则');
    expect(rulesContentZh).toContain('代码风格');

    // 清理并测试英文模板
    await rm(join(tempDir, '.xuanji'), { recursive: true, force: true });
    await writer.initProjectConfig({ language: 'en' }, tempDir);
    const rulesPathEn = join(tempDir, '.xuanji', 'rules.md');
    const rulesContentEn = await readFile(rulesPathEn, 'utf-8');
    expect(rulesContentEn).toContain('# Project Rules');
    expect(rulesContentEn).toContain('Code Style');
  });

  it('should skip if files already exist (overwrite=false)', async () => {
    // 第一次初始化成功
    await writer.initProjectConfig({ language: 'zh' }, tempDir);

    // 第二次初始化应该失败
    await expect(
      writer.initProjectConfig({ language: 'zh' }, tempDir)
    ).rejects.toThrow('Files already exist');
  });

  it('should overwrite if overwrite=true', async () => {
    // 第一次初始化
    await writer.initProjectConfig({ language: 'zh' }, tempDir);

    // 第二次使用 overwrite=true 应该成功
    await expect(
      writer.initProjectConfig({ language: 'en', overwrite: true }, tempDir)
    ).resolves.not.toThrow();

    // 验证内容已更新为英文
    const rulesPath = join(tempDir, '.xuanji', 'rules.md');
    const rulesContent = await readFile(rulesPath, 'utf-8');
    expect(rulesContent).toContain('# Project Rules');
  });

  it('should save project config', async () => {
    const config = {
      model: 'claude-sonnet-4',
      maxTokens: 4096,
    };

    await writer.saveProjectConfig(config, tempDir);

    const configPath = join(tempDir, '.xuanji', 'config.json');
    expect(existsSync(configPath)).toBe(true);

    const content = await readFile(configPath, 'utf-8');
    expect(JSON.parse(content)).toEqual(config);
  });

  it('should create directory if not exists when saving', async () => {
    const config = { test: true };

    await writer.saveProjectConfig(config, tempDir);

    const xuanjiDir = join(tempDir, '.xuanji');
    expect(existsSync(xuanjiDir)).toBe(true);
  });

  it('should format JSON with proper indentation', async () => {
    const config = {
      model: 'claude-sonnet-4',
      nested: {
        key: 'value',
      },
    };

    await writer.saveProjectConfig(config, tempDir);

    const configPath = join(tempDir, '.xuanji', 'config.json');
    const content = await readFile(configPath, 'utf-8');

    // 验证格式化 (包含缩进)
    expect(content).toContain('  "model"');
    expect(content).toContain('  "nested"');
  });

  // ── generateFullConfig 测试 ──

  describe('generateFullConfig', () => {
    it('should generate full config template in Chinese', async () => {
      await writer.initProjectConfig({
        language: 'zh',
        generateFullConfig: true,
      }, tempDir);

      const configPath = join(tempDir, '.xuanji', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);

      // 验证顶层结构
      expect(config.provider).toBeDefined();
      expect(config.ui).toBeDefined();
      expect(config.tools).toBeDefined();

      // 验证 provider 字段
      expect(config.provider.model).toBe('claude-sonnet-4');
      expect(config.provider.maxTokens).toBe(65536);

      // 验证 ui 字段
      expect(config.ui.theme).toBe('auto');
      expect(config.ui.language).toBe('zh');
      expect(config.ui.showTokenUsage).toBe(true);

      // 验证 tools.permissions 字段
      expect(config.tools.permissions.fileRead).toBe('always');
      expect(config.tools.permissions.fileWrite).toBe('ask');
      expect(config.tools.permissions.bashExec).toBe('ask');
      expect(config.tools.permissions.allowedCommands).toBeInstanceOf(Array);
      expect(config.tools.permissions.deniedPaths).toBeInstanceOf(Array);

      // 验证包含中文伪注释
      expect(config['// 说明']).toBeDefined();
    });

    it('should generate full config template in English', async () => {
      await writer.initProjectConfig({
        language: 'en',
        generateFullConfig: true,
      }, tempDir);

      const configPath = join(tempDir, '.xuanji', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);

      // 验证 ui.language 为 en
      expect(config.ui.language).toBe('en');

      // 验证包含英文伪注释
      expect(config['// Note']).toBeDefined();

      // 验证结构一致
      expect(config.provider.model).toBe('claude-sonnet-4');
      expect(config.tools.permissions.fileRead).toBe('always');
    });

    it('should generate empty config when generateFullConfig is false', async () => {
      await writer.initProjectConfig({
        language: 'zh',
        generateFullConfig: false,
      }, tempDir);

      const configPath = join(tempDir, '.xuanji', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      expect(JSON.parse(content)).toEqual({});
    });

    it('should overwrite with full config when overwrite=true', async () => {
      // 先创建空配置
      await writer.initProjectConfig({ language: 'zh' }, tempDir);

      // 用完整配置覆盖
      await writer.initProjectConfig({
        language: 'zh',
        overwrite: true,
        generateFullConfig: true,
      }, tempDir);

      const configPath = join(tempDir, '.xuanji', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);

      // 验证已被完整配置覆盖
      expect(config.provider).toBeDefined();
      expect(config.ui).toBeDefined();
      expect(config.tools).toBeDefined();
    });
  });
});
