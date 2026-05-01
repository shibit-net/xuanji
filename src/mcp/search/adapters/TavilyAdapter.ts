/**
 * ============================================================
 * Tavily Search Adapter
 * ============================================================
 * Tavily API 适配器（专为 AI 优化的搜索引擎）
 */

import type { SearchEngineAdapter, SearchOptions, SearchResult } from '../types';
import { buildSearchQuery } from '../utils';

/**
 * Tavily API 响应类型
 */
interface TavilyResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
    score?: number;
    published_date?: string;
  }>;
}

/**
 * Tavily 搜索适配器
 */
export class TavilyAdapter implements SearchEngineAdapter {
  readonly name = 'tavily' as const;
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.TAVILY_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('Tavily API key not configured');
    }

    const query = buildSearchQuery({
      query: options.query,
      site: options.site,
      fileType: options.fileType,
    });

    const requestBody: Record<string, unknown> = {
      api_key: this.apiKey,
      query,
      max_results: options.maxResults ?? 5,
      search_depth: 'basic',
      include_answer: false,
    };

    // 时间范围映射
    if (options.timeRange && options.timeRange !== 'all') {
      const timeRangeMap: Record<string, string> = {
        day: 'd',
        week: 'w',
        month: 'm',
        year: 'y',
      };
      requestBody.days = timeRangeMap[options.timeRange];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as TavilyResponse;

    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
      publishedDate: r.published_date ? new Date(r.published_date).getTime() : undefined,
      source: 'tavily',
    }));
  }
}
