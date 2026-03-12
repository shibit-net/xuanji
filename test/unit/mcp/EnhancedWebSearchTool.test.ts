/**
 * ============================================================
 * Enhanced Web Search Tool - Unit Tests
 * ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnhancedWebSearchTool } from '@/mcp/search/EnhancedWebSearchTool';
import type { SearchResult } from '@/mcp/search/types';

// Mock fetch
global.fetch = vi.fn();

describe('EnhancedWebSearchTool', () => {
  let tool: EnhancedWebSearchTool;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tool?.destroy();
  });

  describe('基础搜索', () => {
    it('应该成功执行 Tavily 搜索', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: { tavily: 'test-key' },
        defaultProvider: 'tavily',
      });

      // Mock Tavily API 响应
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Next.js Documentation',
              url: 'https://nextjs.org/docs',
              content: 'Official Next.js documentation',
              score: 0.9,
            },
            {
              title: 'React Server Components',
              url: 'https://react.dev/rsc',
              content: 'Guide to React Server Components',
              score: 0.8,
            },
          ],
        }),
      });

      const result = await tool.execute({ query: 'test query' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Next.js Documentation');
      expect(result.content).toContain('React Server Components');
      expect(result.metadata?.provider).toBe('tavily');
      expect(result.metadata?.count).toBe(2);
    });

    it('应该支持 maxResults 参数', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: { tavily: 'test-key' },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { title: 'Python Tutorial', url: 'https://python.org', content: 'Learn Python' },
            { title: 'JavaScript Guide', url: 'https://javascript.info', content: 'JS basics' },
            { title: 'Rust Book', url: 'https://rust-lang.org', content: 'Rust programming' },
            { title: 'Go Documentation', url: 'https://golang.org', content: 'Go lang docs' },
            { title: 'TypeScript Handbook', url: 'https://typescriptlang.org', content: 'TS guide' },
            { title: 'Java SE', url: 'https://oracle.com/java', content: 'Java SE docs' },
            { title: 'C++ Reference', url: 'https://cppreference.com', content: 'C++ ref' },
            { title: 'Ruby Guides', url: 'https://ruby-lang.org', content: 'Ruby tutorials' },
            { title: 'PHP Manual', url: 'https://php.net', content: 'PHP manual' },
            { title: 'Swift Documentation', url: 'https://swift.org', content: 'Swift docs' },
          ],
        }),
      });

      const result = await tool.execute({ query: 'test', max_results: 3 });

      expect(result.isError).toBe(false);
      expect(result.metadata?.count).toBe(3);
    });

    it('应该验证 query 参数', async () => {
      tool = new EnhancedWebSearchTool();

      const result = await tool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameter: query');
    });
  });

  describe('降级策略', () => {
    it('应该在主引擎失败时降级到备用引擎', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: {
          tavily: 'test-key',
          brave: 'test-key',
        },
        defaultProvider: 'tavily',
        fallbackProviders: ['brave'],
      });

      // Tavily 失败
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // Brave 成功
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [
              {
                title: 'Brave Result',
                url: 'https://example.com',
                description: 'Brave content',
              },
            ],
          },
        }),
      });

      const result = await tool.execute({ query: 'test' });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Brave Result');
      expect(result.metadata?.provider).toBe('brave');
    });

    it('应该在所有引擎失败时返回错误', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: {
          tavily: 'test-key',
        },
        defaultProvider: 'tavily',
        fallbackProviders: [],
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await tool.execute({ query: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('All search engines failed');
    });
  });

  describe('结果去重', () => {
    it('应该去除重复的 URL', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: { tavily: 'test-key' },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Result 1',
              url: 'https://www.example.com/page',
              content: 'Content 1',
            },
            {
              title: 'Result 2',
              url: 'https://example.com/page?utm_source=test',
              content: 'Content 2',
            },
          ],
        }),
      });

      const result = await tool.execute({ query: 'test' });

      expect(result.isError).toBe(false);
      // 两个 URL 规范化后相同，应只保留一个
      expect(result.metadata?.count).toBe(1);
    });
  });

  describe('缓存机制', () => {
    it('应该缓存搜索结果', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: { tavily: 'test-key' },
        cacheTTL: 60000,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Cached Result',
              url: 'https://example.com',
              content: 'Cached content',
            },
          ],
        }),
      });

      // 第一次调用
      const result1 = await tool.execute({ query: 'test' });
      expect(result1.isError).toBe(false);
      expect(result1.metadata?.cached).toBeUndefined();

      // 第二次调用（应该命中缓存）
      const result2 = await tool.execute({ query: 'test' });
      expect(result2.isError).toBe(false);
      expect(result2.metadata?.cached).toBe(true);

      // fetch 应该只调用一次
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('应该支持强制刷新缓存', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: { tavily: 'test-key' },
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Result',
              url: 'https://example.com',
              content: 'Content',
            },
          ],
        }),
      });

      // 第一次调用
      await tool.execute({ query: 'test' });

      // 强制刷新
      await tool.execute({ query: 'test', force: true });

      // fetch 应该调用两次
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('速率限制', () => {
    it('应该在超出速率限制时返回错误', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: { tavily: 'test-key' },
        rateLimit: 2, // 每分钟 2 次
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
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

  describe('高级选项', () => {
    it('应该支持时间范围过滤', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: { tavily: 'test-key' },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await tool.execute({
        query: 'test',
        time_range: 'week',
      });

      const fetchCall = (global.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody.days).toBe('w');
    });

    it('应该支持站点过滤', async () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: { tavily: 'test-key' },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await tool.execute({
        query: 'test',
        site: 'github.com',
      });

      const fetchCall = (global.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody.query).toContain('site:github.com');
    });
  });

  describe('统计信息', () => {
    it('应该返回正确的统计信息', () => {
      tool = new EnhancedWebSearchTool({
        apiKeys: {
          tavily: 'test-key',
          brave: 'test-key',
        },
        rateLimit: 10,
      });

      const stats = tool.stats();

      expect(stats.cache.size).toBe(0);
      expect(stats.rateLimit.limit).toBe(10);
      expect(stats.rateLimit.remaining).toBe(10);
      expect(stats.availableEngines).toContain('tavily');
      expect(stats.availableEngines).toContain('brave');
      expect(stats.availableEngines).toContain('duckduckgo'); // 始终可用
    });
  });
});
