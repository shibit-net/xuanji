import { ipcMain } from 'electron';
import { modelsService } from '../services/index.js';

function registerModelsIpcHandlers() {
  ipcMain.handle('models:list-marketplace', async (_event, options?: { vendor?: string, name?: string, routeId?: number, page?: number, size?: number }) => {
    try {
      const result = await modelsService.listMarketplaceModels(options);
      return result;
    } catch (err) {
      console.error('获取模型广场列表失败:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('models:list-all', async () => {
    try {
      const result = await modelsService.listAllModels();
      return result;
    } catch (err) {
      console.error('获取所有模型列表失败:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('models:list-vendors', async () => {
    try {
      const result = await modelsService.listAgentLlmVendors();
      return result;
    } catch (err) {
      console.error('获取供应商列表失败:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('models:get-info', async (_event, id: number, routeId?: number) => {
    try {
      const result = await modelsService.getAgentLlmBasicInfoById(id, routeId);
      return result;
    } catch (err) {
      console.error('获取模型基本信息失败:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 🆕 从用户配置中获取模型列表
  ipcMain.handle('models:list-user-config', async () => {
    try {
      const { getUserConfigPath } = await import('../../../src/core/config/PathManager.js');
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');

      // 获取当前用户 ID
      let userId: string | null = null;
      try {
        const { getAuthState } = await import('../config/auth.js');
        const authState = getAuthState();
        if (authState?.user?.userId) {
          userId = authState.user.userId;
        }
      } catch (err) {
        console.warn('无法获取当前用户:', err);
      }

      if (!userId) {
        return {
          success: false,
          error: '用户未登录'
        };
      }

      const configPath = getUserConfigPath(userId);

      if (!existsSync(configPath)) {
        return {
          success: false,
          error: '用户配置文件不存在'
        };
      }

      const content = await readFile(configPath, 'utf-8');
      const configFile = JSON.parse(content);
      const config = configFile.config || configFile;

      // 从配置中提取模型信息
      const userModel = {
        id: 0,
        name: config.provider?.model || 'claude-sonnet-4-5-20250929',
        model: config.provider?.model || 'claude-sonnet-4-5-20250929',
        adapter: config.provider?.adapter || 'anthropic',
        vendor: config.provider?.adapter || 'anthropic',
        baseURL: config.provider?.baseURL,
        apiKey: config.provider?.apiKey ? '(已配置)' : '(未配置)',
      };

      return {
        success: true,
        data: {
          list: [userModel],
          total: 1,
          page: 1,
          size: 1
        }
      };
    } catch (err) {
      console.error('读取用户配置模型失败:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });
}

export { registerModelsIpcHandlers };
