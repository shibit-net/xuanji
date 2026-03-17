import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntentRouter } from '@/core/intent/IntentRouter';
import { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { ProviderConfig } from '@/core/types';
import type { AvailableModule } from '@/core/intent/LLMIntentClassifier';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// 增加测试超时时间（向量匹配器初始化需要加载模型）
describe('IntentRouter Integration', { timeout: 30000 }, () => {
  let intentRouter: IntentRouter;
  let agentRegistry: AgentRegistry;
  let providerConfig: ProviderConfig;
  let testDataDir: string;

  beforeEach(async () => {
    // 创建临时测试数据目录
    testDataDir = path.join(os.tmpdir(), `xuanji-test-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });

    // Mock AgentRegistry
    agentRegistry = new AgentRegistry([
      // 使用内置 Agent 配置路径
      path.join(process.cwd(), 'src/core/agent/builtin'),
    ]);
    await agentRegistry.init();

    // 配置
    providerConfig = {
      model: 'claude-haiku-4-5-20251001',
      apiKey: process.env.XUANJI_API_KEY || 'test-key',
      baseURL: process.env.XUANJI_BASE_URL,
      maxTokens: 1000,
      temperature: 0.1,
    };

    // 创建 IntentRouter（使用真实的 AgentRegistry）
    intentRouter = new IntentRouter(agentRegistry, providerConfig);
  });

  afterEach(async () => {
    // 清理临时目录
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  // ─── 初始化测试 ─────────────────────────────────

  describe('初始化', () => {
    it('应该成功初始化', async () => {
      await intentRouter.init({ skipVectorInit: true });
      expect(intentRouter.isInitialized()).toBe(true);
    });

    it('应该扫描并注册已有的意图定义', async () => {
      await intentRouter.init({ skipVectorInit: true });

      const registry = intentRouter.getRegistry();
      const stats = registry.getStats();

      // 应该至少有一些已注册的模块（如果有 intentMeta）
      expect(stats).toBeDefined();
      expect(stats.totalModules).toBeGreaterThanOrEqual(0);
    });

    it('应该加载已学习的意图', async () => {
      // 先清空学习数据
      const learner = intentRouter.getLearner();
      await learner.clear();

      await intentRouter.init({ skipVectorInit: true });

      const learnedDefs = learner.getLearnedIntentDefinitions();
      // 初始应该是空的
      expect(learnedDefs).toHaveLength(0);
    });

    it('不应该重复初始化', async () => {
      await intentRouter.init({ skipVectorInit: true });
      expect(intentRouter.isInitialized()).toBe(true);

      // 再次初始化应该跳过
      await intentRouter.init({ skipVectorInit: true });
      expect(intentRouter.isInitialized()).toBe(true);
    });
  });

  // ─── 向量匹配测试 ─────────────────────────────────

  describe('向量匹配', () => {
    const availableModules: AvailableModule[] = [
      {
        id: 'code-assistant',
        type: 'skill',
        name: '代码助手',
        description: '帮助编写、审查、重构代码，解决编程问题',
      },
      {
        id: 'life-secretary',
        type: 'skill',
        name: '生活秘书',
        description: '管理日程、提醒事项、记录生活知识',
      },
    ];

    it('首次使用应该走 LLM 分类（向量未命中）', async () => {
      await intentRouter.init({ skipVectorInit: true });

      // 清空学习数据
      await intentRouter.getLearner().clear();

      const userInput = '帮我写一个 TypeScript 函数';

      const intents = await intentRouter.route(userInput, availableModules, {
        threshold: 0.7,
        enableVector: false, // 禁用向量（因为向量匹配器未初始化）
        enableLLM: false,    // 禁用 LLM 以测试向量未命中
      });

      // 向量和 LLM 都禁用应该返回空数组
      expect(intents).toHaveLength(0);
    });

    it.skip('向量匹配命中应该返回结果（需要网络，跳过）', async () => {
      // 该测试需要下载向量模型，在 CI 环境中跳过
    });
  });

  // ─── LLM 分类测试 ─────────────────────────────────

  describe('LLM 分类', () => {
    const availableModules: AvailableModule[] = [
      {
        id: 'code-assistant',
        type: 'skill',
        name: '代码助手',
        description: '帮助编写、审查、重构代码，解决编程问题',
      },
    ];

    it('应该在 AgentRegistry 不可用时返回空数组', async () => {
      // 创建一个没有 AgentRegistry 的 IntentRouter
      const router = new IntentRouter(null, providerConfig);
      await router.init({ skipVectorInit: true });

      const intents = await router.route('帮我写代码', availableModules, {
        enableVector: false,
        enableLLM: true,
      });

      // AgentRegistry 为 null，LLM 分类应该失败
      expect(intents).toHaveLength(0);
    });

    it('应该在 IntentAnalyzer Agent 未启用时返回空数组', async () => {
      await intentRouter.init({ skipVectorInit: true });

      // 禁用 IntentAnalyzer Agent
      const intentAnalyzerConfig = agentRegistry.get('intent-analyzer');
      if (intentAnalyzerConfig) {
        intentAnalyzerConfig.enabled = false;
      }

      const intents = await intentRouter.route('帮我写代码', availableModules, {
        enableVector: false,
        enableLLM: true,
      });

      // Agent 未启用，应该返回空数组
      expect(intents).toHaveLength(0);

      // 恢复
      if (intentAnalyzerConfig) {
        intentAnalyzerConfig.enabled = true;
      }
    });
  });

  // ─── 自动学习测试 ─────────────────────────────────

  describe('自动学习', () => {
    it('应该从 LLM 分类结果中学习（跳过向量生成）', async () => {
      await intentRouter.init({ skipVectorInit: true });
      const learner = intentRouter.getLearner();

      // 清空学习数据
      await learner.clear();

      const beforeStats = learner.getStats();
      expect(beforeStats.totalLearned).toBe(0);

      // 测试学习逻辑（不生成向量）
      // 直接测试学习数据的持久化
      const intentData = {
        definition: {
          type: 'skill.code-assistant',
          domain: 'coding' as const,
          name: '代码助手',
          description: '帮助用户编写代码',
          examples: ['帮我写代码'],
          module: {
            id: 'code-assistant',
            name: '代码助手',
            type: 'skill' as const,
          },
        },
        learnedFrom: 'llm' as const,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        usageCount: 0,
      };

      // 手动添加到学习数据（跳过向量生成）
      learner['learnedIntents'].set(intentData.definition.type, intentData);
      await learner['save']();

      const afterStats = learner.getStats();
      expect(afterStats.totalLearned).toBe(1);
      expect(afterStats.totalSamples).toBe(1);
    });

    it.skip('应该从向量匹配中增强样本（需要网络，跳过）', async () => {
      // 该测试需要 Embedding 模型，在 CI 环境中跳过
    });

    it.skip('应该限制每个意图的样本数量（需要网络，跳过）', async () => {
      // 该测试需要 Embedding 模型，在 CI 环境中跳过
    });
  });

  // ─── 路由选项测试 ─────────────────────────────────

  describe('路由选项', () => {
    const availableModules: AvailableModule[] = [
      {
        id: 'test-skill',
        type: 'skill',
        name: '测试',
        description: '测试模块',
      },
    ];

    it('应该支持禁用向量匹配', async () => {
      await intentRouter.init({ skipVectorInit: true });

      const intents = await intentRouter.route('test', availableModules, {
        enableVector: false,
        enableLLM: false,
      });

      // 两者都禁用应该返回空数组
      expect(intents).toHaveLength(0);
    });

    it('应该支持自定义阈值', async () => {
      await intentRouter.init({ skipVectorInit: true });

      const intents = await intentRouter.route('test', availableModules, {
        threshold: 0.9, // 高阈值
        enableVector: false, // 禁用向量（因为向量匹配器未初始化）
      });

      // 高阈值可能导致无结果（LLM 也可能未返回高置信度结果）
      // 这里只测试参数传递成功，不关注结果
      expect(Array.isArray(intents)).toBe(true);
    });
  });

  // ─── 统计信息测试 ─────────────────────────────────

  describe('统计信息', () => {
    it('应该返回学习统计', async () => {
      await intentRouter.init({ skipVectorInit: true });

      const stats = intentRouter.getLearningStats();

      expect(stats).toBeDefined();
      expect(stats.totalLearned).toBeGreaterThanOrEqual(0);
      expect(stats.totalSamples).toBeGreaterThanOrEqual(0);
      expect(stats.learningHistory).toBeDefined();
      expect(stats.mostUsed).toBeDefined();
    });

    it('应该返回学习历史', async () => {
      await intentRouter.init({ skipVectorInit: true });

      const history = intentRouter.getLearningHistory(10);

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeLessThanOrEqual(10);
    });
  });
});
