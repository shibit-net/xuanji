import { safeStorage } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { authService, apiClient, type User } from '../services/index.js';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  user: User | null;
}

interface SavedAccount {
  email: string;
  nickname?: string;
  avatar?: string;
  lastLogin: number;
  // 不保存密码和 token！
}

interface AccountsData {
  accounts: SavedAccount[];
}

interface CurrentAuthData {
  email: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  user: User;
}

let authState: AuthState = {
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  user: null
};

const AUTH_DATA_PATH = path.join(os.homedir(), '.xuanji', 'auth');
const ACCOUNTS_FILE = path.join(AUTH_DATA_PATH, 'accounts.enc');
const ACCOUNTS_FILE_JSON = path.join(AUTH_DATA_PATH, 'accounts.json');
const CURRENT_AUTH_FILE = path.join(AUTH_DATA_PATH, 'current-auth.enc');
const CURRENT_AUTH_FILE_JSON = path.join(AUTH_DATA_PATH, 'current-auth.json');

function ensureAuthDir() {
  if (!fs.existsSync(AUTH_DATA_PATH)) {
    fs.mkdirSync(AUTH_DATA_PATH, { recursive: true });
  }
}

// 保存账号列表（不含 token）
async function saveAccountsList(data: AccountsData) {
  ensureAuthDir();
  try {
    const serialized = JSON.stringify(data);

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(serialized);
      fs.writeFileSync(ACCOUNTS_FILE, encrypted);
    } else {
      fs.writeFileSync(ACCOUNTS_FILE_JSON, serialized);
    }

    console.log('保存账号列表成功，共', data.accounts.length, '个账号');
  } catch (err) {
    console.error('保存账号列表失败:', err);
  }
}

// 加载账号列表
async function loadAccountsList(): Promise<AccountsData> {
  ensureAuthDir();
  try {
    if (fs.existsSync(ACCOUNTS_FILE) && safeStorage.isEncryptionAvailable()) {
      const encrypted = fs.readFileSync(ACCOUNTS_FILE);
      const serialized = safeStorage.decryptString(encrypted);
      return JSON.parse(serialized);
    } else if (fs.existsSync(ACCOUNTS_FILE_JSON)) {
      const serialized = fs.readFileSync(ACCOUNTS_FILE_JSON, 'utf8');
      return JSON.parse(serialized);
    }
  } catch (err) {
    console.error('加载账号列表失败:', err);
  }

  return { accounts: [] };
}

// 保存当前登录状态
async function saveCurrentAuth(data: CurrentAuthData) {
  ensureAuthDir();
  console.log('[saveCurrentAuth] 准备保存:', {
    email: data.email,
    hasAccessToken: !!data.accessToken,
    hasRefreshToken: !!data.refreshToken,
    tokenExpiresAt: data.tokenExpiresAt,
    accessTokenLength: data.accessToken?.length
  });

  try {
    const serialized = JSON.stringify(data);
    console.log('[saveCurrentAuth] 序列化后的数据长度:', serialized.length);

    if (safeStorage.isEncryptionAvailable()) {
      console.log('[saveCurrentAuth] 使用加密存储');
      const encrypted = safeStorage.encryptString(serialized);
      fs.writeFileSync(CURRENT_AUTH_FILE, encrypted);
      console.log('[saveCurrentAuth] 加密文件已写入:', CURRENT_AUTH_FILE);
    } else {
      console.log('[saveCurrentAuth] 使用 JSON 存储（加密不可用）');
      fs.writeFileSync(CURRENT_AUTH_FILE_JSON, serialized);
      console.log('[saveCurrentAuth] JSON 文件已写入:', CURRENT_AUTH_FILE_JSON);
    }

    console.log('[saveCurrentAuth] 保存当前登录状态成功:', data.email);
  } catch (err) {
    console.error('[saveCurrentAuth] 保存当前登录状态失败:', err);
    throw err;
  }
}

// 加载当前登录状态
async function loadCurrentAuth(): Promise<CurrentAuthData | null> {
  ensureAuthDir();
  try {
    if (fs.existsSync(CURRENT_AUTH_FILE) && safeStorage.isEncryptionAvailable()) {
      const encrypted = fs.readFileSync(CURRENT_AUTH_FILE);
      const serialized = safeStorage.decryptString(encrypted);
      return JSON.parse(serialized);
    } else if (fs.existsSync(CURRENT_AUTH_FILE_JSON)) {
      const serialized = fs.readFileSync(CURRENT_AUTH_FILE_JSON, 'utf8');
      return JSON.parse(serialized);
    }
  } catch (err) {
    console.error('加载当前登录状态失败:', err);
  }

  return null;
}

// 清除当前登录状态
async function clearCurrentAuth() {
  try {
    if (fs.existsSync(CURRENT_AUTH_FILE)) {
      fs.unlinkSync(CURRENT_AUTH_FILE);
    }
    if (fs.existsSync(CURRENT_AUTH_FILE_JSON)) {
      fs.unlinkSync(CURRENT_AUTH_FILE_JSON);
    }
    console.log('清除当前登录状态成功');
  } catch (err) {
    console.error('清除当前登录状态失败:', err);
  }
}

async function saveAuthState() {
  console.log('[saveAuthState] 开始保存认证状态...');
  console.log('[saveAuthState] 当前 authState:', {
    hasUser: !!authState.user,
    userEmail: authState.user?.email,
    hasAccessToken: !!authState.accessToken,
    hasRefreshToken: !!authState.refreshToken,
    tokenExpiresAt: authState.tokenExpiresAt,
    accessTokenLength: authState.accessToken?.length,
    refreshTokenLength: authState.refreshToken?.length
  });

  if (!authState.user) {
    console.log('[saveAuthState] 没有用户信息，不保存认证状态');
    return;
  }

  if (!authState.accessToken) {
    console.error('[saveAuthState] ⚠️ 警告：accessToken 为空！');
  }

  try {
    // 保存当前登录状态
    console.log('[saveAuthState] 调用 saveCurrentAuth...');
    await saveCurrentAuth({
      email: authState.user.email,
      accessToken: authState.accessToken || '',
      refreshToken: authState.refreshToken || '',
      tokenExpiresAt: authState.tokenExpiresAt || 0,
      user: authState.user
    });
    console.log('[saveAuthState] saveCurrentAuth 完成');

    // 更新账号列表中的 lastLogin
    const accountsData = await loadAccountsList();
    const existingAccountIndex = accountsData.accounts.findIndex(
      a => a.email === authState.user?.email
    );

    const account: SavedAccount = {
      email: authState.user.email,
      nickname: authState.user.nickname,
      avatar: authState.user.avatar,
      lastLogin: Date.now()
    };

    if (existingAccountIndex >= 0) {
      accountsData.accounts[existingAccountIndex] = account;
    } else {
      accountsData.accounts.unshift(account);
    }

    // 保持最近登录的在前面
    accountsData.accounts.sort((a, b) => b.lastLogin - a.lastLogin);

    // 限制最多保存 10 个账号
    if (accountsData.accounts.length > 10) {
      accountsData.accounts = accountsData.accounts.slice(0, 10);
    }

    await saveAccountsList(accountsData);
    console.log('[saveAuthState] 认证状态保存完成');
  } catch (err) {
    console.error('[saveAuthState] 保存认证状态失败:', err);
  }
}

async function loadAuthState(): Promise<AuthState> {
  const currentAuth = await loadCurrentAuth();

  if (currentAuth) {
    authState = {
      accessToken: currentAuth.accessToken,
      refreshToken: currentAuth.refreshToken,
      tokenExpiresAt: currentAuth.tokenExpiresAt,
      user: currentAuth.user
    };

    // 同步到 apiClient
    if (authState.accessToken) apiClient.setCookie('accessToken', authState.accessToken);
    if (authState.refreshToken) apiClient.setCookie('refreshToken', authState.refreshToken);
    if (authState.tokenExpiresAt) {
      const expiresIn = Math.max(3600, Math.floor((authState.tokenExpiresAt - Date.now()) / 1000));
      apiClient.setCookie('tokenExpiresIn', expiresIn.toString());
    }

    // 同步到 Electron Session Cookies
    await syncToElectronCookies();

    console.log('加载认证状态成功:', { user: authState.user?.email });
    return authState;
  }

  console.log('未找到当前登录状态');
  return {
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    user: null
  };
}

async function removeAccount(email: string): Promise<boolean> {
  console.log('开始删除账号:', email);
  const accountsData = await loadAccountsList();
  const initialLength = accountsData.accounts.length;

  accountsData.accounts = accountsData.accounts.filter(a => a.email !== email);
  console.log('删除账号数量:', initialLength, '->', accountsData.accounts.length);

  await saveAccountsList(accountsData);

  // 如果删除的是当前登录账号，清除登录状态
  if (authState.user?.email === email) {
    await clearAuthState();
  }

  console.log('删除账号成功:', email);
  return accountsData.accounts.length < initialLength;
}

async function getSavedAccounts(): Promise<SavedAccount[]> {
  const accountsData = await loadAccountsList();
  return accountsData.accounts;
}

async function clearAuthState() {
  console.log('清除认证状态');

  // 清除当前登录状态文件
  await clearCurrentAuth();

  // 清理旧的单账号文件
  const oldEncPath = path.join(AUTH_DATA_PATH, 'auth.enc');
  const oldJsonPath = path.join(AUTH_DATA_PATH, 'auth.json');
  if (fs.existsSync(oldEncPath)) fs.unlinkSync(oldEncPath);
  if (fs.existsSync(oldJsonPath)) fs.unlinkSync(oldJsonPath);

  apiClient.clearCookies();

  authState = {
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    user: null
  };
}

function isTokenValid(): boolean {
  if (!authState.tokenExpiresAt) return false;
  return Date.now() < authState.tokenExpiresAt;
}

function syncCookiesFromClient() {
  console.log('[syncCookiesFromClient] 开始同步 Cookie...');
  const accessToken = apiClient.getCookie('accessToken');
  const refreshToken = apiClient.getCookie('refreshToken');
  const expiresInStr = apiClient.getCookie('tokenExpiresIn');

  console.log('[syncCookiesFromClient] 从 apiClient 获取的 Cookie:', {
    hasAccessToken: !!accessToken,
    hasRefreshToken: !!refreshToken,
    expiresInStr,
    accessTokenLength: accessToken?.length,
    refreshTokenLength: refreshToken?.length
  });

  authState.accessToken = accessToken || null;
  authState.refreshToken = refreshToken || null;
  const expiresIn = expiresInStr ? parseInt(expiresInStr, 10) : 3600;
  authState.tokenExpiresAt = Date.now() + (expiresIn * 1000);

  console.log('[syncCookiesFromClient] 同步后的 authState:', {
    hasAccessToken: !!authState.accessToken,
    hasRefreshToken: !!authState.refreshToken,
    tokenExpiresAt: authState.tokenExpiresAt,
    expiresIn
  });

  // 同步到 Electron Session Cookies
  syncToElectronCookies().catch(err => {
    console.error('[syncCookiesFromClient] 同步到 Electron Session 失败:', err);
  });
}

// 将 token 同步到 Electron Session Cookies
async function syncToElectronCookies() {
  const { session } = await import('electron');
  const baseUrl = apiClient.getCookie('baseUrl') || 'https://shibit.net';

  try {
    if (authState.accessToken) {
      await session.defaultSession.cookies.set({
        url: baseUrl,
        name: 'accessToken',
        value: authState.accessToken,
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expirationDate: authState.tokenExpiresAt ? authState.tokenExpiresAt / 1000 : undefined
      });
      console.log('[syncToElectronCookies] accessToken 已同步到 Electron Session');
    }

    if (authState.refreshToken) {
      await session.defaultSession.cookies.set({
        url: baseUrl,
        name: 'refreshToken',
        value: authState.refreshToken,
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expirationDate: authState.tokenExpiresAt ? (authState.tokenExpiresAt + 259200000) / 1000 : undefined
      });
      console.log('[syncToElectronCookies] refreshToken 已同步到 Electron Session');
    }
  } catch (err) {
    console.error('[syncToElectronCookies] 同步失败:', err);
  }
}

async function refreshUserInfo(): Promise<User | null> {
  try {
    console.log('调用 authService.getCurrentUser()...');
    const result = await authService.getCurrentUser();
    console.log('getCurrentUser 响应:', { success: result.success, data: result.data });

    if (result.success && result.data) {
      authState.user = result.data;
      await saveAuthState();
      console.log('用户信息刷新成功:', result.data.email);
      return result.data;
    } else {
      console.log('getCurrentUser 失败:', result.message);
    }
  } catch (err) {
    console.error('刷新用户信息失败:', err);
  }
  return null;
}

function getAuthState(): AuthState {
  return authState;
}

function setAuthState(newState: Partial<AuthState>) {
  authState = { ...authState, ...newState };
}

export {
  loadAuthState,
  saveAuthState,
  clearAuthState,
  isTokenValid,
  syncCookiesFromClient,
  syncToElectronCookies,
  refreshUserInfo,
  getAuthState,
  setAuthState,
  removeAccount,
  getSavedAccounts,
  type AuthState,
  type SavedAccount
};
