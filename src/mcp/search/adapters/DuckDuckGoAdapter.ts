/**
 * ============================================================
 * DuckDuckGo Search Adapter
 * ============================================================
 * DuckDuckGo API 适配器（免费，无需 API Key，但功能受限）
 */

import type { SearchEngineAdapter, SearchOptions, SearchResult } from '../types';

/**
 * DuckDuckGo API 响应类型
 */
interface DDGResponse {
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
  }>;
}

/**
 * DuckDuckGo 搜索适配器
 * 注意：DuckDuckGo 的 Instant Answer API 功能有限，仅作为最后降级选项
 */
export class DuckDuckGoAdapter implements SearchEngineAdapter {
  readonly name = 'duckduckgo' as const;

  isAvailable(): boolean {
    return true; // 无需 API Key，始终可用
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: options.query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    });

    const response = await fetch(`https://api.duckduckgo.com/?${params}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Xuanji/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as DDGResponse;

    const results: SearchResult[] = [];
    const maxResults = options.maxResults ?? 5;

    // DuckDuckGo Instant Answer API 返回的是相关主题，不是搜索结果
    // 格式较简单，只能作为降级选项
    for (const topic of data.RelatedTopics ?? []) {
      if (results.length >= maxResults) break;
      if (!topic.Text || !topic.FirstURL) continue;

      results.push({
        title: topic.Text.split(' - ')[0] ?? topic.Text,
        url: topic.FirstURL,
        content: topic.Text,
        source: 'duckduckgo',
      });
    }

    return results;
  }
}
