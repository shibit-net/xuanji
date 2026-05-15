// ============================================================
// Xuanji Desktop - API Client
// ============================================================
// 统一管理 API 请求，处理 Cookie 传递和响应解析

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
// 使用 default import 兼容 CJS electron 模块（子进程 ESM 环境下 named export 不可用）
import electron from 'electron';
const { session } = electron;

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  code?: number;
}

export interface ApiConfig {
  baseUrl: string;
  timeout?: number;
}

/** refreshToken 刷新回调签名 */
export type RefreshTokenHandler = () => Promise<boolean>;

class ApiClient {
  private config: ApiConfig;
  private cookies: Map<string, string> = new Map();
  private axiosInstance: AxiosInstance;

  /** refreshToken 刷新回调（由 auth config 注册） */
  private refreshTokenHandler: RefreshTokenHandler | null = null;

  /** 防止并发刷新 */
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(config: ApiConfig) {
    this.config = {
      timeout: 15000,
      ...config
    };

    // 创建 axios 实例
    this.axiosInstance = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // 请求拦截器：自动添加 Cookie（仅限 shibit.net 域）
    this.axiosInstance.interceptors.request.use(async (config) => {
      try {
        // 从 Electron Session 获取 Cookie
        const fullUrl = (config.baseURL ?? '') + (config.url ?? '');

        // 🔧 只为 shibit.net 域添加 Cookie，避免污染其他域名的请求
        if (fullUrl.includes('shibit.net')) {
          const cookies = await session.defaultSession.cookies.get({ url: fullUrl });

          if (cookies.length > 0) {
            const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            config.headers['Cookie'] = cookieHeader;
          } else {
            console.log('[API Client] 警告：没有可用的 Cookie');
          }
        }
      } catch (err) {
        console.error('[API Client] 获取 Cookie 失败:', err);
      }

      return config;
    });

    // 响应拦截器：处理 1101 自动刷新、Set-Cookie 和错误
    this.axiosInstance.interceptors.response.use(
      async (response) => {
        // 处理 Set-Cookie（如果有）
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
          this.parseAndStoreCookies(setCookie);
        }

        // 检测 code=1101（Token 过期），自动刷新后重放
        // 跳过 /api/auth/refresh 自身，防止 refreshToken 也过期时无限递归
        const data = response.data;
        if (data?.code === 1101 && this.refreshTokenHandler && !response.config.url?.includes('/api/auth/refresh')) {
          const refreshed = await this.handleTokenRefresh();
          if (refreshed) {
            // 重新获取 Cookie 并重放原请求
            try {
              const fullUrl = (response.config.baseURL ?? '') + (response.config.url ?? '');
              if (fullUrl.includes('shibit.net')) {
                const cookies = await session.defaultSession.cookies.get({ url: fullUrl });
                if (cookies.length > 0) {
                  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                  response.config.headers['Cookie'] = cookieHeader;
                }
              }
            } catch { /* ignore */ }
            return this.axiosInstance.request(response.config);
          }
          // 刷新失败，返回原始 1101 错误
        }

        return response;
      },
      (error) => {
        // 友好的错误提示
        let errorMessage = '请求失败';

        if (error.code === 'ENOTFOUND' || error.message.includes('getaddrinfo')) {
          errorMessage = '无法连接到服务器，请检查网络连接';
          console.error('[API Client] 网络连接失败:', error.message);
        } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
          errorMessage = '连接超时，请检查网络连接或稍后重试';
          console.error('[API Client] 连接超时:', error.message);
        } else if (error.code === 'ECONNREFUSED') {
          errorMessage = '服务器拒绝连接，请稍后重试';
          console.error('[API Client] 连接被拒绝:', error.message);
        } else if (error.response) {
          const status = error.response.status;
          if (status === 401) {
            errorMessage = '用户名或密码错误';
          } else if (status === 403) {
            errorMessage = '没有访问权限';
          } else if (status === 429) {
            errorMessage = '请求过于频繁，请稍后重试';
          } else if (status >= 500) {
            errorMessage = '服务器内部错误，请稍后重试';
          } else {
            errorMessage = `请求失败 (${status})`;
          }
          console.error('[API Client] 服务器错误:', status, error.response.data);
        } else {
          errorMessage = '网络错误，请检查网络连接';
          console.error('[API Client] 请求失败:', error.message);
        }

        error.friendlyMessage = errorMessage;
        throw error;
      }
    );
  }

  /** 注册 refresh token 回调 */
  setRefreshTokenHandler(handler: RefreshTokenHandler): void {
    this.refreshTokenHandler = handler;
  }

  /** 执行 token 刷新（带并发锁） */
  private async handleTokenRefresh(): Promise<boolean> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        if (!this.refreshTokenHandler) return false;
        console.log('[API Client] 检测到 code=1101，开始自动刷新 token...');
        const result = await this.refreshTokenHandler();
        console.log('[API Client] token 刷新结果:', result ? '成功' : '失败');
        return result;
      } catch (err) {
        console.error('[API Client] token 刷新异常:', err);
        return false;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // 设置 Cookie
  setCookie(name: string, value: string) {
    this.cookies.set(name, value);
  }

  // 获取 Cookie
  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  // 清除 Cookie 清除所有 Cookies
  clearCookies() {
    this.cookies.clear();
  }

  // 从 Electron 的 Cookies 同步
  async syncFromElectronCookies(url: string) {
    try {
      const cookies = await session.defaultSession.cookies.get({ url });
      for (const cookie of cookies) {
        if (cookie.name === 'accessToken' || cookie.name === 'refreshToken' || cookie.name === 'tokenExpiresIn') {
          this.setCookie(cookie.name, cookie.value);
        }
      }
    } catch (err) {
      console.error('同步 Electron Cookies 失败:', err);
    }
  }

  // 从 Set-Cookie 响应头解析 Cookie
  parseAndStoreCookies(setCookieHeaders: string | string[] | null) {
    if (!setCookieHeaders) return;

    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    for (const header of headers) {
      // 按逗号分割多个 cookie（同一 header 中可能合并了多个 Set-Cookie）
      const cookies = header.split(/,(?=\s*(?:access|refresh)Token=)/i);

      for (const cookieStr of cookies) {
        const trimmed = cookieStr.trim();

        // 提取 cookie 名称和值
        const nameMatch = trimmed.match(/^([^=]+)=([^;]*)/);
        if (!nameMatch) continue;

        const cookieName = nameMatch[1].trim();
        const cookieValue = nameMatch[2].trim();

        if (cookieName === 'accessToken') {
          this.setCookie('accessToken', cookieValue);
        } else if (cookieName === 'refreshToken') {
          this.setCookie('refreshToken', cookieValue);
          // 同时解析 Max-Age，避免硬编码 refreshToken 过期时间
          const maxAgeMatch = trimmed.match(/Max-Age=(\d+)/i);
          if (maxAgeMatch) {
            this.setCookie('refreshTokenExpiresIn', maxAgeMatch[1]);
          }
        } else if (cookieName === 'tokenExpiresIn') {
          this.setCookie('tokenExpiresIn', cookieValue);
        }
      }
    }
  }

  // 构建 Cookie 头（保留供参考，但不再使用）
  // private buildCookieHeader(): string {
  //   const cookies: string[] = [];
  //   this.cookies.forEach((value, name) => {
  //     cookies.push(`${name}=${value}`);
  //   });
  //   return cookies.join('; ');
  // }

  // 通用请求方法 - 使用 axios
  async request<T = any>(
    url: string,
    options: { method?: string; body?: any; timeout?: number } = {}
  ): Promise<ApiResponse<T>> {
    try {
      const config: AxiosRequestConfig = {
        url,
        method: (options.method || 'GET') as any,
        data: options.body,
        timeout: options.timeout ?? this.config.timeout,
      };

      const response = await this.axiosInstance.request(config);
      const result = response.data;

      return {
        success: result.success !== false,
        data: result.data,
        message: result.message,
        code: result.code,
      };
    } catch (error: any) {
      console.error('[API Client] 请求异常:', error);

      // 如果是 HTTP 错误响应
      if (error.response) {
        const result = error.response.data;
        return {
          success: false,
          data: result?.data,
          message: result?.message || error.friendlyMessage || error.message,
          code: result?.code || error.response.status,
        };
      }

      // 网络错误或其他错误
      throw error;
    }
  }

  // GET 请求
  async get<T = any>(url: string) {
    return this.request<T>(url, { method: 'GET' });
  }

  // POST 请求
  async post<T = any>(url: string, data?: any, options?: { timeout?: number }) {
    return this.request<T>(url, {
      method: 'POST',
      body: data,
      timeout: options?.timeout,
    });
  }

  // PUT 请求
  async put<T = any>(url: string, data?: any, options?: { timeout?: number }) {
    return this.request<T>(url, {
      method: 'PUT',
      body: data,
      timeout: options?.timeout,
    });
  }

  // DELETE 请求
  async delete<T = any>(url: string, options?: { timeout?: number }) {
    return this.request<T>(url, {
      method: 'DELETE',
      timeout: options?.timeout,
    });
  }
}

export default ApiClient;
