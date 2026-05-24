import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatchAgentTool } from '@/core/tools/MatchAgentTool';

// EmbeddingProvider 接口（与 src 保持一致）
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number;
  dotProduct(vectors: Float32Array, offset: number, query: Float32Array, dimensions: number): number;
}
import type { ConfigurableAgentConfig } from '@/core/agent/types';

// ============================================================
// Mock Agent 工厂
// ============================================================
function createMockAgent(overrides: Partial<ConfigurableAgentConfig> = {}): ConfigurableAgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent for unit testing',
    capabilities: ['testing', 'code review', 'analysis'],
    enabled: true,
    tools: [],
    systemPrompt: null,
    model: { primary: 'claude-sonnet-4' },
    execution: { maxIterations: 10, timeout: 30000 },
    metadata: {},
    ...overrides,
  } as ConfigurableAgentConfig;
}

function createMockAgentRegistry(agents: ConfigurableAgentConfig[] = []) {
  const agentMap = new Map(agents.map(a => [a.id, a]));
  return {
    getAllIds: vi.fn(() => Array.from(agentMap.keys())),
    get: vi.fn((id: string) => agentMap.get(id)),
  };
}

function createMockEmbeddingProvider(score = 0.85): EmbeddingProvider {
  return {
    embed: vi.fn(async (text: string) => {
      return new Array(10).fill(0).map((_, i) => (text.length + i) / 100);
    }),
    cosineSimilarity: vi.fn(() => score),
    dotProduct: vi.fn(() => score),
  } as unknown as EmbeddingProvider;
}

// ============================================================
// 工具函数：创建带 embedding 的完整可用 tool
// ============================================================
function createToolWithEmbedding(agentOverrides?: Partial<ConfigurableAgentConfig>, vectorScore = 0.85) {
  const tool = new MatchAgentTool();
  const agent = createMockAgent(agentOverrides || {});
  const registry = createMockAgentRegistry([agent]);
  const embedding = createMockEmbeddingProvider(vectorScore);
  tool.setDependencies({ agentRegistry: registry as any, embeddingProvider: embedding });
  return { tool, agent, registry, embedding };
}

describe('MatchAgentTool', () => {
  let tool: MatchAgentTool;

  beforeEach(() => {
    tool = new MatchAgentTool();
  });

  // ============================================================
  // 元数据测试
  // ============================================================
  describe('工具元数据', () => {
    it('应有正确的工具名和 schema', () => {
      expect(tool.name).toBe('match_agent');
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.required).toContain('task_description');
    });

    it('应为只读工具', () => {
      expect(tool.readonly).toBe(true);
    });
  });

  // ============================================================
  // 初始化校验
  // ============================================================
  describe('初始化校验', () => {
    it('AgentRegistry 未初始化时应返回系统错误', async () => {
      const result = await tool.execute({ task_description: 'test task' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('AgentRegistry 未初始化');
    });
  });

  // ============================================================
  // 参数校验
  // ============================================================
  describe('参数校验', () => {
    beforeEach(() => {
      const mockRegistry = createMockAgentRegistry([createMockAgent()]);
      const mockEmbedding = createMockEmbeddingProvider();
      tool.setDependencies({ agentRegistry: mockRegistry as any, embeddingProvider: mockEmbedding });
    });

    it('task_description 为空时应返回参数错误', async () => {
      const result = await tool.execute({ task_description: '' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('参数错误');
    });

    it('缺少 task_description 时应返回参数错误', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('参数错误');
    });
  });

  // ============================================================
  // 向量模型不可用
  // ============================================================
  describe('向量模型不可用', () => {
    it('无 embedding provider 时应返回错误并触发下载回调', async () => {
      const onDownload = vi.fn();
      const mockRegistry = createMockAgentRegistry([createMockAgent()]);
      tool.setDependencies({ agentRegistry: mockRegistry as any, onMissingEmbedding: onDownload });

      const result = await tool.execute({ task_description: 'test task' });

      expect(onDownload).toHaveBeenCalledOnce();
      expect(result.isError).toBe(true);
      expect(result.content).toContain('向量模型未安装');
      expect(result.content).toContain('list_agents');
    });

    it('无 embedding provider 且无回调时仍返回错误', async () => {
      const mockRegistry = createMockAgentRegistry([createMockAgent()]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('向量模型未安装');
    });
  });

  // ============================================================
  // 资源错误
  // ============================================================
  describe('资源错误', () => {
    it('没有可用 agent 时应返回资源错误', async () => {
      const mockRegistry = createMockAgentRegistry([]);
      const mockEmbedding = createMockEmbeddingProvider();
      tool.setDependencies({ agentRegistry: mockRegistry as any, embeddingProvider: mockEmbedding });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('没有可用的 agent');
    });

    it('主 agent、系统 agent、internal agent 应被过滤', async () => {
      const agents = [
        createMockAgent({ id: 'main', metadata: { isMainAgent: true } }),
        createMockAgent({ id: 'sys', metadata: { category: 'system' } }),
        createMockAgent({ id: 'internal', metadata: { internal: true } }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      const mockEmbedding = createMockEmbeddingProvider();
      tool.setDependencies({ agentRegistry: mockRegistry as any, embeddingProvider: mockEmbedding });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('没有可用的 agent');
    });
  });

  // ============================================================
  // 基本匹配功能（纯向量）
  // ============================================================
  describe('基本匹配功能', () => {
    it('应成功返回向量匹配结果', async () => {
      const { tool, embedding } = createToolWithEmbedding(
        { id: 'code-analyzer', name: 'Code Analyzer', description: 'Analyze code quality' },
        0.85
      );

      const result = await tool.execute({ task_description: 'analyze code quality' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Code Analyzer');
      expect(result.content).toContain('code-analyzer');
      expect(embedding.embed).toHaveBeenCalled();
      expect(embedding.cosineSimilarity).toHaveBeenCalled();
    });

    it('匹配结果应包含分数', async () => {
      const { tool } = createToolWithEmbedding(
        { id: 'code-analyzer', name: 'Code Analyzer', description: 'Analyze code' },
        0.72
      );

      const result = await tool.execute({ task_description: 'analyze code quality' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('72%');
    });

    it('分数低于阈值时应返回无匹配', async () => {
      const { tool } = createToolWithEmbedding(
        { id: 'code-analyzer', name: 'Code Analyzer', description: 'Analyze code' },
        0.2
      );

      const result = await tool.execute({ task_description: 'analyze code quality' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('未找到匹配的 agent');
      expect(result.content).toContain('list_agents');
    });
  });

  // ============================================================
  // top_k 参数
  // ============================================================
  describe('top_k 参数', () => {
    let multiTool: MatchAgentTool;

    beforeEach(() => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent 1', description: 'First agent', capabilities: ['a'] }),
        createMockAgent({ id: 'agent-2', name: 'Agent 2', description: 'Second agent', capabilities: ['b'] }),
        createMockAgent({ id: 'agent-3', name: 'Agent 3', description: 'Third agent', capabilities: ['c'] }),
        createMockAgent({ id: 'agent-4', name: 'Agent 4', description: 'Fourth agent', capabilities: ['d'] }),
        createMockAgent({ id: 'agent-5', name: 'Agent 5', description: 'Fifth agent', capabilities: ['e'] }),
      ];
      const registry = createMockAgentRegistry(agents);
      const embedding = createMockEmbeddingProvider(0.6);
      multiTool = new MatchAgentTool();
      multiTool.setDependencies({ agentRegistry: registry as any, embeddingProvider: embedding });
    });

    it('默认返回 top 3', async () => {
      const result = await multiTool.execute({ task_description: 'test task' });
      expect(result.content).toContain('Top 3');
    });

    it('支持自定义 top_k', async () => {
      const result = await multiTool.execute({ task_description: 'test task', top_k: 2 });
      expect(result.content).toContain('Top 2');
    });

    it('top_k 最大为 5', async () => {
      const result = await multiTool.execute({ task_description: 'test task', top_k: 10 });
      expect(result.content).toContain('Top 5');
    });
  });

  // ============================================================
  // preferred_agent
  // ============================================================
  describe('preferred_agent', () => {
    let prefTool: MatchAgentTool;

    beforeEach(() => {
      const agents = [
        createMockAgent({
          id: 'code-analyzer', name: 'Code Analyzer',
          description: 'Analyze code quality and security',
          capabilities: ['code analysis', 'security review'],
        }),
        createMockAgent({
          id: 'doc-writer', name: 'Doc Writer',
          description: 'Write documentation',
          capabilities: ['writing', 'documentation'],
        }),
      ];
      const registry = createMockAgentRegistry(agents);
      const embedding = createMockEmbeddingProvider(0.6);
      prefTool = new MatchAgentTool();
      prefTool.setDependencies({ agentRegistry: registry as any, embeddingProvider: embedding });
    });

    it('preferred_agent 匹配度足够时应显示验证通过', async () => {
      const result = await prefTool.execute({
        task_description: 'code analysis and review',
        preferred_agent: 'code-analyzer',
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('👉');
      expect(result.content).toContain('← 推荐');
    });

    it('preferred_agent 不存在时应返回资源错误', async () => {
      const result = await prefTool.execute({
        task_description: 'test task',
        preferred_agent: 'non-existent',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('不存在或已被禁用');
    });

    it('preferred_agent 被禁用时应返回资源错误', async () => {
      const agents = [
        createMockAgent({ id: 'disabled', name: 'Disabled', description: 'disabled', capabilities: [], enabled: false }),
        createMockAgent({ id: 'enabled', name: 'Enabled', description: 'enabled', capabilities: [], enabled: true }),
      ];
      const registry = createMockAgentRegistry(agents);
      const embedding = createMockEmbeddingProvider(0.8);
      const t = new MatchAgentTool();
      t.setDependencies({ agentRegistry: registry as any, embeddingProvider: embedding });

      const result = await t.execute({
        task_description: 'test',
        preferred_agent: 'disabled',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('不存在或已被禁用');
    });
  });

  // ============================================================
  // EmbeddingProvider 异常
  // ============================================================
  describe('EmbeddingProvider 异常', () => {
    it('向量计算抛出异常时不应影响整体匹配（该 agent 得分为 0）', async () => {
      const failingEmbedding = {
        embed: vi.fn(async () => { throw new Error('Embedding failed'); }),
        cosineSimilarity: vi.fn(() => { throw new Error('Similarity failed'); }),
        dotProduct: vi.fn(() => { throw new Error('Similarity failed'); }),
      } as unknown as EmbeddingProvider;

      const agent = createMockAgent({ id: 'test', name: 'Test', description: 'test', capabilities: ['test'] });
      const registry = createMockAgentRegistry([agent]);
      const t = new MatchAgentTool();
      t.setDependencies({ agentRegistry: registry as any, embeddingProvider: failingEmbedding });

      // 向量失败 → 得分为 0 → 低于阈值 → 返回无匹配
      const result = await t.execute({ task_description: 'test task' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('未找到匹配的 agent');
    });
  });

  // ============================================================
  // 评分与排序
  // ============================================================
  describe('评分与排序', () => {
    it('高相似度 agent 应排在前面', async () => {
      const agents = [
        createMockAgent({ id: 'poor', name: 'Poor', description: 'irrelevant', capabilities: ['x'] }),
        createMockAgent({ id: 'good', name: 'Good', description: 'testing code', capabilities: ['testing'] }),
      ];
      const registry = createMockAgentRegistry(agents);

      // 用不同的相似度分数
      let callCount = 0;
      const scoredEmbedding = {
        embed: vi.fn(async () => new Array(10).fill(0).map((_, i) => (10 + i) / 100)),
        cosineSimilarity: vi.fn(() => {
          callCount++;
          // good agent 得分 0.8, poor agent 得分 0.3
          return callCount === 1 ? 0.3 : 0.8;
        }),
        dotProduct: vi.fn(() => {
          callCount++;
          return callCount === 1 ? 0.3 : 0.8;
        }),
      } as unknown as EmbeddingProvider;

      const t = new MatchAgentTool();
      t.setDependencies({ agentRegistry: registry as any, embeddingProvider: scoredEmbedding });

      const result = await t.execute({ task_description: 'test code' });
      const goodIdx = result.content.indexOf('Good');
      const poorIdx = result.content.indexOf('Poor');

      expect(goodIdx).toBeGreaterThan(0);
      expect(poorIdx).toBeGreaterThan(0);
      expect(goodIdx).toBeLessThan(poorIdx);
    });

    it('preferred_agent 1.5x 加权后应提升排名', async () => {
      const agents = [
        createMockAgent({ id: 'agent-a', name: 'Agent A', description: 'general', capabilities: ['general'] }),
        createMockAgent({ id: 'preferred', name: 'Preferred', description: 'specific', capabilities: ['specific'] }),
      ];
      const registry = createMockAgentRegistry(agents);
      const embedding = createMockEmbeddingProvider(0.5);
      const t = new MatchAgentTool();
      t.setDependencies({ agentRegistry: registry as any, embeddingProvider: embedding });

      const result = await t.execute({
        task_description: 'general task',
        preferred_agent: 'preferred',
      });

      expect(result.content).toContain('👉');
      expect(result.content).toContain('← 推荐');
    });
  });

  // ============================================================
  // 输出格式
  // ============================================================
  describe('输出格式', () => {
    it('应包含任务描述', async () => {
      const { tool } = createToolWithEmbedding({ id: 'test', name: 'Test' }, 0.6);
      const result = await tool.execute({ task_description: 'my custom task' });
      expect(result.content).toContain('Task: "my custom task"');
    });

    it('preferred_agent 匹配时应显示决策建议', async () => {
      const { tool } = createToolWithEmbedding(
        { id: 'test-agent', name: 'Test Agent', description: 'testing tool', capabilities: ['testing'] },
        0.6
      );
      const result = await tool.execute({
        task_description: 'testing something',
        preferred_agent: 'test-agent',
      });

      expect(result.content).toContain('💡 Decision:');
      expect(result.content).toContain('task({ subagent_type: "test-agent"');
    });
  });
});
