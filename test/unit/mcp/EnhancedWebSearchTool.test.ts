/**
 * ============================================================
 * Enhanced Web Search Tool - Unit Tests
 * ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnhancedWebSearchTool } from '@/mcp/search/EnhancedWebSearchTool';

// Mock fetch
global.fetch = vi.fn();

// Helper: 生成 Bing RSS XML
function bingRSSXml(items: Array<{ title: string; url: string; content: string; pubDate?: string }>): string {
  const itemXmls = items
    .map(
      (item) => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.url}</link>
      <description><![CDATA[${item.content}]]></description>
      ${item.pubDate ? `<pubDate>${item.pubDate}</pubDate>` : ''}
    </item>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    ${itemXmls}
  </channel>
</rss>`;
}

// Helper: 生成 Google HTML（用于降级测试）
function googleHtml(results: Array<{ title: string; url: string; snippet?: string }>): string {
  const blocks = results
    .map(
      (r) => `
    <div class="g">
      <a href="${r.url}">
        <h3>${r.title}</h3>
      </a>
      ${r.snippet ? `<div class="VwiC3b">${r.snippet}</div>` : ''}
    </div>`
    )
    .join('');

  return `<!DOCTYPE html><html><body>${blocks}</body></html>`;
}

describe('EnhancedWebSearchTool', () => {
  let tool: EnhancedWebSearchTool;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tool?.destroy();
  });

  describe('基础搜索', () => {
    it('应该成功执行 Bing 搜索', async () => {
      tool = new EnhancedWebSearchTool({ defaultProvider: 'bing' });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: async () =>
          bingRSSXml([
            {
              title: 'Next.js Documentation',
              url: 'https://nextjs.org/docs',
              content: 'Official Next.js documentation',
            },
            {
              title: 'React Server Components',
              url: 'https://react.dev/rsc',
              content: 'Guide to React Server Components',
            },
          ]),
      });

      const result = await tool.execute({ query: 'test query' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Next.js Documentation');
      expect(result.content).toContain('React Server Components');
      expect(result.metadata?.count).toBe(2);
    });

    it('应该支持 maxResults 参数', async () => {
      tool = new EnhancedWebSearchTool();

      const titles = [
        'Python Tutorial',
        'JavaScript Guide',
        'Rust Programming Book',
        'Go Language Documentation',
        'TypeScript Handbook',
        'Java SE Reference',
        'C++ Standard Library',
        'Ruby on Rails Guide',
        'PHP Manual',
        'Swift Development Docs',
      ];
      const items = Array.from({ length: 10 }, (_, i) => ({
        title: titles[i]!,
        url: `https://example${i + 1}.com/page`,
        content: `Content ${i + 1}`,
      }));

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: async () => bingRSSXml(items),
      });

      const result = await tool.execute({ query: 'test', max_results: 3 });

      expect(result.isError).toBe(false);
      expect(result.metadata?.count).toBe(3);
    });

    it('应该在无 query 和 url 时返回错误', async () => {
      tool = new EnhancedWebSearchTool();

      const result = await tool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Must provide at least one of');
    });
  });

  describe('降级策略', () => {
    it('应该在主引擎失败时降级到备用引擎', async () => {
      tool = new EnhancedWebSearchTool({
        defaultProvider: 'bing',
        fallbackProviders: ['google'],
      });

      // Bing 失败
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // Google 成功
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: async () =>
          googleHtml([
            {
              title: 'Google Result',
              url: 'https://example.com',
              snippet: 'Google search result content',
            },
          ]),
      });

      const result = await tool.execute({ query: 'test' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Google Result');
    });

    it('应该在所有引擎失败时返回错误', async () => {
      tool = new EnhancedWebSearchTool({
        defaultProvider: 'bing',
        fallbackProviders: [],
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await tool.execute({ query: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Search failed');
    });
  });

  describe('结果去重', () => {
    it('应该去除重复的 URL', async () => {
      tool = new EnhancedWebSearchTool();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: async () =>
          bingRSSXml([
            {
              title: 'Python Tutorial for Beginners',
              url: 'https://www.example.com/page',
              content: 'Content 1',
            },
            {
              title: 'Advanced JavaScript Guide',
              url: 'https://example.com/page?utm_source=test',
              content: 'Content 2',
            },
          ]),
      });

      const result = await tool.execute({ query: 'test' });

      expect(result.isError).toBe(false);
      // 两个 URL 规范化后相同，应只保留一个
      expect(result.metadata?.count).toBe(1);
    });
  });

  describe('缓存机制', () => {
    it('应该缓存搜索结果', async () => {
      tool = new EnhancedWebSearchTool({ cacheTTL: 60000 });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: async () =>
          bingRSSXml([
            {
              title: 'Cached Result',
              url: 'https://example.com',
              content: 'Cached content',
            },
          ]),
      });

      // 第一次调用
      const result1 = await tool.execute({ query: 'cache-test' });
      expect(result1.isError).toBe(false);
      expect(result1.metadata?.cached).toBeUndefined();

      // 第二次调用（应该命中缓存）
      const result2 = await tool.execute({ query: 'cache-test' });
      expect(result2.isError).toBe(false);
      expect(result2.metadata?.cached).toBe(true);

      // fetch 应该只调用一次
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('应该支持强制刷新缓存', async () => {
      tool = new EnhancedWebSearchTool();

      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: async () =>
          bingRSSXml([
            {
              title: 'Result',
              url: 'https://example.com',
              content: 'Content',
            },
          ]),
      });

      // 第一次调用
      await tool.execute({ query: 'force-test' });

      // 强制刷新
      await tool.execute({ query: 'force-test', force: true });

      // fetch 应该调用两次
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('速率限制', () => {
    it('应该在超出速率限制时返回错误', async () => {
      tool = new EnhancedWebSearchTool({ rateLimit: 2 });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: async () =>
          bingRSSXml([
            {
              title: 'Result',
              url: 'https://example.com',
              content: 'Content',
            },
          ]),
      });

      // 前两次应该成功
      await tool.execute({ query: 'test1' });
      await tool.execute({ query: 'test2' });

      // 第三次应该失败
      const result = await tool.execute({ query: 'test3' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Rate limit');
    });
  });

  describe('统计信息', () => {
    it('应该返回正确的统计信息', () => {
      tool = new EnhancedWebSearchTool({ rateLimit: 10 });

      const stats = tool.stats();

      expect(stats.cache.size).toBe(0);
      expect(stats.rateLimit.limit).toBe(10);
      expect(stats.rateLimit.remaining).toBe(10);
      expect(stats.availableEngines).toContain('bing');
      expect(stats.availableEngines).toContain('baidu');
      expect(stats.availableEngines).toContain('google');
    });
  });
});
