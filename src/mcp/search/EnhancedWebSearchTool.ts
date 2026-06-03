/**
 * ============================================================
 * Enhanced Web Search Tool - 统一的 web_search + web_fetch
 * ============================================================
 * 支持：
 * - 关键词搜索（多引擎 + 自动降级）
 * - 单一 URL 抓取（HTML→Markdown）
 * - 搜索后自动抓取 top 结果的正文内容
 * - 对 LLM 友好的结构化 Markdown 输出
 * - 内置缓存、速率限制、结果去重排序
 * - 全套 SSRF 防护
 */

import { BaseTool } from '@/tools/BaseTool';
import type { ToolResult, JSONSchema } from '@/infrastructure/core-types';
import { MemoryCache } from '../cache';
import type { SearchEngineAdapter, SearchOptions, SearchResult, SearchProvider } from './types';
import { BingAdapter, BaiduAdapter, GoogleAdapter } from './adapters';
import { RateLimiter } from './RateLimiter';
import { deduplicateResults, sortResults } from './utils';

/**
 * Enhanced WebSearchTool 配置
 */
export interface EnhancedWebSearchConfig {
  /** 默认引擎 */
  defaultProvider?: SearchProvider;
  /** 降级引擎列表（按优先级排序） */
  fallbackProviders?: SearchProvider[];
  /** 缓存 TTL（毫秒，默认 900000 = 15 分钟） */
  cacheTTL?: number;
  /** 每次搜索返回的最大结果数（默认 5） */
  maxResults?: number;
  /** 速率限制（每分钟请求数，默认 10） */
  rateLimit?: number;
}

/**
 * 增强版 Web Search 工具 — 替代 web_fetch 和旧的 web_search
 */
export class EnhancedWebSearchTool extends BaseTool {
  readonly name = 'web_search';
  readonly description = `Search the internet or fetch web page content.

=== USAGE MODES ===

1. SEARCH MODE (query only):
   Search the web for information, return structured results with summaries.

2. FETCH MODE (url only):
   Fetch a specific URL and convert it to Markdown for easy reading.

3. SEARCH + FETCH (query + fetch_contents=true):
   Search first, then automatically fetch the full content of the top results.
   This is the most powerful mode — returns search results WITH full article text.

=== BEST PRACTICES ===

- Be specific: "Next.js 15 app router migration guide" > "Next.js"
- Add context: "Python asyncio timeout error 2024" > "Python error"
- Include version numbers: "React 19 server components"
- Use quotes for exact phrases: "cannot find module"
- Set time_range=day/week for time-sensitive queries
- Set fetch_contents=true when you need detailed information, not just summaries

Results are cached for 15 minutes. Use force=true to bypass cache.`;

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search keyword(s). Required for search mode. Combined with url for targeted search.',
      },
      url: {
        type: 'string',
        description: 'HTTP/HTTPS URL to fetch directly. Mutually compatible with query — when both provided, fetches the url in the context of the search.',
      },
      fetch_contents: {
        type: 'boolean',
        description: 'When true and query is provided, automatically fetches full content of top 1-2 results. Default: false',
        default: false,
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of search results to return (1-20, default 5)',
      },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year', 'all'],
        description: 'Time range filter (default: all)',
      },
      site: {
        type: 'string',
        description: 'Filter by domain (e.g., github.com)',
      },
      file_type: {
        type: 'string',
        description: 'Filter by file type (e.g., pdf)',
      },
      language: {
        type: 'string',
        description: 'Language preference (e.g., zh-CN, en-US)',
      },
      provider: {
        type: 'string',
        enum: ['bing', 'baidu', 'google'],
        description: 'Search engine to use. Default: bing. Falls back to others on failure.',
      },
      force: {
        type: 'boolean',
        description: 'Force refresh cache (default: false)',
      },
      prompt: {
        type: 'string',
        description: 'Question or instruction about the fetched content (only relevant in fetch-only mode)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds for URL fetch mode (default: 30000)',
      },
    },
  };

  readonly readonly = true; // 无副作用

  private config: Required<EnhancedWebSearchConfig>;
  private cache: MemoryCache<SearchResult[]>;
  private rateLimiter: RateLimiter;
  private adapters: Map<SearchProvider, SearchEngineAdapter>;

  constructor(config: EnhancedWebSearchConfig = {}) {
    super();

    // 默认配置
    this.config = {
      defaultProvider: config.defaultProvider ?? 'bing',
      fallbackProviders: config.fallbackProviders ?? ['google', 'baidu'],
      cacheTTL: config.cacheTTL ?? 15 * 60 * 1000,
      maxResults: config.maxResults ?? 5,
      rateLimit: config.rateLimit ?? 10,
    };

    // 初始化缓存
    this.cache = new MemoryCache({
      defaultTTL: this.config.cacheTTL,
      maxSize: 100,
    });

    // 初始化速率限制器（每分钟限制）
    this.rateLimiter = new RateLimiter({
      limit: this.config.rateLimit,
      window: 60 * 1000,
    });

    // 初始化适配器（全部免费，无需 API Key）
    this.adapters = new Map<SearchProvider, SearchEngineAdapter>([
      ['bing' as const, new BingAdapter()],
      ['baidu' as const, new BaiduAdapter()],
      ['google' as const, new GoogleAdapter()],
    ]);
  }

  /**
   * 主执行入口
   */
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string | undefined;
    const query = input.query as string | undefined;

    // 必须提供 url 或 query 至少一个
    if (!url && !query) {
      return this.error('Must provide at least one of: query (for search), url (for direct fetch)');
    }

    // === FETCH-ONLY MODE ===
    if (url && !query) {
      return this.executeFetch(url, input);
    }

    // === SEARCH MODE (with optional url context) ===
    return this.executeSearch(query!, input);
  }

  /**
   * FETCH-ONLY MODE — 抓取单个 URL 内容
   */
  private async executeFetch(url: string, input: Record<string, unknown>): Promise<ToolResult> {
    const prompt = input.prompt as string | undefined;
    let timeout = (input.timeout as number | undefined) ?? 30_000;
    const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB

    // URL 验证
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return this.error(`Invalid URL: ${url}`);
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return this.error(`Only HTTP/HTTPS protocols supported: ${parsedUrl.protocol}`);
    }

    // SSRF 防护
    if (this.isSSRFTarget(parsedUrl.hostname)) {
      return this.error(`Security restriction: blocked internal/metadata address: ${parsedUrl.hostname}`);
    }

    // 自动升级 HTTP → HTTPS
    if (parsedUrl.protocol === 'http:' && !this.isPrivateAddress(parsedUrl.hostname)) {
      parsedUrl.protocol = 'https:';
    }

    try {
      // DNS rebinding 防护
      if (!this.isIPLiteral(parsedUrl.hostname)) {
        const dns = await import('node:dns/promises');
        try {
          const { address } = await dns.lookup(parsedUrl.hostname);
          if (this.isSSRFTarget(address)) {
            return this.error(`Security restriction: ${parsedUrl.hostname} resolves to internal address: ${address}`);
          }
        } catch { /* DNS fail, let fetch error naturally */ }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      // 手动处理重定向
      let finalUrl = parsedUrl.toString();
      const MAX_REDIRECTS = 5;
      let redirectCount = 0;
      let response: Response;

      while (true) {
        response = await fetch(finalUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': 'Xuanji/1.0 (AI Assistant; +https://github.com/shibit/xuanji)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.7,*/*;q=0.5',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break;

          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            clearTimeout(timer);
            return this.error(`Too many redirects (>${MAX_REDIRECTS}): ${url}`);
          }

          let redirectUrl: URL;
          try {
            redirectUrl = new URL(location, finalUrl);
          } catch {
            clearTimeout(timer);
            return this.error(`Redirect target URL invalid: ${location}`);
          }

          if (!['http:', 'https:'].includes(redirectUrl.protocol)) {
            clearTimeout(timer);
            return this.error(`Redirect target protocol unsafe: ${redirectUrl.protocol}`);
          }

          if (this.isSSRFTarget(redirectUrl.hostname)) {
            clearTimeout(timer);
            return this.error(`Security restriction: redirect target is internal: ${redirectUrl.hostname}`);
          }

          if (!this.isIPLiteral(redirectUrl.hostname)) {
            const dns = await import('node:dns/promises');
            try {
              const { address } = await dns.lookup(redirectUrl.hostname);
              if (this.isSSRFTarget(address)) {
                clearTimeout(timer);
                return this.error(`Security restriction: redirect target ${redirectUrl.hostname} resolves to internal: ${address}`);
              }
            } catch { /* DNS fail */ }
          }

          finalUrl = redirectUrl.toString();
          continue;
        }
        break;
      }

      clearTimeout(timer);

      if (!response.ok) {
        return this.error(`HTTP ${response.status} ${response.statusText}: ${finalUrl}`);
      }

      // 检查内容大小
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_SIZE) {
        return this.error(`Content too large (${contentLength} bytes), exceeds ${MAX_CONTENT_SIZE / 1024 / 1024}MB limit`);
      }

      const contentType = response.headers.get('content-type') ?? '';

      // 流式读取
      let body: string;
      const reader = response.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let totalSize = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalSize += value.byteLength;
            if (totalSize > MAX_CONTENT_SIZE) {
              reader.cancel();
              return this.error(`Content too large (>${MAX_CONTENT_SIZE / 1024 / 1024}MB), download aborted`);
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        body = new TextDecoder().decode(
          chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks)
        );
      } else {
        body = await response.text();
        if (body.length > MAX_CONTENT_SIZE) {
          return this.error(`Content too large (>${MAX_CONTENT_SIZE / 1024 / 1024}MB)`);
        }
      }

      // 根据内容类型处理
      let content: string;
      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(body);
          content = '```json\n' + JSON.stringify(json, null, 2) + '\n```';
        } catch {
          content = body;
        }
      } else if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        content = await this.htmlToMarkdown(body);
      } else {
        content = body;
      }

      return this.success(
        this.formatFetchOutput(finalUrl, content, prompt),
        { url: finalUrl, contentType, contentLength: body.length }
      );
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return this.error(`Request timeout (${timeout}ms): ${url}`);
        }
        return this.error(`Fetch failed: ${err.message}`);
      }
      return this.error(`Fetch failed: ${String(err)}`);
    }
  }

  /**
   * SEARCH MODE — 搜索 + 可选自动抓取正文
   */
  private async executeSearch(query: string, input: Record<string, unknown>): Promise<ToolResult> {
    const fetchContents = input.fetch_contents === true;
    const force = input.force === true;

    // 构建搜索选项
    const options: SearchOptions = {
      query,
      maxResults: this.validateMaxResults(input.max_results as number | undefined),
      timeRange: input.time_range as SearchOptions['timeRange'],
      site: input.site as string | undefined,
      fileType: input.file_type as string | undefined,
      language: input.language as string | undefined,
    };

    // 检查缓存
    const cacheKey = this.getCacheKey(options);
    if (!force) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const needContents = cached.some(r => r.rawContent !== undefined);
        if (needContents || !fetchContents) {
          return this.success(this.formatSearchOutput(cached, query), { cached: true, count: cached.length });
        }
      }
    }

    // 速率限制检查
    try {
      await this.rateLimiter.checkLimit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(`Rate limit: ${message}`);
    }

    // 确定搜索引擎
    const provider = (input.provider as SearchProvider) ?? this.config.defaultProvider;
    const providers = [provider, ...this.config.fallbackProviders.filter((p) => p !== provider)];

    // 尝试搜索（降级策略）
    let lastError: Error | undefined;
    let allResults: SearchResult[] = [];

    for (const currentProvider of providers) {
      const adapter = this.adapters.get(currentProvider);
      if (!adapter || !adapter.isAvailable()) continue;

      try {
        const results = await adapter.search(options);
        const deduplicated = deduplicateResults(results);
        const sorted = sortResults(deduplicated);
        allResults = sorted.slice(0, options.maxResults);
        break; // 第一个成功的引擎跳出
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
    }

    if (allResults.length === 0) {
      return this.error(
        `Search failed. Last error: ${lastError?.message ?? 'Unknown error'}`
      );
    }

    // 如果需要，自动抓取 top 1-2 个结果的正文
    if (fetchContents) {
      const fetchCount = Math.min(2, allResults.length);
      const fetchPromises = allResults.slice(0, fetchCount).map(async (result) => {
        try {
          const content = await this.fetchContent(result.url);
          return { ...result, rawContent: content };
        } catch {
          return result; // 抓取失败，保留原始结果
        }
      });
      allResults = await Promise.all(fetchPromises);
    }

    // 缓存
    this.cache.set(cacheKey, allResults);

    return this.success(this.formatSearchOutput(allResults, query), {
      provider,
      count: allResults.length,
      hasRawContent: fetchContents,
    });
  }

  /**
   * 抓取单个 URL 的正文内容（用于 search + fetch_contents 模式）
   */
  private async fetchContent(url: string): Promise<string | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Xuanji/1.0 (AI Assistant; +https://github.com/shibit/xuanji)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      if (!response.ok) return undefined;

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return undefined;
      }

      const body = await response.text();
      if (body.length > 5 * 1024 * 1024) return undefined; // 太大跳过

      return this.htmlToMarkdown(body);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  // ================================================================
  // 格式化输出
  // ================================================================

  /**
   * 格式化 FETCH 输出 — 结构化 Markdown
   */
  private formatFetchOutput(url: string, content: string, prompt?: string): string {
    const lines: string[] = [];

    lines.push(`# 🌐 ${url}`);
    lines.push('');

    if (prompt) {
      lines.push(`> 📝 Question: ${prompt}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push(content);

    return lines.join('\n');
  }

  /**
   * 格式化 SEARCH 输出 — 对 LLM 友好的结构化 Markdown
   *
   * 输出包含：
   * - 摘要区（Tavily 有 answer 时优先）
   * - 来源引用列表
   * - 每个结果的详情（含 rawContent 时提供全文摘要）
   */
  private formatSearchOutput(results: SearchResult[], query: string): string {
    if (results.length === 0) {
      return `No results found for: "${query}"`;
    }

    const lines: string[] = [];

    // 标题
    lines.push(`# 🔍 Search: ${query}`);
    lines.push('');

    // 摘要区 — 如果有 answer 放这里
    const answer = results.find(r => r.answer);
    if (answer?.answer) {
      lines.push(`> **Summary**: ${answer.answer}`);
      lines.push('');
    }

    // 来源快速索引
    lines.push('## 📑 Sources');
    lines.push('');
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const sourceTag = r.source ? `  [${r.source}] ` : ' ';
      lines.push(`[${i + 1}]${sourceTag}${r.title}`);
      lines.push(`    ${r.url}`);
      if (r.publishedDate) {
        lines.push(`    Published: ${new Date(r.publishedDate).toLocaleDateString()}`);
      }
    }
    lines.push('');

    // 详细结果
    lines.push('---');
    lines.push('');
    lines.push('## 📄 Details');
    lines.push('');

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;

      lines.push(`### ${i + 1}. ${r.title}`);
      lines.push('');
      lines.push(`**URL**: ${r.url}`);
      if (r.source) lines.push(`**Source**: ${r.source}`);
      if (r.score !== undefined) lines.push(`**Relevance**: ${(r.score * 100).toFixed(0)}%`);
      if (r.publishedDate) lines.push(`**Published**: ${new Date(r.publishedDate).toLocaleDateString()}`);
      lines.push('');

      // 摘要内容
      lines.push(r.content);
      lines.push('');

      // 如果有抓取的正文 — 更详细
      if (r.rawContent) {
        // 如果正文太长，只取前 3000 字符
        const excerpt = r.rawContent.length > 3000
          ? r.rawContent.slice(0, 3000) + '\n\n_[Content truncated — ${r.rawContent.length} total chars]_'
          : r.rawContent;
        lines.push('<details>\n<summary>📖 Full Content</summary>\n\n' + excerpt + '\n\n</details>');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    // 元信息
    lines.push(`_Results: ${results.length} · Source: ${results[0]?.source ?? 'unknown'}_`);

    return lines.join('\n');
  }

  // ================================================================
  // 辅助方法
  // ================================================================

  private validateMaxResults(value: number | undefined): number {
    if (value === undefined) return this.config.maxResults;
    if (typeof value !== 'number' || value < 1 || value > 20) return this.config.maxResults;
    return Math.floor(value);
  }

  private getCacheKey(options: SearchOptions): string {
    return JSON.stringify({
      query: options.query,
      maxResults: options.maxResults,
      timeRange: options.timeRange,
      site: options.site,
      fileType: options.fileType,
      language: options.language,
    });
  }

  /**
   * HTML → Markdown（复用了原 WebFetchTool 的逻辑）
   */
  private async htmlToMarkdown(html: string): Promise<string> {
    try {
      const TurndownService = (await import('turndown')).default;
      const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      });
      turndown.remove(['script', 'style', 'noscript', 'iframe']);
      return turndown.turndown(html);
    } catch {
      return this.extractText(html);
    }
  }

  private extractText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
  }

  // ================================================================
  // SSRF 防护（从原 WebFetchTool 移植）
  // ================================================================

  private isPrivateAddress(hostname: string): boolean {
    const cleanHostname = hostname.replace(/^\[|\]$/g, '');
    if (cleanHostname === 'localhost' || cleanHostname === '127.0.0.1' || cleanHostname === '::1') return true;
    if (cleanHostname === '0.0.0.0') return true;
    if (/^127\./.test(cleanHostname)) return true;
    if (cleanHostname.startsWith('10.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(cleanHostname)) return true;
    if (cleanHostname.startsWith('192.168.')) return true;
    if (cleanHostname.endsWith('.local')) return true;
    return false;
  }

  private isIPLiteral(hostname: string): boolean {
    const cleanHostname = hostname.replace(/^\[|\]$/g, '');
    return /^\d+\.\d+\.\d+\.\d+$/.test(cleanHostname) || cleanHostname.includes(':');
  }

  private isSSRFTarget(hostname: string): boolean {
    const cleanHostname = hostname.replace(/^\[|\]$/g, '');
    if (cleanHostname === 'localhost' || cleanHostname === '127.0.0.1' || cleanHostname === '::1') return true;
    if (cleanHostname === '0.0.0.0') return true;
    if (cleanHostname === '169.254.169.254') return true;
    if (cleanHostname === 'metadata.google.internal') return true;
    if (/^127\./.test(cleanHostname)) return true;
    if (cleanHostname.startsWith('10.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(cleanHostname)) return true;
    if (cleanHostname.startsWith('192.168.')) return true;
    if (cleanHostname.endsWith('.local')) return true;
    if (/^fd[0-9a-f]{2}:/i.test(cleanHostname) || /^fe[89ab][0-9a-f]:/i.test(cleanHostname)) return true;
    if (/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.test(cleanHostname)) {
      const match = cleanHostname.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/i);
      if (match) {
        const high = parseInt(match[1]!, 16);
        const low = parseInt(match[2]!, 16);
        const ipNum = (high << 16) | low;
        if (this.isPrivateIPNumber(ipNum)) return true;
      }
    }
    const ffmpMatch = cleanHostname.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/i);
    if (ffmpMatch) return this.isSSRFTarget(ffmpMatch[1]!);
    const v4compatMatch = cleanHostname.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (v4compatMatch) return this.isSSRFTarget(v4compatMatch[1]!);
    const octalMatch = cleanHostname.match(/^(0\d+)\.(0\d*)\.(0\d*)\.(0\d*)$/);
    if (octalMatch) {
      const ipNum = this.parseIPToNumber(cleanHostname);
      if (ipNum !== null && this.isPrivateIPNumber(ipNum)) return true;
    }
    if (/^0x[0-9a-fA-F]+$/.test(cleanHostname)) {
      const ipNum = parseInt(cleanHostname, 16);
      if (!isNaN(ipNum) && this.isPrivateIPNumber(ipNum)) return true;
    }
    if (/^\d+$/.test(cleanHostname) && cleanHostname.length > 3) {
      const ipNum = parseInt(cleanHostname, 10);
      if (!isNaN(ipNum) && this.isPrivateIPNumber(ipNum)) return true;
    }
    return false;
  }

  private parseIPToNumber(hostname: string): number | null {
    const parts = hostname.split('.');
    if (parts.length !== 4) return null;
    let result = 0;
    for (const part of parts) {
      let val: number;
      if (part.startsWith('0') && part.length > 1 && !part.startsWith('0x')) {
        val = parseInt(part, 8);
      } else {
        val = parseInt(part, 10);
      }
      if (isNaN(val) || val < 0 || val > 255) return null;
      result = (result << 8) | val;
    }
    return result >>> 0;
  }

  private isPrivateIPNumber(ip: number): boolean {
    if (ip === 0) return true;
    if ((ip >>> 24) === 127) return true;
    if ((ip >>> 24) === 10) return true;
    if ((ip >>> 20) === 0xAC1) return true;
    if ((ip >>> 16) === 0xC0A8) return true;
    if (ip === 0xA9FEA9FE) return true;
    return false;
  }

  // ================================================================
  // 生命周期
  // ================================================================

  destroy(): void {
    this.cache.destroy();
    this.rateLimiter.reset();
  }

  stats(): {
    cache: { size: number; maxSize: number };
    rateLimit: { limit: number; remaining: number };
    availableEngines: string[];
  } {
    return {
      cache: {
        size: this.cache.size,
        maxSize: this.cache.stats().maxSize,
      },
      rateLimit: {
        limit: this.rateLimiter.stats().limit,
        remaining: this.rateLimiter.stats().remaining,
      },
      availableEngines: Array.from(this.adapters.entries())
        .filter(([, adapter]) => adapter.isAvailable())
        .map(([name]) => name),
    };
  }
}

/**
 * 创建 EnhancedWebSearchTool
 */
export function createEnhancedWebSearchTool(
  config?: EnhancedWebSearchConfig
): EnhancedWebSearchTool {
  return new EnhancedWebSearchTool(config);
}
