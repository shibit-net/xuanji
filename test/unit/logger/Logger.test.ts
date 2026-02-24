import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, DebugLogger, ConsolaLogger } from '@/core/logger';
import type { ILogger } from '@/core/logger';

describe('Logger System', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 清理日志相关环境变量
    delete process.env.NODE_ENV;
    delete process.env.XUANJI_LOGGER_TYPE;
    delete process.env.XUANJI_LOG_LEVEL;
    delete process.env.XUANJI_LOG_FILE;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── 工厂函数测试 ──────────────────────────────────────

  describe('createLogger()', () => {
    it('should create DebugLogger by default (non-production)', () => {
      process.env.NODE_ENV = 'development';
      const logger = createLogger({ namespace: 'test' });
      expect(logger).toBeInstanceOf(DebugLogger);
    });

    it('should create ConsolaLogger in production', () => {
      process.env.NODE_ENV = 'production';
      const logger = createLogger({ namespace: 'test' });
      expect(logger).toBeInstanceOf(ConsolaLogger);
    });

    it('should respect XUANJI_LOGGER_TYPE=consola override', () => {
      process.env.NODE_ENV = 'development';
      process.env.XUANJI_LOGGER_TYPE = 'consola';
      const logger = createLogger({ namespace: 'test' });
      expect(logger).toBeInstanceOf(ConsolaLogger);
    });

    it('should respect XUANJI_LOGGER_TYPE=debug override', () => {
      process.env.NODE_ENV = 'production';
      process.env.XUANJI_LOGGER_TYPE = 'debug';
      const logger = createLogger({ namespace: 'test' });
      expect(logger).toBeInstanceOf(DebugLogger);
    });

    it('should create logger with default namespace', () => {
      const logger = createLogger();
      expect(logger).toBeDefined();
    });
  });

  // ── DebugLogger 测试 ──────────────────────────────────

  describe('DebugLogger', () => {
    it('should implement ILogger interface', () => {
      const logger = new DebugLogger({ namespace: 'test' });
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.child).toBe('function');
    });

    it('should create child with nested namespace', () => {
      const parent = new DebugLogger({ namespace: 'xuanji' });
      const child = parent.child({ module: 'AgentLoop' });
      expect(child).toBeInstanceOf(DebugLogger);
    });

    it('should create deeply nested child', () => {
      const root = new DebugLogger({ namespace: 'xuanji' });
      const child1 = root.child({ module: 'core' });
      const child2 = child1.child({ module: 'agent' });
      expect(child2).toBeInstanceOf(DebugLogger);
    });

    it('should not throw when calling log methods', () => {
      const logger = new DebugLogger({ namespace: 'test' });
      expect(() => logger.debug('test message')).not.toThrow();
      expect(() => logger.info('test message')).not.toThrow();
      expect(() => logger.warn('test message')).not.toThrow();
      expect(() => logger.error('test message')).not.toThrow();
    });

    it('should handle extra arguments', () => {
      const logger = new DebugLogger({ namespace: 'test' });
      expect(() => logger.debug('message', { data: 123 }, 'extra')).not.toThrow();
    });
  });

  // ── ConsolaLogger 测试 ────────────────────────────────

  describe('ConsolaLogger', () => {
    it('should implement ILogger interface', () => {
      const logger = new ConsolaLogger({ namespace: 'test' });
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.child).toBe('function');
    });

    it('should support setLevel', () => {
      const logger = new ConsolaLogger({ namespace: 'test' });
      expect(typeof logger.setLevel).toBe('function');
      expect(() => logger.setLevel('warn')).not.toThrow();
    });

    it('should create child with nested namespace', () => {
      const parent = new ConsolaLogger({ namespace: 'xuanji' });
      const child = parent.child({ module: 'Provider' });
      expect(child).toBeInstanceOf(ConsolaLogger);
    });

    it('should not throw when calling log methods', () => {
      const logger = new ConsolaLogger({ namespace: 'test' });
      expect(() => logger.debug('test message')).not.toThrow();
      expect(() => logger.info('test message')).not.toThrow();
      expect(() => logger.warn('test message')).not.toThrow();
      expect(() => logger.error('test message')).not.toThrow();
    });

    it('should handle extra arguments', () => {
      const logger = new ConsolaLogger({ namespace: 'test' });
      expect(() => logger.error('error:', new Error('test'))).not.toThrow();
    });

    it('should support destroy()', async () => {
      const logger = new ConsolaLogger({ namespace: 'test' });
      await expect(logger.destroy()).resolves.not.toThrow();
    });

    it('should respect XUANJI_LOG_LEVEL env', () => {
      process.env.XUANJI_LOG_LEVEL = 'error';
      const logger = new ConsolaLogger({ namespace: 'test' });
      expect(logger).toBeDefined();
    });
  });

  // ── child() 行为测试 ──────────────────────────────────

  describe('child() pattern', () => {
    it('should create independent child loggers', () => {
      const root = createLogger({ namespace: 'xuanji' });
      const child1 = root.child({ module: 'AgentLoop' });
      const child2 = root.child({ module: 'Provider' });

      expect(child1).not.toBe(child2);
      expect(child1).not.toBe(root);
    });

    it('should allow child without module', () => {
      const root = createLogger({ namespace: 'xuanji' });
      const child = root.child({});
      expect(child).toBeDefined();
    });

    it('should allow child with custom metadata', () => {
      const root = createLogger({ namespace: 'xuanji' });
      const child = root.child({ module: 'Test', requestId: '12345' });
      expect(child).toBeDefined();
    });
  });

  // ── 全局 Logger 实例测试 ──────────────────────────────

  describe('Global logger instance', () => {
    it('should export a default logger', async () => {
      const { logger } = await import('@/core/logger');
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.child).toBe('function');
    });
  });
});
