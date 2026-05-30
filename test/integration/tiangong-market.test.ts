import { describe, it, expect } from 'vitest';
import { TiangongMarket } from '../../src/mcp/market/TiangongMarket';

describe('天工坊集成测试 - test.shibit.net', () => {
  const market = new TiangongMarket({
    baseUrl: 'https://test.shibit.net/api/tiangong',
    timeout: 10000,
  });

  it('搜索 Skill - 能找到 code-review-skill', async () => {
    const result = await market.search({ type: 'skill', pageSize: 10 });
    const items = result.skill?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    const ids = items.map(i => i.packageId);
    expect(ids).toContain('code-review-skill');
  }, 15000);

  it('搜索 MCP - 能找到 hello-mcp-server', async () => {
    const result = await market.search({ type: 'mcp', pageSize: 10 });
    const items = result.mcp?.items ?? [];
    expect(items.length).toBeGreaterThanOrEqual(3);
    const ids = items.map(i => i.packageId);
    expect(ids).toContain('hello-mcp-server');
  }, 15000);

  it('获取 Skill 详情', async () => {
    const detail = await market.getDetail('code-review-skill');
    expect(detail.name).toBe('代码审查助手');
    expect(detail.type).toBe('skill');
    expect(detail.currentVersion).toBe('1.0.0');
  }, 15000);

  it('P0: Skill downloadUrl 指向天工坊自身', async () => {
    const info = await market.getDownloadInfo('code-review-skill');
    expect(info.downloadUrl).toBeTruthy();
    expect(info.downloadUrl).toContain('/api/tiangong/public/files/');
  }, 15000);

  it('P0: MCP downloadUrl 指向天工坊自身', async () => {
    const info = await market.getDownloadInfo('hello-mcp-server');
    expect(info.downloadUrl).toBeTruthy();
    expect(info.downloadUrl).toContain('/api/tiangong/public/files/');
  }, 15000);
});
