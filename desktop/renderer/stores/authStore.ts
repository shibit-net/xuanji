import { create } from 'zustand';

export interface User {
  userId: string;
  email: string;
  nickname?: string;
  avatar?: string;
  roles?: string[];
  permissions?: string[];
}

export interface SavedAccount {
  email: string;
  nickname?: string;
  avatar?: string;
  lastLogin: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  error: string | null;
  savedAccounts: SavedAccount[];
  isLoadingAccounts: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  loadSavedAccounts: () => Promise<void>;
  removeAccount: (email: string) => Promise<boolean>;
}

// 移除 persist 中间件，认证状态完全由后端 token 管理
// 后端已实现加密 token 存储（.xuanji/auth/current-auth.enc）
export const useAuthStore = create<AuthState>()((set, get) => ({
  isAuthenticated: false,
  isLoading: false,
  user: null,
  error: null,
  savedAccounts: [],
  isLoadingAccounts: false,

  login: async (email: string, password: string) => {
    if (!window.electron?.authLogin) {
      set({ error: '应用未就绪' });
      return false;
    }
    set({ isLoading: true, error: null });
    try {
      const result = await window.electron.authLogin(email, password);

      if (result.success && result.data) {
        set({
          isAuthenticated: true,
          user: {
            ...(result.data as User),
            nickname: (result.data as any).nickName || (result.data as User).nickname,
          },
          error: null
        });
        // 重新加载账号列表
        await get().loadSavedAccounts();
        return true;
      } else {
        set({ error: result.message || '登录失败' });
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败';
      set({ error: message });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    if (!window.electron?.authLogout) {
      set({ isAuthenticated: false, user: null });
      return;
    }
    try {
      await window.electron.authLogout();
      set({ isAuthenticated: false, user: null });
      // 重新加载账号列表
      await get().loadSavedAccounts();
    } catch (err) {
      console.error('登出失败:', err);
      set({ isAuthenticated: false, user: null });
    }
  },

  checkAuth: async () => {
    if (!window.electron?.authCheck) {
      set({ isLoading: false, isAuthenticated: false, user: null });
      return;
    }
    set({ isLoading: true });
    try {
      const result = await window.electron.authCheck();
      if (result.success && result.data) {
        set({
          isAuthenticated: true,
          user: {
            ...(result.data as User),
            nickname: (result.data as any).nickName || (result.data as User).nickname,
          },
          error: null
        });
      } else {
        set({ isAuthenticated: false, user: null });
      }
    } catch (err) {
      console.error('检查认证状态失败:', err);
      set({ isAuthenticated: false, user: null });
    } finally {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),

  loadSavedAccounts: async () => {
    if (!window.electron?.authGetSavedAccounts) {
      set({ isLoadingAccounts: false, savedAccounts: [] });
      return;
    }
    set({ isLoadingAccounts: true });
    try {
      const accounts = await window.electron.authGetSavedAccounts();
      set({ savedAccounts: accounts });
    } catch (err) {
      console.error('加载保存的账号失败:', err);
      set({ savedAccounts: [] });
    } finally {
      set({ isLoadingAccounts: false });
    }
  },

  removeAccount: async (email: string) => {
    if (!window.electron?.authRemoveAccount) {
      return false;
    }
    try {
      const result = await window.electron.authRemoveAccount(email);
      if (result.success) {
        await get().loadSavedAccounts();
        return true;
      }
      return false;
    } catch (err) {
      console.error('删除账号失败:', err);
      return false;
    }
  },
}));

// 监听 session 过期事件（token 刷新失败时主进程通知）
// 主进程已调用 clearAuthState()，renderer 只需清除登录状态即可触发路由守卫重定向
if (typeof window !== 'undefined' && window.electron?.onAuthSessionExpired) {
  window.electron.onAuthSessionExpired(() => {
    console.warn('[AuthStore] Session 过期，跳转登录页');
    useAuthStore.setState({ isAuthenticated: false, user: null });
    useAuthStore.getState().loadSavedAccounts();
  });
}
