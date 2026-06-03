/**
 * TemplateRepo 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateRepo } from '@/infrastructure/template/TemplateRepo';
import type { MCPManager } from '@/mcp/MCPManager';
import type { IMCPClient } from '@/mcp/types';

describe('TemplateRepo', () => {
  let mockMCPManager: MCPManager;
  let templateRepo: TemplateRepo;

  beforeEach(() => {
    mockMCPManager = {
      getAllPrompts: vi.fn(),
      getClient: vi.fn(),
    } as any;

    templateRepo = new TemplateRepo(mockMCPManager);
  });

  describe('list()', () => {
    it('应该列出所有模板', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'analysis_report',
            description: '生成市场分析报告',
            arguments: [
              { name: 'symbol', description: '股票代码', required: true },
            ],
          },
        },
        {
          serverName: 'market',
          prompt: {
            name: 'trend_analysis',
            description: '趋势分析',
          },
        },
      ]);

      const templates = await templateRepo.list();

      expect(templates).toHaveLength(2);
      expect(templates[0]).toMatchObject({
        id: 'market:analysis_report',
        name: 'analysis_report',
        serverName: 'market',
        description: '生成市场分析报告',
      });
      expect(templates[0].arguments).toHaveLength(1);
      expect(templates[0].arguments![0].required).toBe(true);
    });

    it('应该处理 MCP 错误', async () => {
      (mockMCPManager.getAllPrompts as any).mockRejectedValue(new Error('MCP 错误'));

      const templates = await templateRepo.list();

      expect(templates).toEqual([]);
    });
  });

  describe('get()', () => {
    it('应该获取并渲染模板', async () => {
      const mockClient: IMCPClient = {
        getPrompt: vi.fn().mockResolvedValue({
          description: '市场分析报告',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: '请分析 AAPL 的市场表现',
              },
            },
            {
              role: 'assistant',
              content: {
                type: 'text',
                text: '根据数据分析...',
              },
            },
          ],
        }),
      } as any;

      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'analysis_report',
            description: '生成市场分析报告',
            arguments: [
              { name: 'symbol', description: '股票代码', required: true },
            ],
          },
        },
      ]);

      (mockMCPManager.getClient as any).mockReturnValue(mockClient);

      const rendered = await templateRepo.get('market:analysis_report', { symbol: 'AAPL' });

      expect(rendered.template.id).toBe('market:analysis_report');
      expect(rendered.messages).toHaveLength(2);
      expect(rendered.messages[0].role).toBe('user');
      expect(rendered.messages[0].content).toContain('AAPL');
      expect(rendered.description).toBe('市场分析报告');
      expect(mockClient.getPrompt).toHaveBeenCalledWith('analysis_report', { symbol: 'AAPL' });
    });

    it('应该验证必填参数', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'analysis_report',
            arguments: [
              { name: 'symbol', required: true },
            ],
          },
        },
      ]);

      await expect(
        templateRepo.get('market:analysis_report', {})
      ).rejects.toThrow('Missing required arguments: symbol');
    });

    it('应该处理无效的模板 ID', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([]);

      await expect(
        templateRepo.get('invalid-id')
      ).rejects.toThrow('Invalid template ID');
    });

    it('应该处理不存在的模板', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'other_template',
          },
        },
      ]);

      await expect(
        templateRepo.get('market:nonexistent')
      ).rejects.toThrow('Template not found: "market:nonexistent"');
    });

    it('应该处理不存在的 MCP 服务器', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'analysis_report',
          },
        },
      ]);

      (mockMCPManager.getClient as any).mockReturnValue(null);

      await expect(
        templateRepo.get('market:analysis_report')
      ).rejects.toThrow('MCP server not found: "market"');
    });
  });

  describe('search()', () => {
    it('应该搜索模板', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'analysis_report',
            description: '市场分析报告',
          },
        },
        {
          serverName: 'market',
          prompt: {
            name: 'trend_analysis',
            description: '趋势分析',
          },
        },
        {
          serverName: 'other',
          prompt: {
            name: 'data_export',
            description: '数据导出',
          },
        },
      ]);

      const results = await templateRepo.search('分析');

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('market:analysis_report');
      expect(results[1].id).toBe('market:trend_analysis');
    });

    it('应该忽略大小写', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'Analysis_Report',
            description: 'Market Analysis',
          },
        },
      ]);

      const results = await templateRepo.search('analysis');

      expect(results).toHaveLength(1);
    });
  });

  describe('listByServer()', () => {
    it('应该按服务器过滤模板', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: { name: 'template1' },
        },
        {
          serverName: 'market',
          prompt: { name: 'template2' },
        },
        {
          serverName: 'other',
          prompt: { name: 'template3' },
        },
      ]);

      const results = await templateRepo.listByServer('market');

      expect(results).toHaveLength(2);
      expect(results[0].serverName).toBe('market');
      expect(results[1].serverName).toBe('market');
    });
  });
});
