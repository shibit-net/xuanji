import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEnvProviderConfig, getApiKey, ENV_KEYS } from '@/infrastructure/config/EnvConfig';

describe('EnvConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 清理相关环境变量
    delete process.env.XUANJI_API_KEY;
    delete process.env.XUANJI_BASE_URL;
    delete process.env.XUANJI_MODEL;
    delete process.env.XUANJI_MAX_TOKENS;
    delete process.env.XUANJI_THEME;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getEnvProviderConfig()', () => {
    it('应在无环境变量时返回空对象', () => {
      const config = getEnvProviderConfig();
      expect(config).toEqual({});
    });

    it('应读取 XUANJI_API_KEY', () => {
      process.env.XUANJI_API_KEY = 'test-api-key';
      const config = getEnvProviderConfig();
      expect(config.apiKey).toBe('test-api-key');
    });

    it('应读取 XUANJI_BASE_URL', () => {
      process.env.XUANJI_BASE_URL = 'https://api.example.com';
      const config = getEnvProviderConfig();
      expect(config.baseURL).toBe('https://api.example.com');
    });

    it('应读取 XUANJI_MODEL', () => {
      process.env.XUANJI_MODEL = 'claude-opus-4';
      const config = getEnvProviderConfig();
      expect(config.model).toBe('claude-opus-4');
    });

    it('应读取 XUANJI_MAX_TOKENS 并解析为整数', () => {
      process.env.XUANJI_MAX_TOKENS = '4096';
      const config = getEnvProviderConfig();
      expect(config.maxTokens).toBe(4096);
    });

    it('应同时读取多个环境变量', () => {
      process.env.XUANJI_API_KEY = 'my-key';
      process.env.XUANJI_MODEL = 'my-model';
      process.env.XUANJI_MAX_TOKENS = '2048';
      const config = getEnvProviderConfig();
      expect(config.apiKey).toBe('my-key');
      expect(config.model).toBe('my-model');
      expect(config.maxTokens).toBe(2048);
    });
  });

  describe('getApiKey()', () => {
    it('应在环境变量设置时返回 API Key', () => {
      process.env.XUANJI_API_KEY = 'my-secret-key';
      expect(getApiKey()).toBe('my-secret-key');
    });

    it('应在环境变量未设置时返回 undefined', () => {
      expect(getApiKey()).toBeUndefined();
    });
  });

  describe('ENV_KEYS', () => {
    it('应导出正确的环境变量键名', () => {
      expect(ENV_KEYS.XUANJI_API_KEY).toBe('XUANJI_API_KEY');
      expect(ENV_KEYS.XUANJI_BASE_URL).toBe('XUANJI_BASE_URL');
      expect(ENV_KEYS.XUANJI_MODEL).toBe('XUANJI_MODEL');
      expect(ENV_KEYS.XUANJI_MAX_TOKENS).toBe('XUANJI_MAX_TOKENS');
      expect(ENV_KEYS.XUANJI_THEME).toBe('XUANJI_THEME');
    });
  });
});
