/**
 * InstallTool 单元测试
 * 测试搜索模式、安装模式、依赖未注入、错误处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstallTool } from '@/core/tools/InstallTool';
import type { TiangongMarket, MarketPackage } from '@/mcp/market/TiangongMarket';
import type { MCPInstaller, InstallResult } from '@/mcp/market/MCPInstaller';
import type { SkillInstaller, SkillInstallResult } from '@/core/skills/SkillInstaller';
import type { MCPServerConfig } from '@/mcp/types';

// ============================================================
// Mock Factories
// ============================================================

function createMockMarketPackage(overrides: Partial<MarketPackage> = {}): MarketPackage {
  return {
    packageId: 'test-mcp-001',
    name: 'Test MCP Server',
    type: 'mcp',
    description: 'A test MCP server for PostgreSQL',
    authorName: 'Test Author',
    categoryName: 'Database',
    totalDownloads: 1234,
    ratingAvg: 4.5,
    ratingCount: 42,
    qualityScore: 95,
    securityScore: 90,
    tags: ['database', 'postgresql'],
    transport: 'stdio',
    currentVersion: '1.0.0',
    proxyEnabled: false,
    pricingModel: 0,
    source: 1,
    isPrivate: false,
    ...overrides,
  };
}

function createMockTiangongMarket(): TiangongMarket {
  return {
    search: vi.fn(),
    getDetail: vi.fn(),
    getInstallConfig: vi.fn(),
    download: vi.fn(),
    getDownloadInfo: vi.fn(),
    checkUpdates: vi.fn(),
  } as unknown as TiangongMarket;
}

function createMockMCPInstaller(): MCPInstaller {
  return {
    search: vi.fn(),
    install: vi.fn(),
    installFromSearch: vi.fn(),
    uninstall: vi.fn(),
  } as unknown as MCPInstaller;
}

function createMockSkillInstaller(): SkillInstaller {
  return {
    install: vi.fn(),
    uninstall: vi.fn(),
    listInstalled: vi.fn(),
  } as unknown as SkillInstaller;
}

function createSuccessInstallResult(overrides: Partial<InstallResult> = {}): InstallResult {
  return {
    success: true,
    packageId: 'test-mcp-001',
    version: '1.0.0',
    installPath: '/home/user/.xuanji/mcp/test-mcp-001',
    config: {
      name: 'test-mcp',
      transport: 'stdio',
      command: 'node',
      args: ['index.js'],
      source: 'marketplace',
      packageId: 'test-mcp-001',
      installedVersion: '1.0.0',
    } as MCPServerConfig,
    ...overrides,
  };
}

function createSuccessSkillResult(overrides: Partial<SkillInstallResult> = {}): SkillInstallResult {
  return {
    success: true,
    skillId: 'test-skill-001',
    version: '1.0.0',
    filePath: '/home/user/.xuanji/skills/installed/test-skill-001.json',
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('InstallTool', () => {
  let tool: InstallTool;
  let mockMarket: TiangongMarket;
  let mockMCP: MCPInstaller;
  let mockSkill: SkillInstaller;

  beforeEach(() => {
    tool = new InstallTool();
    mockMarket = createMockTiangongMarket();
    mockMCP = createMockMCPInstaller();
    mockSkill = createMockSkillInstaller();
  });

  // ── 依赖未注入 ──────────────────────────────────

  describe('without dependencies', () => {
    it('should return error when market not configured', async () => {
      const result = await tool.execute({ goal: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Marketplace 未配置');
    });

    it('should return error when market not configured (packageId)', async () => {
      const result = await tool.execute({ packageId: 'test-001', type: 'mcp' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Marketplace 未配置');
    });
  });

  // ── 参数验证 ────────────────────────────────────

  describe('parameter validation', () => {
    beforeEach(() => {
      tool.setDependencies({ market: mockMarket, mcpInstaller: mockMCP, skillInstaller: mockSkill });
    });

    it('should return error when neither goal nor packageId provided', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('缺少 goal 或 packageId');
    });

    it('should return error for empty goal', async () => {
      const result = await tool.execute({ goal: '   ' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('缺少 goal 或 packageId');
    });
  });

  // ── 搜索模式 ────────────────────────────────────

  describe('search mode', () => {
    beforeEach(() => {
      tool.setDependencies({ market: mockMarket, mcpInstaller: mockMCP, skillInstaller: mockSkill });
    });

    it('should search MCP and return results', async () => {
      const pkg = createMockMarketPackage({ name: 'Postgres MCP', description: 'PostgreSQL integration' });
      (mockMarket.search as any).mockResolvedValue({
        items: [pkg],
        total: 1,
        pageNum: 1,
        pageSize: 10,
        pages: 1,
      });

      const result = await tool.execute({ goal: 'PostgreSQL', type: 'mcp' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Postgres MCP');
      expect(result.content).toContain('packageId');
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.mcpCount).toBe(1);
      expect(mockMarket.search).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mcp', query: 'PostgreSQL' }),
      );
    });

    it('should search Skill and return results', async () => {
      const skill = createMockMarketPackage({
        type: 'skill',
        name: 'Review PR',
        description: 'Code review workflow',
        packageId: 'skill-001',
      });
      (mockMarket.search as any).mockResolvedValue({
        items: [skill],
        total: 1,
        pageNum: 1,
        pageSize: 10,
        pages: 1,
      });

      const result = await tool.execute({ goal: 'review', type: 'skill' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Review PR');
      expect(result.content).toContain('skill-001');
      expect(result.metadata?.skillCount).toBe(1);
    });

    it('should search both when type=auto', async () => {
      const mcpPkg = createMockMarketPackage({ type: 'mcp', name: 'DB MCP' });
      const skillPkg = createMockMarketPackage({
        type: 'skill',
        name: 'DB Skill',
        packageId: 'skill-002',
      });
      (mockMarket.search as any)
        .mockResolvedValueOnce({ items: [mcpPkg], total: 1, pageNum: 1, pageSize: 10, pages: 1 })
        .mockResolvedValueOnce({ items: [skillPkg], total: 1, pageNum: 1, pageSize: 10, pages: 1 });

      const result = await tool.execute({ goal: 'database', type: 'auto' });

      expect(result.isError).toBe(false);
      expect(result.metadata?.mcpCount).toBe(1);
      expect(result.metadata?.skillCount).toBe(1);
      expect(mockMarket.search).toHaveBeenCalledTimes(2);
    });

    it('should handle empty search results', async () => {
      (mockMarket.search as any).mockResolvedValue({
        items: [],
        total: 0,
        pageNum: 1,
        pageSize: 10,
        pages: 0,
      });

      const result = await tool.execute({ goal: 'nonexistent', type: 'mcp' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('未找到');
    });

    it('should handle search failures gracefully', async () => {
      (mockMarket.search as any).mockRejectedValue(new Error('Network error'));

      const result = await tool.execute({ goal: 'test', type: 'mcp' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Network error');
    });
  });

  // ── 安装模式 ────────────────────────────────────

  describe('install mode (by packageId)', () => {
    beforeEach(() => {
      tool.setDependencies({ market: mockMarket, mcpInstaller: mockMCP, skillInstaller: mockSkill });
    });

    it('should install MCP by packageId', async () => {
      const installResult = createSuccessInstallResult();
      (mockMCP.install as any).mockResolvedValue(installResult);

      const result = await tool.execute({ packageId: 'mcp-001', type: 'mcp' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('安装成功');
      expect(result.content).toContain('test-mcp');
      expect(mockMCP.install).toHaveBeenCalledWith('mcp-001', expect.objectContaining({ autoStart: true }));
    });

    it('should install Skill by packageId', async () => {
      const skillResult = createSuccessSkillResult();
      (mockSkill.install as any).mockResolvedValue(skillResult);

      const result = await tool.execute({ packageId: 'skill-001', type: 'skill' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('安装成功');
      expect(result.content).toContain('test-skill-001');
      expect(mockSkill.install).toHaveBeenCalledWith(
        expect.objectContaining({ packageId: 'skill-001' }),
      );
    });

    it('should pass version to installer', async () => {
      const installResult = createSuccessInstallResult({ version: '2.0.0' });
      (mockMCP.install as any).mockResolvedValue(installResult);

      await tool.execute({ packageId: 'mcp-001', type: 'mcp', version: '2.0.0' });

      expect(mockMCP.install).toHaveBeenCalledWith(
        'mcp-001',
        expect.objectContaining({ version: '2.0.0' }),
      );
    });

    it('should return error when MCP install fails', async () => {
      (mockMCP.install as any).mockResolvedValue({
        success: false,
        error: 'Download failed',
        packageId: 'mcp-001',
      } as InstallResult);

      const result = await tool.execute({ packageId: 'mcp-001', type: 'mcp' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Download failed');
    });

    it('should return error when Skill install fails', async () => {
      (mockSkill.install as any).mockResolvedValue({
        success: false,
        error: 'Invalid package',
        skillId: 'skill-001',
      } as SkillInstallResult);

      const result = await tool.execute({ packageId: 'skill-001', type: 'skill' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid package');
    });

    it('should try Skill when MCP fails with type=auto', async () => {
      (mockMCP.install as any).mockResolvedValue({
        success: false,
        error: 'Not found',
        packageId: 'test-001',
      } as InstallResult);
      const skillResult = createSuccessSkillResult({ skillId: 'test-001' });
      (mockSkill.install as any).mockResolvedValue(skillResult);

      const result = await tool.execute({ packageId: 'test-001', type: 'auto' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Skill 安装成功');
      expect(mockMCP.install).toHaveBeenCalled();
      expect(mockSkill.install).toHaveBeenCalled();
    });

    it('should return error when both MCP and Skill fail with type=auto', async () => {
      (mockMCP.install as any).mockResolvedValue({
        success: false,
        error: 'MCP failed',
        packageId: 'test-001',
      } as InstallResult);
      (mockSkill.install as any).mockResolvedValue({
        success: false,
        error: 'Skill failed',
      } as SkillInstallResult);

      const result = await tool.execute({ packageId: 'test-001', type: 'auto' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('未成功');
    });
  });

  // ── Tool 元数据 ──────────────────────────────────

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('install');
    });

    it('should not be readonly', () => {
      expect(tool.readonly).toBe(false);
    });

    it('should have valid input schema', () => {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toHaveProperty('goal');
      expect(tool.input_schema.properties).toHaveProperty('packageId');
      expect(tool.input_schema.properties).toHaveProperty('type');
      expect(tool.input_schema.properties).toHaveProperty('version');
    });
  });
});
