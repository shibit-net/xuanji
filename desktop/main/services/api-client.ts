// ============================================================
// Xuanji Desktop - API Client
// ============================================================
// 统一管理 API 请求，处理 Cookie 传递和响应解析

import { net, session } from 'electron';
import { URL } from 'url';

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

  constructor(config: ApiConfig) {
    this.config = {
      timeout: 15000,
      ...config
    };
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

  // 构建 Cookie 头
  private buildCookieHeader(): string {
    const cookies: string[] = [];
    this.cookies.forEach((value, name) => {
      cookies.push(`${name}=${value}`);
    });
    return cookies.join('; ');
  }

  // 通用请求方法 - 使用 Electron net 模块
  async request<T = any>(
    url: string, options: { method?: string; body?: any } = {}): Promise<ApiResponse<T>> {
    return new Promise(async (resolve, reject) => {
      const fullUrl = url.startsWith('http') ? url : `${this.config.baseUrl}${url}`;

      console.log('发送 API 请求:', options.method || 'GET', fullUrl);

      // 先检查 Session Cookies
      try {
        const cookies = await session.defaultSession.cookies.get({ url: fullUrl });
        console.log('请求前的 Session Cookies:', cookies.map(c => ({ name: c.name, domain: c.domain })));
      } catch (err) {
        console.error('获取 Session Cookies 失败:', err);
      }

      const requestOptions: Electron.ClientRequestConstructorOptions = {
        method: options.method || 'GET',
        url: fullUrl,
        useSessionCookies: true, // 关键：使用 Session Cookies
        session: session.defaultSession
      };

      const request = net.request(requestOptions);

      // 设置请求头
      request.setHeader('Content-Type', 'application/json');

      // 不再手动添加 Cookie 头，让 Electron 自动处理
      console.log('使用 Electron Session Cookies 发送请求');

      const timeoutId = setTimeout(() => {
        console.error('请求超时:', fullUrl);
        request.abort();
      }, this.config.timeout);

      request.on('response', (response) => {
        console.log('收到响应，状态码:', response.statusCode);

        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          clearTimeout(timeoutId);

          try {
            // 处理 Set-Cookie 响应头（登录时需要）
            const setCookieHeaders = response.headers['set-cookie'];
            if (setCookieHeaders) {
              console.log('收到 Set-Cookie 头:', setCookieHeaders);
              this.parseAndStoreCookies(setCookieHeaders);
              console.log('解析后的 Cookies:', Object.keys(Object.fromEntries(this.cookies)));
            }

            const result: ApiResponse<T> = JSON.parse(data);
            console.log('响应数据:', { success: result.success, message: result.message });
            resolve({
              success: result.success !== false,
              data: result.data,
              message: result.message,
              code: result.code,
            });
          } catch (err: any) {
            console.error('解析响应失败:', err, '响应数据:', data);
            reject(err);
          }
        });

        response.on('error', (err) => {
          clearTimeout(timeoutId);
          console.error('响应错误:', err);
          reject(err);
        });
      });

      request.on('error', (err) => {
        clearTimeout(timeoutId);
        console.error('请求错误:', err);
        reject(err);
      });

      if (options.body) {
        const bodyStr = JSON.stringify(options.body);
        console.log('请求体长度:', bodyStr.length);
        request.write(bodyStr);
      }
      
      request.end();
    });
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
