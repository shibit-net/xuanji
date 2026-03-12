// ============================================================
// 用户认证 — 认证管理器
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { logger } from '@/core/logger';
import type { UserCredentials, UserInfo, AuthStatus } from './types';
import { EncryptionService } from './EncryptionService';
import { CookieManager } from './CookieManager';
import { AuthenticatedFetch } from './AuthenticatedFetch';

const log = logger.child({ module: 'Auth' });

/** Token 提前刷新阈值（秒） */
const TOKEN_REFRESH_THRESHOLD = 5 * 60; // 5 分钟

/** API 响应结构（Shibit 标准格式） */
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export class AuthManager {
  private credentials: UserCredentials | null = null;
  private encryption: EncryptionService;
  private cookieManager: CookieManager;
  private authenticatedFetch: AuthenticatedFetch;
  private refreshPromise: Promise<void> | null = null;

  private readonly authFilePath: string;
  private readonly serverURL: string;

  constructor(
    private configDir: string,
    serverURL?: string,
  ) {
    this.serverURL = serverURL ?? 'https://shibit.net';
    this.authFilePath = join(configDir, 'auth.json');

    // 初始化加密服务
    this.encryption = new EncryptionService(join(configDir, 'machine.key'));

    // 初始化 Cookie 管理
    this.cookieManager = new CookieManager(
      join(configDir, 'cookies.json'),
      this.encryption,
    );

    // 初始化认证 Fetch
    this.authenticatedFetch = new AuthenticatedFetch(
      this.cookieManager,
      () => this.getAccessToken(),
      () => this.handleUnauthorized(),
    );

    // 加载已有凭证
    this.loadCredentials();
  }

  // ============================================================
  // 公开方法
  // ============================================================

  /** 邮箱密码登录 */
  async login(email: string, password: string): Promise<UserInfo> {
    log.info(`Logging in as ${email}`);

    const url = `${this.serverURL}/api/auth/login`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    // 保存响应 Cookie（accessToken / refreshToken）
    this.cookieManager.setCookies(url, response.headers);

    if (!response.ok) {
      const body = await response.text();
      let message = `登录失败 (${response.status})`;
      try {
        const json = JSON.parse(body);
        if (json.message) message = json.message;
      } catch { /* 非 JSON 响应 */ }
      throw new Error(message);
    }

    const json = await response.json() as ApiResponse<{ accessToken: string; refreshToken?: string }>;
    if (!json.success) {
      throw new Error(json.message ?? '登录失败');
    }

    // 提取 Token（可能在响应体或 Cookie 中）
    const accessToken = json.data?.accessToken ?? this.extractTokenFromCookie('accessToken');
    const refreshToken = json.data?.refreshToken ?? this.extractTokenFromCookie('refreshToken');

    if (!accessToken) {
      throw new Error('登录响应中未找到 accessToken');
    }

    // 获取用户信息
    const userInfo = await this.fetchUserInfo(accessToken);

    // 保存凭证
    this.credentials = {
      accessToken,
      refreshToken: refreshToken ?? '',
      tokenExpiry: this.parseJwtExpiry(accessToken),
      userId: userInfo.id,
      username: userInfo.username,
      email: userInfo.email,
    };
    this.saveCredentials();

    log.info(`Login successful: ${userInfo.username} (${userInfo.email})`);
    return userInfo;
  }

  /** 登出 */
  async logout(): Promise<void> {
    log.info('Logging out');

    // 调用后端登出接口（静默失败）
    try {
      const url = `${this.serverURL}/api/auth/logout`;
      await this.authenticatedFetch.fetch(url, { method: 'POST' });
    } catch (err) {
      log.debug(`Logout API call failed (ignored): ${err}`);
    }

    // 清除本地凭证和 Cookie
    this.clearCredentials();
    this.cookieManager.clear();

    log.info('Logged out successfully');
  }

  /**
   * 确保 Token 有效（自动刷新快过期的 Token）
   * 返回有效的 accessToken，无效时返回 null
   */
  async ensureValidToken(): Promise<string | null> {
    if (!this.credentials) return null;

    const now = Math.floor(Date.now() / 1000);
    const remaining = this.credentials.tokenExpiry - now;

    if (remaining < TOKEN_REFRESH_THRESHOLD) {
      try {
        await this.refreshToken();
      } catch (err) {
        log.warn(`Token refresh failed: ${err}`);
        this.clearCredentials();
        return null;
      }
    }

    return this.credentials?.accessToken ?? null;
  }

  /** 刷新 Token（带并发锁） */
  async refreshToken(): Promise<void> {
    // 防止并发刷新
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefreshToken();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /** 获取当前用户信息（需要有效 Token） */
  async getCurrentUser(): Promise<UserInfo | null> {
    const token = await this.ensureValidToken();
    if (!token) return null;

    try {
      return await this.fetchUserInfo(token);
    } catch (err) {
      log.warn(`Failed to fetch user info: ${err}`);
      return null;
    }
  }

  /** 当前是否已认证 */
  isAuthenticated(): boolean {
    return this.credentials !== null;
  }

  /** 获取认证状态 */
  getAuthStatus(): AuthStatus {
    if (!this.credentials) return 'unauthenticated';
    const now = Math.floor(Date.now() / 1000);
    if (this.credentials.tokenExpiry <= now) return 'expired';
    return 'authenticated';
  }

  /** 获取缓存的用户名（不发请求） */
  getCachedUsername(): string | null {
    return this.credentials?.username ?? null;
  }

  /** 获取缓存的邮箱（不发请求） */
  getCachedEmail(): string | null {
    return this.credentials?.email ?? null;
  }

  /** 获取 AuthenticatedFetch 实例（供 RegistryClient 等使用） */
  getAuthenticatedFetch(): AuthenticatedFetch {
    return this.authenticatedFetch;
  }

  /** 获取服务器地址 */
  getServerURL(): string {
    return this.serverURL;
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /** 获取当前 accessToken（TokenProvider 回调） */
  private async getAccessToken(): Promise<string | null> {
    return this.credentials?.accessToken ?? null;
  }

  /** 401 处理（AuthenticatedFetch 回调） */
  private async handleUnauthorized(): Promise<boolean> {
    if (!this.credentials?.refreshToken) {
      this.clearCredentials();
      return false;
    }

    try {
      await this.refreshToken();
      return true;
    } catch {
      this.clearCredentials();
      return false;
    }
  }

  /** 执行 Token 刷新 */
  private async doRefreshToken(): Promise<void> {
    log.debug('Refreshing token');

    const url = `${this.serverURL}/api/auth/refresh`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: this.cookieManager.getCookieHeader(url),
      },
    });

    // 保存新的 Cookie
    this.cookieManager.setCookies(url, response.headers);

    if (!response.ok) {
      throw new Error(`Token 刷新失败 (${response.status})`);
    }

    const json = await response.json() as ApiResponse<{ accessToken: string; refreshToken?: string }>;
    if (!json.success) {
      throw new Error(json.message ?? 'Token 刷新失败');
    }

    // 更新 Token
    const newAccessToken = json.data?.accessToken ?? this.extractTokenFromCookie('accessToken');
    const newRefreshToken = json.data?.refreshToken ?? this.extractTokenFromCookie('refreshToken');

    if (!newAccessToken) {
      throw new Error('刷新响应中未找到 accessToken');
    }

    if (this.credentials) {
      this.credentials.accessToken = newAccessToken;
      if (newRefreshToken) {
        this.credentials.refreshToken = newRefreshToken;
      }
      this.credentials.tokenExpiry = this.parseJwtExpiry(newAccessToken);
      this.saveCredentials();
    }

    log.debug('Token refreshed successfully');
  }

  /** 获取用户信息 */
  private async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    const url = `${this.serverURL}/api/users/me`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Cookie': this.cookieManager.getCookieHeader(url),
      },
    });

    if (!response.ok) {
      throw new Error(`获取用户信息失败 (${response.status})`);
    }

    const json = await response.json() as ApiResponse<UserInfo>;
    if (!json.success) {
      throw new Error(json.message ?? '获取用户信息失败');
    }
    return json.data;
  }

  /** 从 Cookie 中提取指定名称的值 */
  private extractTokenFromCookie(name: string): string | null {
    const cookieHeader = this.cookieManager.getCookieHeader(this.serverURL);
    if (!cookieHeader) return null;

    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? match[1] : null;
  }

  /** 解析 JWT 过期时间 */
  private parseJwtExpiry(token: string): number {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return 0;

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      return payload.exp ?? 0;
    } catch {
      // JWT 解析失败，默认 1 小时后过期
      return Math.floor(Date.now() / 1000) + 3600;
    }
  }

  /** 加载凭证（从加密文件） */
  private loadCredentials(): void {
    if (!existsSync(this.authFilePath)) return;

    try {
      const encrypted = readFileSync(this.authFilePath, 'utf-8');
      const json = this.encryption.decrypt(encrypted);
      this.credentials = JSON.parse(json) as UserCredentials;
      log.debug(`Credentials loaded for ${this.credentials.username}`);
    } catch (err) {
      log.warn(`Failed to load credentials (will be cleared): ${err}`);
      this.clearCredentials();
    }
  }

  /** 保存凭证（加密到文件，权限 600） */
  private saveCredentials(): void {
    if (!this.credentials) return;

    try {
      const json = JSON.stringify(this.credentials);
      const encrypted = this.encryption.encrypt(json);

      const dir = dirname(this.authFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.authFilePath, encrypted, 'utf-8');
      try {
        chmodSync(this.authFilePath, 0o600);
      } catch {
        // Windows 忽略
      }
    } catch (err) {
      log.error(`Failed to save credentials: ${err}`);
    }
  }

  /** 清除凭证 */
  private clearCredentials(): void {
    this.credentials = null;
    try {
      if (existsSync(this.authFilePath)) {
        unlinkSync(this.authFilePath);
      }
    } catch {
      // 忽略删除失败
    }
  }
}
