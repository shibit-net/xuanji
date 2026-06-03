import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListAgentsTool } from '@/tools/ListAgentsTool';
import type { ConfigurableAgentConfig } from '@/agent/types';

// ============================================================
// Mock Agent 工厂函数
// ============================================================
function createMockAgent(overrides: Partial<ConfigurableAgentConfig> = {}): ConfigurableAgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent for unit testing',
    capabilities: ['testing', 'code review', 'analysis'],
    tags: ['test', 'general'],
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
    getEnabled: vi.fn(() => agents.filter(a => a.enabled !== false)),
    getAll: vi.fn(() => agents),
  };
}

describe('ListAgentsTool', () => {
  let tool: ListAgentsTool;

  beforeEach(() => {
    tool = new ListAgentsTool();
  });

  // ============================================================
  // 元数据测试
  // ============================================================
  describe('工具元数据', () => {
    it('工具名称应为 list_agents', () => {
      expect(tool.name).toBe('list_agents');
    });

    it('应有详细的工具描述', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description).toContain('available agents');
      expect(tool.description).toContain('capabilities');
    });

    it('input_schema 应定义 filter 对象并包含所有过滤字段', () => {
      const props = tool.input_schema.properties as Record<string, any>;
      expect(props).toBeDefined();
      expect(props.filter).toBeDefined();
      expect(props.filter.type).toBe('object');

      const filterProps = props.filter.properties;
      expect(filterProps.tags).toBeDefined();
      expect(filterProps.tags.type).toBe('array');
      expect(filterProps.tags.items.type).toBe('string');

      expect(filterProps.search).toBeDefined();
      expect(filterProps.search.type).toBe('string');

      expect(filterProps.enabled_only).toBeDefined();
      expect(filterProps.enabled_only.type).toBe('boolean');

      expect(filterProps.include_subagents).toBeDefined();
      expect(filterProps.include_subagents.type).toBe('boolean');
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
    it('AgentRegistry 未初始化时应返回错误', async () => {
      const result = await tool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('AgentRegistry not available');
    });
  });

  // ============================================================
  // 基本功能
  // ============================================================
  describe('基本功能', () => {
    it('应列出所有 agent（不传任何过滤参数）', async () => {
      const agents = [
        createMockAgent({
          id: 'agent-1',
          name: 'Agent One',
          description: 'First test agent',
          capabilities: ['coding', 'debugging'],
          tags: ['dev'],
          metadata: { internal: false, filePath: '/custom/agent-1.yaml' },
        }),
        createMockAgent({
          id: 'agent-2',
          name: 'Agent Two',
          description: 'Second test agent',
          capabilities: ['writing', 'review'],
          tags: ['docs'],
          metadata: { internal: true, filePath: '/builtin/agent-2.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 2 agent(s)');
      expect(result.content).toContain('Agent One');
      expect(result.content).toContain('agent-1');
      expect(result.content).toContain('Agent Two');
      expect(result.content).toContain('agent-2');
    });

    it('应正确通过 getEnabled 获取 agent 列表', async () => {
      const agent = createMockAgent({ id: 'my-agent' });
      const mockRegistry = createMockAgentRegistry([agent]);
      tool.setAgentRegistry(mockRegistry as any);

      await tool.execute({});

      expect(mockRegistry.getEnabled).toHaveBeenCalledTimes(1);
    });

    it('应处理 3 个以上 agent 的场景', async () => {
      const agents = [
        createMockAgent({ id: 'a1', name: 'Alpha', metadata: { internal: false, filePath: '/custom/a1.yaml' } }),
        createMockAgent({ id: 'a2', name: 'Beta', metadata: { internal: false, filePath: '/custom/a2.yaml' } }),
        createMockAgent({ id: 'a3', name: 'Gamma', metadata: { internal: true, filePath: '/builtin/gamma.yaml' } }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 3 agent(s)');
      expect(result.content).toContain('Alpha');
      expect(result.content).toContain('Beta');
      expect(result.content).toContain('Gamma');
    });
  });

  // ============================================================
  // enabled_only 过滤
  // ============================================================
  describe('enabled_only 过滤', () => {
    it('默认应只显示启用的 agent（enabledOnly 默认为 true）', async () => {
      const agents = [
        createMockAgent({ id: 'enabled-1', name: 'Enabled One', enabled: true }),
        createMockAgent({ id: 'disabled-1', name: 'Disabled One', enabled: false }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Enabled One');
      expect(result.content).not.toContain('Disabled One');
    });

    it('enabled_only 为 true 时应过滤掉禁用的 agent', async () => {
      const agents = [
        createMockAgent({ id: 'enabled-1', name: 'Enabled One', enabled: true }),
        createMockAgent({ id: 'disabled-1', name: 'Disabled One', enabled: false }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { enabled_only: true },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Enabled One');
      expect(result.content).not.toContain('Disabled One');
    });

    it('enabled_only 为 false 时应显示所有 agent（包括禁用的）', async () => {
      const agents = [
        createMockAgent({ id: 'enabled-1', name: 'Enabled One', enabled: true }),
        createMockAgent({ id: 'disabled-1', name: 'Disabled One', enabled: false }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { enabled_only: false },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 2 agent(s)');
      expect(result.content).toContain('Enabled One');
      expect(result.content).toContain('Disabled One');
    });

    it('enabled 字段未定义时应视为已启用', async () => {
      const agents = [
        createMockAgent({ id: 'no-enabled-field', name: 'No Enabled Field' }),
      ];
      // Remove enabled field to test undefined behavior
      delete (agents[0] as any).enabled;
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('No Enabled Field');
    });
  });

  // ============================================================
  // include_subagents 过滤
  // ============================================================
  describe('include_subagents 过滤', () => {
    it('include_subagents 为 false 时应过滤掉 internal agent', async () => {
      const agents = [
        createMockAgent({
          id: 'explore',
          name: 'Explore Agent',
          metadata: { internal: true, filePath: '/builtin/explore.yaml' },
        }),
        createMockAgent({
          id: 'custom-agent',
          name: 'Custom Agent',
          metadata: { internal: false, filePath: '/custom/my-agent.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { include_subagents: false },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Custom Agent');
      expect(result.content).not.toContain('Explore Agent');
    });

    it('include_subagents 默认为 true 时应包含 internal agent', async () => {
      const agents = [
        createMockAgent({
          id: 'explore',
          name: 'Explore Agent',
          metadata: { internal: true, filePath: '/builtin/explore.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Explore Agent');
    });
  });

  // ============================================================
  // tags 过滤
  // ============================================================
  describe('tags 过滤', () => {
    it('应返回匹配指定标签的 agent', async () => {
      const agents = [
        createMockAgent({
          id: 'finance-agent',
          name: 'Finance Agent',
          tags: ['finance', 'analysis'],
        }),
        createMockAgent({
          id: 'coding-agent',
          name: 'Coding Agent',
          tags: ['coding', 'dev'],
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { tags: ['finance'] },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Finance Agent');
      expect(result.content).not.toContain('Coding Agent');
    });

    it('应支持多个标签的 OR 匹配（任一匹配即可）', async () => {
      const agents = [
        createMockAgent({
          id: 'finance-agent',
          name: 'Finance Agent',
          tags: ['finance', 'analysis'],
        }),
        createMockAgent({
          id: 'coding-agent',
          name: 'Coding Agent',
          tags: ['coding', 'dev'],
        }),
        createMockAgent({
          id: 'docs-agent',
          name: 'Docs Agent',
          tags: ['docs'],
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { tags: ['finance', 'coding'] },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 2 agent(s)');
      expect(result.content).toContain('Finance Agent');
      expect(result.content).toContain('Coding Agent');
      expect(result.content).not.toContain('Docs Agent');
    });

    it('tags 为空数组时应返回所有 agent', async () => {
      const agents = [
        createMockAgent({ id: 'agent-a', name: 'Agent A', tags: ['x'] }),
        createMockAgent({ id: 'agent-b', name: 'Agent B', tags: ['y'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { tags: [] },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 2 agent(s)');
    });
  });

  // ============================================================
  // search 关键词搜索
  // ============================================================
  describe('search 关键词搜索', () => {
    it('应通过 id 匹配搜索关键词', async () => {
      const agents = [
        createMockAgent({ id: 'code-analyzer', name: 'CA', description: 'some tool', capabilities: ['x'] }),
        createMockAgent({ id: 'doc-writer', name: 'DW', description: 'some tool', capabilities: ['y'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { search: 'code-analyzer' },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('code-analyzer');
    });

    it('应通过 name 匹配搜索关键词', async () => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Code Analyzer Pro', description: 'some tool', capabilities: ['x'] }),
        createMockAgent({ id: 'agent-2', name: 'Doc Writer', description: 'some tool', capabilities: ['y'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { search: 'Code Analyzer' },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Code Analyzer Pro');
    });

    it('应通过 description 匹配搜索关键词', async () => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent One', description: 'Specializes in financial analysis', capabilities: ['x'] }),
        createMockAgent({ id: 'agent-2', name: 'Agent Two', description: 'Handles documentation tasks', capabilities: ['y'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { search: 'financial' },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Agent One');
    });

    it('应通过 capabilities 匹配搜索关键词', async () => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent One', description: 'desc', capabilities: ['code review', 'debugging'] }),
        createMockAgent({ id: 'agent-2', name: 'Agent Two', description: 'desc', capabilities: ['technical writing'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { search: 'debugging' },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Agent One');
    });

    it('搜索应忽略大小写', async () => {
      const agents = [
        createMockAgent({ id: 'Code-Analyzer', name: 'Code Analyzer', description: 'AnalyzE code', capabilities: ['Code Review'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { search: 'code' },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Code Analyzer');
    });

    it('搜索时如果 agent 有 undefined tags 不应抛出异常', async () => {
      const agent = createMockAgent({
        id: 'safe-agent',
        name: 'Safe Agent',
        description: 'handles undefined tags safely',
        capabilities: ['testing'],
      });
      // Set tags to undefined
      (agent as any).tags = undefined;
      const mockRegistry = createMockAgentRegistry([agent]);
      tool.setAgentRegistry(mockRegistry as any);

      // This should not throw; we're just testing search path
      const result = await tool.execute({
        filter: { search: 'safe' },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Safe Agent');
    });
  });

  // ============================================================
  // 没有匹配结果
  // ============================================================
  describe('没有匹配结果', () => {
    it('没有 agent 时应返回提示信息', async () => {
      const mockRegistry = createMockAgentRegistry([]);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toBe('No agents found matching the criteria.');
    });

    it('tags 过滤无匹配时应返回提示信息', async () => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent One', tags: ['dev'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { tags: ['nonexistent-tag'] },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toBe('No agents found matching the criteria.');
    });

    it('search 过滤无匹配时应返回提示信息', async () => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent One', description: 'dev tool', capabilities: ['coding'] }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: { search: 'zzzz_nonexistent_zzzz' },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toBe('No agents found matching the criteria.');
    });

    it('enabled_only 过滤全部 agent 时应返回提示信息', async () => {
      const agents = [
        createMockAgent({ id: 'disabled-1', name: 'Disabled One', enabled: false }),
        createMockAgent({ id: 'disabled-2', name: 'Disabled Two', enabled: false }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toBe('No agents found matching the criteria.');
    });

    it('组合过滤无匹配时应返回提示信息', async () => {
      const agents = [
        createMockAgent({
          id: 'finance-agent',
          name: 'Finance Agent',
          tags: ['finance'],
          enabled: true,
          metadata: { internal: false, filePath: '/custom/finance.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      // Match tags but search doesn't match -> no results
      const result = await tool.execute({
        filter: { tags: ['finance'], search: 'nonexistent' },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toBe('No agents found matching the criteria.');
    });
  });

  // ============================================================
  // 格式化输出 - Built-in/Custom 分组
  // ============================================================
  describe('格式化输出分组', () => {
    it('应正确将 agent 分为 Built-in 和 Custom 两组', async () => {
      const agents = [
        createMockAgent({
          id: 'builtin-agent',
          name: 'Builtin Agent',
          metadata: { internal: true, filePath: '/builtin/some-agent.yaml' },
        }),
        createMockAgent({
          id: 'custom-agent',
          name: 'Custom Agent',
          metadata: { internal: false, filePath: '/user/custom/my-agent.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('## Built-in Agents');
      expect(result.content).toContain('## Custom Agents');
      expect(result.content).toContain('Builtin Agent');
      expect(result.content).toContain('Custom Agent');
    });

    it('只有内置 agent 时应只显示 Built-in 分组', async () => {
      const agents = [
        createMockAgent({
          id: 'explore',
          name: 'Explore Agent',
          metadata: { internal: true, filePath: '/builtin/explore.yaml' },
        }),
        createMockAgent({
          id: 'coder',
          name: 'Coder Agent',
          metadata: { internal: true, filePath: '/builtin/coder.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('## Built-in Agents');
      expect(result.content).not.toContain('## Custom Agents');
    });

    it('只有自定义 agent 时应只显示 Custom 分组', async () => {
      const agents = [
        createMockAgent({
          id: 'my-agent',
          name: 'My Custom Agent',
          metadata: { internal: false, filePath: '/user/agents/my-agent.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).not.toContain('## Built-in Agents');
      expect(result.content).toContain('## Custom Agents');
      expect(result.content).toContain('My Custom Agent');
    });

    it('通过 filePath 含 /builtin/ 路径判断为内置 agent', async () => {
      const agents = [
        createMockAgent({
          id: 'builtin-by-path',
          name: 'Path Builtin',
          metadata: { internal: false, filePath: '/some/path/builtin/my-agent.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('## Built-in Agents');
      expect(result.content).toContain('Path Builtin');
    });

    it('通过 filePath 含 \\builtin\\ 路径判断为内置 agent（Windows 路径）', async () => {
      const agents = [
        createMockAgent({
          id: 'win-builtin',
          name: 'Windows Builtin',
          metadata: { internal: false, filePath: 'C:\\agents\\builtin\\win-agent.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('## Built-in Agents');
      expect(result.content).toContain('Windows Builtin');
    });

    it('格式化输出应包含 agent 的详细信息', async () => {
      const agents = [
        createMockAgent({
          id: 'full-agent',
          name: 'Full Agent',
          description: 'A fully featured agent',
          capabilities: ['coding', 'testing', 'deploy'],
          tags: ['devops', 'cicd'],
          model: { primary: 'claude-opus-4' },
          tools: [{ name: 'bash' }, { name: 'read_file' }],
          metadata: { internal: false, filePath: '/custom/full.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Full Agent');
      expect(result.content).toContain('full-agent');
      expect(result.content).toContain('A fully featured agent');
      expect(result.content).toContain('coding');
      expect(result.content).toContain('testing');
      expect(result.content).toContain('deploy');
      expect(result.content).toContain('devops, cicd');
      expect(result.content).toContain('claude-opus-4');
      expect(result.content).toContain('2 available');
    });
  });

  // ============================================================
  // 组合过滤
  // ============================================================
  describe('组合过滤', () => {
    it('应支持 tags + search + enabled_only + include_subagents 组合过滤', async () => {
      const agents = [
        // Should match: tags match + search match + enabled + not internal
        createMockAgent({
          id: 'finance-analyzer',
          name: 'Finance Analyzer',
          description: 'Analyze financial data',
          tags: ['finance', 'analysis'],
          capabilities: ['data analysis', 'reporting'],
          enabled: true,
          metadata: { internal: false, filePath: '/custom/finance-analyzer.yaml' },
        }),
        // Should NOT match: disabled
        createMockAgent({
          id: 'stock-predictor',
          name: 'Stock Predictor',
          description: 'Predict stock market',
          tags: ['finance', 'ml'],
          capabilities: ['prediction', 'ml'],
          enabled: false,
          metadata: { internal: false, filePath: '/custom/stock-predictor.yaml' },
        }),
        // Should NOT match: internal (include_subagents = false)
        createMockAgent({
          id: 'finance-internal',
          name: 'Finance Internal',
          description: 'Internal finance agent',
          tags: ['finance'],
          capabilities: ['internal processing'],
          enabled: true,
          metadata: { internal: true, filePath: '/builtin/finance-internal.yaml' },
        }),
        // Should NOT match: search keyword doesn't match
        createMockAgent({
          id: 'cooking-assistant',
          name: 'Cooking Assistant',
          description: 'Help with cooking',
          tags: ['cooking'],
          capabilities: ['recipe', 'meal planning'],
          enabled: true,
          metadata: { internal: false, filePath: '/custom/cooking.yaml' },
        }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({
        filter: {
          tags: ['finance'],
          search: 'analyze',
          enabled_only: true,
          include_subagents: false,
        },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('Finance Analyzer');
      expect(result.content).not.toContain('Stock Predictor');
      expect(result.content).not.toContain('Finance Internal');
      expect(result.content).not.toContain('Cooking Assistant');
    });
  });

  // ============================================================
  // 边界情况
  // ============================================================
  describe('边界情况', () => {
    it('filter 字段完全不存在时应正常工作（使用默认值）', async () => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent 1' }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
    });

    it('filter 为 null 时应正常工作', async () => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent 1' }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({ filter: null });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
    });

    it('filter 为空对象时应正常工作', async () => {
      const agents = [
        createMockAgent({ id: 'agent-1', name: 'Agent 1' }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({ filter: {} });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
    });

    it('metadata 为 undefined 时不应抛出异常', async () => {
      const agents = [
        createMockAgent({ id: 'no-meta', name: 'No Meta', metadata: undefined }),
      ];
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('No Meta');
    });

    it('model 为 undefined 时不应抛出异常', async () => {
      const agents = [
        createMockAgent({
          id: 'no-model',
          name: 'No Model',
          metadata: { internal: false, filePath: '/custom/no-model.yaml' },
        }),
      ];
      (agents[0] as any).model = undefined;
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
    });

    it('tools 为 undefined 时不应抛出异常', async () => {
      const agents = [
        createMockAgent({
          id: 'no-tools',
          name: 'No Tools',
          metadata: { internal: false, filePath: '/custom/no-tools.yaml' },
        }),
      ];
      (agents[0] as any).tools = undefined;
      const mockRegistry = createMockAgentRegistry(agents);
      tool.setAgentRegistry(mockRegistry as any);

      const result = await tool.execute({});

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Found 1 agent(s)');
      expect(result.content).toContain('No Tools');
    });
  });
});
