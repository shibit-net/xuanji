/**
 * ============================================================
 * Serper Search Adapter
 * ============================================================
 * Serper.dev API 适配器（Google 搜索结果）
 */

import type { SearchEngineAdapter, SearchOptions, SearchResult } from '../types';
import { buildSearchQuery } from '../utils';

/**
 * Serper API 响应类型
 */
interface SerperResponse {
  organic?: Array<{
    title: string;
    link: string;
    snippet: string;
    date?: string;
  }>;
}

/**
 * Serper 搜索适配器
 */
export class SerperAdapter implements SearchEngineAdapter {
  readonly name = 'serper' as const;
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.SERPER_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('Serper API key not configured');
    }

    const query = buildSearchQuery({
      query: options.query,
      site: options.site,
      fileType: options.fileType,
    });

    const requestBody: Record<string, unknown> = {
      q: query,
      num: options.maxResults ?? 5,
    };

    // 时间范围映射
    if (options.timeRange && options.timeRange !== 'all') {
      const timeRangeMap: Record<string, string> = {
        day: 'd',
        week: 'w',
        month: 'm',
        year: 'y',
      };
      requestBody.tbs = `qdr:${timeRangeMap[options.timeRange]}`;
    }

    // 语言设置
    if (options.language) {
      requestBody.gl = options.language.split('-')[0]; // zh-CN -> zh
    }

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SerperResponse;

    return (data.organic ?? []).map((r) => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
      publishedDate: r.date ? new Date(r.date).getTime() : undefined,
      source: 'serper',
    }));
  }
}
