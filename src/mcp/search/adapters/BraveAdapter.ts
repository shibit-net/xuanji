/**
 * ============================================================
 * Brave Search Adapter
 * ============================================================
 * Brave Search API 适配器（隐私友好）
 */

import type { SearchEngineAdapter, SearchOptions, SearchResult } from '../types';
import { buildSearchQuery } from '../utils';

/**
 * Brave Search API 响应类型
 */
interface BraveResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
      age?: string;
    }>;
  };
}

/**
 * Brave 搜索适配器
 */
export class BraveAdapter implements SearchEngineAdapter {
  readonly name = 'brave' as const;
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.BRAVE_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('Brave API key not configured');
    }

    const query = buildSearchQuery({
      query: options.query,
      site: options.site,
      fileType: options.fileType,
    });

    const params = new URLSearchParams({
      q: query,
      count: String(options.maxResults ?? 5),
    });

    // 时间范围映射
    if (options.timeRange && options.timeRange !== 'all') {
      const timeRangeMap: Record<string, string> = {
        day: 'pd',
        week: 'pw',
        month: 'pm',
        year: 'py',
      };
      params.set('freshness', timeRangeMap[options.timeRange]!);
    }

    // 安全搜索
    if (options.safeSearch) {
      const safeSearchMap: Record<string, string> = {
        strict: 'strict',
        moderate: 'moderate',
        off: 'off',
      };
      params.set('safesearch', safeSearchMap[options.safeSearch]!);
    }

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as BraveResponse;

    return (data.web?.results ?? []).map((r) => {
      // 解析 age（如 "2 days ago"）
      let publishedDate: number | undefined;
      if (r.age) {
        const match = r.age.match(/(\d+)\s+(day|week|month|year)s?\s+ago/i);
        if (match) {
          const num = parseInt(match[1]!, 10);
          const unit = match[2]!.toLowerCase();
          const now = Date.now();
          const msMap: Record<string, number> = {
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000,
            year: 365 * 24 * 60 * 60 * 1000,
          };
          publishedDate = now - num * msMap[unit]!;
        }
      }

      return {
        title: r.title,
        url: r.url,
        content: r.description,
        publishedDate,
        source: 'brave',
      };
    });
  }
}
