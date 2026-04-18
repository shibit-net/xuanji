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
import { triggerStartup } from '../agent/index.js';
import { initializeUserConfig } from '../../../src/core/config/UserConfigInitializer.js';

function registerAuthIpcHandlers() {
  ipcMain.handle('auth:login', async (_event, email: string, password: string) => {
    console.log('收到登录请求:', email);
    try {
      const result = await authService.login({ email, password });
      console.log('登录 API 响应:', { success: result.success, message: result.message });

      if (result.success) {
        syncCookiesFromClient();
        setAuthState({ user: result.data || null });
        await saveAuthState();

        console.log('登录成功，用户信息:', result.data);

        // 初始化用户配置
        if (result.data?.userId) {
          try {
            await initializeUserConfig(result.data.userId);
            console.log('用户配置初始化完成:', result.data.userId);
          } catch (err) {
            console.error('初始化用户配置失败:', err);
          }
        }

        // 登录成功后触发启动消息
        triggerStartup();

        return {
          success: true,
          data: getAuthState().user
        };
      } else {
        console.log('登录失败:', result.message);
        return {
          success: false,
          message: result.message || '登录失败'
        };
      }
    } catch (err) {
      console.error('登录请求失败:', err);
      return {
        success: false,
        message: err instanceof Error ? err.message : '网络错误'
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
        console.log('Token 已过期，尝试刷新...');
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

                // Token 刷新成功，触发启动消息
                triggerStartup();
                return { success: true, data: user };
              }
            }
          } catch (err) {
            console.error('刷新 Token 失败:', err);
          }
        }

        console.log('Token 过期且无法刷新，退出登录');
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

          // 认证检查成功，触发启动消息
          triggerStartup();
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
