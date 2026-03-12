/**
 * ============================================================
 * Enhanced Web Search Tool - 增强版网页搜索工具
 * ============================================================
 * 支持多个搜索引擎、自动降级、结果去重和排序、缓存、速率限制
 */

import { BaseTool } from '@/core/tools/BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import { MemoryCache } from '../cache';
import type { SearchEngineAdapter, SearchOptions, SearchResult, SearchProvider } from './types';
import { TavilyAdapter, SerperAdapter, BraveAdapter, DuckDuckGoAdapter } from './adapters';
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
  /** API Keys */
  apiKeys?: {
    tavily?: string;
    serper?: string;
    brave?: string;
  };
  /** 缓存 TTL（毫秒，默认 900000 = 15 分钟） */
  cacheTTL?: number;
  /** 每次搜索返回的最大结果数（默认 5） */
  maxResults?: number;
  /** 速率限制（每分钟请求数，默认 10） */
  rateLimit?: number;
}

/**
 * 增强版 Web Search 工具
 */
export class EnhancedWebSearchTool extends BaseTool {
  readonly name = 'web_search';
  readonly description = `Search the internet for real-time information using multiple search engines.

Use this for:
- Current events, news, weather, stock prices
- Information after your knowledge cutoff date (February 2025)
- Latest documentation, API references, library versions
- Real-world data (exchange rates, regulations, statistics)
- Troubleshooting recent bugs or issues

Do NOT use for:
- Information you already know with confidence
- Code that exists in the local project (use grep/glob instead)
- General programming concepts (you already know these)
- User-specific project details (read local files instead)

Query Best Practices:
- Be specific: "Next.js 15 app router migration guide" > "Next.js"
- Add context: "Python asyncio timeout error 2024" > "Python error"
- Include version numbers: "React 19 server components"
- Use quotes for exact phrases: "cannot find module"

Advanced Options:
- max_results: 1-20 (default 5)
- time_range: day|week|month|year|all
- site: Filter by domain (e.g., "github.com")
- file_type: Filter by file type (e.g., "pdf")

Supports automatic engine fallback and result deduplication.`;

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (1-20, default 5)',
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
        enum: ['tavily', 'serper', 'brave', 'duckduckgo'],
        description: 'Search engine to use (auto-select if not specified)',
      },
      force: {
        type: 'boolean',
        description: 'Force refresh cache (default: false)',
      },
    },
    required: ['query'],
  };

  readonly readonly = true; // 并行执行

  private config: Required<EnhancedWebSearchConfig>;
  private cache: MemoryCache<SearchResult[]>;
  private rateLimiter: RateLimiter;
  private adapters: Map<SearchProvider, SearchEngineAdapter>;

  constructor(config: EnhancedWebSearchConfig = {}) {
    super();

    // 默认配置
    this.config = {
      defaultProvider: config.defaultProvider ?? 'tavily',
      fallbackProviders: config.fallbackProviders ?? ['serper', 'brave', 'duckduckgo'],
      apiKeys: config.apiKeys ?? {},
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

    // 初始化适配器（使用 as const 确保类型安全）
    this.adapters = new Map<SearchProvider, SearchEngineAdapter>([
      ['tavily' as const, new TavilyAdapter(this.config.apiKeys.tavily)],
      ['serper' as const, new SerperAdapter(this.config.apiKeys.serper)],
      ['brave' as const, new BraveAdapter(this.config.apiKeys.brave)],
      ['duckduckgo' as const, new DuckDuckGoAdapter()],
    ]);
  }

  /**
   * 执行搜索
   */
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    if (!query || typeof query !== 'string') {
      return this.error('Missing required parameter: query');
    }

    // 构建搜索选项
    const options: SearchOptions = {
      query,
      maxResults: this.validateMaxResults(input.max_results as number | undefined),
      timeRange: input.time_range as SearchOptions['timeRange'],
      site: input.site as string | undefined,
      fileType: input.file_type as string | undefined,
      language: input.language as string | undefined,
      force: input.force as boolean | undefined,
    };

    // 检查缓存
    if (!options.force) {
      const cacheKey = this.getCacheKey(options);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return this.success(this.formatResults(cached, query), { cached: true });
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
    for (const currentProvider of providers) {
      const adapter = this.adapters.get(currentProvider);
      if (!adapter || !adapter.isAvailable()) {
        continue; // 引擎不可用，尝试下一个
      }

      try {
        const results = await adapter.search(options);

        // 去重和排序
        const deduplicated = deduplicateResults(results);
        const sorted = sortResults(deduplicated);
        const limited = sorted.slice(0, options.maxResults);

        // 缓存结果
        const cacheKey = this.getCacheKey(options);
        this.cache.set(cacheKey, limited);

        return this.success(this.formatResults(limited, query), {
          provider: currentProvider,
          count: limited.length,
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // 记录错误，继续尝试下一个引擎
        continue;
      }
    }

    // 所有引擎都失败
    return this.error(
      `All search engines failed. Last error: ${lastError?.message ?? 'Unknown error'}`
    );
  }

  /**
   * 验证 maxResults 参数
   */
  private validateMaxResults(value: number | undefined): number {
    if (value === undefined) {
      return this.config.maxResults;
    }
    if (typeof value !== 'number' || value < 1 || value > 20) {
      return this.config.maxResults;
    }
    return Math.floor(value);
  }

  /**
   * 生成缓存键
   */
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
   * 格式化搜索结果
   */
  private formatResults(results: SearchResult[], query: string): string {
    if (results.length === 0) {
      return `No results found for: "${query}"`;
    }

    const lines: string[] = [`Search results for: "${query}"`, ''];

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      lines.push(`${i + 1}. **${r.title}**`);
      lines.push(`   URL: ${r.url}`);
      if (r.source) {
        lines.push(`   Source: ${r.source}`);
      }
      lines.push(`   ${r.content}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 销毁（清理资源）
   */
  destroy(): void {
    this.cache.destroy();
    this.rateLimiter.reset();
  }

  /**
   * 获取统计信息
   */
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
 * 创建 EnhancedWebSearchTool（从配置或环境变量）
 */
export function createEnhancedWebSearchTool(
  config?: EnhancedWebSearchConfig
): EnhancedWebSearchTool {
  return new EnhancedWebSearchTool(config);
}
