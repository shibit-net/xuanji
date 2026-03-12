# Enhanced Web Search Tool

增强版网页搜索工具，支持多个搜索引擎、自动降级、结果去重和排序、缓存、速率限制。

## 功能特性

### 1. 多搜索引擎支持

支持 4 种搜索引擎（按推荐优先级）：

| 引擎 | 优势 | API Key 要求 | 环境变量 |
|------|------|-------------|----------|
| **Tavily** | 专为 AI 优化，高质量结果，带相关性评分 | ✅ 需要 | `TAVILY_API_KEY` |
| **Serper** | Google 搜索结果，高准确性 | ✅ 需要 | `SERPER_API_KEY` |
| **Brave** | 隐私友好，无跟踪，免费层可用 | ✅ 需要 | `BRAVE_API_KEY` |
| **DuckDuckGo** | 免费，无需 API Key，功能受限 | ❌ 不需要 | - |

### 2. 自动降级策略

当主引擎失败时，自动尝试备用引擎：

```
Tavily (主) → Serper (备 1) → Brave (备 2) → DuckDuckGo (备 3)
```

失败场景：
- API Key 未配置
- API 返回错误
- 网络超时
- 速率限制

### 3. 结果去重和排序

**去重策略**：
- URL 规范化（移除 `www.`、`utm_*` 参数）
- 标题相似度检测（Levenshtein 距离 > 0.8 认为重复）
- 同一域名最多保留 2 个结果

**排序策略**：
```
综合评分 = 0.6 × 相关性 + 0.3 × 时效性 + 0.1 × 权威性
```

- **相关性**：引擎返回的 score（0-1）
- **时效性**：发布时间（1 天内 1.0，1 周 0.9，1 月 0.7，1 年 0.5，其他 0.3）
- **权威性**：域名白名单（github.com、stackoverflow.com、mdn 等为 1.0，其他 0.5）

### 4. 缓存机制

- **内存缓存**：基于 MemoryCache，支持 TTL 过期
- **默认 TTL**：15 分钟
- **缓存键**：`query + options` 的 JSON 字符串
- **LRU 淘汰**：超过 100 条时淘汰最久未使用
- **强制刷新**：`force: true` 参数跳过缓存

### 5. 速率限制

- **默认限制**：每分钟 10 次请求
- **滑动窗口**：时间窗口内计数
- **限流降级**：主引擎限流时自动切换备用引擎
- **友好错误**：超限时返回等待时间提示

### 6. 高级搜索选项

```typescript
{
  query: string;              // 搜索关键词（必填）
  max_results?: number;       // 最多返回结果数（1-20，默认 5）
  time_range?: 'day' | 'week' | 'month' | 'year' | 'all';
  site?: string;              // 站点过滤（如 "github.com"）
  file_type?: string;         // 文件类型过滤（如 "pdf"）
  language?: string;          // 语言偏好（如 "zh-CN"）
  safe_search?: 'strict' | 'moderate' | 'off';
  provider?: 'tavily' | 'serper' | 'brave' | 'duckduckgo';
  force?: boolean;            // 强制刷新缓存
}
```

## 配置

### 环境变量

```bash
# .env 文件
TAVILY_API_KEY=tvly-xxxxx
SERPER_API_KEY=xxxxx
BRAVE_API_KEY=xxxxx
```

### 配置文件

`~/.xuanji/config.json`:

```json
{
  "webSearch": {
    "defaultProvider": "tavily",
    "fallbackProviders": ["serper", "brave", "duckduckgo"],
    "apiKeys": {
      "tavily": "tvly-xxxxx",
      "serper": "xxxxx",
      "brave": "xxxxx"
    },
    "cacheTTL": 900000,
    "maxResults": 5,
    "rateLimit": 10
  }
}
```

## 使用示例

### 基础搜索

```typescript
import { createEnhancedWebSearchTool } from '@/mcp/search';

const tool = createEnhancedWebSearchTool({
  defaultProvider: 'tavily',
  apiKeys: {
    tavily: process.env.TAVILY_API_KEY,
  },
});

const result = await tool.execute({ query: 'Next.js 15 features' });
console.log(result.data);
```

### 高级搜索

```typescript
const result = await tool.execute({
  query: 'React server components',
  max_results: 10,
  time_range: 'week',
  site: 'github.com',
  provider: 'serper',
});
```

### 强制刷新缓存

```typescript
const result = await tool.execute({
  query: 'latest news',
  force: true, // 跳过缓存
});
```

### 获取统计信息

```typescript
const stats = tool.stats();
console.log(stats);
// {
//   cache: { size: 10, maxSize: 100 },
//   rateLimit: { limit: 10, remaining: 8 },
//   availableEngines: ['tavily', 'brave', 'duckduckgo']
// }
```

## 获取 API Key

### Tavily（推荐）

1. 访问 [https://tavily.com](https://tavily.com)
2. 注册账号
3. 获取免费 API Key（每月 1000 次请求）

### Serper

1. 访问 [https://serper.dev](https://serper.dev)
2. 注册账号
3. 获取免费 API Key（每月 2500 次请求）

### Brave

1. 访问 [https://brave.com/search/api](https://brave.com/search/api)
2. 申请 API Key
3. 免费层：每月 2000 次请求

## 架构设计

```
EnhancedWebSearchTool
├── adapters/               # 搜索引擎适配器
│   ├── TavilyAdapter       # Tavily API
│   ├── SerperAdapter       # Serper API
│   ├── BraveAdapter        # Brave Search API
│   └── DuckDuckGoAdapter   # DuckDuckGo API
├── RateLimiter             # 速率限制器
├── utils                   # 工具函数
│   ├── normalizeUrl        # URL 规范化
│   ├── deduplicateResults  # 结果去重
│   └── sortResults         # 结果排序
└── MemoryCache             # 缓存管理
```

## 错误处理

所有搜索引擎失败时：
```
Error: All search engines failed. Last error: Tavily API error: 401 Unauthorized
```

速率限制超出时：
```
Error: Rate limit exceeded. Please wait 45s
```

## 性能优化

1. **缓存命中率**：相同查询 15 分钟内命中缓存，减少 API 调用
2. **去重效率**：URL 和标题双重去重，减少冗余结果
3. **降级延迟**：主引擎失败后立即切换，无需等待超时
4. **速率限制**：避免超出 API 配额，保护账号安全

## 测试

运行单元测试：

```bash
npm test test/unit/mcp/EnhancedWebSearchTool.test.ts
```

测试覆盖：
- ✅ 基础搜索
- ✅ 降级策略
- ✅ 结果去重
- ✅ 缓存机制
- ✅ 速率限制
- ✅ 高级选项
- ✅ 统计信息

## 迁移指南

从旧版 WebSearchTool 迁移：

```diff
- import { createWebSearchTool } from '@/mcp/tools/WebSearchTool';
+ import { createEnhancedWebSearchTool } from '@/mcp/search';

- const tool = createWebSearchTool({
-   provider: 'tavily',
-   apiKey: 'xxx',
- });
+ const tool = createEnhancedWebSearchTool({
+   defaultProvider: 'tavily',
+   apiKeys: { tavily: 'xxx' },
+ });
```

配置兼容性：
- ❌ 旧版 `provider` → ✅ 新版 `defaultProvider`
- ❌ 旧版 `apiKey` → ✅ 新版 `apiKeys.{provider}`
- ✅ `cacheTTL` 保持兼容
- ✅ `maxResults` 保持兼容

## 未来扩展

- [ ] Google Search API（需要付费）
- [ ] Bing Search API
- [ ] 自定义搜索引擎适配器接口
- [ ] 结果聚合（多引擎同时搜索）
- [ ] LLM 摘要生成（可选）
- [ ] 持久化缓存（SQLite）
