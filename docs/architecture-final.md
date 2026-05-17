# Xuanji 记忆与自我扩展系统 · 最终架构设计

> 版本: 2.0 | 日期: 2026-05-16
> 整合全部 8 篇记忆文档 + 插件系统，形成一个完整的架构蓝图

---

## 目录

1. [系统总览](#1-系统总览)
2. [记忆系统](#2-记忆系统)
3. [插件与自我扩展](#3-插件与自我扩展)
4. [自举场景全流程](#4-自举场景全流程)
5. [文件清单与改动量](#5-文件清单与改动量)

---

## 1. 系统总览

### 1.1 一句话定位

**xuanji 是一个能记忆、能学习、能安装新能力、能使用新能力、能自我扩展的 AI 管家。**

### 1.2 系统层次

```
┌──────────────────────────────────────────────────────────┐
│                    用户交互层                              │
│  对话输入 / 指令 / 追问 / 纠错 / "学一下" / "装一个"    │
└──────────────────────────────────────────────────────────┘
                          │
┌──────────────────────────────────────────────────────────┐
│  Agent 处理层                                            │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐  │
│  │AgentLoop│ │IntentRouter│ │LearnTool │ │InstallTool│  │
│  └──────────┘ └────────────┘ └──────────┘ └──────────┘  │
└──────────────────────────────────────────────────────────┘
         │            │            │            │
         ▼            ▼            ▼            ▼
┌──────────────────────────────────────────────────────────┐
│  能力注册层                                               │
│  ┌──────────┐ ┌────────────┐ ┌──────────────────────┐   │
│  │ToolReg.  │ │SkillReg.  │ │MCPManager            │   │
│  │(静态)    │ │(动态)     │ │(启动子进程, 热注册)   │   │
│  └──────────┘ └────────────┘ └──────────────────────┘   │
└──────────────────────────────────────────────────────────┘
         │            │            │
         ▼            ▼            ▼
┌──────────────────────────────────────────────────────────┐
│  持久化层                                                 │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐  │
│  │记忆库    │ │MCP配置    │ │Skill文件  │ │插件目录   │  │
│  │(SQLite)  │ │(mcp.json)  │ │(YAML)    │ │(mcps/*)  │  │
│  └──────────┘ └────────────┘ └──────────┘ └──────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 1.3 三种能力的动态关系

```
ToolRegistry（静态）:
  核心工具：read_file, write_file, bash, web_fetch, web_search ...
  这些不动态注册，安全、稳定、可审查

MCPManager（动态）:
  通过 install 工具安装外部 MCP server
  安装后 MCPClient 发现 tools → 自动注册到 ToolRegistry
  Agent 使用这些工具跟使用内置工具一样

SkillRegistry（动态）:
  来源 1: install("xxx") → 从外部搜索 → 下载 YAML → 注册
  来源 2: learn("xxx") → LLM 学习 → 生成 skill → 注册
  来源 3: 用户写 YAML → 放到 skills/custom/ → SkillLoader 加载
```

### 1.4 使用流程总览

```
用户: "帮我查一下数据库的 users 表"

  → 当前 ToolRegistry 里没有 postgres 工具
  → Agent 自动识别需要数据库工具
  → 调 install("PostgreSQL 数据库")
    → PluginSearchService.searchMcp("PostgreSQL")
    → 找到 @anthropic/mcp-server-postgres
    → 配置 mcp.json → MCPManager 启动子进程 → 工具可用
  → Agent 再试 → 调 postgres.query("SELECT * FROM users LIMIT 5")
  → 返回结果

用户: "学一下怎么用高德地图查位置"

  → learn("高德地图 API")
    → PluginSearchService 搜索 → 没找到现成 MCP server
    → 搜索高德开放平台 Web API 文档
    → 提取 endpoints（地理编码、POI 搜索、路线规划）
    → 生成 MCP server 配置 + server.js → 注册到 MCPManager
    → 生成 skill "查附近POI"（多步操作：地理编码 + POI 搜索）
    → 注册到 SkillRegistry
  → "已学习高德地图工具和技能"

用户: "西湖附近有什么咖啡厅"

  → IntentRouter 匹配到 skill "查附近POI"
  → 执行 skill: amap_geocode("西湖") → amap_search_poi(坐标, "咖啡厅")
  → 返回结果

用户: "学一下怎么在饿了么点外卖"

  → learn("饿了么点外卖")
    → 识别需要 browser 工具
    → checkMissingTools(["browser_navigate", "browser_click", ...])
    → 没有 → 调 install("浏览器自动化")
      → PluginSearchService 搜索 → 找到 playwright MCP server
      → 安装 → ToolRegistry 注册 browser_* 工具
    → 重新检查 → 工具已就绪
    → 生成 workflow skill: 打开饿了么 → 搜索 → 加购 → 结算
    → 注册到 SkillRegistry

用户: "帮我点一份黄焖鸡"
  → 匹配 skill "饿了么点外卖"
  → 执行: browser_navigate → browser_type → browser_click → ...
  → 到支付环节 → 停下来让用户确认
```

---

## 2. 记忆系统

### 2.1 数据模型（8 表）

```
基础 4 表:
  entities          → 节点（人/项目/工具/偏好/概念）
  relations         → 有向边（熟练使用/负责/偏好），带 is_active 软删除标记
  events            → 时序事件（完成了什么），entity_ids 用 ',id,' 格式避免子串匹配
  facts             → 事实条目（带 version 版本管理，is_latest 标记）

派生 2 表:
  relation_changes  → 关系变更历史（JWT→RSA 等偏好切换），存实体 ID 而非名称
  project_snapshots → 项目状态快照（进度、阶段、阻塞项），追加模式不覆盖

全文索引:
  memory_fts        → FTS5 全文索引，trigger 同步

语义搜索:
  embeddings.data   → 独立二进制文件存储 384 维向量
  embeddings.idx    → JSON 索引

叙事记忆:
  episodes          → 情节叙事表（300-2000 字完整情节）
  episode_entities  → 叙事↔实体多对多关联

子 Agent 结果存档:
  subagent_results/ → JSONL 格式，按日期分文件，7 天过期

Schema 管理:
  schema_version   → 迁移表，initDB() 时检查并执行
```

完整 DDL 见 [memory-system-part-1-storage.md](./memory-system-part-1-storage.md)

### 2.2 三层检索

| 层级 | 触发方式 | 实现 |
|------|---------|------|
| L0 被动注入 | build prompt 时自动注入（~800 tokens） | SQL 索引查询 |
| L1 场景记忆 | build prompt + scene 过滤 | entities + facts by scene_tag |
| L2 主动搜索 | Agent 调 memory_search 工具 | FTS5 + 语义搜索 + 关系查询 + MemoryGraph 图查询 |
| L3 叙事回忆 | 用户说"记得那次…"时自动激活 | EpisodicMemory 语义交叉检索 |

### 2.3 自动推演引擎

LLM 只存原子事件，MemoryManager 自动推演派生状态。

| 事件类型 | 自动推演 | 更新目标 |
|---------|---------|---------|
| "完成了用户注册接口" | tryUpdateProjectStatus() | project_snapshots（进度 +15%，current_focus 更新） |
| "从 JWT 改为 RSA" | tryTrackPreferenceChange() | relation_changes + relations.is_active |
| 用户纠正 | detectCorrection() | facts version+1，source='user_correction' |
| 上下文压缩 | archiveDelegate.archiveMessages() | events + facts + SubAgentResultStore |

### 2.4 三级触发

| 层级 | 触发者 | 触发时机 | 成本 |
|------|--------|---------|------|
| 1. LLM 主动存储 | Agent 调 memory_store 工具 | 合适的时机主动存 | ~0（tool call 成本忽略） |
| 2. PostToolUse 兜底 | HookRegistry 监听器 | task/agent_team 完成后 LLM 忘存时 | ~500 tokens（便宜 LLM） |
| 3. 会话结束提取 | ChatSession.run() finally | 5 秒后异步执行 | ~1k tokens |

### 2.5 三人份记忆

| 记忆类型 | 存储位置 | 回答的问题 |
|---------|---------|-----------|
| 语义记忆 | entities + facts + relations | "张三喜欢什么技术栈" |
| 程序记忆 | skills + workflow execute | "怎么创建一个 SpringBoot 项目" |
| 叙事记忆 | episodes | "记得上次认证方案选了三次才定下来" |

---

## 3. 插件与自我扩展

### 3.1 两种可安装能力

| 插件类型 | 安装方式 | 隔离性 | 注册目标 |
|---------|---------|--------|---------|
| MCP server | install 搜索 → npm 安装 → MCPManager 管理子进程 | ✅ 独立子进程 | ToolRegistry |
| Skill | install 搜索 → YAML 下载 / learn 生成 → SkillRegistry 注册 | ✅ 文本 / 可隔离执行 | SkillRegistry |

**tools 不动态注册**。read_file、write_file、bash、web_fetch 等核心工具保持静态。外部能力通过 MCP server 提供，MCP server 暴露的工具自动出现在 ToolRegistry 中，对 Agent 而言跟内置工具无差别。

### 3.2 搜索接口（待外部实现）

```typescript
interface PluginSearchService {
  searchMcp(query: string): Promise<McpCandidate[]>;
  searchSkill(query: string): Promise<SkillCandidate[]>;
  getMcpDetail(id: string): Promise<McpDetail | null>;
  getSkillDetail(id: string): Promise<SkillDetail | null>;
}
```

### 3.3 InstallTool 流程

```
install("PostgreSQL")

  ① PluginSearchService.searchMcp("PostgreSQL")
     → 返回候选列表 [{ name, description, installCommand, confidence }]

  ② 选最优候选 → getMcpDetail → 构建 MCPServerConfig

  ③ 追加到 mcp.json（持久化）
     MCPManager.addServer(config)（热加载）

  ④ MCPClient 连接 → listTools → 工具自动注册到 ToolRegistry

  ⑤ 返回安装报告：工具名称、数量、配置路径
```

### 3.4 Skill 的三种来源

```
来源          注册时机         持久化路径          来源标记
──────        ────────         ────────            ────────
install()     SkillLoader      复制到 installed/    source: 'installed'
learn()       立即注册         写入 learned/        source: 'learn_tool'
用户写 YAML    SkillLoader      放入 custom/        source: 'custom'

Agent 使用 skill 时无需关心来源。
```

### 3.5 Skill 的自举：缺工具时怎么办

```typescript
async createSkillFromLearning(plan, merged): Promise<Skill> {
  const skill = await this.buildSkill(plan, merged);

  // 检查 skill 需要的工具当前是否有
  const missing = await this.checkMissingTools(skill.requiredTools || []);

  if (missing.length > 0) {
    // 尝试安装缺失的工具（通过 MCP server）
    for (const toolName of missing) {
      const result = await this.installTool.execute({ goal: toolName, type: 'mcp' });
      if (result.isError) {
        // 装不上 → skill 降级为 prompt 模式
        skill.category = 'prompt';
        skill.content = `[需要 ${toolName} 工具，当前未安装]\n\n${skill.content}`;
      }
    }
  }

  this.skillRegistry.register(skill);
  return skill;
}
```

### 3.6 目录结构

```
~/.xuanji/users/{userId}/
├── mcp.json                       ← MCP server 配置
├── mcps/                          ← 生成的 MCP server 源码
│   └── amap-mcp/
│       └── server.js
├── skills/
│   ├── installed/                 ← 从外部安装的 skill（YAML）
│   │   └── review-pr.yaml
│   ├── learned/                   ← xuanji 自学的 skill（YAML）
│   │   ├── ele-order-food.yaml
│   │   └── springboot-project.yaml
│   ├── custom/                    ← 用户手动写的 skill
│   │   └── my-workflow.yaml
│   └── disabled/                  ← 用户禁用的 skill
├── memory/
│   ├── memory.db
│   ├── embeddings.data
│   ├── embeddings.idx
│   └── subagent_results/
├── sessions/
└── registry/                      ← 搜索索引缓存
    ├── mcp-index.json
    └── skill-index.json
```

---

## 4. 自举场景全流程

### 场景：饿了么点外卖

```
用户: "学一下怎么在饿了么点外卖"

  ① learn("饿了么点外卖")
     → 搜索 "饿了么 点外卖 流程"
     → 理解操作流程：打开网页 → 登录 → 选地址 → 搜店铺 → 加购 → 下单
     → 识别需要 browser 工具

  ② checkMissingTools(["browser_navigate", "browser_click", "browser_type", "browser_snapshot"])
     → 当前 ToolRegistry 没有 → MCPManager 也没有
     → 调 install("浏览器自动化工具")

  ③ install("浏览器自动化工具")
     → PluginSearchService.searchMcp("playwright MCP")
     → 找到 @anthropic/mcp-server-playwright
     → 配置 mcp.json → MCPManager 启动子进程
     → browser_navigate, browser_click, browser_type, browser_snapshot 注册到 ToolRegistry

  ④ check 通过 → 工具已就绪

  ⑤ 生成 workflow skill
     type: workflow
     name: "饿了么点外卖"
     requiredTools: [browser_navigate, browser_click, browser_type, browser_snapshot]
     execute:
       1. browser_navigate("https://ele.me")
       2. browser_snapshot 检查页面 → 判断是否需登录
       3. browser_type 搜索框 → "黄焖鸡"
       4. browser_click 搜索按钮
       5. browser_snapshot 检查结果列表
       6. browser_click 选中店铺
       7. browser_snapshot 检查菜单
       8. browser_click 加购
       9. ...（到支付时暂停，等用户确认）
     → 注册到 SkillRegistry
     → 持久化到 skills/learned/ele-order-food.yaml

  ⑥ 学习报告:
     "已学习饿了么点外卖技能。"
     "同时安装了浏览器自动化工具（Playwright MCP server）。"
     "下次说'帮我点一份黄焖鸡'就能自动执行。"
```

### 场景：如果饿了么改版了

```
用户执行 skill 时:
  1. browser_navigate("https://ele.me")  → 页面加载成功
  2. browser_snapshot  → 发现页面结构和学的时候不一样
     → Agent 发现无法按原步骤执行
  3. Agent 自动调 learn("饿了么当前页面怎么点外卖")
     → 重新学习当前页面的操作流程
  4. 更新 skill 内容
     → skillRegistry.update(id, newContent)
     → 更新磁盘上的 YAML 文件
     → version: '1.0.1'
  5. 继续执行新的操作流程
```

### 场景：创建一个 SpringBoot 3 项目

```
用户: "帮我创建一个 SpringBoot 3 项目，叫 demo"

  → 没有现成 skill → Agent 自动调 learn("SpringBoot 3 项目脚手架")
    → 搜索 SpringBoot 官方文档
    → 提取 steps: 生成 pom.xml, 创建目录结构, 写 application.yml
    → 检查工具: write_file, bash 都有
    → 生成 workflow skill
    → 注册 + 持久化

  → 执行 skill
    → write_file(demo/pom.xml, ...)
    → write_file(demo/src/main/java/...)
    → write_file(demo/src/main/resources/application.yml)
    → bash("cd demo && mvn wrapper:wrapper")
    → 返回 "SpringBoot 3 项目 demo 已创建"

  → 以后直接说"创建一个 SpringBoot 项目"就可以。
```

---

## 5. 文件清单与改动量

### 5.1 文档总览（9 篇 + 1 个代码文件）

```
docs/
├── memory-system-part-1-storage.md         (601行) 8表DDL + FTS5 + 迁移策略
├── memory-system-part-2-retrieval.md       (594行) 三层检索 + MemoryGraph + prompt注入
├── memory-system-part-3-integration.md     (1316行) 三级触发 + 推演引擎 + 工具 + 测试
├── memory-system-part-4-scaling.md         (438行) 万级规模 + 文档摘要 + 自我进化
├── memory-system-part-5-semantic-search.md  (414行) 本地ONNX语义搜索
├── memory-system-part-6-archiving.md       (427行) 上下文归档 + 子Agent结果持久化
├── memory-system-part-7-episodic.md        (527行) 叙事记忆（情节回忆）
├── memory-system-part-8-self-learning.md   (1246行) 自主学习 + MCP注册 + 代码生成
└── plugin-system.md                        (525行) 插件架构 + 搜索接口 + 自举流程

src/core/memory/
└── MemoryGraph.ts                          (508行) 内存拓扑图实现（已完成）
总计 6596 行
```

### 5.2 需要实现的新文件

| 文件 | 职责 | 预估行数 |
|------|------|---------|
| `src/core/memory/MemoryManager.ts` | 记忆系统主类：CRUD + FTS5 + 推演 + `ArchiveDelegate` | ~800 |
| `src/core/memory/SemanticIndex.ts` | 向量索引：写入/搜索/持久化 | ~200 |
| `src/core/memory/EpisodicMemory.ts` | 叙事记忆：从消息生成/语义搜索 | ~200 |
| `src/core/memory/SubAgentResultStore.ts` | 子Agent结果JSONL持久化 | ~150 |
| `src/core/memory/types.ts` | 类型定义 | ~100 |
| `src/core/memory/CareManager.ts` | 时间感知 + 纪念日检查 | ~100 |
| `src/core/memory/MemoryGraph.ts` | **已完成**（508行） | — |
| `src/core/tools/MemorySearchTool.ts` | memory_search 工具 | ~100 |
| `src/core/tools/MemoryStoreTool.ts` | memory_store 工具 | ~150 |
| `src/core/tools/LearnTool.ts` | 学习工具 | ~400 |
| `src/core/tools/InstallTool.ts` | 安装工具 | ~200 |
| `src/core/learn/LearnEngine.ts` | 学习引擎：搜索/提取/合并/MCP生成 | ~500 |
| `src/core/scheduler/Scheduler.ts` | 定时任务调度 + 空闲检测 | ~200 |
| `src/core/scheduler/types.ts` | CronJob 类型定义 | ~50 |

### 5.3 需要修改的现有文件

| 文件 | 改动 |
|------|------|
| `src/core/prompt/LayeredPromptBuilder.ts` | 构造函数新增 memoryManager 参数, build() 中调用 buildContext() |
| `src/core/chat/ChatSession.ts` | onText 传递 + scheduleMemoryExtraction + detectCorrection |
| `src/core/agent/AgentLoop.ts` | onToolEnd 中触发 SubAgentResultStore |
| `src/core/context/ContextManager.ts` | 已有 ArchiveDelegate 接口，只需调 setArchiveDelegate() |
| `src/core/tools/ToolRegistry.ts` | 注册 MemorySearchTool, MemoryStoreTool, LearnTool, InstallTool |
| `src/core/skills/loader.ts` | 新增加载 installed/ 和 learned/ 目录 |
| `src/core/config/PathManager.ts` | 已有 memory.db 路径，无需修改 |
| `src/core/templates/prompts/l0-base-memory-guide.yaml` | 改为 tool call 说明，去掉文本标记 |
| `src/core/templates/agents/xuanji.yaml` | tools 列表新增 memory_search, memory_store, learn, install |

### 5.4 零改动的系统

| 系统 | 原因 |
|------|------|
| `MCPManager` | 已有 addServer、listTools、callTool、reconnect |
| `SkillRegistry` | 已有 register、unregister、enable、intentMeta |
| `HookRegistry` | 已有 on、emit |
| `EventBus` | 已有 on、emit |
| `EmbeddingProvider` | 已有 embed、cosineSimilarity |
| `AcpProcessManager` | 已有 spawnWorker |

---

> 整个系统的设计目标是：每新增一个功能，对现有系统的修改趋近于零。新能力以 MCP server 或 Skill 插件的形式加载，不修改核心循环。
