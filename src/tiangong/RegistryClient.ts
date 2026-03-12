// ============================================================
// 天工坊 Registry API 客户端
// ============================================================

import { logger } from '@/core/logger';
import type { PackageDetail, InstallConfig, SearchOptions, SearchResult, SubscriptionItem, SubscriptionConfig } from './types';
import type { AuthenticatedFetch } from '@/auth/AuthenticatedFetch';

const log = logger.child({ module: 'TiangongRegistry' });

/** API 响应结构 */
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export class RegistryClient {
  private baseURL: string;
  private apiKey?: string;
  private authFetch?: AuthenticatedFetch;

  constructor(baseURL?: string, apiKey?: string, authFetch?: AuthenticatedFetch) {
    this.baseURL = baseURL ?? 'https://shibit.net/api/tiangong';
    this.apiKey = apiKey;
    this.authFetch = authFetch;
  }

  /** 是否已配置认证（API Key 或已登录） */
  get isAuthenticated(): boolean {
    return !!this.apiKey || !!this.authFetch;
  }

  /** 构建请求头（如有 apiKey 则携带 Authorization） */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /** 发送请求（优先使用 authFetch，降级到原生 fetch） */
  private async doFetch(url: string, options?: RequestInit): Promise<Response> {
    if (this.authFetch) {
      return this.authFetch.fetch(url, options);
    }
    return fetch(url, options);
  }

  /** 搜索包（带认证时返回自己的草稿 + 他人的上线包） */
  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const params = new URLSearchParams();
    params.set('search', query);
    if (options?.type) params.set('type', String(options.type));
    if (options?.category) params.set('category', String(options.category));
    params.set('sort', options?.sort ?? 'downloads');
    params.set('pageNum', String(options?.page ?? 1));
    params.set('pageSize', String(options?.pageSize ?? 20));

    // 已认证时使用用户搜索接口（可看到自己的草稿）
    const endpoint = this.isAuthenticated
      ? `${this.baseURL}/user/packages/search`
      : `${this.baseURL}/public/packages`;
    const url = `${endpoint}?${params.toString()}`;
    log.debug(`Searching packages: ${url}`);

    const response = await this.doFetch(url, {
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`天工坊 API 请求失败: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as ApiResponse<SearchResult>;
    if (!json.success) {
      throw new Error(`天工坊 API 错误: ${json.message}`);
    }
    return json.data;
  }

  /** 获取包详情 */
  async getDetail(packageId: string): Promise<PackageDetail> {
    const url = `${this.baseURL}/public/packages/${encodeURIComponent(packageId)}`;
    log.debug(`Fetching package detail: ${url}`);

    const response = await this.doFetch(url, {
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`天工坊 API 请求失败: ${response.status}`);
    }

    const json = await response.json() as ApiResponse<PackageDetail>;
    if (!json.success) {
      throw new Error(`天工坊 API 错误: ${json.message}`);
    }
    return json.data;
  }

  /** 获取安装配置 */
  async getInstallConfig(packageId: string, version?: string): Promise<InstallConfig> {
    const params = version ? `?version=${encodeURIComponent(version)}` : '';
    const url = `${this.baseURL}/public/packages/${encodeURIComponent(packageId)}/install${params}`;
    log.debug(`Fetching install config: ${url}`);

    const response = await this.doFetch(url, {
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`天工坊 API 请求失败: ${response.status}`);
    }

    const json = await response.json() as ApiResponse<InstallConfig>;
    if (!json.success) {
      throw new Error(`天工坊 API 错误: ${json.message}`);
    }
    return json.data;
  }

  /** 记录下载 */
  async recordDownload(packageId: number, versionId: number, deviceFingerprint?: string): Promise<void> {
    if (!this.isAuthenticated) return;

    try {
      const url = `${this.baseURL}/user/downloads`;
      await this.doFetch(url, {
        method: 'POST',
        headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ packageId, versionId, deviceFingerprint }),
      });
    } catch (err) {
      log.warn(`Failed to record download: ${err}`);
    }
  }

  /** 订阅私有服务 */
  async subscribe(packageId: string, configs: Record<string, string>): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('未登录或未配置 API Key，请先 /login 或设置天工坊 API Key');
    }

    const url = `${this.baseURL}/user/subscribe`;
    log.debug(`Subscribing to package: ${packageId}`);

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ packageId, configs }),
    });
    if (!response.ok) {
      throw new Error(`天工坊 API 请求失败: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as ApiResponse<void>;
    if (!json.success) {
      throw new Error(`天工坊 API 错误: ${json.message}`);
    }
  }

  /** 取消订阅 */
  async unsubscribe(packageId: string): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('未登录或未配置 API Key，请先 /login 或设置天工坊 API Key');
    }

    const url = `${this.baseURL}/user/unsubscribe`;
    log.debug(`Unsubscribing from package: ${packageId}`);

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ packageId }),
    });
    if (!response.ok) {
      throw new Error(`天工坊 API 请求失败: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as ApiResponse<void>;
    if (!json.success) {
      throw new Error(`天工坊 API 错误: ${json.message}`);
    }
  }

  /** 获取我的订阅列表 */
  async getMySubscriptions(): Promise<SubscriptionItem[]> {
    if (!this.isAuthenticated) {
      throw new Error('未登录或未配置 API Key，请先 /login 或设置天工坊 API Key');
    }

    const url = `${this.baseURL}/user/subscriptions`;
    log.debug('Fetching my subscriptions');

    const response = await this.doFetch(url, {
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`天工坊 API 请求失败: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as ApiResponse<SubscriptionItem[]>;
    if (!json.success) {
      throw new Error(`天工坊 API 错误: ${json.message}`);
    }
    return json.data;
  }

  /** 获取订阅配置（安装私有服务时使用） */
  async getSubscriptionConfig(packageId: string): Promise<SubscriptionConfig> {
    if (!this.isAuthenticated) {
      throw new Error('未登录或未配置 API Key，请先 /login 或设置天工坊 API Key');
    }

    const url = `${this.baseURL}/user/subscriptions/${encodeURIComponent(packageId)}/config`;
    log.debug(`Fetching subscription config: ${packageId}`);

    const response = await this.doFetch(url, {
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`天工坊 API 请求失败: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as ApiResponse<SubscriptionConfig>;
    if (!json.success) {
      throw new Error(`天工坊 API 错误: ${json.message}`);
    }
    return json.data;
  }
}
