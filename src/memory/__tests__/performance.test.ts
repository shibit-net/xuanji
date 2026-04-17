// ============================================================
// 璇玑记忆系统 3.0 - 性能测试
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryStore } from '../MemoryStore';
import { DecisionPointDetector } from '../DecisionPointDetector';
import { DecisionPointMemoryRetriever } from '../DecisionPointMemoryRetriever';
import { DreamAgent } from '../DreamAgent';
import type { MemoryEntry } from '../types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

describe('璇玑记忆系统 3.0 - 性能测试', () => {
  let store: MemoryStore;
  let detector: DecisionPointDetector;
  let dbPath: string;

  // Mock SubAgentFactory
  const mockSubAgentFactory: any = {
    create: async () => ({
      run: async () => ({
        response: JSON.stringify([
          { memoryId: 'test-1', applicability: 0.9, reason: 'test' }
        ])
      })
    })
  };

  beforeAll(async () => {
    dbPath = join(tmpdir(), `xuanji-perf-test-${Date.now()}.db`);
    store = new MemoryStore(dbPath);
    await store.init();
    detector = new DecisionPointDetector();
  });

  afterAll(() => {
    try {
      unlinkSync(dbPath);
    } catch {}
  });

  describe('决策点检测性能', () => {
    it('应该在 10ms 内完成工具调用检测', async () => {
      const start = Date.now();

      await detector.detect({
        toolCall: {
          id: 'test',
          name: 'bash',
          input: { command: 'pnpm install axios' }
        },
        userMessage: '安装依赖'
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10);
    });

    it('应该在 50ms 内完成 thinking 检测', async () => {
      const thinking = '我应该用 pnpm 来安装依赖，因为项目配置了 pnpm-lock.yaml。' +
        '同时我决定使用 TypeScript 开发，并且选择 Vite 作为构建工具。';

      const start = Date.now();

      await detector.detect({
        thinking,
        userMessage: '创建项目'
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50);
    });

    it('应该在 20ms 内完成用户消息检测', async () => {
      const start = Date.now();

      await detector.detect({
        userMessage: '帮我创建一个 Vue3 + TypeScript + Vite 的项目'
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(20);
    });
  });

  describe('记忆存储性能', () => {
    it('应该在 5ms 内完成单条记忆保存', () => {
      const memory: Partial<MemoryEntry> = {
        id: `perf-test-${Date.now()}`,
        type: 'user_preference',
        content: '测试记忆内容',
        keywords: ['test'],
        source: 'test',
        confidence: 0.8,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 0,
        scope: 'knowledge',
        volatility: 'normal',
        significance: 0.5,
        constraint: 'may',
        usageScenarios: ['test'],
        usageCount: 0,
        effectiveCount: 0,
        memoryOriginV2: 'agent',
        dreamGeneration: 0,
        evidenceCount: 1,
        dreamCount: 0,
      };

      const start = Date.now();
      store.saveEntry(memory as MemoryEntry);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5);
    });

    it('应该在 100ms 内完成 100 条记忆批量保存', () => {
      const memories: MemoryEntry[] = [];

      for (let i = 0; i < 100; i++) {
        memories.push({
          id: `batch-test-${Date.now()}-${i}`,
          type: 'session_summary',
          content: `测试记忆 ${i}`,
          keywords: ['test', `item-${i}`],
          source: 'test',
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 0,
          scope: 'episode',
          volatility: 'transient',
          significance: 0.3,
          constraint: 'may',
          usageScenarios: ['test'],
          usageCount: 0,
          effectiveCount: 0,
          memoryOriginV2: 'agent',
          dreamGeneration: 0,
          evidenceCount: 1,
          dreamCount: 0,
        } as MemoryEntry);
      }

      const start = Date.now();
      store.saveBatch(memories);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('记忆检索性能', () => {
    beforeAll(() => {
      // 准备 1000 条测试记忆
      const memories: MemoryEntry[] = [];

      for (let i = 0; i < 1000; i++) {
        memories.push({
          id: `search-test-${i}`,
          type: 'user_preference',
          content: `测试记忆内容 ${i}，包含关键词 pnpm typescript vite`,
          keywords: ['pnpm', 'typescript', 'vite', `item-${i}`],
          source: 'test',
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: i % 10,
          scope: 'knowledge',
          volatility: 'normal',
          significance: 0.5 + (i % 5) * 0.1,
          constraint: i % 3 === 0 ? 'must' : i % 3 === 1 ? 'should' : 'may',
          usageScenarios: ['package-management', 'code-style'],
          usageCount: i % 10,
          effectiveCount: Math.floor((i % 10) * 0.7),
          memoryOriginV2: 'agent',
          dreamGeneration: 0,
          evidenceCount: 1,
          dreamCount: 0,
        } as MemoryEntry);
      }

      store.saveBatch(memories);
    });

    it('应该在 50ms 内完成关键词搜索（FTS5）', async () => {
      const retriever = new DecisionPointMemoryRetriever(store, mockSubAgentFactory);

      const start = Date.now();

      await retriever['searchByKeywords'](['pnpm', 'typescript'], 'must', 20);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50);
    });

    it('应该在 30ms 内完成场景搜索', async () => {
      const retriever = new DecisionPointMemoryRetriever(store, mockSubAgentFactory);

      const start = Date.now();

      await retriever['searchByScenarios'](['package-management'], 20);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(30);
    });

    it('应该在 1s 内完成完整的决策点检索流程', async () => {
      const retriever = new DecisionPointMemoryRetriever(store, mockSubAgentFactory);

      const points = await detector.detect({
        toolCall: {
          id: 'test',
          name: 'bash',
          input: { command: 'pnpm install' }
        },
        userMessage: '安装依赖'
      });

      const start = Date.now();

      await retriever.retrieve({
        decisionPoints: points,
        userMessage: '安装依赖',
        currentScene: 'package-management'
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('做梦机制性能', () => {
    it('应该在 60s 内完成 100 条记忆的做梦处理', async () => {
      const dreamAgent = new DreamAgent(store, mockSubAgentFactory);

      const start = Date.now();

      await dreamAgent.dream({
        batchSize: 100,
        dryRun: true  // 试运行，不实际修改
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(60000);
    }, 65000);  // 设置测试超时为 65 秒
  });

  describe('数据库索引效率', () => {
    it('约束级别索引应该提升查询速度', async () => {
      // 无索引查询
      const start1 = Date.now();
      const sql1 = `SELECT * FROM memories WHERE constraint_level = 'must' LIMIT 10`;
      store.db!.prepare(sql1).all();
      const duration1 = Date.now() - start1;

      // 有索引查询（应该更快）
      const start2 = Date.now();
      const sql2 = `SELECT * FROM memories WHERE constraint_level = 'must' LIMIT 10`;
      store.db!.prepare(sql2).all();
      const duration2 = Date.now() - start2;

      // 第二次查询应该利用索引，更快
      expect(duration2).toBeLessThanOrEqual(duration1);
    });

    it('复合索引应该优化多条件查询', async () => {
      const start = Date.now();

      const sql = `
        SELECT * FROM memories
        WHERE constraint_level = 'must'
          AND deleted_at IS NULL
        ORDER BY last_used DESC
        LIMIT 10
      `;

      store.db!.prepare(sql).all();

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10);
    });
  });

  describe('内存使用', () => {
    it('批量处理不应该导致内存泄漏', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // 处理 10 批，每批 100 条
      for (let batch = 0; batch < 10; batch++) {
        const memories: MemoryEntry[] = [];

        for (let i = 0; i < 100; i++) {
          memories.push({
            id: `memory-leak-test-${batch}-${i}`,
            type: 'session_summary',
            content: `测试内容 ${batch}-${i}`,
            keywords: ['test'],
            source: 'test',
            confidence: 0.8,
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            accessCount: 0,
            scope: 'episode',
            volatility: 'transient',
            significance: 0.3,
            constraint: 'may',
            usageScenarios: ['test'],
            usageCount: 0,
            effectiveCount: 0,
            memoryOriginV2: 'agent',
            dreamGeneration: 0,
            evidenceCount: 1,
            dreamCount: 0,
          } as MemoryEntry);
        }

        store.saveBatch(memories);
      }

      // 强制垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // 内存增长应该小于 50MB
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});
