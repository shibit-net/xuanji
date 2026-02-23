import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '@/core/config/defaults';

describe('defaults', () => {
  it('默认配置应包含所有必需的顶层字段', () => {
    expect(DEFAULT_CONFIG).toHaveProperty('provider');
    expect(DEFAULT_CONFIG).toHaveProperty('ui');
    expect(DEFAULT_CONFIG).toHaveProperty('tools');
    expect(DEFAULT_CONFIG).toHaveProperty('retry');
  });

  it('provider 默认配置应合理', () => {
    expect(DEFAULT_CONFIG.provider.model).toBeTruthy();
    expect(DEFAULT_CONFIG.provider.timeout).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.provider.baseURL).toBeTruthy();
  });

  it('ui 默认配置应合理', () => {
    expect(DEFAULT_CONFIG.ui.theme).toBe('auto');
    expect(typeof DEFAULT_CONFIG.ui.showTokenUsage).toBe('boolean');
    expect(typeof DEFAULT_CONFIG.ui.showCost).toBe('boolean');
    expect(typeof DEFAULT_CONFIG.ui.showThinking).toBe('boolean');
  });

  it('retry 默认配置应合理', () => {
    expect(DEFAULT_CONFIG.retry.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.retry.initialDelay).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.retry.maxDelay).toBeGreaterThan(DEFAULT_CONFIG.retry.initialDelay);
    expect(DEFAULT_CONFIG.retry.backoffMultiplier).toBeGreaterThan(1);
    expect(DEFAULT_CONFIG.retry.retryableStatusCodes).toContain(429);
    expect(DEFAULT_CONFIG.retry.retryableStatusCodes).toContain(500);
  });

  it('tools 默认配置应合理', () => {
    expect(Array.isArray(DEFAULT_CONFIG.tools.enabled)).toBe(true);
    expect(DEFAULT_CONFIG.tools.permissions).toBeDefined();
    expect(DEFAULT_CONFIG.tools.permissions.fileRead).toBe('always');
    expect(DEFAULT_CONFIG.tools.permissions.fileWrite).toBe('ask');
    expect(DEFAULT_CONFIG.tools.permissions.bashExec).toBe('ask');
  });
});
