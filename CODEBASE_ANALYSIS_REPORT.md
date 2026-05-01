# 璇玑 (Xuanji) 代码库全面分析报告

> **分析日期**: 2025-07-20  
> **版本**: v0.9.0  
> **项目**: Shibit Xuanji · 璇玑 — 开源 AI 编程助手  
> **技术栈**: TypeScript 5.7 + Ink 5 (React 18) + Node.js ≥ 20

---

## 目录

1. [模块结构分析](#1-模块结构分析)
2. [架构模式分析](#2-架构模式分析)
3. [依赖关系分析](#3-依赖关系分析)
4. [代码质量评估](#4-代码质量评估)
5. [综合评估与建议](#5-综合评估与建议)

---

## 1. 模块结构分析

### 1.1 总体布局

项目采用 **分层架构**，共 99 个文件、296 个符号，按职责划分为 5 个层次：

```
┌─────────────────────────────────────────────────────────┐
│                      适配层 (adapters/)                   │
│            CLI (Ink/React)  │  IM (钉钉/飞书/企微)        │
│                         │  Electron GUI                   │
├─────────────────────────────────────────────────────────┤
│                      业务核心层 (core/)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │  Agent   │ │  Chat    │ │  Tools   │ │  Providers  │ │
│  │  ReAct   │ │  Session │ │  30+ 工具 │ │  LLM 适配  │ │
│  │  循环    │ │  管理    │ │  中间件链  │ │  工厂模式  │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │  Config  │ │  Prompt  │ │  Intent  │ │   Skills    │ │
│  │  分层配置 │ │  分层构建 │ │  意图路由 │ │  技能系统  │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │
├─────────────────────────────────────────────────────────┤
│                    专业功能层                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Permission│ │ Session  │ │  Hook    │ │    MCP      │ │
│  │  双层防护 │ │  持久化  │ │  事件钩子 │ │ 协议支持    │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Context  │ │ Embedding│ │ Reminder │ │  Tiangong   │ │
│  │  上下文   │ │  向量化  │ │  提醒引擎 │ │  天工坊     │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │
├─────────────────────────────────────────────────────────┤
│                    基础设施层 (infrastructure/)           │
│  Storage  │  Config  │  Messaging  │  Middleware         │
│  SQLite   │  多源配置 │  事件总线   │  管道模式           │
├─────────────────────────────────────────────────────────┤
│                    共享层 (shared/)                       │
│  Types (agent/tools/provider/config/pricing)  │  Utils  │
└─────────────────────────────────────────────────────────┘
```

### 1.2 模块详细分析

#### 🔌 适配层 (`adapters/`)
| 模块 | 职责 | 关键文件 | 评估 |
|------|------|----------|------|
| **CLI** | 终端交互 (Ink/React) | `App.tsx`, `StartupLogo.tsx`, `ConfigManager.ts` | 核心入口，包含 Ink 渲染、交互模式、非交互模式 |
| **IM** | IM 机器人适配 | `DingtalkBot.ts`, `FeishuBot.ts`, `WecomBot.ts` | 多平台支持，WebSocket 流式通信 |

**设计亮点**：适配层与核心层完全解耦，通过 `ChatSession` 接口交互。IM 机器人支持优雅退出（SIGINT/SIGTERM）。

#### 🧠 核心层 (`core/`)

##### Agent 循环 (`core/agent/`)
这是项目的心脏，采用 **ReAct (Reasoning + Acting)** 模式：

```
┌──────────────────────────────────────────────────────┐
│                    AgentLoop.run()                     │
│                                                       │
│  1. injectTodoContextHint()   注入任务状态提示         │
│  2. messageManager.build()    构建消息数组             │
│  3. ★ 循环开始                                      │
│  4.   └─ messagePreparationHandler  处理追加消息       │
│  5.   └─ messageContextHandler      上下文压缩检查     │
│  6.   └─ streamRetryHandler         调用 LLM (流式)   │
│  7.   └─ resultProcessor            结果处理           │
│  8.   └─ toolExecutionCoordinator   执行工具调用       │
│  9.   └─ 回到 4 (直到 end_turn)                      │
│ 10. sessionRecorder.record()   记录审计日志            │
└──────────────────────────────────────────────────────┘
```

**关键组件** (14 个文件)：

| 组件 | 职责 | 设计模式 |
|------|------|----------|
| `AgentLoop` | 主循环编排 (982 行) | Template Method + Strategy |
| `MessageManager` | 消息历史管理、快照/回滚 | Memento |
| `StreamProcessor` | 流式响应解析 | Observer (事件回调) |
| `StreamRetryHandler` | API 重试 + 中断处理 | Retry Pattern |
| `ToolDispatcher` | 工具执行分发 | Command |
| `ToolExecutionCoordinator` | 工具协调 + Hook 集成 | Mediator |
| `ContextCompressor` | 语义压缩 (保持上下文) | Strategy |
| `TokenManager` | Token 计数与管理 | Singleton |
| `ErrorRecovery` | 错误恢复策略 | Chain of Responsibility |
| `MessagePreparationHandler` | 消息追加/延迟 | Pipeline |
| `MessageContextHandler` | 上下文预处理 | Adapter |
| `ResultProcessor` | LLM 响应结果处理 | Strategy |

**调度系统** (`dispatch/`)：`MainAgent` 通过 system prompt 描述调度策略，使用 `agent_team`/`task` 工具委派子 Agent。引入了 `IntentClassifier` 进行意图预分析。

**团队协作** (`team/`)：`TeamManager` 支持 parallel/serial/debate 三种策略的多 Agent 协作。

**子代理**：`SubAgentFactory` 创建隔离的子 Agent 实例，支持 `stream_to_user` 直通输出。

##### 聊天系统 (`core/chat/`)

```
SessionFactory.create()
  ├── 1. ConfigLoader.load()          加载多层配置
  ├── 2. SessionManager               会话持久化
  ├── 3. HookRegistry                 事件钩子
  ├── 4. ProviderManager.getProvider() LLM Provider
  ├── 5. createDefaultRegistry()      工具注册表
  ├── 6. PermissionController         权限控制
  ├── 7. AgentRegistry                预置 Agent 注册
  ├── 8. PromptComponentRegistry      Prompt 组件
  ├── 9. LayeredPromptBuilder         分层 Prompt 构建
  ├── 10. IntentAnalyzer              意图分析 (Embedding)
  ├── 11. registerAdvancedTools()     注册高级工具
  ├── 12. MainAgent                   主调度 Agent
  └── 13. ChatSession                 会话封装
```

这是一个 **13 步的初始化流程**，通过 DI 容器管理依赖。

##### 工具系统 (`core/tools/`) — 30+ 工具

工具系统采用 **中间件管道 (Middleware Pipeline)** 架构：

```
ToolRegistry.execute()
  │
  ├── ErrorHandlingMiddleware    捕获未处理异常
  ├── LoggingMiddleware          记录执行日志
  ├── TimeoutMiddleware          超时控制 (可配置)
  ├── AbortCheckMiddleware       中止检查
  ├── PlanModeMiddleware         Plan 模式拦截写操作
  ├── PermissionMiddleware       权限检查
  └── Tool.execute()             实际工具执行
```

**工具分类**：

| 类别 | 工具 | 数量 |
|------|------|------|
| 文件操作 | `read_file`, `write_file`, `edit_file`, `multi_edit`, `notebook_edit` | 5 |
| 搜索 | `glob`, `grep` | 2 |
| 系统 | `bash`, `change_directory`, `ls`, `task_output` | 4 |
| Agent 管理 | `task`, `agent_team`, `match_agent`, `list_agents`, `list_scenes` | 5 |
| 计划/确认 | `plan_review`, `ask_user`, `enter_plan_mode`, `exit_plan_mode` | 4 |
| 任务管理 | `todo_create`, `todo_list`, `todo_update`, `todo_archive`, `todo_clear` | 5 |
| 其他 | `web_fetch`, `sleep`, `worktree`, `reminder_set`, `reminder_check` | 5 |

#### 🔐 权限系统 (`permission/`)

**双层防护设计**：

```
第 1 层: LLM 主动审查
  ├── safe/warn 级别: 完全信任模型判断
  └── 通过 plan_review 工具触发用户审查

第 2 层: 硬编码安全兜底
  ├── danger 级别 (rm -rf /, 写系统文件): 强制用户确认
  └── 模型无法绕过此检查 (防 prompt injection)
```

**决策流程** (PermissionController, 886 行)：

```
check()
  │
  ├── 第 0 步: 检查操作黑名单 (DeniedOperation)
  ├── 第 0.5 步: 检查当前意图拒绝列表
  ├── 第 1 步: FileGuard/CommandGuard 风险评估
  ├── 第 1.5 步: PolicyEngine 检查 (always/never)
  │
  ├── safe + fileRead        → 自动放行
  ├── safe + fileWrite       → 根据 confirmWrite 配置
  ├── safe + bash            → 自动放行
  ├── warn                   → 根据 warnLevel 配置
  └── danger                 → 强制确认
       │
       ├── 会话缓存 (decisionCache)
       ├── 持久化缓存 (DecisionStore/SQLite)
       └── UI 确认 (confirmationHandler)
```

**安全特性**：
- 敏感目录保护 (`/etc`, `/usr`, `~/.ssh`, `~/.aws` 等)
- 意图级拒绝追踪 (同一意图下拒绝写操作 → 阻止所有写尝试)
- 确认队列 (保证同一时刻只有一个确认框)
- 审计日志 (PermissionAudit)

### 1.3 模块层次关系图

```
                    ┌──────────────────┐
                    │   src/index.ts   │  ← 主入口 (554 行)
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ CLI Mode │  │ Bot Mode │  │ GUI Mode │
        └────┬─────┘  └────┬─────┘  └────┬─────┘
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                   ┌─────────────────┐
                   │  SessionFactory  │  ← 工厂 (251 行)
                   └────────┬────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌────────────┐
        │  Config   │ │    DI    │ │  Provider  │
        │  Loader   │ │ Container│ │  Manager   │
        └──────────┘ └────┬─────┘ └────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ MainAgent│ │  Tools   │ │Permission│
        │ (调度)   │ │ Registry │ │Controller│
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
             ▼             ▼             ▼
        ┌──────────────────────────────────┐
        │          AgentLoop               │
        │   (ReAct 推理循环核心)           │
        └──────────────────────────────────┘
```

### 1.4 模块划分合理性评估

| 方面 | 评分 | 说明 |
|------|------|------|
| 职责单一 | ⭐⭐⭐⭐ | 每个模块职责清晰，如 `permission/` 专注权限、`session/` 专注持久化 |
| 接口抽象 | ⭐⭐⭐⭐ | 通过 `shared/types` 定义公共接口，DI 容器管理依赖 |
| 扩展性 | ⭐⭐⭐⭐⭐ | 工具系统通过注册机制扩展，Provider 通过工厂模式扩展 |
| 目录一致性 | ⭐⭐⭐ | `core/logger/` 和 `core/logging/` 并存略有混淆；`core/template/` 和 `core/templates/` 已废弃 |

**注意**：
- `core/logger/` 和 `core/logging/` 是两个不同模块：前者是内部日志框架，后者是 Agent 执行日志（`AgentLoopLogger`）
- `core/agent/dispatch/` 和 `core/agent/team/` 各有用处：dispatch 处理意图分类，team 处理多 Agent 协作
- 存在部分未完成模块：`core/butler/` (管家)，`core/templates/` (模板)

---

## 2. 架构模式分析

### 2.1 整体架构模式

Xuanji 采用 **分层 + 微核 + 插件** 的混合架构：

```
┌─────────────────────────────────────────────────────┐
│                    插件层                            │
│   Skills  │  MCP  │  Hooks  │  Tiangong            │
│   (可插拔) │ (协议) │ (钩子)  │ (注册表)             │
├─────────────────────────────────────────────────────┤
│                    业务层                            │
│   Agent  │  Tools  │  Permission  │  Chat          │
├─────────────────────────────────────────────────────┤
│                    内核层                            │
│   DI  │  Config  │  Logger  │  Middleware  │  Types │
├─────────────────────────────────────────────────────┤
│                    基础设施层                         │
│   Storage (SQLite) │ Messaging (EventBus)            │
└─────────────────────────────────────────────────────┘
```

**各模式体现**：

| 模式 | 体现位置 | 说明 |
|------|----------|------|
| **分层架构** | modules 整体 | 严格分层：共享层 → 基础设施 → 核心 → 适配 |
| **微核架构** | core/agent/ + DI | AgentLoop 是内核，工具/Provider 通过注册扩展 |
| **插件架构** | Skills, Hooks, MCP | 可动态加载/卸载的扩展能力 |
| **管道模式** | ToolRegistry middleware | 工具执行链：Error→Log→Timeout→Abort→Plan→Permission→Execute |
| **工厂模式** | SessionFactory, ProviderFactory | 复杂对象创建 |
| **观察者模式** | StreamProcessor, EventBus | 流事件处理和消息传递 |
| **策略模式** | ContextCompressor, TeamManager | 不同压缩/协作策略可替换 |
| **Memento 模式** | MessageManager.snapshot | 消息历史快照/回滚 |
| **模板方法** | BaseTool, AgentLoop | 定义骨架，子类实现细节 |

### 2.2 依赖注入 (DI) 分析

`DependencyContainer` (140 行) 是一个轻量级 DI 容器：

```typescript
// 特性
- 生命周期: singleton | transient
- 工厂函数 + 实例注册
- 循环依赖检测 (resolving Set)
- 同步/异步解析
- 服务注册检查

// 典型使用 (SessionFactory)
this.container.registerSingleton('config', config);
this.container.register('provider', async () => { ... });
this.container.register('toolRegistry', () => createDefaultRegistry());
```

**评估**：
- ✅ 简洁实用，无框架依赖
- ✅ 循环依赖检测（使用 `resolving` Set）
- ⚠️ 无装饰器支持，注册代码较冗长
- ⚠️ 无生命周期钩子（onInit/onDestroy）
- ⚠️ `resolveSync` 只能解析已缓存的单例，调用方需要确保初始化顺序

### 2.3 Agent 循环设计深度分析

`AgentLoop` 是架构核心（982 行），设计精良：

**关键设计决策**：

1. **流式优先**：所有 LLM 调用使用 Streaming API，通过 `StreamProcessor` 实时推送文本/思考/工具调用事件
2. **中断机制**：支持 `interrupt()`（强制中断）和 `appendMessage()`（温和追加），类似 Claude Code 的 Boundary-Aware Queuing
3. **级联中止**：通过全局 `AbortController` + `AbortSignal` 级联终止所有子任务、子 Agent、Bash 进程
4. **快照回滚**：API 调用前保存消息快照，失败时回滚，防止上下文污染
5. **上下文压缩**：通过语义压缩保持对话在 token 限制内
6. **扩展思考**：支持 Anthropic Extended Thinking (Claude 4.5+)

**辅助模块拆分**（6 个 Handler）：
- `MessagePreparationHandler` — 处理用户消息追加/延迟
- `MessageContextHandler` — 上下文预处理
- `StreamRetryHandler` — 流式调用重试
- `ResultProcessor` — LLM 响应处理
- `ToolExecutionCoordinator` — 工具执行协调
- `AgentLoopLogger` — 执行日志（可独立开关）

这种拆分避免了 AgentLoop 成为 God Object，每个 Handler 职责单一，可独立测试。

---

## 3. 依赖关系分析

### 3.1 核心模块识别（按被依赖次数）

| 模块 | 被依赖次数 | 角色 |
|------|-----------|------|
| `shared/types` | ~50+ | **全局类型基础** |
| `core/logger` | ~40+ | **日志基础设施** |
| `core/types` → `shared/types` | ~30+ | 类型兼容层 |
| `core/tools` | ~15+ | 工具系统 |
| `core/agent` | ~12+ | Agent 核心 |
| `permission` | ~10+ | 权限控制 |
| `infrastructure/middleware` | ~8+ | 中间件框架 |
| `core/config` | ~8+ | 配置管理 |
| `core/providers` | ~6+ | LLM Provider |
| `hooks` | ~5+ | 钩子系统 |
| `core/i18n` | ~4+ | 国际化 |

### 3.2 依赖图 (核心依赖链)

```
shared/types          ← 零依赖，被所有模块依赖
    ↑
core/types            ← 兼容层，re-export shared/types
    ↑
core/logger           ← 仅依赖 shared/types
    ↑
infrastructure/middleware  ← 依赖 shared/types
    ↑
core/tools/ToolRegistry    ← 依赖 middleware + permission types
    ↑
core/agent/AgentLoop       ← 依赖 tools + providers + telemetry + logger
    ↑
core/agent/dispatch/MainAgent  ← 依赖 AgentLoop + IntentClassifier
    ↑
core/chat/ChatSession          ← 依赖 MainAgent + DI Container
    ↑
core/chat/SessionFactory       ← 依赖所有核心模块 (工厂/编排)
    ↑
src/index.ts                   ← 依赖 ChatSession + adapters
```

### 3.3 耦合度评估

| 依赖关系 | 耦合类型 | 评估 |
|----------|----------|------|
| `shared/types` → 全局 | 无耦合 | ✅ 纯类型定义，零运行时依赖 |
| `core/types → shared/types` | 兼容层 | ✅ 简单的 re-export |
| `AgentLoop → tools/providers` | 接口依赖 | ✅ 通过 `IToolRegistry`/`ILLMProvider` 接口 |
| `SessionFactory → 所有核心` | 编排依赖 | ⚠️ 承担了太多初始化职责 (13 步) |
| `PermissionController → FileGuard/CommandGuard` | 组合 | ✅ 清晰的内部组合 |
| `ToolRegistry → PermissionMiddleware` | 中间件依赖 | ✅ 通过管道模式解耦 |
| `MainAgent → AgentLoop` | 组合/代理 | ✅ 清晰的代理模式 |

### 3.4 循环依赖风险

**检查结果**：**无循环依赖** ✅

DI 容器内置了循环依赖检测（`resolving` Set），`SessionFactory.create()` 的 13 步初始化是单向依赖链：

```
Config → Provider → ToolRegistry → PermissionController → AgentRegistry → 
PromptRegistry → LayeredPromptBuilder → IntentAnalyzer → MainAgent → ChatSession
```

**潜在风险**：
1. `SessionFactory` 过于重量级（251 行），承担过多初始化逻辑
2. `AgentLoop` 的构造函数创建了 13 个辅助对象，耦合较紧（但通过构造函数注入而非硬编码）
3. 部分模块使用 `await import()` 动态导入避免循环引用（如 `AgentRegistry`, `PromptComponentRegistry`）

---

## 4. 代码质量评估

### 4.1 入口设计 (`src/index.ts`, 554 行)

| 方面 | 评分 | 说明 |
|------|------|------|
| 功能覆盖 | ⭐⭐⭐⭐⭐ | CLI/Bot/GUI 三种模式 + 守护进程 |
| 参数解析 | ⭐⭐⭐ | 手写 switch-case，未使用 commander/yargs |
| 错误处理 | ⭐⭐⭐⭐ | 各模式独立 try-catch，优雅退出监听 |
| 代码组织 | ⭐⭐⭐ | `main()` 函数偏长 (~200 行)，内联回调较多 |
| 完成度 | ⭐⭐⭐ | **大量 TODO 标记**（模型切换、记忆查询、会话保存/恢复、检查点等） |

**关键观察**：入口文件中有大量回调处理器返回占位符：

```typescript
// 许多功能标记为 TODO 或返回占位符
onMemoryQuery: async (query?: string) => {
  return '❌ 记忆系统已移除';
},
onAgentQuery: async (_args: string) => {
  return '❌ /agent 命令已移除\n提示: Agent 管理已迁移到配置文件 (.xuanji/agents/*.json5)';
},
// 会话持久化回调全部返回 TODO 占位
onSessionSave: async (...) => { /* TODO */ return 'session-id'; },
onSessionResume: async (...) => { /* TODO */ return { ... }; },
```

这表明：
- 记忆系统 (Memory) 已被移除
- Agent 管理从运行时迁移到配置文件
- 会话持久化功能开发中
- 模板系统未启用
- 许多 UI 交互功能待实现

### 4.2 类型定义完整性 (`shared/types/`)

| 文件 | 类型数 | 质量评估 |
|------|--------|----------|
| `agent.ts` | 15 个类型/接口 | ⭐⭐⭐⭐⭐ 完整清晰 |
| `tools.ts` | 7 个类型/接口 | ⭐⭐⭐⭐ |
| `provider.ts` | 7 个类型/接口 | ⭐⭐⭐⭐ |
| `config.ts` | 30+ 个类型/接口 | ⭐⭐⭐⭐⭐ 非常详细 |
| `pricing.ts` | 4 个类型/接口 | ⭐⭐⭐⭐ |

**评估**：
- ✅ 类型定义非常完整，`AppConfig` 包含 25+ 个配置字段
- ✅ 使用 `|` 联合类型表达状态 (如 `PermissionLevel`, `AgentStatus`)
- ✅ 有 `@deprecated` 标记向后兼容字段
- ⚠️ 存在 `any` 类型 (`butler?: any`, `hooks?: Record<string, any>`)
- ⚠️ 部分类型被注释掉 (`// import('@/butler/types').ButlerConfig`)

### 4.3 PermissionController 质量分析 (886 行)

**优点**：
- ✅ **双层防护设计**：LLM 主动审查 + 硬编码安全兜底，设计理念先进
- ✅ **四级缓存**：会话缓存 → 持久化缓存 → UI 确认 → 拒绝记录
- ✅ **并发安全**：确认队列 (`confirmationQueue`) 保证同一时刻只有一个确认框
- ✅ **意图级拒绝**：同一意图下拒绝某类操作后，自动阻止所有同类尝试
- ✅ **审计完整**：每个决策记录到 `PermissionAudit`
- ✅ **国际化**：使用 `t()` 函数输出用户可见文本

**改进空间**：
- ⚠️ 886 行偏长，可考虑拆分为多个策略类
- ⚠️ `check()` 方法有 200+ 行的决策分支，复杂度较高
- ⚠️ 缓存 key 生成逻辑 (`guardResult.cacheKey`) 在 `FileGuard`/`CommandGuard` 中，不同 Guard 可能产生冲突
- ⚠️ `setIgnoreFilter` 使用 `as any` 传递给 `FileGuard`

### 4.4 错误处理评估

| 模块 | 错误处理方式 | 评估 |
|------|-------------|------|
| `AgentLoop` | try-catch + 快照回滚 + `ErrorRecovery` | ⭐⭐⭐⭐⭐ |
| `StreamRetryHandler` | 指数退避 + max_tokens 自动重试 | ⭐⭐⭐⭐⭐ |
| `ToolRegistry` | `ErrorHandlingMiddleware` 统一捕获 | ⭐⭐⭐⭐⭐ |
| `SessionFactory` | 每步 try-catch + 降级策略 | ⭐⭐⭐⭐ |
| `PermissionController` | handler 异常 → 自动拒绝 | ⭐⭐⭐⭐ |
| `src/index.ts` | `main().catch()` 顶层兜底 | ⭐⭐⭐⭐ |

**亮点**：
- `AgentLoop` 在 API 调用前保存 `messageSnapshot`，失败时回滚，防止上下文不一致
- `StreamRetryHandler` 对 `max_tokens` 错误自动调整参数重试
- `ToolRegistry` 的中间件管道统一处理所有工具执行的错误、日志、超时

### 4.5 代码规范评估

| 规范项 | 遵守情况 | 说明 |
|--------|----------|------|
| 文件头注释 | ✅ 90% | 大部分文件有 `// === 模块名 — 描述 ===` 头部 |
| TypeScript 严格模式 | ✅ | `tsc --noEmit` 在 scripts 中 |
| 命名规范 | ✅ | PascalCase 类/组件, camelCase 函数, UPPER_SNAKE_CASE 常量 |
| 代码注释 | ⭐⭐⭐ | 注释偏少，关键算法缺乏文档 |
| Magic Number | ⚠️ | 存在硬编码（如 `MAX_DECISION_CACHE = 500`），但有常量定义 |
| 异步处理 | ✅ | 所有 async 函数有 try-catch |
| 类型安全 | ⭐⭐⭐⭐ | 少量 `as any` 绕过类型检查 |

### 4.6 测试覆盖

```
src/core/stats/__tests__/TokenStatsCollector.test.ts  ← 唯一发现的测试文件
```

测试覆盖率似乎较低，核心模块 (AgentLoop, PermissionController, ToolRegistry) 未发现测试文件。

### 4.7 依赖管理

**生产依赖分析**：
| 依赖 | 用途 | 必要性 |
|------|------|--------|
| `@anthropic-ai/sdk` | Anthropic Claude API | 核心 |
| `openai` | OpenAI API | 核心 |
| `ink` + `react` | CLI UI 渲染 | 核心 |
| `better-sqlite3` | 持久化存储 | 重要 |
| `fast-glob` / `ignore` | 文件搜索 | 重要 |
| `node-llama-cpp` | 本地 LLM | 可选 |
| `tree-sitter-*` | 代码解析 | 上下文引擎 |
| `ws` | WebSocket | IM 机器人 |
| `jsdom` + `@mozilla/readability` | 网页解析 | WebFetch 工具 |
| `consola` + `debug` | 日志 | 基础设施 |

无冗余依赖，每个依赖都有明确用途。

---

## 5. 综合评估与建议

### 5.1 总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | ⭐⭐⭐⭐⭐ | 分层清晰，模式运用恰当，可扩展性强 |
| 代码质量 | ⭐⭐⭐⭐ | 类型定义完整，错误处理到位，部分 TODO 待完成 |
| 模块划分 | ⭐⭐⭐⭐ | 职责单一，接口抽象好，部分模块可进一步细化 |
| 安全性 | ⭐⭐⭐⭐⭐ | 双层防护，意图级拒绝，敏感路径保护 |
| 可维护性 | ⭐⭐⭐⭐ | DI 容器 + 接口抽象，但仍存在 God Object 倾向 |
| 测试覆盖 | ⭐⭐ | 测试文件较少，核心路径缺少测试 |
| 文档 | ⭐⭐⭐ | 代码注释适中，缺少模块级架构文档 |
| 完成度 | ⭐⭐⭐ | 核心流程完整，UI 交互/会话持久化部分 TODO |

### 5.2 主要发现

#### 优势
1. **AgentLoop 设计精良**：14 个辅助模块拆分，流式优先，中断/追加双模式，快照回滚
2. **权限系统成熟**：双层防护 + 四级缓存 + 意图级拒绝，安全性高
3. **工具中间件管道**：可组合的横切关注点处理，PlanModeMiddleware 巧妙
4. **配置类型完整**：AppConfig 包含 25+ 个配置项，每个都有详细类型
5. **多入口支持**：CLI/Bot/GUI 三种模式通过同一 SessionFactory 创建

#### 待改进
1. **SessionFactory 过于重量级**：13 步初始化，可考虑 Builder 模式或模块化初始化
2. **TODO 标记过多**：入口文件有 ~15 个 TODO，会话持久化/记忆系统/模型切换等核心功能待实现
3. **权限检查器过于复杂**：`PermissionController.check()` 长方法可拆分
4. **缺少测试**：核心模块缺少单元测试
5. **AgentLoop 构造函数臃肿**：创建 13 个辅助对象，可考虑工厂模式
6. **`core/logger` vs `core/logging`**：两个日志模块的职责边界不够清晰

### 5.3 改进建议

#### 短期 (P0)
1. **补全 TODO 功能**：会话持久化 (save/resume/list/delete)、检查点 (create/rewind)
2. **添加核心测试**：AgentLoop、PermissionController、ToolRegistry 的单元测试
3. **拆分 PermissionController.check()**：将 safe/warn/danger 分支提取为独立方法

#### 中期 (P1)
1. **SessionFactory 重构**：提取 `SessionBuilder`，将 13 步分解为可选的构建步骤
2. **AgentLoop 构造工厂**：`AgentLoopFactory` 封装 13 个辅助对象的创建
3. **统一 logger/logging**：合并或明确区分两个日志模块
4. **补充 API 文档**：为关键接口 (AgentCallbacks, IToolRegistry, IPermissionController) 添加 JSDoc

#### 长期 (P2)
1. **插件市场对接**：完善 Tiangong (天工坊) 模块，实现 Skill/MCP 的一键安装
2. **性能优化**：AgentLoop 中考虑增量 token 计数、工具结果缓存
3. **可观测性**：集成 OpenTelemetry，替换自研 telemetry 模块

### 5.4 技术债务清单

| 项目 | 位置 | 优先级 |
|------|------|--------|
| 会话持久化回调 TODO | `src/index.ts:480-511` | 🔴 高 |
| 检查点回调 TODO | `src/index.ts:500-511` | 🔴 高 |
| 记忆系统已移除但引用仍在 | `src/index.ts:470-473` | 🟡 中 |
| 模型切换未实现 | `src/index.ts:465-468` | 🟡 中 |
| 模板系统未启用 | `src/index.ts:475-478` | 🟢 低 |
| `as any` 类型绕过 | `PermissionController.ts:115,120` | 🟡 中 |
| 退出清理逻辑 TODO | `src/index.ts:383` | 🟡 中 |
| MemoryUpdateTool/MemoryDeleteTool 注释 | `ToolRegistry.ts:350-352` | 🟢 低 |
| `hooks` 配置用 `Record<string, any>` | `config.ts:218` | 🟢 低 |

---

> **报告生成**: AI 代码分析助手  
> **分析范围**: 99 个文件，296 个符号，10+ 核心模块  
> **分析方法**: 静态代码审查 + 架构模式分析 + 依赖关系图重建
