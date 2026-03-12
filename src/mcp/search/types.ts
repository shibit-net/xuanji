/**
 * ============================================================
 * Web Search Types - 搜索相关类型定义
 * ============================================================
 */

/**
 * 搜索结果
 */
export interface SearchResult {
  /** 标题 */
  title: string;
  /** URL */
  url: string;
  /** 内容摘要 */
  content: string;
  /** 相关性评分（0-1） */
  score?: number;
  /** 发布时间（时间戳） */
  publishedDate?: number;
  /** 来源（引擎名称） */
  source?: string;
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  /** 搜索关键词 */
  query: string;
  /** 最多返回结果数（1-20，默认 5） */
  maxResults?: number;
  /** 时间范围过滤 */
  timeRange?: 'day' | 'week' | 'month' | 'year' | 'all';
  /** 站点限制（如 site:github.com） */
  site?: string;
  /** 文件类型过滤（如 filetype:pdf） */
  fileType?: string;
  /** 语言偏好（如 zh-CN、en-US） */
  language?: string;
  /** 安全搜索级别 */
  safeSearch?: 'strict' | 'moderate' | 'off';
  /** 强制刷新缓存 */
  force?: boolean;
}

/**
 * 搜索引擎类型
 */
export type SearchProvider = 'tavily' | 'serper' | 'brave' | 'duckduckgo';

/**
 * 搜索引擎适配器接口
 */
export interface SearchEngineAdapter {
  /** 引擎名称 */
  readonly name: SearchProvider;
  /** 检查引擎是否可用（API Key 是否存在） */
  isAvailable(): boolean;
  /** 执行搜索 */
  search(options: SearchOptions): Promise<SearchResult[]>;
}

/**
 * 搜索引擎配置
 */
export interface SearchProviderConfig {
  /** 引擎名称 */
  name: SearchProvider;
  /** API Key */
  apiKey?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级（数字越小优先级越高） */
  priority: number;
}
