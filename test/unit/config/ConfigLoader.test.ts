import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '@/config/ConfigLoader';
import { DEFAULT_CONFIG } from '@/config/defaults';

// Mock core/ 下的真实模块 (vi.mock 工厂函数会被提升)
vi.mock('@/core/config/GlobalConfig', () => ({
  loadGlobalConfig: vi.fn(async () => ({})),
  saveGlobalConfig: vi.fn(),
  GLOBAL_CONFIG_DIR: '/mock/.xuanji',
  GLOBAL_CONFIG_PATH: '/mock/.xuanji/config.json',
}));

vi.mock('@/core/config/ProjectConfig', () => ({
  loadProjectConfig: vi.fn(async () => ({})),
  getProjectRulesPath: vi.fn(() => '/mock/.xuanji/rules.md'),
  PROJECT_CONFIG_DIR_NAME: '.xuanji',
}));

vi.mock('@/core/config/EnvConfig', () => ({
  getEnvProviderConfig: vi.fn(() => ({})),
}));

describe('ConfigLoader', () => {
  let loader: ConfigLoader;

  beforeEach(() => {
    loader = new ConfigLoader();
    vi.clearAllMocks();
  });

  // ---- load() 基本功能 ----

  it('应该加载默认配置', async () => {
    const config = await loader.load();
    expect(config.provider.model).toBe(DEFAULT_CONFIG.provider.model);
    expect(config.ui.theme).toBe('auto');
    expect(config.retry.maxRetries).toBe(3);
  });

  it('加载后 isLoaded() 应返回 true', async () => {
    expect(loader.isLoaded()).toBe(false);
    await loader.load();
    expect(loader.isLoaded()).toBe(true);
  });

  it('应合并全局配置', async () => {
    const { loadGlobalConfig } = await import('@/core/config/GlobalConfig');
    vi.mocked(loadGlobalConfig).mockResolvedValueOnce({
      provider: { model: 'claude-opus-4-20250514' },
    });

    const config = await loader.load();
    expect(config.provider.model).toBe('claude-opus-4-20250514');
  });

  it('应合并项目配置（优先于全局配置）', async () => {
    const { loadGlobalConfig } = await import('@/core/config/GlobalConfig');
    const { loadProjectConfig } = await import('@/core/config/ProjectConfig');

    vi.mocked(loadGlobalConfig).mockResolvedValueOnce({
      provider: { model: 'global-model' },
    });
    vi.mocked(loadProjectConfig).mockResolvedValueOnce({
      provider: { model: 'project-model' },
    });

    const config = await loader.load();
    expect(config.provider.model).toBe('project-model');
  });

  it('应合并环境变量配置（最高优先级）', async () => {
    const { getEnvProviderConfig } = await import('@/core/config/EnvConfig');
    vi.mocked(getEnvProviderConfig).mockReturnValueOnce({
      apiKey: 'env-api-key',
      model: 'env-model',
    });

    const config = await loader.load();
    expect(config.provider.apiKey).toBe('env-api-key');
    expect(config.provider.model).toBe('env-model');
  });

  // ---- get/set 点号路径 ----

  it('get() 应支持点号路径取值', async () => {
    await loader.load();
    expect(loader.get<string>('provider.model')).toBe(DEFAULT_CONFIG.provider.model);
    expect(loader.get<boolean>('ui.showCost')).toBe(true);
    expect(loader.get<number>('retry.maxRetries')).toBe(3);
  });

  it('get() 对不存在的路径应返回 undefined', async () => {
    await loader.load();
    expect(loader.get('nonexistent.path')).toBeUndefined();
    expect(loader.get('provider.nonexistent')).toBeUndefined();
  });

  it('set() 应通过点号路径设值', async () => {
    await loader.load();
    loader.set('provider.model', 'new-model');
    expect(loader.get<string>('provider.model')).toBe('new-model');
  });

  it('set() 应创建不存在的中间路径', async () => {
    await loader.load();
    loader.set('custom.nested.key', 'value');
    expect(loader.get('custom.nested.key')).toBe('value');
  });

  // ---- validate() ----

  it('validate() 应在完整配置时返回 true', async () => {
    await loader.load();
    // 设置必要字段
    loader.set('provider.apiKey', 'test-key');
    expect(loader.validate()).toBe(true);
  });

  it('validate() 应在缺少 apiKey 时返回 false', async () => {
    await loader.load();
    // 默认配置没有 apiKey
    expect(loader.validate()).toBe(false);
  });

  it('validate() 应在缺少 model 时返回 false', async () => {
    await loader.load();
    loader.set('provider.apiKey', 'test-key');
    loader.set('provider.model', '');
    expect(loader.validate()).toBe(false);
  });

  it('validate() 应在 maxTokens <= 0 时仍返回 true（maxTokens 已改为可选）', async () => {
    await loader.load();
    loader.set('provider.apiKey', 'test-key');
    loader.set('provider.maxTokens', 0);
    expect(loader.validate()).toBe(true);
  });

  // ---- getConfig() ----

  it('getConfig() 应返回完整配置对象', async () => {
    await loader.load();
    const config = loader.getConfig();
    expect(config).toHaveProperty('provider');
    expect(config).toHaveProperty('ui');
    expect(config).toHaveProperty('tools');
    expect(config).toHaveProperty('retry');
  });
});
