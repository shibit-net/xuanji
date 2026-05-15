/**
 * ============================================================
 * Bing Search Adapter
 * ============================================================
 * 使用 Bing RSS 搜索接口（无需 API Key）
 * 返回干净的 XML，包含 title/link/description/pubDate
 */

import type { SearchEngineAdapter, SearchOptions, SearchResult } from '../types';

export class BingAdapter implements SearchEngineAdapter {
  readonly name = 'bing' as const;

  isAvailable(): boolean {
    return true;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: options.query, format: 'rss' });
    const maxResults = options.maxResults ?? 5;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(`https://www.bing.com/search?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Bing returned HTTP ${response.status}`);
    }

    const xml = await response.text();
    return this.parseRSS(xml, maxResults);
  }

  private parseRSS(xml: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // 提取所有 <item> 块
    const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemPattern.exec(xml)) !== null && results.length < maxResults) {
      const item = match[1]!;

      const title = this.extractTag(item, 'title');
      const link = this.extractTag(item, 'link');
      const description = this.extractTag(item, 'description');
      const pubDate = this.extractTag(item, 'pubDate');

      if (!title || !link) continue;

      results.push({
        title: this.decodeXML(title),
        url: link,
        content: this.decodeXML(description || title),
        publishedDate: pubDate ? new Date(pubDate).getTime() : undefined,
        source: 'bing',
      });
    }

    return results;
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'));
    if (m) return m[1]!;
    const m2 = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m2 ? m2[1]! : undefined;
  }

  private decodeXML(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .trim();
  }
}
