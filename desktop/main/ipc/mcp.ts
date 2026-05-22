import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerMcpIpcHandlers() {
  // ============ MCP 管理 ============
  ipcMain.handle('mcp:list', async () => {
    // 优先走 agent-bridge（含运行时信息），失败或 session 未就绪时直接读 mcp.json
    if (isSessionReady()) {
      try {
        const result = await sendRequest('mcp-list');
        if (result?.success) return result;
      } catch { /* 失败则回退到直接读文件 */ }
    }
    try {
      const { mcpSettingsPersistence } = await import('../../../src/mcp/config/settings-persistence.js');
      const servers = await mcpSettingsPersistence.listServers();
      return {
        success: true,
        servers: servers.map(s => ({
          name: s.name,
          transport: s.transport || 'stdio',
          enabled: !s.disabled,
          toolCount: 0,
          source: s.source || 'custom',
          packageId: s.packageId || '',
        })),
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mcp:toggle', async (_event, data: { name: string; enabled: boolean }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('mcp-toggle', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('mcp:detail', async (_event, data: { name: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('mcp-detail', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('mcp:uninstall', async (_event, data: { serverName?: string; packageId?: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('mcp-uninstall', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('mcp:install', async (_event, data: { packageId: string; version?: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('mcp-install', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('mcp:publish', async (_event, data: { serverName: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('mcp-publish', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ============ Skill 管理 ============
  ipcMain.handle('skill:list', async () => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('skill-list'); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('skill:toggle', async (_event, data: { id: string; enabled: boolean }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('skill-toggle', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('skill:detail', async (_event, data: { id: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('skill-detail', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('skill:uninstall', async (_event, data: { skillId: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('skill-uninstall', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('skill:install', async (_event, data: { packageId: string; version?: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('skill-install', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('skill:publish', async (_event, data: { skillId: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('skill-publish', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  // ============ 天工坊市场 ============
  ipcMain.handle('tiangong:search', async (_event, data: { type?: 'mcp' | 'skill'; query?: string; categoryId?: number; tags?: string; sort?: string; page?: number; pageSize?: number }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('tiangong-search', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('tiangong:detail', async (_event, data: { packageId: string }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('tiangong-detail', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('tiangong:installedIds', async () => {
    if (isSessionReady()) {
      try {
        const result = await sendRequest('tiangong-installed-ids');
        if (result?.success) return result;
      } catch { /* 失败则回退到直接读文件 */ }
    }
    try {
      const { mcpSettingsPersistence } = await import('../../../src/mcp/config/settings-persistence.js');
      const servers = await mcpSettingsPersistence.listServers();
      const mcpIds = servers.filter(s => s.packageId).map(s => s.packageId!);
      return { success: true, mcpIds, skillIds: [] };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('tiangong:deletePackage', async (_event, data: { id: number }) => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('tiangong-delete', data); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('tiangong:checkUpdates', async () => {
    if (!isSessionReady()) return { success: false, error: '会话未初始化' };
    try { return await sendRequest('tiangong-check-updates'); }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });
}

export { registerMcpIpcHandlers };
