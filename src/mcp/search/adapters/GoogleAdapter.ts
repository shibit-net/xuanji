/**
 * ============================================================
 * Google Search Adapter
 * ============================================================
 * 抓取 Google 搜索结果页 HTML，解析结果（无需 API Key）
 *
 * 注意：Google 有反爬机制，频繁请求可能触发验证码。
 * 使用较宽松的 User-Agent 和语言偏好降低被拦截概率。
 */

import type { SearchEngineAdapter, SearchOptions, SearchResult } from '../types';

export class GoogleAdapter implements SearchEngineAdapter {
  readonly name = 'google' as const;

  isAvailable(): boolean {
    return true;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: options.query,
      hl: options.language?.startsWith('zh') ? 'zh-CN' : 'en',
      num: String(Math.min(options.maxResults ?? 5, 10)),
    });
    if (options.site) params.set('q', `${options.query} site:${options.site}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(
      `https://www.google.com/search?${params}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Google returned HTTP ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, options.maxResults ?? 5);
  }

  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Google 搜索结果结构多样，用多种模式匹配

    // 模式 1: 标准结果块 <div class="g"> ... </div>
    // 模式 2: <div data-sokoban-container> 嵌套的 <a href="URL"><h3>Title</h3></a>

    // 先尝试找所有包含链接+标题+摘要的结果块
    const blockPattern = /<div[^>]*class="[^"]*\bg\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/(?!accounts\.google\.com|policies\.google\.com|support\.google\.com)[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/gi;
    let match;

    const seen = new Set<string>();

    while ((match = blockPattern.exec(html)) !== null && results.length < maxResults) {
      const rawUrl = this.decodeHTML(match[1]!);
      const title = this.decodeHTML(this.stripTags(match[2]!));

      if (!rawUrl || !title) continue;
      // 去重
      const key = rawUrl.split('?')[0]!;
      if (seen.has(key)) continue;
      seen.add(key);

      // 尝试获取后续的摘要文本
      let snippet = '';
      // 在链接之后找摘要 <div class="VwiC3b"> 或其他摘要容器
      const restOfBlock = html.slice(match.index + match[0].length, match.index + match[0].length + 3000);
      const snippetMatch = restOfBlock.match(/<div[^>]*class="[^"]*(?:VwiC3b|yXK7lc|lEBKkf|BNeawe)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (snippetMatch) {
        snippet = this.stripTags(snippetMatch[1]!);
        snippet = this.decodeHTML(snippet);
      }

      results.push({
        title,
        url: rawUrl,
        content: snippet || title,
        source: 'google',
      });
    }

    // 如果上面的模式没抓到足够结果，尝试更宽泛的匹配
    if (results.length === 0) {
      const altPattern = /<a[^>]*href="\/url\?q=(https?:\/\/[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
      while ((match = altPattern.exec(html)) !== null && results.length < maxResults) {
        const rawUrl = decodeURIComponent(match[1]!);
        const title = this.decodeHTML(this.stripTags(match[2]!));

        const key = rawUrl.split('?')[0]!;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          title,
          url: rawUrl,
          content: title,
          source: 'google',
        });
      }
    }

    return results;
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
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/<b>/g, '')
      .replace(/<\/b>/g, '')
      .replace(/<em>/g, '')
      .replace(/<\/em>/g, '')
      .trim();
  }
}
