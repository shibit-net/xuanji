import { ipcMain, session } from 'electron';
import { authService } from '../services/index.js';
import {
  saveAuthState,
  clearAuthState,
  isTokenValid,
  syncCookiesFromClient,
  refreshUserInfo,
  getAuthState,
  setAuthState,
  removeAccount,
  getSavedAccounts,
  registerRefreshHandler,
  startProactiveRefresh,
  stopProactiveRefresh,
  performRefresh,
  type SavedAccount
} from '../config/auth.js';

async function initUserConfig(userId: string): Promise<void> {
  try {
    const { getUserConfigPath } = await import('../../../src/core/config/PathManager.js');
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(getUserConfigPath(userId)), { recursive: true });
  } catch (err) {
    console.error('初始化用户配置失败:', err);
  }
}

function registerAuthIpcHandlers() {
  ipcMain.handle('auth:login', async (_event, email: string, password: string) => {
    try {
      await clearAuthState();

      const ses = session.defaultSession;
      await ses.clearStorageData({ storages: ['cookies'] });

      const result = await authService.login({ email, password });

      if (result.success) {
        await syncCookiesFromClient();

        setAuthState({ user: result.data || null });
        await saveAuthState();

        // 注册 1101 自动刷新回调 + 启动主动刷新定时器
        registerRefreshHandler();
        startProactiveRefresh();

        // 初始化用户配置
        if (result.data?.userId) {
          await initUserConfig(result.data.userId);
        }

        return {
          success: true,
          data: getAuthState().user
        };
      } else {
        return {
          success: false,
          message: result.message || '登录失败'
        };
      }
    } catch (err) {
      console.error('登录请求失败:', err);

      // 友好的错误提示
      let errorMessage = '网络错误';

      if (err instanceof Error) {
        // 网络连接错误
        if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
          errorMessage = '无法连接到服务器，请检查网络连接';
        }
        // 超时错误
        else if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
          errorMessage = '连接超时，请检查网络连接或稍后重试';
        }
        // 连接被拒绝
        else if (err.message.includes('ECONNREFUSED')) {
          errorMessage = '服务器拒绝连接，请稍后重试';
        }
        // SSL/TLS 错误
        else if (err.message.includes('certificate') || err.message.includes('SSL')) {
          errorMessage = '安全连接失败，请检查系统时间设置';
        }
        // 其他错误
        else {
          errorMessage = `网络错误: ${err.message}`;
        }
      }

      return {
        success: false,
        message: errorMessage
      };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      stopProactiveRefresh();
      try {
        await authService.logout();
      } catch (err) {
      }
      
      await clearAuthState();
      
      const ses = session.defaultSession;
      await ses.clearStorageData();
      await ses.clearCache();
      
      return { success: true };
    } catch (err) {
      console.error('登出失败:', err);
      return { success: false };
    }
  });

  ipcMain.handle('auth:check', async () => {
    try {
      const authState = getAuthState();
      if (!authState.accessToken) {
        return { success: false };
      }

      // Token 过期 → 尝试刷新
      if (!isTokenValid()) {
        if (!authState.refreshToken) {
          await clearAuthState();
          return { success: false };
        }
        const refreshed = await performRefresh();
        if (!refreshed) {
          await clearAuthState();
          return { success: false };
        }
      }

      // 验证用户信息有效性
      const user = await refreshUserInfo();
      if (user) {
        await initUserConfig(user.userId);
        return { success: true, data: user };
      }

      await clearAuthState();
      return { success: false };
    } catch (err) {
      console.error('检查认证状态失败:', err);
      await clearAuthState();
      return { success: false };
    }
  });

  ipcMain.handle('auth:getSavedAccounts', async (): Promise<SavedAccount[]> => {
    try {
      return await getSavedAccounts();
    } catch (err) {
      console.error('获取保存的账号失败:', err);
      return [];
    }
  });

  // 移除 switchAccount handler，因为不再支持切换账号（需要重新登录）

  ipcMain.handle('auth:removeAccount', async (_event, email: string): Promise<{ success: boolean }> => {
    try {
      const result = await removeAccount(email);
      return { success: result };
    } catch (err) {
      console.error('删除账号失败:', err);
      return { success: false };
    }
  });
}

export { registerAuthIpcHandlers };
