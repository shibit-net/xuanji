import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatchAgentTool } from '@/core/tools/MatchAgentTool';
// EmbeddingProvider interface (embedding模块已删除，保留接口用于测试)
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number;
  embedBatch?: any;
  computeSimilarity?: any;
  findMostSimilar?: any;
  getModelId?: any;
  getDimensions?: any;
  init?: any;
  updateConfig?: any;
  getService?: any;
}
import type { ConfigurableAgentConfig } from '@/core/agent/types';

// ============================================================
// Mock Agent 工厂函数
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

// ============================================================
// Mock AgentRegistry 工厂函数
// ============================================================
function createMockAgentRegistry(agents: ConfigurableAgentConfig[] = []) {
  const agentMap = new Map(agents.map(a => [a.id, a]));
  return {
    getAllIds: vi.fn(() => Array.from(agentMap.keys())),
    get: vi.fn((id: string) => agentMap.get(id)),
  };
}

// ============================================================
// Mock EmbeddingProvider 工厂函数
// ============================================================
function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: vi.fn(async (text: string) => {
      // Return a simple mock vector based on text length for deterministic behavior
      return new Array(10).fill(0).map((_, i) => (text.length + i) / 100);
    }),
    cosineSimilarity: vi.fn((_vec1: number[] | Float32Array, _vec2: number[] | Float32Array) => {
      // Return a high similarity (0.85) for deterministic testing
      return 0.85;
    }),
    embedBatch: vi.fn(),
    computeSimilarity: vi.fn(),
    findMostSimilar: vi.fn(),
    getModelId: vi.fn(() => 'mock-model'),
    getDimensions: vi.fn(() => 10),
    init: vi.fn(),
    updateConfig: vi.fn(),
    getService: vi.fn(),
  } as unknown as EmbeddingProvider;
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

    it('input_schema 应定义所有字段', () => {
      const props = tool.input_schema.properties as Record<string, any>;
      expect(props).toBeDefined();
      expect(props.task_description).toBeDefined();
      expect(props.task_description.type).toBe('string');
      expect(props.preferred_agent).toBeDefined();
      expect(props.preferred_agent.type).toBe('string');
      expect(props.top_k).toBeDefined();
      expect(props.top_k.type).toBe('number');
    });

    it('应为只读工具', () => {
      expect(tool.readonly).toBe(true);
    });

    it('isWriteOperation 应返回 false', () => {
      expect(tool.isWriteOperation()).toBe(false);
    });
  });

  // ============================================================
  // 初始化校验
  // ============================================================
  describe('初始化校验', () => {
    it('AgentRegistry 未初始化时应返回系统错误', async () => {
      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('系统错误');
      expect(result.content).toContain('AgentRegistry 未初始化');
    });
  });

  // ============================================================
  // 参数校验
  // ============================================================
  describe('参数校验', () => {
    beforeEach(() => {
      const mockRegistry = createMockAgentRegistry([createMockAgent()]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });
    });

    it('task_description 为空时应返回参数错误', async () => {
      const result = await tool.execute({ task_description: '' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('参数错误');
      expect(result.content).toContain('缺少必需参数 task_description');
    });

    it('task_description 为纯空格时应返回参数错误', async () => {
      const result = await tool.execute({ task_description: '   ' });

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
  // 资源错误
  // ============================================================
  describe('资源错误', () => {
    it('没有可用 agent 时应返回资源错误', async () => {
      const mockRegistry = createMockAgentRegistry([]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('资源错误');
      expect(result.content).toContain('没有可用的 agent');
    });

    it('所有 agent 都被禁用时应返回资源错误', async () => {
      const disabledAgent = createMockAgent({ id: 'disabled-1', enabled: false });
      const mockRegistry = createMockAgentRegistry([disabledAgent]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('资源错误');
    });

    it('主 agent 应被过滤掉', async () => {
      const mainAgent = createMockAgent({
        id: 'main-agent',
        metadata: { isMainAgent: true },
      });
      const mockRegistry = createMockAgentRegistry([mainAgent]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('没有可用的 agent');
    });

    it('系统 agent 应被过滤掉', async () => {
      const systemAgent = createMockAgent({
        id: 'system-agent',
        metadata: { category: 'system' },
      });
      const mockRegistry = createMockAgentRegistry([systemAgent]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('没有可用的 agent');
    });

    it('内部 agent 应被过滤掉', async () => {
      const internalAgent = createMockAgent({
        id: 'internal-agent',
        metadata: { internal: true },
      });
      const mockRegistry = createMockAgentRegistry([internalAgent]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('没有可用的 agent');
    });
  });

  // ============================================================
  // 基本匹配功能
  // ============================================================
  describe('基本匹配功能', () => {
    let mockRegistry: ReturnType<typeof createMockAgentRegistry>;

    beforeEach(() => {
      const agent = createMockAgent({
        id: 'code-analyzer',
        name: 'Code Analyzer',
        description: 'Analyze code quality and security',
        capabilities: ['code analysis', 'security review', 'performance optimization'],
      });
      mockRegistry = createMockAgentRegistry([agent]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });
    });

    it('应成功返回匹配结果', async () => {
      const result = await tool.execute({ task_description: 'analyze code quality' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Task: "analyze code quality"');
      expect(result.content).toContain('Code Analyzer');
      expect(result.content).toContain('code-analyzer');
      expect(result.content).toContain('Top');
    });

    it('匹配结果应包含评分信息', async () => {
      const result = await tool.execute({ task_description: 'analyze code quality' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Match:');
      expect(result.content).toContain('%');
      expect(result.content).toContain('Reason:');
    });

    it('返回结果应包含建议语', async () => {
      const result = await tool.execute({ task_description: 'analyze code quality' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Recommendation');
    });
  });

  // ============================================================
  // top_k 参数测试
  // ============================================================
  describe('top_k 参数', () => {
    beforeEach(() => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent 1', description: 'First test agent', capabilities: ['a'] }),
        createMockAgent({ id: 'agent-2', name: 'Agent 2', description: 'Second test agent', capabilities: ['b'] }),
        createMockAgent({ id: 'agent-3', name: 'Agent 3', description: 'Third test agent', capabilities: ['c'] }),
        createMockAgent({ id: 'agent-4', name: 'Agent 4', description: 'Fourth test agent', capabilities: ['d'] }),
        createMockAgent({ id: 'agent-5', name: 'Agent 5', description: 'Fifth test agent', capabilities: ['e'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setDependencies({ agentRegistry: mockRegistry as any });
    });

    it('默认返回 top 3 个结果', async () => {
      const result = await tool.execute({ task_description: 'test task' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Top 3');
    });

    it('应支持自定义 top_k 值', async () => {
      const result = await tool.execute({ task_description: 'test task', top_k: 2 });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Top 2');
    });

    it('top_k 最大为 5', async () => {
      const result = await tool.execute({ task_description: 'test task', top_k: 10 });

      expect(result.isError).toBe(false);
      // Should be capped at 5 (we have 5 agents)
      expect(result.content).toContain('Top 5');
    });

    it('top_k 为 1 时只返回 1 个结果', async () => {
      const result = await tool.execute({ task_description: 'test task', top_k: 1 });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Top 1');
    });
  });

  // ============================================================
  // preferred_agent 测试
  // ============================================================
  describe('preferred_agent 参数', () => {
    let mockRegistry: ReturnType<typeof createMockAgentRegistry>;

    beforeEach(() => {
      const agents = [
        createMockAgent({
          id: 'code-analyzer',
          name: 'Code Analyzer',
          description: 'Analyze code quality and security',
          capabilities: ['code analysis', 'security review'],
        }),
        createMockAgent({
          id: 'doc-writer',
          name: 'Doc Writer',
          description: 'Write documentation and guides',
          capabilities: ['writing', 'documentation'],
        }),
      ];
      mockRegistry = createMockAgentRegistry(agents);
      tool.setDependencies({ agentRegistry: mockRegistry as any });
    });

    it('preferred_agent 存在且匹配度足够时应在结果中显示验证通过', async () => {
      const result = await tool.execute({
        task_description: 'code analysis and review',
        preferred_agent: 'code-analyzer',
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('✅ 推荐的 agent "code-analyzer" 存在且匹配');
      expect(result.content).toContain('👉');
      expect(result.content).toContain('← 推荐');
      expect(result.content).toContain('直接使用推荐的 agent');
    });

    it('preferred_agent 不存在时应返回资源错误', async () => {
      const result = await tool.execute({
        task_description: 'test task',
        preferred_agent: 'non-existent-agent',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('资源错误');
      expect(result.content).toContain('推荐的 agent "non-existent-agent" 不存在或已被禁用');
      expect(result.content).toContain('创建临时 agent');
    });

    it('preferred_agent 被禁用时应返回资源错误', async () => {
      const disabledAgent = createMockAgent({
        id: 'disabled-agent',
        name: 'Disabled Agent',
        description: 'This agent is disabled',
        capabilities: ['test'],
        enabled: false,
      });
      const enabledAgent = createMockAgent({
        id: 'enabled-agent',
        name: 'Enabled Agent',
        description: 'This agent is enabled',
        capabilities: ['general'],
        enabled: true,
      });
      const agentsMock = createMockAgentRegistry([disabledAgent, enabledAgent]);
      tool.setDependencies({ agentRegistry: agentsMock as any });

      const result = await tool.execute({
        task_description: 'test task',
        preferred_agent: 'disabled-agent',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('不存在或已被禁用');
    });

    it('preferred_agent 匹配度不足时应提示创建临时 agent', async () => {
      // Use a task description that doesn't match the agent well
      const result = await tool.execute({
        task_description: 'completely unrelated topic like cooking recipes',
        preferred_agent: 'code-analyzer',
      });

      expect(result.isError).toBe(false);
      // Should warn about insufficient matching
      expect(result.content).toContain('⚠️');
      expect(result.content).toContain('匹配度不足');
      expect(result.content).toContain('创建临时 agent');
    });
  });

  // ============================================================
  // 多 Agent 匹配测试
  // ============================================================
  describe('多 Agent 匹配', () => {
    it('应能处理多个 agent 并按分数排序', async () => {
      const agents = [
        createMockAgent({
          id: 'code-analyzer',
          name: 'Code Analyzer',
          description: 'Analyze code quality and security',
          capabilities: ['code analysis', 'security review'],
        }),
        createMockAgent({
          id: 'doc-writer',
          name: 'Doc Writer',
          description: 'Write documentation and guides',
          capabilities: ['writing', 'documentation'],
        }),
        createMockAgent({
          id: 'test-writer',
          name: 'Test Writer',
          description: 'Write unit tests and integration tests',
          capabilities: ['testing', 'unit tests', 'integration'],
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({
        task_description: 'write unit tests for the codebase',
      });

      expect(result.isError).toBe(false);
      // The test-writer agent should rank higher for this task
      expect(result.content).toContain('Test Writer');
      expect(result.content).toContain('test-writer');
    });
  });

  // ============================================================
  // EmbeddingProvider 集成测试
  // ============================================================
  describe('EmbeddingProvider 集成', () => {
    let mockEmbeddingProvider: EmbeddingProvider;

    beforeEach(() => {
      const agent = createMockAgent({
        id: 'code-analyzer',
        name: 'Code Analyzer',
        description: 'Analyze code quality and security',
        capabilities: ['code analysis', 'security review'],
      });
      const mockRegistry = createMockAgentRegistry([agent]);
      mockEmbeddingProvider = createMockEmbeddingProvider();
      tool.setDependencies({
        agentRegistry: mockRegistry as any,
        embeddingProvider: mockEmbeddingProvider,
      });
    });

    it('有 EmbeddingProvider 时应调用向量匹配', async () => {
      const result = await tool.execute({ task_description: 'analyze code quality' });

      expect(result.isError).toBe(false);
      expect(mockEmbeddingProvider.embed).toHaveBeenCalled();
      expect(mockEmbeddingProvider.cosineSimilarity).toHaveBeenCalled();
      expect(result.content).toContain('Semantic:');
    });

    it('有 EmbeddingProvider 时 breakdown 应包含 vector 分数', async () => {
      const result = await tool.execute({ task_description: 'analyze code quality' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Semantic:');
      expect(result.content).toContain('Breakdown:');
    });

    it('EmbeddingProvider 抛出异常时不应影响整体匹配', async () => {
      const failingEmbedding = {
        ...mockEmbeddingProvider,
        embed: vi.fn(async () => { throw new Error('Embedding failed'); }),
        cosineSimilarity: vi.fn(() => { throw new Error('Similarity failed'); }),
      } as unknown as EmbeddingProvider;

      const agent = createMockAgent({
        id: 'code-analyzer',
        name: 'Code Analyzer',
        description: 'Analyze code quality',
        capabilities: ['code analysis'],
      });
      const mockRegistry = createMockAgentRegistry([agent]);
      tool.setDependencies({
        agentRegistry: mockRegistry as any,
        embeddingProvider: failingEmbedding,
      });

      const result = await tool.execute({ task_description: 'analyze code quality' });

      // Should still succeed without vector scores
      expect(result.isError).toBe(false);
      expect(result.content).toContain('Code Analyzer');
      // Should not contain semantic breakdown since it failed
      expect(result.content).not.toContain('Semantic:');
    });
  });

  // ============================================================
  // 排序与评分验证
  // ============================================================
  describe('评分与排序', () => {
    it('分数最高的 agent 应排在第一位', async () => {
      const agents = [
        createMockAgent({
          id: 'poor-match',
          name: 'Poor Match',
          description: 'irrelevant stuff',
          capabilities: ['cooking', 'baking'],
        }),
        createMockAgent({
          id: 'good-match',
          name: 'Good Match',
          description: 'code testing and quality analysis',
          capabilities: ['testing', 'code analysis', 'quality assurance'],
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({
        task_description: 'test code quality and analysis',
      });

      expect(result.isError).toBe(false);
      // good-match should appear first in the list
      const goodMatchIndex = result.content.indexOf('Good Match');
      const poorMatchIndex = result.content.indexOf('Poor Match');
      expect(goodMatchIndex).toBeGreaterThan(0);
      expect(poorMatchIndex).toBeGreaterThan(0);
      expect(goodMatchIndex).toBeLessThan(poorMatchIndex);
    });

    it('preferred_agent 加权后应提升排名', async () => {
      const agents = [
        createMockAgent({
          id: 'agent-a',
          name: 'Agent A',
          description: 'general purpose agent',
          capabilities: ['general'],
        }),
        createMockAgent({
          id: 'preferred-one',
          name: 'Preferred One',
          description: 'specialized agent',
          capabilities: ['specialized', 'specific'],
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({
        task_description: 'general task for testing',
        preferred_agent: 'preferred-one',
      });

      expect(result.isError).toBe(false);
      // preferred-one should have the 👉 marker showing it's preferred
      expect(result.content).toContain('👉');
      expect(result.content).toContain('← 推荐');
    });
  });

  // ============================================================
  // 输出格式测试
  // ============================================================
  describe('输出格式', () => {
    it('应包含任务描述', async () => {
      const agent = createMockAgent();
      const mockRegistry = createMockAgentRegistry([agent]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({ task_description: 'my custom task' });

      expect(result.content).toContain('Task: "my custom task"');
    });

    it('应包含推荐决策说明', async () => {
      const agent = createMockAgent();
      const mockRegistry = createMockAgentRegistry([agent]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({ task_description: 'test task' });

      expect(result.content).toContain('Recommendation');
      expect(result.content).toContain('list_agents');
    });

    it('preferred_agent 存在时应显示决策建议', async () => {
      const agent = createMockAgent({
        id: 'test-agent',
        name: 'Test Agent',
        description: 'testing tool',
        capabilities: ['testing'],
      });
      const mockRegistry = createMockAgentRegistry([agent]);
      tool.setDependencies({ agentRegistry: mockRegistry as any });

      const result = await tool.execute({
        task_description: 'testing something',
        preferred_agent: 'test-agent',
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('💡 Decision:');
      // Should recommend using the preferred agent directly
      expect(result.content).toContain('task({ subagent_type: "test-agent"');
    });
  });
});
