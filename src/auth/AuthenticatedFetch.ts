// ============================================================
// 用户认证 — 带 Cookie 的 Fetch 封装
// ============================================================

import type { CookieManager } from './CookieManager';

export type TokenProvider = () => Promise<string | null>;

export class AuthenticatedFetch {
  constructor(
    private cookieManager: CookieManager,
    private tokenProvider: TokenProvider,
    private onUnauthorized: () => Promise<boolean>, // 返回 true 表示刷新成功，可重试
  ) {}

  /**
   * 发送带认证的 HTTP 请求
   * - 自动注入 Cookie header
   * - 自动保存响应的 Set-Cookie
   * - 401 时尝试刷新 Token 并重试一次
   */
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    const response = await this.doFetch(url, options);

    // 401 → 尝试刷新 Token 并重试
    if (response.status === 401) {
      const refreshed = await this.onUnauthorized();
      if (refreshed) {
        return this.doFetch(url, options);
      }
    }

    return response;
  }

  private async doFetch(url: string, options?: RequestInit): Promise<Response> {
    // 注入 Cookie
    const cookieHeader = this.cookieManager.getCookieHeader(url);
    const headers = new Headers(options?.headers);
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    }

    // 注入 Bearer Token（作为备选，某些 API 可能不走 Cookie）
    const token = await this.tokenProvider();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // 保存响应的 Set-Cookie
    this.cookieManager.setCookies(url, response.headers);

    return response;
  }
}
