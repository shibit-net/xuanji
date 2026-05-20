/**
 * ============================================================
 * TiangongMarket - Starship 天工坊 HTTP API 适配器
 * ============================================================
 * 封装对 Starship 天工坊 API 的所有 HTTP 调用。
 *
 * API 基础路径: {baseUrl}/public/...
 * 所有响应包裹在 ApiResponse<T> 中: { code, success, message, data, timestamp }
 * 搜索接口使用 PageResponse<T> 分页: { pageNum, pageSize, total, pages, list }
 *
 * 使用 Node.js 内置 http/https，无外部依赖。
 */

import * as https from 'node:https';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TiangongMarket' });

// ============================================================
// Configuration
// ============================================================

export interface MarketConfig {
  /** Starship 天工坊基础 URL，如 "https://api.shibit.com/api/tiangong" */
  baseUrl: string;
  /** 鉴权 API Key（私有包需要） */
  apiKey?: string;
  /** HTTP 请求超时（毫秒），默认 30000 */
  timeout?: number;
}

// ============================================================
// Public Types (exported for consumers)
// ============================================================

export interface MarketPackage {
  packageId: string;
  name: string;
  type: 'mcp' | 'skill';        // 1 → mcp, 2 → skill
  description: string;
  authorName: string;
  categoryName: string;
  totalDownloads: number;
  ratingAvg: number;
  ratingCount: number;
  qualityScore: number;
  securityScore: number;
  tags: string[];
  transport?: string;           // "stdio" | "sse" | "http"
  currentVersion: string;
  proxyEnabled: boolean;
  pricingModel: number;         // 0=free, 1=per-call, 2=subscription
  source: number;
  isPrivate: boolean;
}

export interface MarketPackageDetail extends MarketPackage {
  homepageUrl?: string;
  repositoryUrl?: string;
  license?: string;
  versions: MarketVersion[];
}

export interface MarketVersion {
  id: number;
  version: string;
  changelog?: string;
  downloadUrl?: string;
  downloads: number;
  status: number;
  compatibility?: string;
  createdAt: string;
}

export interface InstallConfig {
  type: string;
  installScript: string;
  configTemplate: string;
  compatibility: string;
  versionId: number;
  version: string;
  proxyEnabled: boolean;
  pricingModel: number;
  downloadUrl?: string;
  sha256?: string;
  fileSize?: number;
}

export interface DownloadInfo {
  downloadUrl: string;
  sha256: string;
  fileSize: number;
  version: string;
  versionId: number;
}

export interface UpdateCheckItem {
  packageId: string;
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
  downloadUrl?: string;
  sha256?: string;
  fileSize?: number;
}

export interface SearchOptions {
  type?: 'mcp' | 'skill';
  query?: string;
  categoryId?: number;
  tags?: string;
  sort?: 'downloads' | 'rating' | 'updated_at' | 'created_at';
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  items: MarketPackage[];
  total: number;
  pageNum: number;
  pageSize: number;
  pages: number;
}

// ============================================================
// Internal API Response Types (match Starship JSON)
// ============================================================

interface ApiResponse<T> {
  code: number;
  success: boolean;
  message: string;
  data: T;
  timestamp: number;
}

interface PageResponse<T> {
  pageNum: number;
  pageSize: number;
  total: number;
  pages: number;
  list: T[];
}

interface PackageListRaw {
  id: number;
  packageId: string;
  name: string;
  type: number;           // 1=MCP, 2=Skill
  description: string;
  authorName: string;
  categoryName: string;
  totalDownloads: number;
  ratingAvg: number;
  ratingCount: number;
  qualityScore: number;
  securityScore: number;
  tags: string[];
  transport: string | null;
  currentVersion: string;
  proxyEnabled: boolean;
  pricingModel: number;
  source: number;
  isPrivate: boolean;
}

interface PackageDetailRaw extends PackageListRaw {
  homepageUrl?: string;
  repositoryUrl?: string;
  license?: string;
  versions?: VersionRaw[];
}

interface VersionRaw {
  id: number;
  version: string;
  changelog?: string;
  downloadUrl?: string;
  downloads: number;
  status: number;
  compatibility?: string;
  createdAt: string;
}

interface InstallConfigRaw {
  type: string;
  installScript: string;
  configTemplate: string;
  compatibility: string;
  versionId: number;
  version: string;
  proxyEnabled: boolean;
  pricingModel: number;
  downloadUrl?: string;
  sha256?: string;
  fileSize?: number;
}

interface DownloadInfoRaw {
  downloadUrl: string;
  sha256: string;
  fileSize: number;
  version: string;
  versionId: number;
}

interface UpdateCheckResultRaw {
  packageId: string;
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
  downloadUrl?: string;
  sha256?: string;
  fileSize?: number;
}

// ============================================================
// TiangongMarketError
// ============================================================

export class TiangongMarketError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly apiCode?: number,
  ) {
    super(message);
    this.name = 'TiangongMarketError';
  }
}

// ============================================================
// TiangongMarket Class
// ============================================================

export class TiangongMarket {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout: number;
  private readonly baseUrlObj: URL;
  private readonly isHttps: boolean;

  constructor(config: MarketConfig) {
    // Normalize: strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
    this.baseUrlObj = new URL(this.baseUrl);
    this.isHttps = this.baseUrlObj.protocol === 'https:';
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * 搜索包（MCP 或 Skill）
   *
   * GET /public/packages?type=1&search=...&pageNum=1&pageSize=10
   */
  async search(options: SearchOptions = {}): Promise<SearchResult> {
    const params = new URLSearchParams();

    if (options.type) {
      params.set('type', options.type === 'mcp' ? '1' : '2');
    }
    if (options.query) {
      params.set('search', options.query);
    }
    if (options.categoryId !== undefined) {
      params.set('categoryId', String(options.categoryId));
    }
    if (options.tags) {
      params.set('tags', options.tags);
    }
    if (options.sort) {
      params.set('sort', options.sort);
    }
    params.set('pageNum', String(options.page ?? 1));
    params.set('pageSize', String(options.pageSize ?? 10));

    const path = `/public/packages?${params.toString()}`;
    const raw = await this.get<PageResponse<PackageListRaw>>(path);
    const data = this.unwrap(raw);

    return {
      items: (data.list ?? []).map(p => this.mapPackage(p)),
      total: data.total,
      pageNum: data.pageNum,
      pageSize: data.pageSize,
      pages: data.pages,
    };
  }

  /**
   * 获取包详情（含版本列表）
   *
   * GET /public/packages/{packageId}
   */
  async getDetail(packageId: string): Promise<MarketPackageDetail> {
    const path = `/public/packages/${encodeURIComponent(packageId)}`;
    const raw = await this.get<PackageDetailRaw>(path);
    const data = this.unwrap(raw);

    return {
      ...this.mapPackage(data),
      homepageUrl: data.homepageUrl,
      repositoryUrl: data.repositoryUrl,
      license: data.license,
      versions: (data.versions ?? []).map(v => this.mapVersion(v)),
    };
  }

  /**
   * 获取安装配置
   *
   * GET /public/packages/{packageId}/install?version=...
   */
  async getInstallConfig(packageId: string, version?: string): Promise<InstallConfig> {
    let path = `/public/packages/${encodeURIComponent(packageId)}/install`;
    if (version) {
      path += `?version=${encodeURIComponent(version)}`;
    }
    const raw = await this.get<InstallConfigRaw>(path);
    return this.unwrap(raw);
  }

  /**
   * 获取下载信息（downloadUrl + sha256）
   *
   * GET /public/download?packageId=...&version=...
   */
  async getDownloadInfo(packageId: string, version?: string): Promise<DownloadInfo> {
    const params = new URLSearchParams();
    params.set('packageId', packageId);
    if (version) {
      params.set('version', version);
    }
    const path = `/public/download?${params.toString()}`;
    const raw = await this.get<DownloadInfoRaw>(path);
    return this.unwrap(raw);
  }

  /**
   * 下载包文件到临时目录
   *
   * 先调用 getDownloadInfo 获取 downloadUrl，再下载到临时文件。
   * @returns { tempPath, sha256 } 临时文件路径和校验和
   */
  async download(
    packageId: string,
    version?: string,
  ): Promise<{ tempPath: string; sha256: string }> {
    const info = await this.getDownloadInfo(packageId, version);
    const downloadUrl = this.resolveUrl(info.downloadUrl);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `xuanji-mcp-${packageId}-`));
    const tempFile = path.join(tempDir, `${packageId}-${info.version}.tar.gz`);

    await this.downloadFile(downloadUrl, tempFile);

    // TODO: Verify SHA256
    // const actualHash = await sha256File(tempFile);
    // if (actualHash !== info.sha256) throw new Error('SHA256 mismatch');

    return { tempPath: tempFile, sha256: info.sha256 };
  }

  /**
   * 批量更新检查
   *
   * POST /public/check-updates
   * Body: { packages: [{ packageId, currentVersion }, ...] }
   */
  async checkUpdates(
    packages: Array<{ packageId: string; currentVersion: string }>,
  ): Promise<UpdateCheckItem[]> {
    const path = '/public/check-updates';
    const body = JSON.stringify({ packages });
    const raw = await this.post<UpdateCheckResultRaw[]>(path, body);
    return this.unwrap(raw);
  }

  // ============================================================
  // HTTP Helpers
  // ============================================================

  private async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  private async post<T>(path: string, body: string): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  private request<T>(
    method: string,
    path: string,
    body?: string,
  ): Promise<ApiResponse<T>> {
    return new Promise((resolve, reject) => {
      const client = this.isHttps ? https : http;

      const headers: Record<string, string> = {
        'User-Agent': 'xuanji/0.9.0',
        'Accept': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(body));
      }

      const reqOptions = {
        hostname: this.baseUrlObj.hostname,
        port: this.baseUrlObj.port || (this.isHttps ? 443 : 80),
        path: this.baseUrlObj.pathname + path,
        method,
        headers,
        timeout: this.timeout,
      };
      const req = client.request(
        reqOptions,
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf-8');

            if (res.statusCode && res.statusCode >= 400) {
              // Try to extract error message from API response
              try {
                const apiResp = JSON.parse(rawBody) as ApiResponse<unknown>;
                reject(new TiangongMarketError(
                  apiResp.message || `HTTP ${res.statusCode}`,
                  res.statusCode,
                  apiResp.code,
                ));
              } catch {
                reject(new TiangongMarketError(
                  `HTTP ${res.statusCode}: ${res.statusMessage}`,
                  res.statusCode,
                ));
              }
              return;
            }

            try {
              const parsed = JSON.parse(rawBody) as ApiResponse<T>;
              resolve(parsed);
            } catch (err) {
              reject(new TiangongMarketError(
                `Failed to parse API response: ${(err as Error).message}`,
              ));
            }
          });
        },
      );

      req.on('error', (err) => {
        reject(new TiangongMarketError(
          `Network error: ${err.message}`,
        ));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new TiangongMarketError(
          `Request timed out after ${this.timeout}ms`,
        ));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  /**
   * 下载文件到指定路径（带重定向支持）
   */
  private downloadFile(urlStr: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const downloadUrl = new URL(urlStr);
      const client = downloadUrl.protocol === 'https:' ? https : http;

      // Ensure target directory exists
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const req = client.get(
        {
          hostname: downloadUrl.hostname,
          port: downloadUrl.port || (downloadUrl.protocol === 'https:' ? 443 : 80),
          path: downloadUrl.pathname + downloadUrl.search,
          headers: {
            'User-Agent': 'xuanji/0.9.0',
            ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
          },
          timeout: this.timeout,
        },
        (response) => {
          // Handle redirects
          if (
            response.statusCode === 301 ||
            response.statusCode === 302 ||
            response.statusCode === 307 ||
            response.statusCode === 308
          ) {
            const redirectUrl = response.headers.location;
            if (!redirectUrl) {
              reject(new TiangongMarketError('Redirect without location header'));
              return;
            }
            const resolvedRedirect = this.resolveUrl(redirectUrl, downloadUrl);
            this.downloadFile(resolvedRedirect, dest).then(resolve).catch(reject);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new TiangongMarketError(
              `Download failed: HTTP ${response.statusCode}`,
              response.statusCode,
            ));
            return;
          }

          const file = fs.createWriteStream(dest);
          response.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve();
          });

          file.on('error', (err) => {
            file.close();
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            reject(new TiangongMarketError(`File write error: ${err.message}`));
          });
        },
      );

      req.on('error', (err) => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(new TiangongMarketError(`Download error: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(new TiangongMarketError(`Download timed out after ${this.timeout}ms`));
      });
    });
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  /**
   * 解开 ApiResponse 包装，提取 data 字段
   */
  private unwrap<T>(response: ApiResponse<T>): T {
    if (!response.success) {
      throw new TiangongMarketError(
        response.message || 'API returned failure',
        undefined,
        response.code,
      );
    }
    return response.data;
  }

  /**
   * 映射原始 PackageListDTO → MarketPackage
   */
  private mapPackage(raw: PackageListRaw): MarketPackage {
    return {
      packageId: raw.packageId,
      name: raw.name,
      type: raw.type === 1 ? 'mcp' : 'skill',
      description: raw.description ?? '',
      authorName: raw.authorName ?? '',
      categoryName: raw.categoryName ?? '',
      totalDownloads: raw.totalDownloads ?? 0,
      ratingAvg: raw.ratingAvg ?? 0,
      ratingCount: raw.ratingCount ?? 0,
      qualityScore: raw.qualityScore ?? 0,
      securityScore: raw.securityScore ?? 0,
      tags: raw.tags ?? [],
      transport: raw.transport ?? undefined,
      currentVersion: raw.currentVersion ?? '',
      proxyEnabled: raw.proxyEnabled ?? false,
      pricingModel: raw.pricingModel ?? 0,
      source: raw.source ?? 0,
      isPrivate: raw.isPrivate ?? false,
    };
  }

  /**
   * 映射原始 VersionRaw → MarketVersion
   */
  private mapVersion(raw: VersionRaw): MarketVersion {
    return {
      id: raw.id,
      version: raw.version,
      changelog: raw.changelog,
      downloadUrl: raw.downloadUrl,
      downloads: raw.downloads ?? 0,
      status: raw.status,
      compatibility: raw.compatibility,
      createdAt: raw.createdAt,
    };
  }

  /**
   * 解析相对 URL 为绝对 URL
   */
  private resolveUrl(urlStr: string, base?: URL): string {
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
      return urlStr;
    }
    try {
      return new URL(urlStr, base ?? this.baseUrlObj).toString();
    } catch {
      return `${this.baseUrlObj.origin}${urlStr.startsWith('/') ? '' : '/'}${urlStr}`;
    }
  }
}
