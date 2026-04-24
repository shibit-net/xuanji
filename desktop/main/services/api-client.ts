// ============================================================
// Xuanji Desktop - API Client
// ============================================================
// 统一管理 API 请求，处理 Cookie 传递和响应解析

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { session } from 'electron';

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

class ApiClient {
  private config: ApiConfig;
  private cookies: Map<string, string> = new Map();
  private axiosInstance: AxiosInstance;

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
        const fullUrl = config.baseURL + config.url;

        // 🔧 只为 shibit.net 域添加 Cookie，避免污染其他域名的请求
        if (fullUrl.includes('shibit.net')) {
          const cookies = await session.defaultSession.cookies.get({ url: fullUrl });

          if (cookies.length > 0) {
            const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            config.headers['Cookie'] = cookieHeader;
            console.log('[API Client] 自动添加 Cookie，数量:', cookies.length);
            console.log('[API Client] Cookie 内容（前200字符）:', cookieHeader.substring(0, 200));

            // 打印所有请求头
            console.log('[API Client] 所有请求头:', JSON.stringify(config.headers, null, 2));
          } else {
            console.log('[API Client] 警告：没有可用的 Cookie');
          }
        } else {
          console.log('[API Client] 跳过 Cookie 添加（非 shibit.net 域）:', fullUrl);
        }
      } catch (err) {
        console.error('[API Client] 获取 Cookie 失败:', err);
      }

      console.log('[API Client] 发送请求:', config.method?.toUpperCase(), config.url);
      return config;
    });

    // 响应拦截器：处理 Set-Cookie 和错误
    this.axiosInstance.interceptors.response.use(
      (response) => {
        console.log('[API Client] 收到响应，状态码:', response.status);

        // 处理 Set-Cookie（如果有）
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
          console.log('[API Client] 收到 Set-Cookie:', setCookie);
          this.parseAndStoreCookies(setCookie);
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
          // 服务器返回了错误状态码
          errorMessage = `服务器错误 (${error.response.status})`;
          console.error('[API Client] 服务器错误:', error.response.status, error.response.data);
        } else {
          console.error('[API Client] 请求失败:', error.message);
        }

        // 将友好的错误消息附加到错误对象
        error.friendlyMessage = errorMessage;
        throw error;
      }
    );
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
      const cookies = header.split(/,(?=\s*[a-zA-Z0-9_]+=)/);
      
      for (const cookie of cookies) {
        const trimmedCookie = cookie.trim();
        
        if (trimmedCookie.startsWith('accessToken=')) {
          const match = trimmedCookie.match(/accessToken=([^;]+)/);
          if (match) {
            this.setCookie('accessToken', match[1]);
          }
        } else if (trimmedCookie.startsWith('refreshToken=')) {
          const match = trimmedCookie.match(/refreshToken=([^;]+)/);
          if (match) {
            this.setCookie('refreshToken', match[1]);
          }
        } else if (trimmedCookie.startsWith('tokenExpiresIn=')) {
          const match = trimmedCookie.match(/tokenExpiresIn=([^;]+)/);
          if (match) {
            this.setCookie('tokenExpiresIn', match[1]);
          }
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
    options: { method?: string; body?: any } = {}
  ): Promise<ApiResponse<T>> {
    try {
      const config: AxiosRequestConfig = {
        url,
        method: (options.method || 'GET') as any,
        data: options.body
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
          message: result?.message || error.message,
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
  async post<T = any>(url: string, data?: any) {
    return this.request<T>(url, {
      method: 'POST',
      body: data
    });
  }

  // PUT 请求
  async put<T = any>(url: string, data?: any) {
    return this.request<T>(url, {
      method: 'PUT',
      body: data
    });
  }

  // DELETE 请求
  async delete<T = any>(url: string) {
    return this.request<T>(url, { method: 'DELETE' });
  }
}

export default ApiClient;
