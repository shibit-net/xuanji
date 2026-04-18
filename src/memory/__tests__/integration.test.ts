// ============================================================
// 璇玑记忆系统 3.0 - 端到端集成测试
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryStore } from '../MemoryStore';
import { DecisionPointDetector } from '../DecisionPointDetector';
import { DecisionPointMemoryRetriever } from '../DecisionPointMemoryRetriever';
import { PermanentConstraintManager } from '../PermanentConstraintManager';
import { DreamAgent } from '../DreamAgent';
import { DreamScheduler } from '../DreamScheduler';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import type { MemoryEntry } from '../types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

describe('璇玑记忆系统 3.0 - 端到端集成测试', () => {
  let store: MemoryStore;
  let detector: DecisionPointDetector;
  let retriever: DecisionPointMemoryRetriever;
  let constraintManager: PermanentConstraintManager;
  let dreamAgent: DreamAgent;
  let dreamScheduler: DreamScheduler;
  let dbPath: string;

  // Mock SubAgentFactory
  const mockSubAgentFactory: SubAgentFactory = {
    create: async (agentId: string) => ({
      run: async (prompt: string) => {
        // Mock response
        if (agentId === 'memory-retriever') {
          return {
            response: JSON.stringify([
              { memoryId: 'test-1', applicability: 0.9, reason: '完全匹配' }
            ])
          };
        }
        if (agentId === 'dream-agent') {
          return {
            toolCalls: [
              { tool: 'memory_store', input: { origin: 'dream' } },
              { tool: 'memory_update', input: { reason: 'compress' } },
              { tool: 'memory_delete', input: { reason: 'duplicate' } }
            ]
          };
        }
        return { response: 'ok' };
      }
    })
  } as any;

  beforeAll(async () => {
    // 创建临时数据库
    dbPath = join(tmpdir(), `xuanji-test-${Date.now()}.db`);
    store = new MemoryStore(dbPath);
    await store.init();

    // 初始化组件
    detector = new DecisionPointDetector();
    retriever = new DecisionPointMemoryRetriever(store, mockSubAgentFactory);
    constraintManager = new PermanentConstraintManager(store);
    dreamAgent = new DreamAgent(store, mockSubAgentFactory);
    dreamScheduler = new DreamScheduler(dreamAgent, store);
  });

  afterAll(() => {
    // 清理临时数据库
    try {
      unlinkSync(dbPath);
    } catch {}
  });

  describe('场景1：用户设置身份并使用', () => {
    it('应该能设置用户称呼', async () => {
      await constraintManager.setUserTitle('先生');

      const identity = await constraintManager.getIdentity();
      expect(identity.userTitle).toBe('先生');
    });

    it('应该能设置助手名字', async () => {
      await constraintManager.setAssistantName('贾维斯');

      const identity = await constraintManager.getIdentity();
      expect(identity.assistantName).toBe('贾维斯');
    });

    it('应该能格式化为 System Prompt', async () => {
      const identity = await constraintManager.getIdentity();
      const prompt = constraintManager.formatIdentityForPrompt(identity);

      expect(prompt).toContain('贾维斯');
      expect(prompt).toContain('先生');
    });
  });

  describe('场景2：决策点驱动的记忆检索', () => {
    beforeAll(async () => {
      // 准备测试记忆
      const memories: Partial<MemoryEntry>[] = [
        {
          id: 'test-1',
          type: 'user_preference',
          content: '项目统一使用 pnpm 管理依赖',
          keywords: ['pnpm', '依赖'],
          source: 'user',
          confidence: 1.0,
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 0,
          scope: 'profile',
          volatility: 'permanent',
          significance: 1.0,
          constraint: 'must',
          usageScenarios: ['package-management', 'command-execution'],
          usageCount: 0,
          effectiveCount: 0,
          memoryOriginV2: 'user',
          dreamGeneration: 0,
          evidenceCount: 1,
          dreamCount: 0,
        },
        {
          id: 'test-2',
          type: 'tool_pattern',
          content: '使用 TypeScript 开发',
          keywords: ['TypeScript'],
          source: 'conversation',
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 0,
          scope: 'knowledge',
          volatility: 'stable',
          significance: 0.8,
          constraint: 'should',
          usageScenarios: ['code-style', 'file-creation'],
          usageCount: 0,
          effectiveCount: 0,
          memoryOriginV2: 'agent',
          dreamGeneration: 0,
          evidenceCount: 1,
          dreamCount: 0,
        }
      ];

      for (const memory of memories) {
        store.saveEntry(memory as MemoryEntry);
      }
    });

    it('应该能检测工具调用决策点', async () => {
      const points = await detector.detect({
        toolCall: {
          id: 'test',
          name: 'bash',
          input: { command: 'npm install axios' }
        },
        userMessage: '安装 axios'
      });

      expect(points.length).toBeGreaterThan(0);
      const toolPoint = points.find(p => p.tool === 'bash');
      expect(toolPoint).toBeDefined();
      expect(toolPoint?.type).toBe('command-execution');
    });

    it('应该能基于决策点检索记忆', async () => {
      const points = await detector.detect({
        toolCall: {
          id: 'test',
          name: 'bash',
          input: { command: 'npm install axios' }
        },
        userMessage: '安装 axios'
      });

      const memories = await retriever.retrieve({
        decisionPoints: points,
        userMessage: '安装 axios',
        currentScene: 'package-management'
      });

      expect(memories.length).toBeGreaterThan(0);

      // 应该检索到 must 级别的 pnpm 记忆
      const mustMemory = memories.find(m => m.constraint === 'must');
      expect(mustMemory).toBeDefined();
      expect(mustMemory?.content).toContain('pnpm');
    });

    it('应该按约束级别排序', async () => {
      const points = await detector.detect({
        userMessage: '创建一个 TypeScript 项目'
      });

      const memories = await retriever.retrieve({
        decisionPoints: points,
        userMessage: '创建一个 TypeScript 项目',
        currentScene: 'file-creation'
      });

      if (memories.length >= 2) {
        // must 应该排在 should 前面
        const firstMust = memories.findIndex(m => m.constraint === 'must');
        const firstShould = memories.findIndex(m => m.constraint === 'should');

        if (firstMust >= 0 && firstShould >= 0) {
          expect(firstMust).toBeLessThan(firstShould);
        }
      }
    });
  });

  describe('场景3：做梦机制整理记忆', () => {
    beforeAll(async () => {
      // 准备需要整理的记忆
      const memories: Partial<MemoryEntry>[] = [
        // 相似记忆（待提炼）
        {
          id: 'similar-1',
          type: 'user_preference',
          content: '用户喜欢用 pnpm',
          keywords: ['pnpm'],
          source: 'conversation',
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 0,
          scope: 'profile',
          volatility: 'stable',
          significance: 0.7,
          constraint: 'should',
          usageScenarios: ['package-management'],
          usageCount: 0,
          effectiveCount: 0,
          memoryOriginV2: 'agent',
          dreamGeneration: 0,
          evidenceCount: 1,
          dreamCount: 0,
        },
        // 冗长记忆（待压缩）
        {
          id: 'verbose-1',
          type: 'session_summary',
          content: '用户在上次对话中提到他们的项目是一个 Vue3 项目，使用 TypeScript 开发，配置了 Vite 作为构建工具，并且使用了 Pinia 做状态管理，Router 用的是 Vue Router 4.x 版本，整个项目的技术栈非常现代化，用户对这套技术栈非常满意，希望继续使用这些技术...',
          keywords: ['Vue3', 'TypeScript', 'Vite'],
          source: 'conversation',
          confidence: 0.7,
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 0,
          scope: 'episode',
          volatility: 'normal',
          significance: 0.6,
          constraint: 'may',
          usageScenarios: ['project-context'],
          usageCount: 0,
          effectiveCount: 0,
          memoryOriginV2: 'agent',
          dreamGeneration: 0,
          evidenceCount: 1,
          dreamCount: 0,
        },
        // 低价值记忆（待淘汰）
        {
          id: 'low-value-1',
          type: 'session_summary',
          content: '临时任务：本周完成文档',
          keywords: ['任务', '文档'],
          source: 'conversation',
          confidence: 0.3,
          createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString(), // 200天前
          lastAccessedAt: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString(),
          accessCount: 1,
          scope: 'episode',
          volatility: 'transient',
          significance: 0.2,
          constraint: 'may',
          usageScenarios: ['task-tracking'],
          usageCount: 1,
          effectiveCount: 0,
          memoryOriginV2: 'agent',
          lastUsed: Date.now() - 200 * 24 * 3600 * 1000,
          dreamGeneration: 0,
          evidenceCount: 1,
          dreamCount: 0,
        }
      ];

      for (const memory of memories) {
        store.saveEntry(memory as MemoryEntry);
      }
    });

    it('应该能执行做梦（试运行）', async () => {
      const result = await dreamAgent.dream({ dryRun: true });

      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);

      // 试运行不应该实际修改记忆
      const memory = store.getEntry('low-value-1');
      expect(memory?.deletedAt).toBeUndefined();
    });

    it('应该能检查是否需要做梦', async () => {
      const { should } = await dreamScheduler.shouldDream();

      // 可能需要也可能不需要，取决于记忆数量和时间
      expect(typeof should).toBe('boolean');
    });

    it('应该能记录用户活动', () => {
      const beforeActivity = dreamScheduler['lastActivityTime'];
      dreamScheduler.recordActivity();
      const afterActivity = dreamScheduler['lastActivityTime'];

      expect(afterActivity).toBeGreaterThan(beforeActivity);
    });
  });

  describe('场景4：完整工作流', () => {
    it('应该能完成：设置身份 → 检测决策点 → 检索记忆 → 整理记忆', async () => {
      // 1. 设置身份
      await constraintManager.setUserTitle('老板');
      await constraintManager.setAssistantName('小助手');

      const identity = await constraintManager.getIdentity();
      expect(identity.userTitle).toBe('老板');
      expect(identity.assistantName).toBe('小助手');

      // 2. 检测决策点
      const points = await detector.detect({
        userMessage: '帮我安装依赖',
        toolCall: {
          id: 'test',
          name: 'bash',
          input: { command: 'npm install' }
        }
      });

      expect(points.length).toBeGreaterThan(0);

      // 3. 检索记忆
      const memories = await retriever.retrieve({
        decisionPoints: points,
        userMessage: '帮我安装依赖',
        currentScene: 'package-management'
      });

      expect(memories.length).toBeGreaterThan(0);

      // 4. 做梦整理（试运行）
      const dreamResult = await dreamAgent.dream({ dryRun: true });

      expect(dreamResult).toBeDefined();
      expect(dreamResult.duration).toBeGreaterThan(0);
    });
  });
});
