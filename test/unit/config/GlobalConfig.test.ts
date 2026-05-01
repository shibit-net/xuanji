import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GlobalConfig, deepMergeConfig, getByPath, setByPath } from '@/core/config/GlobalConfig';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AppConfig } from '@/core/types';

// ============================================================
// 工具函数测试
// ============================================================

describe('GlobalConfig - Utility Functions', () => {
  describe('deepMergeConfig()', () => {
    it('应合并嵌套对象', () => {
      const base = { a: { b: 1, c: 2 }, d: 3 };
      const override = { a: { b: 10, e: 4 } };
      const result = deepMergeConfig(base, override);

      expect(result).toEqual({
        a: { b: 10, c: 2, e: 4 },
        d: 3,
      });
    });

    it('应覆盖数组（不合并）', () => {
      const base = { arr: [1, 2, 3] };
      const override = { arr: [4, 5] };
      const result = deepMergeConfig(base, override);

      expect(result.arr).toEqual([4, 5]);
    });

    it('应覆盖原始值', () => {
      const base = { a: 'old', b: 10 };
      const override = { a: 'new', b: 20 };
      const result = deepMergeConfig(base, override);

      expect(result).toEqual({ a: 'new', b: 20 });
    });

    it('应跳过 undefined 值', () => {
      const base = { a: 'keep' };
      const override = { a: undefined, b: 'new' };
      const result = deepMergeConfig(base, override);

      expect(result.a).toBe('keep');
      expect(result.b).toBe('new');
    });

    it('应处理 null 覆盖', () => {
      const base = { a: { b: 1 } };
      const override = { a: null };
      const result = deepMergeConfig(base, override);

      expect(result.a).toBeNull();
    });
  });

  describe('getByPath()', () => {
    it('应获取嵌套属性', () => {
      const obj = { a: { b: { c: 123 } } };
      expect(getByPath(obj, 'a.b.c')).toBe(123);
    });

    it('应对不存在的路径返回 undefined', () => {
      const obj = { a: { b: 1 } };
      expect(getByPath(obj, 'a.x.y')).toBeUndefined();
      expect(getByPath(obj, 'z')).toBeUndefined();
    });

    it('应处理顶层属性', () => {
      const obj = { simple: 'value' };
      expect(getByPath(obj, 'simple')).toBe('value');
    });
  });

  describe('setByPath()', () => {
    it('应设置嵌套属性', () => {
      const obj: Record<string, unknown> = {};
      setByPath(obj, 'a.b.c', 123);
      expect(obj).toEqual({ a: { b: { c: 123 } } });
    });

    it('应创建不存在的中间对象', () => {
      const obj: Record<string, unknown> = { existing: 1 };
      setByPath(obj, 'new.nested.key', 'value');
      expect(obj.new).toEqual({ nested: { key: 'value' } });
      expect(obj.existing).toBe(1);
    });

    it('应覆盖已有值', () => {
      const obj: Record<string, unknown> = { a: { b: { c: 'old' } } };
      setByPath(obj, 'a.b.c', 'new');
      expect(obj.a).toEqual({ b: { c: 'new' } });
    });
  });
});

// ============================================================
// GlobalConfig 类测试
// ============================================================

describe('GlobalConfig', () => {
  let testGlobalDir: string;
  let testProjectDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    // 创建临时测试目录
    testGlobalDir = join(tmpdir(), `xuanji-test-global-${Date.now()}`);
    testProjectDir = join(tmpdir(), `xuanji-test-project-${Date.now()}`);
    await mkdir(testGlobalDir, { recursive: true });
    await mkdir(testProjectDir, { recursive: true });

    // 清空环境变量
    process.env = { ...originalEnv };
    delete process.env.XUANJI_MODEL;
    delete process.env.XUANJI_API_KEY;
    delete process.env.XUANJI_THEME;
  });

  afterEach(async () => {
    // 清理临时目录
    await rm(testGlobalDir, { recursive: true, force: true }).catch(() => {});
    await rm(testProjectDir, { recursive: true, force: true }).catch(() => {});
    // 恢复环境变量
    process.env = originalEnv;
    // 清理所有 mock
    vi.restoreAllMocks();
  });

  // ---- 路径相关 ----

  it('getProjectConfigPath() 默认路径应包含 .xuanji/config.json', () => {
    const path = GlobalConfig.getProjectConfigPath();
    expect(path).toContain('.xuanji');
    expect(path).toContain('config.json');
  });

  it('getProjectConfigPath() 应使用 projectRoot 参数', () => {
    const path = GlobalConfig.getProjectConfigPath('/tmp/myproject');
    expect(path).toBe('/tmp/myproject/.xuanji/config.json');
  });

  // ---- 读写项目配置 ----

  it('readProjectConfig() 不存在时应返回空对象', async () => {
    const nonExistentPath = join(testGlobalDir, 'nonexistent', 'config.json');
    vi.spyOn(GlobalConfig, 'getProjectConfigPath').mockReturnValue(nonExistentPath);

    const config = await GlobalConfig.readProjectConfig();
    expect(config).toEqual({});
  });

  it('writeProjectConfig() 和 readProjectConfig() 应正常工作', async () => {
    const testConfigPath = join(testGlobalDir, 'config.json');
    const spy = vi.spyOn(GlobalConfig, 'getProjectConfigPath').mockReturnValue(testConfigPath);

    const testConfig: Partial<AppConfig> = {
      provider: { model: 'test-model', apiKey: 'test-key' } as any,
    };

    await GlobalConfig.writeProjectConfig(testConfig);
    const loaded = await GlobalConfig.readProjectConfig();

    expect(loaded.provider?.model).toBe('test-model');
    expect(loaded.provider?.apiKey).toBe('test-key');

    spy.mockRestore();
  });

  it('writeProjectConfig() 应自动创建目录', async () => {
    const deepPath = join(testGlobalDir, 'deep', 'nested', 'config.json');
    const spy = vi.spyOn(GlobalConfig, 'getProjectConfigPath').mockReturnValue(deepPath);

    await GlobalConfig.writeProjectConfig({ provider: { model: 'test' } as any });
    const loaded = await GlobalConfig.readProjectConfig();
    expect(loaded.provider?.model).toBe('test');

    spy.mockRestore();
  });

  // ---- 读写项目配置 ----

  it('readProjectConfig() 不存在时应返回空对象', async () => {
    const config = await GlobalConfig.readProjectConfig(testProjectDir);
    expect(config).toEqual({});
  });

  it('writeProjectConfig() 和 readProjectConfig() 应正常工作', async () => {
    const testConfig: Partial<AppConfig> = {
      ui: { theme: 'dark', language: 'zh' } as any,
    };

    await GlobalConfig.writeProjectConfig(testConfig, testProjectDir);
    const loaded = await GlobalConfig.readProjectConfig(testProjectDir);

    expect(loaded.ui?.theme).toBe('dark');
    expect(loaded.ui?.language).toBe('zh');
  });

  // ---- 环境变量解析 ----

  it('resolveEnvConfig() 应映射环境变量', () => {
    process.env.XUANJI_MODEL = 'env-model';
    process.env.XUANJI_API_KEY = 'env-api-key';
    process.env.XUANJI_MAX_TOKENS = '32000';
    process.env.XUANJI_THEME = 'dark';

    const envConfig = GlobalConfig.resolveEnvConfig();

    expect(getByPath(envConfig, 'provider.model')).toBe('env-model');
    expect(getByPath(envConfig, 'provider.apiKey')).toBe('env-api-key');
    expect(getByPath(envConfig, 'provider.maxTokens')).toBe(32000);
    expect(getByPath(envConfig, 'ui.theme')).toBe('dark');
  });

  it('resolveEnvConfig() 应处理数值转换', () => {
    process.env.XUANJI_MAX_TOKENS = '8000';
    process.env.XUANJI_TEMPERATURE = '0.7';
    process.env.XUANJI_TIMEOUT = '60000';

    const envConfig = GlobalConfig.resolveEnvConfig();

    expect(getByPath(envConfig, 'provider.maxTokens')).toBe(8000);
    expect(getByPath(envConfig, 'provider.temperature')).toBe(0.7);
    expect(getByPath(envConfig, 'provider.timeout')).toBe(60000);
  });

  it('resolveEnvConfig() 应处理布尔值', () => {
    process.env.XUANJI_MEMORY_ENABLED = 'true';
    const envConfig = GlobalConfig.resolveEnvConfig();
    expect(getByPath(envConfig, 'memory.enabled')).toBe(true);

    process.env.XUANJI_MEMORY_ENABLED = '0';
    const envConfig2 = GlobalConfig.resolveEnvConfig();
    expect(getByPath(envConfig2, 'memory.enabled')).toBe(false);
  });

  it('resolveEnvConfig() 应跳过空字符串', () => {
    process.env.XUANJI_MODEL = '';
    const envConfig = GlobalConfig.resolveEnvConfig();
    expect(getByPath(envConfig, 'provider.model')).toBeUndefined();
  });

  // ---- 多层配置合并 ----

  it('load() 应按优先级合并配置（环境变量 > 项目配置 > 默认）', async () => {
    const defaults = {
      provider: { model: 'default-model', maxTokens: 8000 },
      ui: { theme: 'auto', language: 'en' },
    } as unknown as Record<string, unknown>;

    const globalPath = join(testGlobalDir, 'config.json');
    const spy = vi.spyOn(GlobalConfig, 'getProjectConfigPath').mockReturnValue(globalPath);

    await GlobalConfig.writeProjectConfig({
      provider: { model: 'global-model' } as any,
      ui: { theme: 'light' } as any,
    });

    await GlobalConfig.writeProjectConfig({
      provider: { model: 'project-model' } as any,
    }, testProjectDir);

    process.env.XUANJI_MODEL = 'env-model';

    const merged = await GlobalConfig.load(testProjectDir, defaults);

    expect(merged.provider?.model).toBe('env-model');
    expect(merged.ui?.theme).toBe('auto');
    expect((merged.provider as any)?.maxTokens).toBe(8000);

    spy.mockRestore();
  });

  it('load() 应处理配置层全空的情况', async () => {
    // 使用独立的临时目录，避免与其他测试冲突
    const isolatedGlobalDir = join(tmpdir(), `xuanji-isolated-${Date.now()}-${Math.random()}`);
    const isolatedProjectDir = join(tmpdir(), `xuanji-project-${Date.now()}-${Math.random()}`);
    await mkdir(isolatedGlobalDir, { recursive: true });
    await mkdir(isolatedProjectDir, { recursive: true });

    const globalPath = join(isolatedGlobalDir, 'config.json');
    const spy = vi.spyOn(GlobalConfig, 'getProjectConfigPath').mockReturnValue(globalPath);

    const defaults = {
      provider: { model: 'default-model', apiKey: 'default-key' },
    } as unknown as Record<string, unknown>;

    const merged = await GlobalConfig.load(isolatedProjectDir, defaults);
    expect(merged.provider?.model).toBe('default-model');

    spy.mockRestore();
    await rm(isolatedGlobalDir, { recursive: true, force: true }).catch(() => {});
    await rm(isolatedProjectDir, { recursive: true, force: true }).catch(() => {});
  });

  // ---- 配置文件格式版本 ----

  it('应支持带 version 的配置文件格式', async () => {
    // 使用独立目录
    const isolatedDir = join(tmpdir(), `xuanji-version-${Date.now()}-${Math.random()}`);
    await mkdir(isolatedDir, { recursive: true });
    const configPath = join(isolatedDir, 'config.json');
    const spy = vi.spyOn(GlobalConfig, 'getProjectConfigPath').mockReturnValue(configPath);

    await GlobalConfig.writeProjectConfig({
      provider: { model: 'versioned-model' } as any,
    });

    // 读取原始 JSON 验证格式
    const raw = await import('fs/promises').then(fs => fs.readFile(configPath, 'utf-8'));
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe('1.0');
    expect(parsed.config.provider.model).toBe('versioned-model');

    // 验证 read 方法自动解包
    const loaded = await GlobalConfig.readProjectConfig();
    expect(loaded.provider?.model).toBe('versioned-model');

    spy.mockRestore();
    await rm(isolatedDir, { recursive: true, force: true }).catch(() => {});
  });

  it('应兼容不带 version 的旧格式配置', async () => {
    // 使用独立目录
    const isolatedDir = join(tmpdir(), `xuanji-legacy-${Date.now()}-${Math.random()}`);
    await mkdir(isolatedDir, { recursive: true });
    const configPath = join(isolatedDir, 'config.json');
    const spy = vi.spyOn(GlobalConfig, 'getProjectConfigPath').mockReturnValue(configPath);

    // 手动写入旧格式
    await writeFile(configPath, JSON.stringify({
      provider: { model: 'legacy-model' },
    }), 'utf-8');

    const loaded = await GlobalConfig.readProjectConfig();
    expect(loaded.provider?.model).toBe('legacy-model');

    spy.mockRestore();
    await rm(isolatedDir, { recursive: true, force: true }).catch(() => {});
  });

  // ---- getEnvMappings ----

  it('getEnvMappings() 应返回环境变量映射表', () => {
    const mappings = GlobalConfig.getEnvMappings();
    expect(mappings).toHaveProperty('XUANJI_API_KEY');
    expect(mappings).toHaveProperty('XUANJI_MODEL');
    expect(mappings.XUANJI_MODEL.path).toBe('provider.model');
  });
});
