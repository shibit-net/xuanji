# Web 能力

> 最后更新：2026-03-10

Xuanji 提供强大的 Web 能力，包括搜索引擎集成和网页内容抓取。

---

## Web 搜索

### 支持的搜索引擎

| 引擎 | API Key 来源 | 特点 |
|------|-------------|------|
| **Tavily** | https://tavily.com | AI 优化，结果质量高 |
| **Serper** | https://serper.dev | Google 结果，稳定快速 |
| **Brave** | https://brave.com/search/api | 隐私友好，无跟踪 |
| **DuckDuckGo** | 无需 API Key | 完全免费，速度较慢 |

---

### 配置搜索引擎

编辑配置文件：

```json
{
  "webSearch": {
    "enabled": true,
    "engines": {
      "tavily": {
        "enabled": true,
        "apiKey": "tvly-xxx",
        "maxResults": 5
      },
      "serper": {
        "enabled": true,
        "apiKey": "xxx",
        "maxResults": 5
      },
      "brave": {
        "enabled": false
      },
      "duckduckgo": {
        "enabled": true
      }
    },
    "fallbackOrder": ["tavily", "serper", "duckduckgo"],
    "cacheEnabled": true,
    "cacheTTL": 3600,
    "rateLimitPerMinute": 10
  }
}
```

---

### 使用搜索

Agent 会根据上下文自动调用搜索工具：

```
用户: React 18 有哪些新特性？

Agent 内部：
1. 调用 web_search({ query: "React 18 new features" })
2. 获取前 5 个结果
3. 总结并回复用户

Agent 回复：
React 18 的主要新特性包括：
1. Concurrent Rendering（并发渲染）
2. Automatic Batching（自动批处理）
3. Transitions API
4. Suspense for Data Fetching
5. ...

来源：
- [React 18 Release Notes](https://react.dev/blog/2022/03/29/react-v18)
- [What's New in React 18](https://blog.logrocket.com/...)
```

---

### 搜索策略

**自动降级**：
1. 优先使用 `fallbackOrder` 中的第一个引擎
2. 如果失败，自动尝试下一个
3. 所有引擎都失败时，返回错误

**结果去重**：
- 相同 URL 只保留一个
- 相似标题的结果会被合并

**缓存**：
- 相同查询在 TTL 内直接返回缓存结果
- 节省 API 调用，提升响应速度

**速率限制**：
- 每分钟最多 10 次请求（可配置）
- 防止滥用和超出配额

---

### 环境变量

```bash
export XUANJI_WEB_SEARCH_TAVILY_API_KEY="tvly-xxx"
export XUANJI_WEB_SEARCH_SERPER_API_KEY="xxx"
export XUANJI_WEB_SEARCH_BRAVE_API_KEY="xxx"
```

---

## 网页抓取

### Web Fetch Tool

将 URL 转换为 Markdown 格式，便于 Agent 阅读。

**支持的格式**：
- HTML（自动转换为 Markdown）
- JSON（格式化输出）
- 纯文本
- Markdown（原样返回）

---

### 使用网页抓取

```
用户: 总结这篇文章：https://example.com/article

Agent 内部：
1. 调用 web_fetch({ url: "https://example.com/article" })
2. 获取 HTML → 转换为 Markdown
3. 提取主要内容
4. 总结并回复用户

Agent 回复：
这篇文章主要讨论了...

[总结内容]

原文链接：https://example.com/article
```

---

### 安全防护

**SSRF（服务端请求伪造）防护**：

自动阻止访问内部网络：

```
✗ 拒绝访问: http://127.0.0.1/admin
原因: 内部 IP 地址（SSRF 防护）

✗ 拒绝访问: http://169.254.169.254/meta-data
原因: 云服务元数据端点（SSRF 防护）
```

**防护范围**：
- IPv4 内网地址：`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- IPv6 内网地址：`::1`, `fe80::/10`, `fc00::/7`
- 本地地址：`127.0.0.1`, `localhost`
- 云服务元数据：`169.254.169.254`（AWS/Azure/GCP）
- DNS 重绑定防护：解析后的 IP 会二次检查

---

### 配置

```json
{
  "webFetch": {
    "enabled": true,
    "timeout": 30000,
    "maxContentLength": 10485760,
    "userAgent": "Xuanji/1.0",
    "followRedirects": true,
    "maxRedirects": 5,
    "ssrfProtection": true
  }
}
```

**参数说明**：
- `timeout`：请求超时时间（毫秒）
- `maxContentLength`：最大内容大小（字节，10MB）
- `userAgent`：User-Agent 标识
- `followRedirects`：是否跟随重定向
- `maxRedirects`：最大重定向次数
- `ssrfProtection`：启用 SSRF 防护（强烈推荐）

---

### HTML → Markdown 转换

使用 `turndown` 库，支持：

**基础元素**：
- 标题（`<h1>` → `# Title`）
- 段落（`<p>` → `段落文本`）
- 列表（`<ul>`, `<ol>` → `- item`）
- 链接（`<a>` → `[text](url)`）
- 图片（`<img>` → `![alt](src)`）
- 代码（`<code>` → `` `code` ``）

**扩展元素**：
- 表格（`<table>` → Markdown 表格）
- 删除线（`<del>` → `~~text~~`）
- 高亮（`<mark>` → `==text==`）

**自动清理**：
- 移除脚本（`<script>`）
- 移除样式（`<style>`）
- 移除广告和追踪代码

---

## 使用场景

### 1. 技术文档查询

```
用户: 如何在 TypeScript 中使用泛型？

Agent:
1. 搜索 "TypeScript generics tutorial"
2. 抓取官方文档
3. 提取关键内容并总结
```

---

### 2. 问题调试

```
用户: 遇到错误 "Cannot find module 'axios'"

Agent:
1. 搜索 "Cannot find module axios solution"
2. 找到 Stack Overflow 相关问题
3. 提取最佳答案并指导用户
```

---

### 3. 市场调研

```
用户: 帮我调研 2024 年 AI 编程助手市场

Agent:
1. 搜索 "AI coding assistant 2024 market"
2. 抓取多个新闻和报告网站
3. 汇总信息并生成报告
```

---

### 4. 内容总结

```
用户: 总结这篇论文：https://arxiv.org/abs/xxxx

Agent:
1. 抓取论文 HTML
2. 转换为 Markdown
3. 提取摘要、方法、结论
4. 生成通俗易懂的总结
```

---

## 最佳实践

1. **优先使用付费搜索引擎**（Tavily/Serper），结果质量更高
2. **启用缓存**，避免重复请求相同内容
3. **配置速率限制**，防止超出 API 配额
4. **启用 SSRF 防护**，保护内网安全
5. **定期检查 API 配额**，避免意外停服

---

## 故障排查

### 搜索失败

```
错误: All search engines failed
```

**解决方案**：
1. 检查 API Key 是否正确
2. 检查网络连接
3. 查看速率限制是否超出
4. 尝试启用 DuckDuckGo（无需 API Key）

---

### 抓取失败

```
错误: Failed to fetch URL (403 Forbidden)
```

**解决方案**：
1. 网站可能屏蔽爬虫，尝试修改 `userAgent`
2. 检查 URL 是否正确
3. 检查是否需要认证（Cookie/Token）

---

### SSRF 拦截

```
错误: SSRF protection: internal IP address
```

**解决方案**：
- 这是安全防护，正常现象
- 如需访问内部资源，禁用 SSRF 防护（不推荐）

---

## 相关文档

- [配置参考](./configuration.md#web-配置)
- [工具参考](./tools-reference.md#web_search)
- [常见问题](./faq.md#web-能力)
