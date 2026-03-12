/**
 * ============================================================
 * Search Utils - 搜索工具函数
 * ============================================================
 * 提供 URL 规范化、结果去重、排序等功能
 */

import type { SearchResult } from './types';

/**
 * 规范化 URL（用于去重）
 * - 移除 www. 前缀
 * - 移除跟踪参数（utm_*）
 * - 统一协议为 https
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);

    // 移除 www. 前缀
    u.hostname = u.hostname.replace(/^www\./, '');

    // 移除跟踪参数
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'ref',
      'source',
    ];
    trackingParams.forEach((param) => {
      u.searchParams.delete(param);
    });

    // 统一协议
    u.protocol = 'https:';

    return u.toString();
  } catch {
    // URL 解析失败，返回原 URL
    return url;
  }
}

/**
 * 计算两个字符串的 Levenshtein 距离（编辑距离）
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // 替换
          matrix[i]![j - 1]! + 1,     // 插入
          matrix[i - 1]![j]! + 1      // 删除
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * 计算两个字符串的相似度（0-1）
 */
function stringSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) {
    return 1.0;
  }

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * 去重搜索结果
 * 策略：
 * 1. URL 相似度检测
 * 2. 标题相似度检测（> 0.8 认为重复）
 * 3. 同一域名最多保留 2 个结果
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const uniqueResults: SearchResult[] = [];
  const domainCounts = new Map<string, number>();

  for (const result of results) {
    // 规范化 URL
    const normalizedUrl = normalizeUrl(result.url);

    // URL 去重
    if (seen.has(normalizedUrl)) {
      continue;
    }

    // 标题相似度去重
    const isDuplicate = uniqueResults.some((existing) => {
      const similarity = stringSimilarity(
        result.title.toLowerCase(),
        existing.title.toLowerCase()
      );
      return similarity > 0.8;
    });

    if (isDuplicate) {
      continue;
    }

    // 域名去重（同一域名最多 2 个结果）
    try {
      const hostname = new URL(result.url).hostname.replace(/^www\./, '');
      const count = domainCounts.get(hostname) ?? 0;

      if (count >= 2) {
        continue;
      }

      domainCounts.set(hostname, count + 1);
    } catch {
      // URL 解析失败，跳过域名检查
    }

    seen.add(normalizedUrl);
    uniqueResults.push(result);
  }

  return uniqueResults;
}

/**
 * 域名白名单（权威性评分）
 */
const AUTHORITY_DOMAINS = new Set([
  'github.com',
  'stackoverflow.com',
  'developer.mozilla.org',
  'docs.python.org',
  'nodejs.org',
  'reactjs.org',
  'vuejs.org',
  'wikipedia.org',
  'arxiv.org',
  'medium.com',
  'dev.to',
]);

/**
 * 计算域名权威性评分（0-1）
 */
function getAuthorityScore(url: string): number {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return AUTHORITY_DOMAINS.has(hostname) ? 1.0 : 0.5;
  } catch {
    return 0.5;
  }
}

/**
 * 计算时效性评分（0-1）
 */
function getRecencyScore(publishedDate?: number): number {
  if (!publishedDate) {
    return 0.5; // 未知时间，给中等分
  }

  const now = Date.now();
  const dayInMs = 24 * 60 * 60 * 1000;
  const age = now - publishedDate;

  // 1 天内：1.0，1 周内：0.9，1 月内：0.7，1 年内：0.5，其他：0.3
  if (age < dayInMs) return 1.0;
  if (age < 7 * dayInMs) return 0.9;
  if (age < 30 * dayInMs) return 0.7;
  if (age < 365 * dayInMs) return 0.5;
  return 0.3;
}

/**
 * 排序搜索结果
 * 综合评分 = 0.6 * relevance + 0.3 * recency + 0.1 * authority
 */
export function sortResults(results: SearchResult[]): SearchResult[] {
  return results.sort((a, b) => {
    const scoreA =
      0.6 * (a.score ?? 0.5) +
      0.3 * getRecencyScore(a.publishedDate) +
      0.1 * getAuthorityScore(a.url);

    const scoreB =
      0.6 * (b.score ?? 0.5) +
      0.3 * getRecencyScore(b.publishedDate) +
      0.1 * getAuthorityScore(b.url);

    return scoreB - scoreA;
  });
}

/**
 * 构建搜索查询（支持高级选项）
 */
export function buildSearchQuery(options: {
  query: string;
  site?: string;
  fileType?: string;
  timeRange?: 'day' | 'week' | 'month' | 'year' | 'all';
}): string {
  let query = options.query;

  if (options.site) {
    query += ` site:${options.site}`;
  }

  if (options.fileType) {
    query += ` filetype:${options.fileType}`;
  }

  // 时间范围由各引擎自己处理

  return query;
}
