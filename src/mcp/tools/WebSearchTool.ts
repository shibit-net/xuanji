/**
 * ============================================================
 * Web Search Tool - Internet Search via Tavily/Brave API
 * ============================================================
 * 提供互联网搜索能力，支持 Tavily 和 Brave Search API
 */

import { BaseTool } from '@/tools/BaseTool';
import type { ToolResult, JSONSchema } from '@/infrastructure/core-types';
import { MemoryCache } from '../cache';

/**
 * 搜索结果
 */
interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

/**
 * Web Search 配置
 */
export interface WebSearchToolConfig {
  /** 搜索 API 提供商 */
  provider: 'tavily' | 'brave';
  /** API Key */
  apiKey: string;
  /** 缓存 TTL（毫秒，默认 900000 = 15 分钟） */
  cacheTTL?: number;
  /** 每次搜索返回的最大结果数（默认 5） */
  maxResults?: number;
}

/**
 * Web Search 工具
 */
export class WebSearchTool extends BaseTool {
  readonly name = 'web_search';
  readonly description = `Search the internet for real-time information.

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

Results are cached for 15 minutes to avoid redundant API calls.`;
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default 5)',
      },
    },
    required: ['query'],
  };

  readonly readonly = true; // 并行执行

  private config: WebSearchToolConfig;
  private cache: MemoryCache<SearchResult[]>;

  constructor(config: WebSearchToolConfig) {
    super();
    this.config = config;
    this.cache = new MemoryCache({
      defaultTTL: config.cacheTTL ?? 15 * 60 * 1000, // 15 分钟
      maxSize: 100,
    });
  }

  /**
   * 执行搜索
   */
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    if (!query || typeof query !== 'string') {
      return this.error('Missing required parameter: query');
    }

    const maxResults = (input.max_results as number) ?? this.config.maxResults ?? 5;

    // 检查缓存
    const cacheKey = `${this.config.provider}:${query}:${maxResults}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return this.success(this.formatResults(cached, query), { cached: true });
    }

    try {
      let results: SearchResult[];

      if (this.config.provider === 'tavily') {
        results = await this.searchTavily(query, maxResults);
      } else {
        results = await this.searchBrave(query, maxResults);
      }

      // 缓存结果
      this.cache.set(cacheKey, results);

      return this.success(this.formatResults(results, query));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(`Web search failed: ${message}`);
    }
  }

  /**
   * Tavily API 搜索
   */
  private async searchTavily(query: string, maxResults: number): Promise<SearchResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.config.apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      results: Array<{
        title: string;
        url: string;
        content: string;
        score?: number;
      }>;
    };

    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));
  }

  /**
   * Brave Search API 搜索
   */
  private async searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      count: String(maxResults),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.config.apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      web?: {
        results: Array<{
          title: string;
          url: string;
          description: string;
        }>;
      };
    };

    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.description,
    }));
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
      const r = results[i];
      lines.push(`${i + 1}. **${r.title}**`);
      lines.push(`   URL: ${r.url}`);
      lines.push(`   ${r.content}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 销毁（清理缓存）
   */
  destroy(): void {
    this.cache.destroy();
  }
}

/**
 * 创建 WebSearchTool（从配置或环境变量）
 * 如果没有配置 API Key 则返回 undefined
 */
export function createWebSearchTool(config?: {
  provider?: 'tavily' | 'brave';
  apiKey?: string;
  cacheTTL?: number;
  maxResults?: number;
}): WebSearchTool | undefined {
  const provider = config?.provider ?? 'tavily';

  // 查找 API Key（配置 > 环境变量）
  let apiKey = config?.apiKey;
  if (!apiKey) {
    apiKey = provider === 'tavily'
      ? process.env.TAVILY_API_KEY
      : process.env.BRAVE_API_KEY;
  }

  if (!apiKey) {
    return undefined; // 没有 API Key，不创建工具
  }

  return new WebSearchTool({
    provider,
    apiKey,
    cacheTTL: config?.cacheTTL,
    maxResults: config?.maxResults,
  });
}
