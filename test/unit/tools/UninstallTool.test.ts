/**
 * UninstallTool 单元测试
 * 测试 MCP 卸载、Skill 卸载、依赖未注入、错误处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UninstallTool } from '@/tools/UninstallTool';
import type { MCPInstaller } from '@/mcp/market/MCPInstaller';
import type { SkillInstaller, SkillUninstallResult } from '@/core/skills/SkillInstaller';

// ============================================================
// Mock Factories
// ============================================================

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

// ============================================================
// Tests
// ============================================================

describe('UninstallTool', () => {
  let tool: UninstallTool;
  let mockMCP: MCPInstaller;
  let mockSkill: SkillInstaller;

  beforeEach(() => {
    tool = new UninstallTool();
    mockMCP = createMockMCPInstaller();
    mockSkill = createMockSkillInstaller();
  });

  // ── 依赖未注入 ──────────────────────────────────

  describe('without dependencies', () => {
    it('should return error for MCP uninstall when not configured', async () => {
      const result = await tool.execute({ packageId: 'mcp-001', type: 'mcp' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('未初始化');
    });

    it('should return error for Skill uninstall when not configured', async () => {
      const result = await tool.execute({ packageId: 'skill-001', type: 'skill' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('未初始化');
    });
  });

  // ── 参数验证 ────────────────────────────────────

  describe('parameter validation', () => {
    beforeEach(() => {
      tool.setDependencies({ mcpInstaller: mockMCP, skillInstaller: mockSkill });
    });

    it('should return error when packageId is missing', async () => {
      const result = await tool.execute({ type: 'mcp' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('缺少 packageId');
    });

    it('should return error when packageId is empty', async () => {
      const result = await tool.execute({ packageId: '   ', type: 'mcp' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('缺少 packageId');
    });

    it('should return error when type is invalid', async () => {
      const result = await tool.execute({ packageId: 'test', type: 'invalid' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('"mcp" 或 "skill"');
    });

    it('should return error when type is missing', async () => {
      const result = await tool.execute({ packageId: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('"mcp" 或 "skill"');
    });
  });

  // ── MCP 卸载 ────────────────────────────────────

  describe('uninstall MCP', () => {
    beforeEach(() => {
      tool.setDependencies({ mcpInstaller: mockMCP, skillInstaller: mockSkill });
    });

    it('should uninstall MCP successfully', async () => {
      (mockMCP.uninstall as any).mockResolvedValue(true);

      const result = await tool.execute({ packageId: 'mcp-001', type: 'mcp' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('已卸载');
      expect(result.content).toContain('mcp-001');
      expect(mockMCP.uninstall).toHaveBeenCalledWith('mcp-001', undefined);
    });

    it('should pass server name to MCP uninstall', async () => {
      (mockMCP.uninstall as any).mockResolvedValue(true);

      await tool.execute({ packageId: 'mcp-001', type: 'mcp', name: 'my-server' });

      expect(mockMCP.uninstall).toHaveBeenCalledWith('mcp-001', 'my-server');
    });

    it('should report when MCP uninstall partially fails', async () => {
      (mockMCP.uninstall as any).mockResolvedValue(false);

      const result = await tool.execute({ packageId: 'mcp-001', type: 'mcp' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('未找到运行中的服务器');
    });

    it('should handle uninstall throw', async () => {
      (mockMCP.uninstall as any).mockRejectedValue(new Error('Permission denied'));

      const result = await tool.execute({ packageId: 'mcp-001', type: 'mcp' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Permission denied');
    });
  });

  // ── Skill 卸载 ──────────────────────────────────

  describe('uninstall Skill', () => {
    beforeEach(() => {
      tool.setDependencies({ mcpInstaller: mockMCP, skillInstaller: mockSkill });
    });

    it('should uninstall Skill successfully', async () => {
      (mockSkill.uninstall as any).mockResolvedValue({ success: true } as SkillUninstallResult);

      const result = await tool.execute({ packageId: 'skill-001', type: 'skill' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('已卸载');
      expect(result.content).toContain('skill-001');
      expect(mockSkill.uninstall).toHaveBeenCalledWith('skill-001');
    });

    it('should report Skill uninstall failure', async () => {
      (mockSkill.uninstall as any).mockResolvedValue({
        success: false,
        error: 'Skill not in registry',
      } as SkillUninstallResult);

      const result = await tool.execute({ packageId: 'skill-001', type: 'skill' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Skill not in registry');
    });

    it('should handle Skill uninstall throw', async () => {
      (mockSkill.uninstall as any).mockRejectedValue(new Error('File not found'));

      const result = await tool.execute({ packageId: 'skill-001', type: 'skill' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('File not found');
    });
  });

  // ── Tool 元数据 ──────────────────────────────────

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('uninstall');
    });

    it('should not be readonly', () => {
      expect(tool.readonly).toBe(false);
    });

    it('should have valid input schema', () => {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toHaveProperty('packageId');
      expect(tool.input_schema.properties).toHaveProperty('type');
      expect(tool.input_schema.properties).toHaveProperty('name');
      expect(tool.input_schema.required).toContain('packageId');
      expect(tool.input_schema.required).toContain('type');
    });
  });
});
