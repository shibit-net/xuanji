import { ipcMain, session } from 'electron';
import { authService } from '../services/index.js';
import {
  loadAuthState,
  saveAuthState,
  clearAuthState,
  isTokenValid,
  syncCookiesFromClient,
  refreshUserInfo,
  getAuthState,
  setAuthState,
  removeAccount,
  getSavedAccounts,
  type SavedAccount
} from '../config/auth.js';
import { initializeUserConfig } from '../../../src/core/config/UserConfigInitializer.js';

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

        // 初始化用户配置
        if (result.data?.userId) {
          try {
            await initializeUserConfig(result.data.userId);
          } catch (err) {
            console.error('初始化用户配置失败:', err);
          }
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

      if (!isTokenValid()) {
        if (authState.refreshToken) {
          try {
            const refreshResult = await authService.refreshToken();

            if (refreshResult.success) {
              syncCookiesFromClient();

              const user = await refreshUserInfo();
              if (user) {
                // 确保用户配置已初始化
                if (user.userId) {
                  try {
                    await initializeUserConfig(user.userId);
                  } catch (err) {
                    console.error('初始化用户配置失败:', err);
                  }
                }

                return { success: true, data: user };
              }
            }
          } catch (err) {
            console.error('刷新 Token 失败:', err);
          }
        }

        await clearAuthState();
        return { success: false };
      }

      try {
        const user = await refreshUserInfo();
        if (user) {
          // 确保用户配置已初始化
          if (user.userId) {
            try {
              await initializeUserConfig(user.userId);
            } catch (err) {
              console.error('初始化用户配置失败:', err);
            }
          }

          return { success: true, data: user };
        }
      } catch (err) {
        console.error('验证用户信息失败:', err);
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
