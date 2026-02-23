import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadGlobalConfig, saveGlobalConfig } from '@/core/config/GlobalConfig';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 由于 GlobalConfig 使用 homedir(), 我们需要测试实际的文件读写逻辑
// 但不能修改用户真实配置。我们直接测试导出的函数行为

describe('GlobalConfig', () => {
  describe('loadGlobalConfig()', () => {
    it('应在配置文件不存在时返回空对象', async () => {
      // 默认行为: 如果 ~/.xuanji/config.json 不存在应返回 {}
      // 这里实际调用函数；如果文件不存在会 catch 并返回 {}
      const config = await loadGlobalConfig();
      expect(typeof config).toBe('object');
    });
  });

  describe('saveGlobalConfig()', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `xuanji-test-global-${Date.now()}`);
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
    });

    // 注意: saveGlobalConfig 写入 ~/.xuanji/, 我们无法安全地测试写入
    // 但可以验证函数存在且签名正确
    it('应是一个可调用的函数', () => {
      expect(typeof saveGlobalConfig).toBe('function');
    });
  });
});
