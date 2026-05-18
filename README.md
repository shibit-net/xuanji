# 璇玑 (Xuanji) — 开源 AI 助手

璇玑是一个基于 TypeScript 的开源 AI 助手框架，支持多智能体协作、MCP（模型上下文协议）生态和 Electron 桌面应用。项目采用模块化架构，围绕 **ReAct 循环**构建，提供可扩展的工具系统、权限控制、记忆系统和事件驱动的可扩展性。

## 核心特性

- **多智能体协作** — 5 种团队策略：串行、并行、层级、辩论、流水线
- **MCP 生态** — 内置 MCP 客户端，支持 stdio/SSE/HTTP 传输，集成天工坊市场
- **工具系统** — 40+ 内置工具，覆盖文件操作、代码搜索、文档解析、网页搜索、子智能体编排
- **双层安全** — LLM 主动审计 + 硬编码安全网，SSRF 防护，sudo 检测
- **会话持久化** — 原子写入的 JSONL 消息存储，检查点/快照支持
- **Electron 桌面** — React + TailwindCSS 桌面应用，独立子进程运行核心引擎
- **记忆系统** — 实体-关系-事件记忆，FTS5 + 语义搜索，知识图谱
- **可扩展性** — 29+ 钩子事件，YAML/JSON5 智能体配置，技能市场

## 快速开始

### 环境要求

- **Node.js** >= 20.0.0
- **npm** >= 9.0.0
- **Git** (可选，用于工作区隔离)

### 安装

```bash
git clone https://github.com/shibit/xuanji.git
cd xuanji
npm install
```

### 配置

```bash
# 设置 LLM API Key（至少一个）
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."

# 或使用自定义端点
export XUANJI_BASE_URL="https://your-api-endpoint.com"
export XUANJI_MODEL="claude-sonnet-4-6"
```

### 运行

```bash
# 开发模式（命令行）
npm run dev

# 桌面应用（Electron GUI）
npm run dev:gui

# 构建桌面应用
npm run build:gui:mac    # macOS
npm run build:gui:win    # Windows
```

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Desktop (GUI)                     │
│  ┌─────────┐  ┌───────────┐  ┌──────────┐  ┌────────────┐  │
│  │ React   │  │ Tailwind  │  │ Shadcn   │  │ React Flow │  │
│  │ Router  │  │ CSS       │  │ UI       │  │ Cytoscape  │  │
│  └────┬────┘  └───────────┘  └──────────┘  └────────────┘  │
│       │ IPC (90+ channels)                                    │
│  ┌────┴──────────────────────────────────────────────────┐   │
│  │              agent-bridge (Child Process)               │   │
│  │         SessionFactory → ChatSession → AgentLoop       │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      Core Engine                             │
│                                                               │
│  ┌──────────┐   ┌──────────┐   ┌───────────────┐            │
│  │ Session  │   │  Agent   │   │   Provider    │            │
│  │ Factory  │──▶│  Loop    │──▶│   Pool        │            │
│  │ (DI)     │   │ (ReAct)  │   │ (Anthropic/   │            │
│  │          │   │          │   │  OpenAI/Llama)│            │
│  └──────────┘   └────┬─────┘   └───────────────┘            │
│                      │                                        │
│       ┌──────────────┼──────────────┐                        │
│       ▼              ▼              ▼                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │  Tool    │  │ Context  │  │Permission│                   │
│  │ Registry │  │ Manager  │  │Controller│                   │
│  │ (40+工具) │  │(压缩/摘要)│  │(双层安全) │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
│       │              │              │                        │
│       └──────────────┼──────────────┘                        │
│                      ▼                                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                 Event Bus + Hook Registry             │    │
│  │              (29+ Events, 3 Handler Types)            │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 架构分层

```
┌──────────────────────────────────────────────┐
│  UI 层        │ Electron / CLI / API          │
├──────────────────────────────────────────────┤
│  ���话层      │ ChatSession / SessionFactory   │
├──────────────────────────────────────────────┤
│  编排层       │ AgentLoop / TeamManager        │
│               │ TaskOrchestrator               │
├──────────────────────────────────────────────┤
│  能力层       │ ToolRegistry / SkillRegistry   │
│               │ MCPManager / MemoryManager     │
├──────────────────────────────────────────────┤
│  基础设施层   │ EventBus / HookRegistry        │
│               │ PermissionController          │
├──────────────────────────────────────────────┤
│  持久化层     │ SessionStorage / ConfigManager │
│               │ DecisionStore (SQLite) / Stats │
└──────────────────────────────────────────────┘
```

## 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **Agent 系统** | `src/core/agent/` | ReAct 循环、工厂模式、5 种团队策略、工作区隔离 |
| **Provider 层** | `src/core/providers/` | Anthropic / OpenAI / Llama 适配器，ProviderPool 缓存 |
| **工具系统** | `src/core/tools/` | 40+ 工具，中间件管道，子代理工具过滤 |
| **MCP 生态** | `src/mcp/` | MCP 客户端、天工坊市场、多引擎网页搜索 |
| **权限系统** | `src/permission/` | 双层安全：LLM 审计 + 硬编码守卫，SQLite 决策缓存 |
| **会话系统** | `src/session/` | JSONL 消息持久化、检查点、快照、损坏修复 |
| **记忆系统** | `src/core/memory/` | 实体-关系-事件模型，FTS5 + 语义搜索，知识图谱 |
| **钩子系统** | `src/hooks/` | 29+ 事件类型，Shell/Prompt/Agent 三种处理器 |
| **上下文系统** | `src/context/` | 项目扫描、代码索引、符号提取、依赖分析 |
| **配置系统** | `src/core/config/` | 多用户隔离、YAML+JSON 合并、环境变量映射 |
| **模板系统** | `src/core/templates/` | 8 个预置智能体、L0-L2 分层提示词 |

## 核心流程图

### 1. Agent ReAct 循环

![flowchart TD](https://mermaid.ink/img/eJxtkt9P2lAUx_-Vkz7Pf8CHJRMEf4CyzZflrg-NXJWktEvThS0tCWZiEcS6QFyMBscczJk53BKhUJV_hnNb_ouF3i6BZY_fcz7nnO895xrCppqmwrywJau5zR1J02Ej-loBAHhGvPoVK_X8xxoWWyLMzT2FBRJRFZ2-05OSIm1TDVjPxfJn1i2x3Y7I6xYCMmKMnPLIqbATa_xlz_v5iV0W2EUrz5nIhDFfUVlWcyZEif_g4qCNRxXv_rs4jbygaRMWCRsW_OHZf_JxjVLFhBjxbz949StIJJJhPhrYiHGxOC1igYiTl7pGpWwq84bKGYUCu9vFexu_7nnH-2GPeEAuGVir4qDu_XKxUQlfsBSMZycWO_9hwjKZbMkacO25p3x14jSLvRYWe9ynCStkQ1XluKTTnPQe2EF_bNns4JvfPAyLVoLZqwYvm5m9yvvZ137HNSFBsN_1m4cz1SGyf4rFlglJMnJ-_4skggFrxHNrrHGOdnXcLsHseUMyyUku1gKxbmC1OXqwJ1e9--trne8kCGHpFh-vvaOOCSni37TxYxn73XGhgNZAnMFvLtFxTIjw4HLQ_jnxh3U8a3BvIZ_iKeGJkKVaVsqkhXlD0HdodvJ_03RLeivrQj7_B2njPf4)

### 2. 会话生命周期

![flowchart TD](https://mermaid.ink/img/eJxN0stOAjEUBuBXaWatPoALDRcREJSou8qigQokMDXDiDFAAomQEYeI0RARRmWjswITAl5G5GVoZ3gLYynqtv-X87cnzUsxEsfSqnSYJiexJFJUsO89kAEAwAX3cDabIrIPxVSinK7EFIxULA6jYHl5DbihNwBo7522TDYwaVWffhnOsBmdT3Bz44G09uiMx7NK3R73mNllxkQADwdeSDWDPl9QvQkiCsml4liJEJIWyMvRBqRam1ofYJ-Q9C5OpLKqcirEBhc-OL8CCHsigHXqtNalLVMQHyebf01O74VOqvbAsq0HYTa58S-KXAksq-LtQvi5CEBnckPb98CTROpiHQfynAQ4CUL7xmTaK728mpXKbKSxcl_MCHKwBfn4ECFHgJ0_O11dxFs8Di12H0YySmBlJYty-LcjxE04P_28c_qGbV0z42G9OM_CP1mBNp4KIPj_hN32C2AbMr08fa9Qvck6JdvS7NqIlcqiepuP3YHsrWI3qs7wjH00otKSlMFKBqXi0mpeUpM48_Nb4vgQHadVqVj8BrGG8Lk)

### 3. 工具执行中间件管道

![flowchart LR](https://mermaid.ink/img/eJxNkMFKw0AURX9lmLXVgrsihTZNW6VCKd1Ns0iTaRJMZmAyQaXpQgURWmnRboLWlbjoJrhVxJ8x0-QvJGPUbu8977173xga1MSwAkcuPTVsnXHQ6Q0IAADUUJ9St4ctx-fsfBefYSPgWAOlUhXUkcoYZW2dmK5DLO1noi49BXWoZf2rilQbqO94mAb8YMj2qvvlsg9MPNIDlxdYQ2Iqqg0p44qNjZPCUKXRRF1XJ8fUxHKBmL6Im3VyHYn726-PxwJtSrSFuph5ju87lEg4mc-S18tsPUvji4JsSbItK_5VG5AtMxTTu837KgSHKP1cJg9PYnWVRYtsGaVxvH0vzIOBPFkIjn5ZGU_MF5vnNw3uQA8zT3dMWBlDbmMvf3jRHk4m33GCky8)

### 4. 多智能体团队协作

![flowchart TD](https://mermaid.ink/img/eJxVkl1LAkEUhv_KsNdF9xFBapZld95NXky7p1zYD5s2IlyhiMy-aEuLyIiCpKA0jT5d0v8Szu72L2JnLPRmmJf3fc6cc5icJJsKSKPSomauyRlCLZSKzRsIITSBLSA6SpmmhoLGll--T6Ph4XEUybHDo-7XpV8780-reRGOhJa9AsurYFgq0WwUxd2P5-DmwNu9C8-iw47PxxboyHjQLrGd1nfhJLxsV9P9BbKEEk0DzUYxzD7f_nEO-vuP_sN-13XZ3s0AlVGBEipnVDl8eBIngShAESsWvJc2R1nNER2IcgO0AgvEAhvFMbu9QBNLYFgoqN8H9Vav3XaIbjeDp8Jgr2oWNNUAG01h73XTa7z4rQ5HfjYcr1Zle9fsPRxPQFG-vGmcAqLPEYMsAe2ViwlHiMl-Ee8XU39CyGkuE5g3HCeyZdJ1MWuxwtwWqzlilt4jCR6fEfGkaWZ5VqxjYKUzPDiLfbfkXV0GmxfMKfasWW4lcdAps8qV19zxNlwRS0tDkg5UJ6oijeYkKwN6-KkUWCSrmiXl87_fdQO-)

### 5. 记忆系统 ER 图

![erDiagram](https://mermaid.ink/img/eJyVVNGK2zAQ_BWh5yZOX_N29HwQWnJHGwoFg9hKa0dXa2WkdWjI5d-L7DSXxE5x_WDknZGlmR3pILU3KJcSw6OFKoArSAgh8vVmtfkhDv1XeiIHS5WwRrx8HlR536AoZIMhesqa4F9Rc6Y9aWw4K22NGXtfF3Iwk8DhoBhb5yDsB3UNjJW_BF6jJ-GQwQDDe9kSC-saHxhIp50tZh8Xi8vlDTCydSh0QGA0CngEbBtzBR4L6gdPD582k91BYst7ZY14GoLaEyPxVK24swZJX3hW1h44_abskV7tqNb0igyuuVHzNf_ysFk9rycriu3P1OE7kgLWwNaTOsXCYINkokrRgMDKl1kbMWa99TGbz-cjyfCjS_RqIwekirdDrXdMutvuswf593w9vaUnZW3EoEAnsV3AlYa6zqBCYmVQ25iAcXkGow62SVNvdt8l4jffVDtT0aguTBbjf7Q3f1l9e37Mp4uzXE84lN22fuFe4Q6J4w2QOm21beAKOu81ckpCGo6ASOYCetfRX0pvb7OZP_RHcCkKuYX4199rxjnWiXWK7ASm_wexT0liWdr5eodGWTpTTz4PuKmjYCkWUn6QDoMDa-TyIHmLLl2-Bktoa5bH4x-1kbX5)

### 6. MCP 市场集成流程

![flowchart TD](https://mermaid.ink/img/eJxNUs1O2zAcf5W_cl6TOwfQCF8tTVfR3kwPVuymAceuHHeMNd0N1LEJVQKhIlCRQLAjHHabtD6N0z7GFMeduFn-fVseOqEg1FlzukychD0sFbS3DjkAwEdU5anCjLWFYOBB6zhmzF5R2YFKZR02UTvGPBI8CrA8pspNKZZhr1M6bBqOP8y__9XjN_3zbGNUAn4BZHryksEWWs6v9d0sn9wvfj8u_lzls_vOe1Y-fc1gG0VU2Wxf8G4cWc62idhBRJxwJjABhaUbfbXojkF30fLXk778ocdv8M1zvwwwP4q9JOx7-fgmLValnhXsGsHeMPCbsJxP8-lrOXtVfM9UCvxmBlXE-wnEZSeoVPpSkEGoYsGtV9V41YrwfDaB0NRu06TPsKKWUzOcfRT4zQBzHFHpYkJaVH6msvM-0rTIoI70-a0-e4Za61MDikG2ACWrCXVjGSCjOKBRnCp56kpz-G-6b0iN1duPJ_riwUJBCTkfnITKBMfEWRs6qkeT4pcQ2sUDppzR6B8hBc-W)

## 工具矩阵

### 文件系统

| 工具 | 名称 | 说明 |
|------|------|------|
| `read_file` | ReadTool | 读取文件内容 |
| `write_file` | WriteTool | 写入新文件 |
| `edit_file` | EditTool | 编辑现有文件（搜索替换） |
| `multi_edit` | MultiEditTool | 批量编辑 |
| `glob` | GlobTool | Glob 模式查找文件 |
| `grep` | GrepTool | 正则搜索文件内容 |
| `list_directory` | LSTool | 列出目录 |
| `change_directory` | ChangeDirectoryTool | 切换工作目录 |
| `bash` | BashTool | 执行 Shell 命令 |

### 智能体编排

| 工具 | 名称 | 说明 |
|------|------|------|
| `task` | TaskTool | 创建子智能体执行任务（同步/异步，最多 5 层） |
| `agent_team` | TeamTool | 创建多智能体团队（5 种策略，最多 10 成员） |
| `match_agent` | MatchAgentTool | 语义向量匹配最佳智能体 |
| `list_agents` | ListAgentsTool | 列出可用智能体 |
| `list_scenes` | ListScenesTool | 列出可用场景 |
| `task_control` | TaskControlTool | 管理后台任务（状态/取消/列表） |
| `task_output` | TaskOutputTool | 查询后台任务结果 |

### 网络 & 搜索

| 工具 | 名称 | 说明 |
|------|------|------|
| `web_search` | EnhancedWebSearchTool | 统一搜索+抓取（Bing/百度/Google） |
| `install` | InstallTool | 搜索安装 MCP/Skills |

### 记忆 & 学习

| 工具 | 名称 | 说明 |
|------|------|------|
| `memory_search` | MemorySearchTool | 搜索持久记忆 |
| `memory_store` | MemoryStoreTool | 存储记忆 |
| `memory_graph` | MemoryGraphTool | 知识图谱查询 |
| `memory_stats` | MemoryStatsTool | 记忆统计 |
| `learn` | LearnTool | 学习新能力（搜索/生成 MCP/Skill） |

### 文档处理

| 工具 | 名称 | 说明 |
|------|------|------|
| `read_pdf` | PdfTool | 读取 PDF |
| `office_generate` | OfficeGenerateTool | 生成 Office 文档 |
| `xlsx_edit` | XlsxEditTool | 编辑 Excel |
| `docx_edit` | DocxEditTool | 编辑 Word |
| `notebook_edit` | NotebookEditTool | 编辑 Jupyter Notebook |

### 控制 & 交互

| 工具 | 名称 | 说明 |
|------|------|------|
| `ask_user` | AskUserTool | 向用户提问 |
| `plan_review` | PlanReviewTool | 提交计划审查 |
| `enter_plan_mode` | EnterPlanModeTool | 进入计划模式（只读） |
| `exit_plan_mode` | ExitPlanModeTool | 退出计划模式 |
| `schedule` | SchedulerTool | 定时任务管理 |
| `sleep` | SleepTool | 延迟执行 |
| `enter_worktree` | WorktreeTool | Git 工作区隔离 |

## 项目结构

```
xuanji/
├── src/
│   ├── index.ts                  # 库入口
│   ├── core/                     # 核心引擎
│   │   ├── agent/                # Agent 系统（循环/工厂/团队/注册表）
│   │   ├── chat/                 # ChatSession + SessionFactory (DI)
│   │   ├── config/               # 配置管理（多用户/验证/运行时）
│   │   ├── context/              # 代码上下文（扫描/索引/符号提取）
│   │   ├── di/                   # 依赖注入容器
│   │   ├── events/               # 事件总线（50+ 事件类型）
│   │   ├── logger/               # Pino 日志系统
│   │   ├── logging/              # 统一日志 + Loki 客户端
│   │   ├── memory/               # 记忆管理器（实体/关系/事件）
│   │   ├── providers/            # LLM 适配器（Anthropic/OpenAI/Llama）
│   │   ├── skills/               # 技能系统（注册表/加载器/安装器）
│   │   ├── state/                # 会话状态机
│   │   ├── stats/                # Token 统计/定价
│   │   ├── task/                 # 任务编排器（异步任务状态机）
│   │   ├── template/             # MCP 提示词模板
│   │   ├── templates/            # 智能体 + 提示词配置（YAML/JSON）
│   │   └── tools/                # 工具注册表 + 40+ 工具实现
│   ├── hooks/                    # 钩子系统（29 事件/3 处理器类型）
│   ├── infrastructure/           # EventBus + 中间件管道
│   ├── mcp/                      # MCP 系统
│   │   ├── market/               # 天工坊市场 + 安装器
│   │   ├── search/               # 多引擎搜索适配器
│   │   └── tools/                # WebSearchTool (旧版 API)
│   ├── permission/               # 双层权限系统
│   ├── session/                  # 会话持久化 + 摘要器
│   └── shared/                   # 共享类型/工具
├── desktop/                      # Electron 桌面应用
│   ├── main/                     # 主进程 + agent-bridge
│   ├── renderer/                 # React 前端
│   └── shared/                   # IPC 通道定义
├── docs/                         # 技术文档
├── test/                         # 单元测试 + 集成测试
└── scripts/                      # 构建/迁移脚本
```

## 设计模式

| 模式 | 应用位置 |
|------|----------|
| **依赖注入 (DI)** | `DependencyContainer` — 服务定位器，Singleton/Transient 生命周期 |
| **工厂方法** | `AgentFactory`、`MCPManager.createClient()`（按传输类型分派） |
| **ReAct 循环** | `AgentLoop` — 推理-行动迭代，含卡住检测 |
| **中间件管道** | `MiddlewarePipeline` — 工具执行切面（错误/日志/超时/权限） |
| **适配器模式** | Anthropic/OpenAI/Llama Provider、Bing/百度/Google 搜索适配器 |
| **策略模式** | 团队协作：sequential/parallel/hierarchical/debate/pipeline |
| **守卫模式** | `FileGuard`/`CommandGuard` — 工具输入风险分级 |
| **对象池** | `AgentPool`、`ProviderPool` — 实例缓存复用 |
| **事件驱动** | `EventBus` + `HookRegistry` — 模块解耦 |
| **观察者模式** | `AgentCallbacks` — 流式输出通知 |

## 配置层级

```
默认模板 (src/core/templates/*.yaml)
    ↓
用户配置 (~/.xuanji/users/{userId}/config.json)
    ↓
智能体覆盖 (~/.xuanji/agent-overrides/{agentId}.json5)
    ↓
环境变量 (XUANJI_*)
    ↓
项目配置 ({cwd}/.xuanji/config.json)
```

## 内置智能体

| 智能体 | 角色 | 说明 |
|--------|------|------|
| **xuanji** | 主智能体 | 唯一面向用户的智能体，40+ 工具，路由所有请求 |
| **scene-classifier** | 分类器 | 意图分析，将用户输入分类为场景+复杂度 |
| **memory-manager** | 记忆管理 | 分析对话，提取并维护长期记忆 |
| **context-compressor** | 压缩器 | 将长对话历史压缩为结构化摘要 |
| **software-engineer** | 工程师 | 代码编写与调试 |
| **product-manager** | 产品经理 | 需求分析与产品规划 |
| **ui-designer** | 设计师 | UI/UX 设计 |
| **stock-analyst** | 分析师 | 股票市场分析 |

## 技术栈

| 层级 | 技术 |
|------|------|
| **语言** | TypeScript 5.7+ (ESM, ES2022) |
| **运行时** | Node.js 20+ |
| **LLM SDK** | @anthropic-ai/sdk, openai, node-llama-cpp |
| **数据库** | better-sqlite3 (权限决策/记忆) |
| **桌面** | Electron 40+, React 18, TailwindCSS, shadcn/ui |
| **构建** | tsup, Vite, electron-builder |
| **测试** | Vitest, 80% 覆盖率目标 |
| **日志** | Pino (JSONL) + Grafana Loki |
| **代码分析** | tree-sitter (TS/Python/Java) |

## 开发指南

```bash
# 安装依赖
npm install

# 类型检查
npm run typecheck

# Lint
npm run lint

# 运行测试
npm test                 # 全部测试
npm run test:unit        # 单元测试
npm run test:watch       # 监听模式

# 构建
npm run build            # 构建核心库
npm run build:src        # 仅构建 TypeScript
```

## 许可证

MIT License — 详见 [LICENSE](LICENSE)
