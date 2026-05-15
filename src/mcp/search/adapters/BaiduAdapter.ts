/**
 * ============================================================
 * Baidu Search Adapter
 * ============================================================
 * 抓取百度搜索结果页 HTML，解析结果（无需 API Key）
 */

import type { SearchEngineAdapter, SearchOptions, SearchResult } from '../types';

export class BaiduAdapter implements SearchEngineAdapter {
  readonly name = 'baidu' as const;

  isAvailable(): boolean {
    return true;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const query = encodeURIComponent(options.query);
    const maxResults = options.maxResults ?? 5;
    const siteFilter = options.site ? ` site%3A${options.site}` : '';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(
      `https://www.baidu.com/s?wd=${query}${siteFilter}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Baidu returned HTTP ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, maxResults);
  }

  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // 百度搜索结果结构：
    // <div class="result c-container" ...>
    //   <h3 class="t"><a href="URL">Title</a></h3>
    //   <div class="c-abstract">snippet...</div>
    //   <span class="c-showurl">display url</span>
    // </div>

    // 匹配每个 result 块
    const blockPattern = /<div[^>]*class="[^"]*result[^"]*c-container[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|<div[^>]*id="page|$)/gi;
    let match;

    while ((match = blockPattern.exec(html)) !== null && results.length < maxResults) {
      const block = match[1]!;

      // 提取标题和 URL
      const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;

      const rawUrl = this.decodeHTML(linkMatch[1]!);
      const title = this.decodeHTML(this.stripTags(linkMatch[2]!));

      if (!rawUrl || !title) continue;
      // 跳过百度跳转链接，提取真实 URL
      const url = this.extractBaiduRealURL(rawUrl) || rawUrl;
      if (url.includes('baidu.com/cb') || url.includes('baidu.com/s?')) continue;

      // 提取摘要
      let snippet = '';
      const absMatch = block.match(/<span[^>]*class="[^"]*content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
        || block.match(/<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
        || block.match(/<span[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      if (absMatch) {
        snippet = this.stripTags(absMatch[1]!);
        snippet = this.decodeHTML(snippet);
      }

      // 提取域名
      let source = '';
      const showurl = block.match(/<span[^>]*class="[^"]*c-showurl[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      if (showurl) {
        source = this.stripTags(showurl[1]!).trim();
      }

      results.push({
        title,
        url,
        content: snippet || title,
        source: source || 'baidu',
      });
    }

    return results;
  }

  /** 百度链接是跳转链接，需要提取真实 URL */
  private extractBaiduRealURL(rawUrl: string): string | null {
    const urlObj = new URL(rawUrl);
    const realUrl = urlObj.searchParams.get('url');
    if (realUrl) return realUrl;
    // 其他跳转格式
    const eqMatch = rawUrl.match(/[?&]eq=([^&]+)/);
    if (eqMatch) {
      try { return decodeURIComponent(eqMatch[1]!); } catch { return null; }
    }
    return null;
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private decodeHTML(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/<em>/g, '')
      .replace(/<\/em>/g, '')
      .trim();
  }
}
