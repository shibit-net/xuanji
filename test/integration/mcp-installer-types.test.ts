import { describe, it, expect } from 'vitest';
import { TiangongMarket } from '../../src/mcp/market/TiangongMarket';

describe('MCP 安装类型集成测试', () => {
  const market = new TiangongMarket({
    baseUrl: 'https://test.shibit.net/api/tiangong',
    timeout: 10000,
  });

  it('Type A: 自托管 MCP 有 downloadUrl（hello-mcp-server）', async () => {
    const info = await market.getDownloadInfo('hello-mcp-server');
    expect(info.downloadUrl).toBeTruthy();
    expect(info.downloadUrl).toContain('/api/tiangong/public/files/');
  }, 15000);

  it('Type B: 外部引用 MCP 无 downloadUrl 但有 configTemplate（feishu-mcp）', async () => {
    const [downloadInfo, installConfig] = await Promise.all([
      market.getDownloadInfo('feishu-mcp'),
      market.getInstallConfig('feishu-mcp'),
    ]);
    // downloadUrl 为 null 或空
    expect(downloadInfo.downloadUrl || '').toBeFalsy();
    // 但 configTemplate 存在
    expect(installConfig.configTemplate).toBeTruthy();
    const tmpl = JSON.parse(installConfig.configTemplate);
    expect(tmpl.command).toBe('npx');
    expect(tmpl.transport).toBe('stdio');
  }, 15000);

  it('Type B: 外部引用 MCP 无 downloadUrl 但有 configTemplate（server-sequential-thinking）', async () => {
    const [downloadInfo, installConfig] = await Promise.all([
      market.getDownloadInfo('server-sequential-thinking'),
      market.getInstallConfig('server-sequential-thinking'),
    ]);
    expect(downloadInfo.downloadUrl || '').toBeFalsy();
    expect(installConfig.configTemplate).toBeTruthy();
    const tmpl = JSON.parse(installConfig.configTemplate);
    expect(tmpl.command).toBeTruthy();
  }, 15000);

  it('Type B: Skill 必须有 downloadUrl（code-review-skill）', async () => {
    const info = await market.getDownloadInfo('code-review-skill');
    expect(info.downloadUrl).toBeTruthy();
    expect(info.downloadUrl).toContain('/api/tiangong/public/files/');
  }, 15000);
});
