// 使用 default import 兼容 CJS electron 模块（子进程 ESM 环境下 named export 不可用）
import electron from 'electron';
const { safeStorage } = electron;
import path from 'path';
import fs from 'fs';
import os from 'os';
import { authService, apiClient, type User } from '../services/index.js';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  user: User | null;
}

interface SavedAccount {
  email: string;
  nickName?: string;
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
  try {
    const serialized = JSON.stringify(data);

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(serialized);
      fs.writeFileSync(CURRENT_AUTH_FILE, encrypted);
    } else {
      fs.writeFileSync(CURRENT_AUTH_FILE_JSON, serialized);
    }
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
  } catch (err) {
    console.error('清除当前登录状态失败:', err);
  }
}

async function saveAuthState() {
  if (!authState.user) {
    return;
  }

  if (!authState.accessToken) {
    console.error('[saveAuthState] ⚠️ 警告：accessToken 为空！');
  }

  try {
    await saveCurrentAuth({
      email: authState.user.email,
      accessToken: authState.accessToken || '',
      refreshToken: authState.refreshToken || '',
      tokenExpiresAt: authState.tokenExpiresAt || 0,
      user: authState.user
    });

    // 更新账号列表中的 lastLogin
    const accountsData = await loadAccountsList();
    const existingAccountIndex = accountsData.accounts.findIndex(
      a => a.email === authState.user?.email
    );

    const account: SavedAccount = {
      email: authState.user.email,
      nickName: authState.user.nickName,
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

    // 注册 1101 自动刷新回调 + 启动主动刷新
    registerRefreshHandler();
    startProactiveRefresh();

    console.log(`[Auth] Session restored: userId=${authState.user.userId}, email=${authState.user.email}, tokenValid=${isTokenValid()}`);
    return authState;
  }


  return {
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    user: null
  };
}

async function removeAccount(email: string): Promise<boolean> {
  const accountsData = await loadAccountsList();
  const initialLength = accountsData.accounts.length;

  accountsData.accounts = accountsData.accounts.filter(a => a.email !== email);

  await saveAccountsList(accountsData);

  // 如果删除的是当前登录账号，清除登录状态
  if (authState.user?.email === email) {
    await clearAuthState();
  }

  return accountsData.accounts.length < initialLength;
}

async function getSavedAccounts(): Promise<SavedAccount[]> {
  const accountsData = await loadAccountsList();
  return accountsData.accounts;
}

async function clearAuthState() {
  // 停止主动刷新定时器
  stopProactiveRefresh();

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

// ─── Token 刷新 & 主动续期 ────────────────────────────

/** 主动刷新定时器句柄 */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Session 过期回调——token 刷新失败时通知主进程，由主进程通知 renderer 跳转登录页 */
let onSessionExpiredHandler: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpiredHandler = handler;
}

/** token 刷新失败时清除认证状态并通知 renderer */
async function notifySessionExpired(): Promise<void> {
  await clearAuthState();
  onSessionExpiredHandler?.();
}
const PROACTIVE_REFRESH_INTERVAL = 50 * 60 * 1000;

/** 执行 token 刷新（apiClient 的 1101 拦截器和主动定时器共用） */
async function performRefresh(): Promise<boolean> {
  try {
    const result = await authService.refreshToken();
    if (result.success) {
      await syncCookiesFromClient();
      await saveAuthState();
      return true;
    }
  } catch (err) {
    console.error('[performRefresh] 刷新 token 失败:', err);
  }
  return false;
}

/** 向 apiClient 注册 1101 自动刷新回调 */
function registerRefreshHandler(): void {
  apiClient.setRefreshTokenHandler(async () => {
    const ok = await performRefresh();
    if (!ok) {
      await notifySessionExpired();
    }
    return ok;
  });
}

/** 启动主动 token 刷新定时器（每 50 分钟刷新一次） */
function startProactiveRefresh(): void {
  stopProactiveRefresh();
  refreshTimer = setInterval(async () => {
    if (!authState.refreshToken) {
      stopProactiveRefresh();
      return;
    }
    const ok = await performRefresh();
    if (!ok) {
      console.error('[Auth] 主动刷新失败，通知重新登录');
      await notifySessionExpired();
    }
  }, PROACTIVE_REFRESH_INTERVAL);
}

/** 停止主动 token 刷新定时器 */
function stopProactiveRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function syncCookiesFromClient() {
  const accessToken = apiClient.getCookie('accessToken');
  const refreshToken = apiClient.getCookie('refreshToken');
  const expiresInStr = apiClient.getCookie('tokenExpiresIn');
  const refreshExpiresInStr = apiClient.getCookie('refreshTokenExpiresIn');

  authState.accessToken = accessToken || null;
  authState.refreshToken = refreshToken || null;
  const expiresIn = expiresInStr ? parseInt(expiresInStr, 10) : 3600;
  authState.tokenExpiresAt = Date.now() + (expiresIn * 1000);

  // 同步 refreshToken 过期时间（从服务端 Set-Cookie 的 Max-Age 解析，不再硬编码）
  const refreshExpiresIn = refreshExpiresInStr ? parseInt(refreshExpiresInStr, 10) : 259200;
  (authState as any)._refreshTokenExpiresAt = Date.now() + (refreshExpiresIn * 1000);

  // 同步到 Electron Session Cookies
  try {
    await syncToElectronCookies();
  } catch (err) {
    console.error('[syncCookiesFromClient] 同步到 Electron Session 失败:', err);
  }
}

// 将 token 同步到 Electron Session Cookies
async function syncToElectronCookies() {
  const { session } = electron;
  const baseUrl = process.env.STARSHIP_API_URL || 'https://shibit.net';

  // 从 URL 提取域名
  let domain: string;
  try {
    const url = new URL(baseUrl);
    domain = url.hostname;
    // 如果是子域名，设置为顶级域名（例如 dev.shibit.net -> .shibit.net）
    const parts = domain.split('.');
    if (parts.length > 2) {
      domain = '.' + parts.slice(-2).join('.');
    } else {
      domain = '.' + domain;
    }
  } catch {
    domain = '.shibit.net'; // 默认值
  }

  try {
    if (authState.accessToken) {
      await session.defaultSession.cookies.set({
        url: baseUrl,
        name: 'accessToken',
        value: authState.accessToken,
        domain: domain,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expirationDate: authState.tokenExpiresAt ? authState.tokenExpiresAt / 1000 : undefined
      });
    }

    if (authState.refreshToken) {
      const refreshExpiresAt = (authState as any)._refreshTokenExpiresAt;
      await session.defaultSession.cookies.set({
        url: baseUrl,
        name: 'refreshToken',
        value: authState.refreshToken,
        domain: domain,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expirationDate: refreshExpiresAt ? refreshExpiresAt / 1000 : undefined,
      });
    }

    await session.defaultSession.cookies.get({ url: baseUrl });
  } catch (err) {
    console.error('[syncToElectronCookies] 同步失败:', err);
  }
}

async function refreshUserInfo(): Promise<User | null> {
  try {
    const result = await authService.getCurrentUser();

    if (result.success && result.data) {
      authState.user = result.data;
      await saveAuthState();
      return result.data;
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
  registerRefreshHandler,
  startProactiveRefresh,
  stopProactiveRefresh,
  performRefresh,
  type AuthState,
  type SavedAccount
};
