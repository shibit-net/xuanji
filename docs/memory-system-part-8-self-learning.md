# Xuanji 记忆系统 · 自主学习（Self-Directed Learning）

> 版本: 1.0 | 日期: 2026-05-16
> 前置: 记忆系统 Part 1-7（完整存储 + 检索 + 归档 + 叙事）

---

## 目录

1. [问题定义](#1-问题定义)
2. [学习流程设计](#2-学习流程设计)
3. [LearnTool 定义](#3-learntool-定义)
4. [学习结果的记忆化](#4-学习结果的记忆化)
5. [学到的知识怎么用](#5-学到的知识怎么用)
6. [Prompt 引导](#6-prompt-引导)

---

## 1. 问题定义

**用户一句话，xuanji 自己完成整个学习闭环。**

```
用户: "你去了解一下最新的 React Server Components 怎么用"

xuanji 需要:
  1. 搜索 → 找官方文档、教程、最佳实践
  2. 阅读 → 提取关键概念、API、用法
  3. 消化 → 生成结构化知识（entity + fact + relation）
  4. 可用 → 以后用户问 React Server Components，xuanji 能直接回答
```

这不是一次性任务——学完的知识要能长期复用。跟"帮我查一下天气"的区别在于：
- 查天气：一次性，用完就丢
- 学知识：存进记忆，以后一直能用

---

## 2. 学习流程设计

### 2.1 图形化总览

```
用户: "去学一下 SpringBoot 3 的新特性"
  │
  ▼
┌──────────────────────────────────────────────────┐
│  LearnTool.execute()                              │
├──────────────────────────────────────────────────┤
│                                                   │
│  ① 分析学习目标          ← LLM 解析需求           │
│     "SpringBoot 3 的新特性" → 拆成子主题           │
│      ├─ 核心特性（GraalVM、虚拟线程）              │
│      ├─ API 变化（jakarta、HttpInterface）         │
│      └─ 迁移指南（从 2.x 升级）                   │
│                                                   │
│  ② 搜索资料              ← web_search × N        │
│     对每个子主题搜索 2-3 次                        │
│                                                   │
│  ③ 阅读并提取知识        ← web_fetch + LLM        │
│     从每篇资料中提取:                              │
│     - entities（新概念/API/工具）                  │
│     - facts（用法、配置、注意事项）                 │
│     - relations（依赖、替代、搭配关系）             │
│                                                   │
│  ④ 结构化和去重          ← 算法合并               │
│     交叉对比多篇来源                              │
│     合并重复概念                                   │
│                                                   │
│  ⑤ 写入记忆库            ← MemoryManager          │
│     entities + facts + relations + episodes        │
│                                                   │
│  ⑥ 生成学习报告          ← LLM 总结               │
│     返回给用户: "学完了，SpringBoot3 的核心变化…"  │
│                                                   │
└──────────────────────────────────────────────────┘
```

### 2.2 子主题分解

这是最关键的一步——学习目标拆准了，后续搜索才有效。用 LLM 做：

```typescript
private async analyzeLearningGoal(goal: string): Promise<LearningPlan> {
  const response = await this.provider.stream([{
    role: 'system',
    content: `分析用户的学习需求，拆解为可搜索的子主题。

输出 JSON：
{
  "title": "SpringBoot 3 新特性学习",
  "confidence": 0-1,         // 对这个主题你有多了解？低的话说明这个主题很新，需要更广搜索
  "topics": [
    {
      "id": "core-features",
      "label": "核心新特性",
      "search_queries": ["SpringBoot 3 new features", "SpringBoot 3 virtual threads"],
      "reason": "用户想了解整体变化，先看大方向",
      "priority": 1
    },
    {
      "id": "migration",
      "label": "从2.x迁移",
      "search_queries": ["SpringBoot 2 to 3 migration guide", "SpringBoot 3 breaking changes"],
      "reason": "用户可能是现有项目升级",
      "priority": 2
    }
  ],
  "estimated_depth": "deep|moderate|shallow",  // 学习深度建议
  "suggested_sources": ["official_docs", "blog_posts", "github_repos"]
}

规则：
- 子主题 2-5 个，太少容易漏、太多并行不过来
- 每个子主题配 1-3 个搜索 query（中文+英文）
- priority 决定搜索顺序`,
  }, {
    role: 'user',
    content: goal,
  }]);

  return JSON.parse(response);
}
```

### 2.3 搜索策略

按子主题优先级分批搜索，不是一次性全搜完：

```typescript
async searchForTopics(plan: LearningPlan): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  // 按优先级排序
  const sortedTopics = [...plan.topics].sort((a, b) => a.priority - b.priority);

  for (const topic of sortedTopics) {
    for (const query of topic.search_queries) {
      const searchResults = await webSearch(query, { count: 5 });

      // 对每个搜索结果，只抓前 2 篇最相关的（避免疯狂抓网页）
      const relevant = await this.filterRelevant(searchResults, topic);
      for (const item of relevant.slice(0, 2)) {
        const content = await webFetch(item.url);
        if (content && content.length < 50000) {  // 限制单篇大小
          results.push({
            topic_id: topic.id,
            url: item.url,
            title: item.title,
            content: content.slice(0, 20000),
            source_type: this.classifySource(item.url),
          });
        }
      }
    }
  }

  return results;
}
```

设计原则：
- 每子主题搜 2-3 个 query × 每次取 5 条结果 × 抓前 2 篇 = 每子主题最多 30 篇网页
- 3 个子主题 × 30 篇 = 最多 90 篇网页
- 但实际因为相关性过滤，通常每子主题只抓 3-5 篇，总共 10-20 篇
- 总耗时预计 3-10 分钟（取决于网络和 LLM 速度）

### 2.4 知识提取

对每篇抓取的内容，用 LLM 提取结构化知识：

```typescript
async extractKnowledge(topic: LearningTopic, sources: SourceContent[]): Promise<Extraction> {
  const combinedContent = sources
    .map(s => `[来源: ${s.title}]\n${s.content.slice(0, 8000)}`)
    .join('\n\n---\n\n');

  const response = await this.provider.stream([{
    role: 'system',
    content: `从以下学习资料中提取关键知识。

输出 JSON：
{
  "entities": [
    {"name": "Virtual Threads", "type": "tool",
     "summary": "SpringBoot 3 支持 JDK 21 虚拟线程，大幅提升并发处理能力",
     "scene_tag": "开发"}
  ],
  "relations": [
    {"subject": "SpringBoot 3", "relation": "支持", "object": "Virtual Threads"}
  ],
  "facts": [
    {"title": "Virtual Thread 配置",
     "content": "spring.threads.virtual.enabled=true 开启虚拟线程，适合IO密集型任务"}
  ],
  "key_concepts": [
    {"concept": "虚拟线程", "description": "JDK 21 轻量级线程，适合高并发 IO 场景"}
  ],
  "confidence": 0-1
}

规则：
- 每篇资料单独提取，不跨篇推理
- 不确定的信息不要输出
- 提取出来的应该是以后能直接用的知识`,
  }, {
    role: 'user',
    content: combinedContent,
  }]);

  return JSON.parse(response);
}
```

### 2.5 交叉去重合并

多个来源提取出的 entity/fact 可能有重叠：

```typescript
private mergeExtractions(extractions: Extraction[]): MergedResult {
  const entityMap = new Map<string, EntityInput>();
  const factMap = new Map<string, FactInput>();
  const relationSet = new Set<string>();

  for (const ext of extractions) {
    for (const e of (ext.entities || [])) {
      const key = e.name;
      if (entityMap.has(key)) {
        // 如果新来源有更详细的信息，更新 summary
        const existing = entityMap.get(key)!;
        if (e.summary.length > existing.summary.length) {
          entityMap.set(key, e);
        }
      } else {
        entityMap.set(key, e);
      }
    }

    for (const f of (ext.facts || [])) {
      const key = f.title;
      if (!factMap.has(key)) {
        factMap.set(key, f);
      }
      // 同标题不同内容 → 保留详细的那个
      // 事实版本管理由 MemoryManager.updateFact 处理
    }

    for (const r of (ext.relations || [])) {
      const key = `${r.subject}|${r.relation}|${r.object}`;
      relationSet.add(key);
    }
  }

  return {
    entities: Array.from(entityMap.values()),
    facts: Array.from(factMap.values()),
    relations: Array.from(relationSet).map(k => {
      const [subject, relation, object] = k.split('|');
      return { subject_name: subject, relation, object_name: object };
    }),
  };
}
```

### 2.6 结果写入记忆

```typescript
async storeLearningResult(merged: MergedResult, plan: LearningPlan): Promise<void> {
  // 1. 写 entities
  for (const entity of merged.entities) {
    await this.memoryManager.upsertEntity(entity);
  }

  // 2. 写 facts
  for (const fact of merged.facts) {
    await this.memoryManager.storeFact(fact);
  }

  // 3. 写 relations
  for (const relation of merged.relations) {
    await this.memoryManager.relate(relation);
  }

  // 4. 写叙事记忆（episodic）— 保存"这次学了什么"的完整叙事
  await this.episodicMemory.createFromLearning({
    title: `学习：${plan.title}`,
    narrative: this.generateLearningSummary(merged, plan),
    participants: [],  // 不关联具体用户实体
    scene_tag: '开发',
    importance: 4,
  });
}

private generateLearningSummary(merged: MergedResult, plan: LearningPlan): string {
  const parts: string[] = [];

  parts.push(`## ${plan.title}`);
  parts.push(`学习时间：${new Date().toLocaleString('zh-CN')}`);
  parts.push('');

  if (merged.entities.length > 0) {
    parts.push('### 核心概念');
    for (const e of merged.entities) {
      parts.push(`- **${e.name}**：${e.summary}`);
    }
  }

  if (merged.facts.length > 0) {
    parts.push('### 关键知识');
    for (const f of merged.facts) {
      parts.push(`- ${f.title}：${f.content}`);
    }
  }

  if (merged.relations.length > 0) {
    parts.push('### 关系');
    for (const r of merged.relations) {
      parts.push(`- ${r.subject_name} ${r.relation} ${r.object_name}`);
    }
  }

  return parts.join('\n');
}
```

---

## 3. LearnTool 定义

```typescript
// src/core/tools/LearnTool.ts

export class LearnTool extends BaseTool {
  readonly name = 'learn';
  readonly description = [
    '自主学习一个新主题。',
    '当你需要了解一个新的技术、概念、框架、工具时使用。',
    '系统会自动搜索资料、提取关键知识、存入长期记忆。',
    '',
    '使用场景：',
    '- 用户说"你去学一下XXX"',
    '- 你需要了解一个不熟悉的技术才能完成任务',
    '- 用户问了一个你不知道的问题，需要先学习再回答',
    '',
    '学习完成后，知识会存入记忆库，以后可以直接使用。',
  ].join('\n');

  readonly input_schema = {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: '学习目标，越具体越好（如 "SpringBoot 3 的新特性和迁移方法"）',
      },
      depth: {
        type: 'string',
        enum: ['shallow', 'moderate', 'deep'],
        description: '学习深度。shallow=只看概述，moderate=核心概念+用法，deep=完整教程',
        default: 'moderate',
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: '指定学习来源（可选），如 ["official_docs", "blog_posts"]',
      },
    },
    required: ['goal'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const goal = input.goal as string;
    const depth = (input.depth as string) || 'moderate';

    try {
      // 1. 分析学习目标
      await this.emitProgress('正在分析学习目标…');
      const plan = await this.analyzeLearningGoal(goal);
      if (depth === 'shallow') {
        plan.topics = plan.topics.slice(0, 2);  // 浅度：只学前两个子主题
      }

      // 2. 搜索资料
      await this.emitProgress('正在搜索相关资料…');
      const sources = await this.searchForTopics(plan);

      // 3. 提取知识
      await this.emitProgress('正在阅读并提取知识…');
      const extractions: Extraction[] = [];
      for (const topic of plan.topics) {
        const topicSources = sources.filter(s => s.topic_id === topic.id);
        if (topicSources.length === 0) continue;
        const ext = await this.extractKnowledge(topic, topicSources);
        extractions.push(ext);
      }

      // 4. 合并去重
      const merged = this.mergeExtractions(extractions);

      // 5. 写入记忆库
      await this.storeLearningResult(merged, plan);

      // 6. 生成报告
      const report = this.formatReport(plan, merged);

      return this.success(report, {
        learned: {
          entityCount: merged.entities.length,
          factCount: merged.facts.length,
          relationCount: merged.relations.length,
          topics: plan.topics.map(t => t.label),
        },
      });
    } catch (err) {
      return this.error(`学习失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async emitProgress(message: string): Promise<void> {
    // 通过 EventBus 通知 UI
    eventBus.emitSync('learning:progress', { message });
  }

  private formatReport(plan: LearningPlan, merged: MergedResult): string {
    const lines: string[] = [];

    lines.push(`## ✅ 学习完成：${plan.title}`);
    lines.push('');
    lines.push(`学习了 ${plan.topics.length} 个主题，共 ${merged.entities.length} 个概念、${merged.facts.length} 条知识、${merged.relations.length} 个关系`);
    lines.push('');
    lines.push('### 核心概念');
    for (const e of merged.entities.slice(0, 5)) {
      lines.push(`- **${e.name}**：${e.summary.slice(0, 100)}`);
    }
    if (merged.entities.length > 5) {
      lines.push(`- …还有 ${merged.entities.length - 5} 个概念`);
    }
    lines.push('');
    lines.push('### 关键事实');
    for (const f of merged.facts.slice(0, 3)) {
      lines.push(`- **${f.title}**：${f.content.slice(0, 120)}`);
    }
    lines.push('');
    lines.push('以后需要使用时，可以直接问我。');

    return lines.join('\n');
  }
}
```

---

## 4. 学习结果的记忆化

学到的知识存入 entities/facts/relations/episodes 后，memory_search 就能搜到。但这只解决了"知道"的问题——用户需要的是"会用"。

学到的知识有两种去向：

- **纯知识**：存入 entities/facts/relations（跟聊天中自然积累的记忆在同一个库）
- **可执行的技能**：包装成 Skill，注册到 SkillRegistry，用户可以直接调用

### 4.1 Skill 市场兼容

xuanji 的 skill 系统不只是学完后自用。它应该能安装、使用社区开源 skill——不管是什么格式的。

#### 市面上的 Skill 生态

目前 AI Agent 工具调用领域的标准格式：

| 生态 | 格式 | 是否已有 | 处理方式 |
|------|------|---------|---------|
| **OpenAI GPTs Actions** | OpenAPI Schema + manifest.json | 大量现成 | 用 OpenAPI Skill adapter 接入 |
| **Claude MCP** | JSON-RPC, tool definitions | 大量现成 | xuanji 已有 MCPManager，复用 |
| **LangChain Tools** | StructuredTool interface | 多 | import/dynamic load |
| **xuanji 原生** | YAML/TS Skill | 少量 | 直接加载 |

#### 加载架构

```
skill_install("github-user/mcp-server-postgres")  
  → 检测包类型
  → 如果是 MCP server: 配置到 mcp.json，通过 MCPManager 调用
  → 如果是 OpenAPI: 通过 OpenAPI adapter 转为 xuanji skill
  → 如果是 xuanji YAML: 直接加载到 SkillRegistry

~/.xuanji/users/{userId}/skills/install/ ← 第三方安装的 skill
├── mcp/  ← MCP server 的注册引用
│   └── postgres.json: { "name": "postgres", "command": "npx @anthropic/mcp-server-postgres", "tools": [...] }
├── openapi/ ← OpenAPI 转译的 skill
│   └── github-skills.yaml
├── native/ ← 原生 YAML skill  
│   └── review-pr.yaml
└── xuanji-learned/ ← 自学的 skill
    └── springboot-virtual-threads.yaml
```

#### Adapter 设计

每种外部格式用一个 adapter 转换为统一的 `Skill` 接口：

```typescript
// MCP Server → xuanji Skill 适配
async function adaptMcpServerToSkill(mcpConfig: McpServerConfig): Promise<Skill> {
  // 通过 MCPManager 获取服务器提供的 tools
  const tools = await mcpManager.listTools(mcpConfig.name);

  return {
    id: `mcp-${mcpConfig.name}`,
    name: mcpConfig.name,
    version: '1.0.0',
    description: `MCP Server: ${mcpConfig.name}`,
    category: 'workflow',
    tags: ['mcp', mcpConfig.name],
    // 每个 MCP tool 映射为一个 internal tool call
    execute: async (params) => {
      const result = await mcpManager.callTool(
        mcpConfig.name,
        params.tool,
        params.args,
      );
      return { success: !result.isError, output: result.content };
    },
    parameters: {
      tool: { type: 'string', description: 'MCP tool name', required: true },
      args: { type: 'object', description: 'Tool arguments' },
    },
    requiredTools: [],
    priority: 50,
    moduleType: 'skill',
  };
}

// OpenAPI → xuanji Skill 适配
async function adaptOpenApiToSkill(openApiSpec: any): Promise<Skill[]> {
  // 每个 API endpoint 映射为一个 skill
  return Object.entries(openApiSpec.paths).map(([path, methods]: [string, any]) => {
    const method = Object.keys(methods)[0];
    const operation = methods[method];
    return {
      id: `openapi-${operation.operationId || path}`,
      name: operation.summary || path,
      version: '1.0.0',
      description: operation.description || '',
      category: 'workflow',
      tags: ['openapi'],
      execute: async (params) => {
        // 通过 web_fetch 调 API
        const response = await webFetch(buildUrl(openApiSpec.servers[0].url + path, params), {
          method: method.toUpperCase(),
          headers: { 'Content-Type': 'application/json' },
          body: params.body ? JSON.stringify(params.body) : undefined,
        });
        return { success: true, output: response };
      },
      parameters: extractParameters(operation),
      requiredTools: ['web_fetch'],
      priority: 50,
      moduleType: 'skill',
    };
  });
}
```

这样 xuanji 的 skill 系统跟市面上的工具市场是**兼容的**。用户可以说"装一个 MCP 的 PostgreSQL 工具"，系统自动适配。

### 4.2 从学 API 到自动注册 MCP Server

你举的高德地图例子，正确的做法是：**注册一个 MCP server，而不是自己写 tool 代码。**

MCP 本身就是用来对接外部服务的标准化协议。高德如果已经有现成的 MCP server，learn 只需要找到它并配置。如果没有，创建一个最简单的 HTTP MCP server 包装——MCPManager 已经支持 stdio、HTTP、SSE 三种传输方式。

```
用户: "学一下高德地图怎么查位置"

learn("高德地图 API"):
  ├─ ① 搜索 "高德地图 MCP server" → 如果有现成的，直接装
  │     npx @amap/mcp-server 或 GitHub 上的社区实现
  │     配置到 mcp.json 即可
  │
  ├─ ② 如果没有现成 MCP server:
  │    搜索高德开放平台 Web API 文档
  │    阅读 API 文档 → 提取 endpoints
  │    生成一个 MCP server 配置 + 简单的 wrapper 脚本
  │
  └─ ③ 写入记忆:
        entities: 高德地图, 地理编码API, POI搜索API
        facts: "高德API key从控制台申请"
        relations: 高德地图 提供 地理编码API
        mcp_config: "amap-mcp" → 已注册到 MCPManager
```

#### 流程 1：有现成 MCP Server

```typescript
// LearnTool 中
async tryInstallMcpServer(goal: string): Promise<boolean> {
  // 搜索现成 MCP server
  const results = await webSearch(`${goal} MCP server`);
  for (const r of results) {
    // 匹配 npm 包模式: @xxx/mcp-server 或 mcp-server-xxx
    const mcpMatch = r.url.match(/npmjs\.com\/package\/(@?[^/]+\/[^/]+mcp[^/]*|mcp[^/]*)/);
    if (mcpMatch) {
      const pkgName = mcpMatch[1];
      // 注册到 MCPManager
      await this.mcpManager.addServer({
        name: this.generateServerName(pkgName),
        transport: 'stdio',
        command: 'npx',
        args: ['-y', pkgName],
        env: {},  // API key 通过环境变量传入
      });
      return true;
    }

    // 也支持 GitHub 仓库: github.com/xxx/mcp-server-xxx
    const ghMatch = r.url.match(/github\.com\/([^/]+\/[^/]+)/);
    if (ghMatch && (r.title.includes('MCP') || r.content?.includes('MCP'))) {
      // 提示用户 git clone 或 npx 安装
      return true;
    }
  }
  return false;
}
```

#### 流程 2：没有现成 MCP Server — 自动注册 HTTP MCP

MCP 协议很简单——一个 JSON-RPC 2.0 接口。learn 可以生成一个最小的 HTTP MCP server wrapper：

```typescript
// LearnTool 生成的最小 MCP server 配置
// 持久化为: ~/.xuanji/users/{userId}/mcps/learned/amap-mcp.json

{
  "name": "amap-mcp",
  "transport": "http",
  "httpUrl": "http://localhost:9876/mcp",
  "command": "node",
  "args": ["${XUANJI_MCP_DIR}/learned/amap-mcp/server.js"],
  "env": {
    "AMAP_API_KEY": "${AMAP_API_KEY}"
  }
}

// 同时生成 server.js
const http = require('http');

const API_KEY = process.env.AMAP_API_KEY;
const BASE = 'https://restapi.amap.com/v3';

const TOOLS = {
  geocode: {
    name: 'amap_geocode',
    description: '高德地理编码：地址转坐标',
    inputSchema: {
      address: 'string',
      city: 'string?',
    },
    async handler(params) {
      const res = await fetch(
        `${BASE}/geocode/geo?key=${API_KEY}&address=${encodeURI(params.address)}`
      );
      return res.json();
    },
  },
  search_poi: {
    name: 'amap_search_poi',
    description: '高德POI搜索：查找周边兴趣点',
    inputSchema: {
      keywords: 'string',
      city: 'string?',
      types: 'string?',
    },
    async handler(params) {
      const res = await fetch(
        `${BASE}/place/text?key=${API_KEY}&keywords=${encodeURI(params.keywords)}`
      );
      return res.json();
    },
  },
};

// JSON-RPC 2.0 MCP server
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    const { method, params, id } = JSON.parse(body);

    if (method === 'tools/list') {
      res.end(JSON.stringify({
        jsonrpc: '2.0', id,
        result: Object.values(TOOLS).map(t => ({
          name: t.name, description: t.description,
          inputSchema: { type: 'object', properties: t.inputSchema },
        })),
      }));
    } else if (method === 'tools/call') {
      const tool = TOOLS[params.name];
      if (!tool) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Tool not found' } }));
        return;
      }
      try {
        const result = await tool.handler(params.arguments);
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }));
      } catch (err) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } }));
      }
    }
  });
});

server.listen(9876);
```

MCP server 启动后，MCPManager 会自动发现它提供的 tools，注册到 ToolRegistry。Agent 可以直接调 `amap_geocode`、`amap_search_poi`——跟调 `read_file`、`bash` 没有区别。

#### 完整用户场景

```
用户: "学一下高德地图怎么查位置"

xuanji:
  learn("高德地图 API")
  → 搜索 "高德 MCP server"
  → 没找到现成的
  → 搜索高德开放平台 Web API 文档
  → 阅读文档 → 提取 geocode、search_poi、driving 三个接口
  → 生成 MCP server 配置 + server.js
  → 注册到 MCPManager
  → MCPManager 启动 server，发现 3 个 tool
  → 注册到 ToolRegistry
  → 写入记忆

用户: "西湖附近有什么咖啡厅"

xuanji:
  1. Agent 自动判断需要的地理编码 + POI 搜索
  2. 调 amap_geocode("西湖") → 获取坐标
  3. 调 amap_search_poi(location, "咖啡厅") → 获取 POI
  4. 格式化结果 → "西湖附近有 12 家咖啡厅，最近的是..."

  用户完全感知不到背后有 MCP server 在运行。
```

#### learn 对外部服务的三种产出

| 情况 | learn 产出 | 技术途径 |
|------|-----------|---------|
| 已有 MCP server | 直接配置到 mcp.json | npm install + MCPManager 注册 |
| 有 REST API，无 MCP | 生成最小 HTTP MCP server | 自动生成 server.js + mcp 配置 |
| 无 API，只文档 | 纯知识存入记忆 | entities/facts/skills |

三种情况对 Agent 来说无差别——最终都是 ToolRegistry 里多了一个或多个 tool 可用。用户只看到结果。


### 4.3 学到的知识 vs 可执行的技能

```
方式 A（纯知识方式）：
  entities: Virtual Threads, HttpInterface, RestClient
  facts:   "Virtual Thread 配置: spring.threads.virtual.enabled=true"
           "HttpInterface 替代 RestTemplate 声明式调用"
  relations: SpringBoot 3 支持 Virtual Threads

  效果: 用户问"SpringBoot 3 虚拟线程怎么配"——能回答
        但不会自动用——Agent 需要手动复制粘贴配置

方式 B（包装成 Skill，新增设计）：
  skill: "springboot3-virtual-threads"
    prompt: "你是一个 SpringBoot 3 专家…
             配置 virtual threads 的步骤：
             application.properties 加 spring.threads.virtual.enabled=true
             需要先升级到 JDK 21
             适用于 IO 密集型任务..."

  效果: Agent 可以 invoke 这个 skill，直接获得行为指导
        用户可以说"帮我配一下虚拟线程"——Agent 直接执行 skill
        skill 的参数提示：{ "target_file": "application.properties" }
```

### 4.2 LearnTool 扩展：学完后生成 Skill

在学**"怎么做"**类型的内容时（API 用法、配置、工作流），额外生成一个 Skill：

```typescript
async execute(input: Record<string, unknown>): Promise<ToolResult> {
  const goal = input.goal as string;
  const plan = await this.analyzeLearningGoal(goal);

  // ... 搜索、提取、合并、写入记忆（同 Part 8）...

  // ★ 新增：如果学习内容包含"怎么做"信息，生成 Skill
  const proceduralContent = this.detectProceduralContent(merged);
  if (proceduralContent) {
    await this.createSkillFromLearning(plan, merged, proceduralContent);
  }

  // ... 生成报告 ...
}

/**
 * 检测学习结果中是否有"可执行"的内容
 * 
 * 判断标准：
 * - facts 中包含步骤/配置/命令
 * - 有明确的输入输出
 * - 不是纯概念介绍
 */
private detectProceduralContent(merged: MergedResult): boolean {
  const proceduralPatterns = [
    /步骤|配置|命令|安装|部署|使用|调用|设置/,
    /\.enable|\-\-flag|install|npm|pip|docker run/,
    /application\.properties|application\.yml|Dockerfile/,
    /POST|GET|PUT|DELETE|API|endpoint/,
  ];

  const allContent = [
    ...merged.facts.map(f => f.content),
    ...merged.entities.map(e => e.summary),
  ].join(' ');

  const matchCount = proceduralPatterns.filter(p => p.test(allContent)).length;
  return matchCount >= 2;  // 至少匹配 2 个模式才算"可执行"
}
```

### 4.3 Skill 生成

Skill 有三种类型，学完后根据内容自动判断生成哪种：

| 类型 | 说明 | 生成条件 | 示例 |
|------|------|----------|------|
| **prompt** | 行为指南，注入到 Agent prompt | 纯步骤/配置说明，不涉及文件或网络操作 | "SpringBoot 虚拟线程配置" |
| **workflow** | 可执行的完整工作流，包含 `execute()` 方法 | 涉及文件操作、命令执行、API 调用 | "部署到服务器"、"创建新项目脚手架" |
| **hybrid** | prompt + workflow 组合 | 既有配置步骤，又有可自动化部分 | "配置 CI 流程"（prompt 部分+自动写 yaml） |

#### 类型 1：prompt skill（纯行为指南）

学到的内容不涉及文件操作或命令执行，只是一系列步骤说明：

```typescript
// 生成 prompt skill
const skill: Skill = {
  id: 'springboot-virtual-threads',
  name: 'SpringBoot 虚拟线程配置',
  version: '1.0.0',
  description: '配置 SpringBoot 3 虚拟线程',
  category: 'prompt',
  tags: ['springboot', 'java', '配置'],
  content: `## SpringBoot 3 虚拟线程配置指南

前提条件：
- 项目已升级到 SpringBoot 3.x
- JDK 21+

步骤：
1. 打开 application.properties
2. 添加：spring.threads.virtual.enabled=true
3. 对于 Tomcat，添加：server.tomcat.threads.max=200

注意事项：
- 虚拟线程适合 IO 密集型任务
- CPU 密集型任务不建议使用
- 谨慎使用 ThreadLocal`,
  priority: 50,
  render: () => skill.content,
};
```

Agent 使用时，加载 skill 的 `content` 注入到 system prompt 中。

#### 类型 2：workflow skill（可执行工作流）

学到的内容涉及文件读写、命令执行、API 调用——需要真正干活。用 LLM 生成 TypeScript 代码作为 `execute` 方法：

```typescript
// LearnTool 中生成 workflow skill
async createWorkflowSkill(plan: LearningPlan, merged: MergedResult): Promise<Skill> {
  const skillId = this.generateSkillId(plan.title);

  // 用 LLM 生成 execute 方法的代码
  const codeGen = await this.provider.stream([{
    role: 'system',
    content: `根据以下学习结果，生成一个可执行的 workflow Skill。

输出 JSON：
{
  "name": "SpringBoot 项目脚手架创建",
  "description": "创建一个新的 SpringBoot 3 项目",
  "parameters": {
    "project_name": { "type": "string", "description": "项目名称", "required": true },
    "package_name": { "type": "string", "description": "包名，如 com.example.demo", "required": true },
    "java_version": { "type": "string", "description": "JDK 版本，默认 21", "default": "21" }
  },
  "code": "生成 TypeScript 代码，实现 Skill 的 execute 方法。

代码规则：
- 函数签名: async (params: Record<string, any>): Promise<WorkflowResult>
- 可用工具: write_file, read_file, bash, edit_file, glob, grep（不需要 import，直接使用）
- write_file(path, content) 写文件
- read_file(path) 读文件
- bash(command) 执行命令，返回 { stdout, stderr, exitCode }
- 错误时返回 { success: false, error: string }
- 成功时返回 { success: true, output: string }

生成的代码示例（pom.xml 生成）：
const pom = \`<?xml version=\"1.0\"...\`;
await write_file(params.project_name + '/pom.xml', pom);
await bash('cd ' + params.project_name + ' && mvn wrapper:wrapper');
return { success: true, output: \\\`SpringBoot项目 \${params.project_name} 已创建\\\` };

只返回代码本身，不要额外说明。",
  "requiredTools": ["write_file", "read_file", "bash"],
  "tags": ["springboot", "java", "project-init"]
}`,
  }, {
    role: 'user',
    content: this.formatLearningForSkillGen(plan, merged),
  }]);

  const skillDef = JSON.parse(codeGen);

  // 将生成的代码转化为可执行的函数
  const executeFn = new Function(
    'write_file', 'read_file', 'bash',
    `return (async (params) => {\n${skillDef.code}\n})`
  )(write_file_fn, read_file_fn, bash_fn);

  const skill: Skill = {
    id: skillId,
    name: skillDef.name,
    version: '1.0.0',
    description: skillDef.description,
    category: 'workflow',
    tags: skillDef.tags || [],
    parameters: skillDef.parameters,
    requiredTools: skillDef.requiredTools || ['write_file', 'read_file', 'bash'],
    content: `可执行工作流：${skillDef.description}`,
    priority: 50,
    moduleType: 'skill',
    intentMeta: {
      description: skillDef.description,
      keywords: plan.topics.flatMap(t => [t.label]),
      scene: '开发',
    },
    execute: executeFn as any,
  };

  this.skillRegistry.register(skill);
  return skill;
}
```

**代码生成安全**：
- 生成的代码只允许调 `write_file`、`read_file`、`bash` 等白名单工具
- 在沙箱化的 `SkillExecutionContext` 中执行（限制 fs 访问范围）
- 用户首次执行 workflow skill 时需要确认（通过 PermissionController）

#### 类型 3：调用外部接口的 skill

有些技能需要调外部 API，比如"创建一个 GitHub 仓库"、"查询 AWS 资源"。

Skill 本身不直接调外部 API——它通过已有的 xuanji tools（web_fetch、bash）间接调：

```typescript
// workflow skill 中调外部 API
async execute(params: Record<string, any>): Promise<WorkflowResult> {
  // 通过 bash 调 curl 调 GitHub API
  const result = await bash(`
    curl -s -X POST https://api.github.com/user/repos \
      -H "Authorization: token ${process.env.GITHUB_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"name": "${params.repo_name}", "private": true}'
  `);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr };
  }

  // 初始化本地仓库
  await bash(`
    mkdir -p ${params.repo_name}
    cd ${params.repo_name}
    git init
    git remote add origin git@github.com:user/${params.repo_name}.git
  `);

  return { success: true, output: `GitHub 仓库 ${params.repo_name} 已创建并关联本地目录` };
}
```

对外部接口的管理：

```yaml
# 学完后自动生成的 skill 配置（持久化到磁盘）
~/.xuanji/users/{userId}/skills/learned/github-create-repo.yaml

id: github-create-repo
name: 创建 GitHub 仓库
version: 1.0.0
description: 创建 GitHub 仓库并关联本地 Git
category: workflow
tags: [github, git, 部署]
parameters:
  repo_name:
    type: string
    description: 仓库名称
    required: true
  private:
    type: boolean
    description: 是否私有
    default: true
requiredTools:
  - bash
extDependencies:         # ← 外部依赖声明
  - type: api
    name: GitHub API
    url: https://api.github.com
    auth: token
    envVar: GITHUB_TOKEN
```

Agent 执行前检查依赖是否满足：

```typescript
async canExecute(skill: Skill): Promise<boolean> {
  const deps = (skill as any).extDependencies || [];
  for (const dep of deps) {
    if (dep.type === 'api' && dep.envVar) {
      if (!process.env[dep.envVar]) {
        return false;  // 缺 API key
      }
    }
    if (dep.type === 'cli') {
      try {
        await bash(`${dep.name} --version`);
      } catch {
        return false;  // 缺 CLI 工具
      }
    }
  }
  return true;
}
```

### 4.4 Skill 的检测流程总结

```
LearningGoal: "创建一个SpringBoot 3项目"

→ search + extract + merge
→ merged 中包含 pom.xml 内容、目录结构、依赖配置

→ detectProceduralContent():
  "步骤" → 命中
  "配置" → 命中
  "application.properties" → 命中
  → matchCount = 3 >= 2 → 需要生成 Skill

→ selectSkillType():
  有文件操作（pom.xml） → workflow
  有命令执行（mvn） → workflow
  → category = 'workflow'

→ createWorkflowSkill():
  LLM 生成 execute 代码
  注册 SkillRegistry
  持久化到 disk

→ 事后:
  用户: "帮我创建一个 SpringBoot 3 项目"
  → IntentRouter 匹配到 skill
  → Agent 检查依赖（JDK、Maven）
  → 执行 skill → 生成项目脚手架
```

### 4.5 用户如何使用生成的 Skill

#### 方式 1：用户显式请求

```
用户: "帮我配一下虚拟线程"

Agent:
  1. 分析意图 → 涉及 SpringBoot 3 虚拟线程
  2. 搜索 memory → 找到 skill "springboot-virtual-threads"
  3. 渲染 skill 内容 → 获得行为指南
  4. 按指南操作 → 读 application.properties → 加配置
  5. 回复用户
```

#### 方式 2：Skill 被 IntentRouter 自动匹配

skill 注册时带有 `intentMeta.keywords`，IntentRouter 可以自动发现和匹配：

```
用户: "怎么优化 IO 密集型服务的并发？"
  → IntentRouter 匹配到 skill "springboot-virtual-threads"
    keywords: ["虚拟线程", "SpringBoot 3", "IO密集型"]
  → Agent 加载 skill → 按指南回答
  → "可以用 SpringBoot 3 的虚拟线程，配置方式..."
```

#### 方式 3：用户通过斜杠命令触发

如果 skill 设置了 `slashCommand`：

```
用户: "/springboot-vt target_file=application.properties"
  → SkillRegistry 直接执行
  → 读文件 → 追加配置 → 验证 → 返回结果
```

### 4.5 Skill 的学习和维护

#### 自动生成的 Skill 质量

LLM 生成的 skill 可能不够精准。两种方式改进：

1. **用户使用中反馈**：用户纠正时，Agent 更新 skill 内容

```typescript
// AgentLoop 检测到用户纠正了跟技能相关的行为
if (correction.topic.includes(skillId) || correction.topic.includes(skillDef.name)) {
  // 更新 skill 内容
  skillRegistry.update(skillId, {
    content: updatedPrompt,
    version: '1.0.1',
  });
}
```

2. **用户手动编辑**：Skill 存储在 `~/.xuanji/skills/` 目录下，用户可以直接编辑 YAML 文件

```
~/.xuanji/users/{userId}/
└── skills/
    ├── learned/              ← 自动生成的 skill
    │   ├── springboot-virtual-threads.yaml
    │   └── restclient-usage.yaml
    └── custom/               ← 用户手动写的
        └── my-workflow.yaml
```

## 5. 学到的知识怎么用

### 5.1 自动在 prompt 中注入

如果用户的问题涉及之前学过的主题，buildContext 自动注入：

```typescript
async buildContext(options: BuildContextOptions): Promise<string> {
  // 1. 标准注入（画像 + 场景事实）
  // 2. 检查是否有相关学习记录
  if (options.keyword) {
    const learningEpisodes = await this.episodicMemory?.search(options.keyword, 1);
    if (learningEpisodes && learningEpisodes.length > 0) {
      // 注入学习摘要作为参考
      parts.push('## 相关知识（自主学习）');
      parts.push(learningEpisodes[0].narrative.slice(0, 500));
    }
  }
}
```

### 5.2 Agent 主动检索

Agent 遇到不知道的问题时，会先调 `memory_search`。学过的知识在 FTS5 和语义搜索中都能命中了——跟用户自己说的记忆没有区别。

### 5.3 `l0-base-memory-guide.yaml` 引导

```yaml
  ## 自主学习

  遇到以下情况时，用 learn 工具主动学习：
  - 用户说"你去学一下/了解一下/看看XXX"
  - 你不知道某个技术怎么用，但知道它存在
  - 你需要了解一个新领域才能完成当前任务
  
  不需要学习的情况：
  - 用户直接给了答案（直接 memory_store 即可）
  - 你已经有相关知识（先 memory_search 确认）
```

---

## 6. 与现有系统集成

### 6.1 文件清单

```
src/core/tools/
├── LearnTool.ts               ← 新增

src/core/memory/
├── EpisodicMemory.ts          ← 修改：新增 createFromLearning()
└── types.ts                   ← 修改：新增 LearningPlan 等类型
```

### 6.2 注册到 ToolRegistry

```typescript
// ToolRegistry.ts
import { LearnTool } from './LearnTool';

function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  // ... 现有工具 ...
  registry.register(new LearnTool(memoryManager, episodicMemory));
  return registry;
}
```

### 6.3 xuanji.yaml

```yaml
tools:
  # ... 现有工具 ...
  - name: learn
    required: false
```

学习工具不是每个任务都要用——只在 LLM 判断需要学习时调用。

### 6.4 成本估算

| 步骤 | 调用次数 | 估算成本 |
|------|---------|---------|
| 分析学习目标 | 1 次 LLM | ~300 tokens |
| 搜索（每子主题 2-3 query） | 6-15 次 web_search | 0 |
| 抓取网页 | 10-20 次 web_fetch | 0 |
| 知识提取（每子主题 1 次） | 2-5 次 LLM | 每次 ~8000 tokens |
| 交叉合并 | 纯算法 | 0 |
| 生成学习报告 | 1 次 LLM | ~500 tokens |

一次完整学习：~50K tokens 输入 + ~2K tokens 输出 = ~$0.007（按 deepseek-chat 价格）。
网络耗时：3-10 分钟（主要花在抓网页上）。

**可以并行：**子主题之间的搜索和提取互不依赖，可以并行执行。`learn` 工具内部的异步并发能显著缩短总耗时。
