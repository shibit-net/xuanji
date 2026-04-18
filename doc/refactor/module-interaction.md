# 璇玑架构 — 模块交互与职责

## 架构概览

璇玑采用分层架构设计，从下到上分为：

```
┌─────────────────────────────────────────────────────────────┐
│                    Adapters Layer (适配器层)                  │
│  CLI (Ink) │ IM Bots (钉钉/企微/飞书) │ Electron Desktop      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Application Layer (应用层)                   │
│  ChatSession │ SkillRouter │ PromptOrchestrator │ Lifecycle │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Domain Layer (领域层)                      │
│  AgentLoop │ ToolRegistry │ MemoryManager │ PermissionCtrl  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                Infrastructure Layer (基础设施层)               │
│  EventBus │ MessageBus │ MiddlewarePipeline │ Storage       │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块职责

### 1. Infrastructure Layer (基础设施层)

#### EventBus (`src/infrastructure/messaging/EventBus.ts`)
- **职责**: 类型安全的事件发布/订阅系统
- **用途**: 解耦模块间的通知机制（如权限审计、状态变更）
- **特性**: 
  - 泛型事件类型约束
  - 支持异步事件处理
  - 错误隔离（单个订阅者失败不影响其他订阅者）

#### MessageBus (`src/infrastructure/messaging/MessageBus.ts`)
- **职责**: 消息总线，支持请求/响应模式
- **用途**: 模块间的同步通信（如查询、命令）
- **特性**: Promise-based，支持超时控制

#### MiddlewarePipeline (`src/infrastructure/middleware/MiddlewarePipeline.ts`)
- **职责**: Koa 风格的洋葱模型中间件管道
- **用途**: 横切关注点（日志、超时、权限、错误处理）
- **内置中间件**:
  - `ErrorHandlingMiddleware` — 统一错误捕获
  - `LoggingMiddleware` — 执行日志记录
  - `TimeoutMiddleware` — 超时控制
  - `PermissionMiddleware` — 权限检查
  - `RetryMiddleware` — 失败重试
  - `CacheMiddleware` — 结果缓存

#### Storage (`src/infrastructure/storage/`)
- **职责**: 统一存储抽象层
- **实现**: 
  - `JsonStorage` — JSON 文件存储
  - `SqliteStorage` — SQLite 数据库存储
- **用途**: 配置、会话、决策持久化

---

### 2. Domain Layer (领域层)

#### AgentLoop (`src/core/agent/AgentLoop.ts`)
- **职责**: ReAct 主循环，驱动 AI 推理和工具执行
- **核心流程**:
  1. 构建消息上下文（System Prompt + 历史消息）
  2. 流式调用 LLM（通过 ProviderManager）
  3. 解析工具调用请求
  4. 委托 ToolRegistry 执行工具
  5. 将工具结果追加到消息历史
  6. 循环直到 LLM 输出最终回复或达到最大迭代次数
- **依赖**:
  - `ToolRegistry` — 工具执行
  - `MessageManager` — 消息管理
  - `ProviderManager` — LLM 调用
  - `PermissionController` — 权限检查（通过 ToolRegistry）

#### ToolRegistry (`src/core/tools/ToolRegistry.ts`)
- **职责**: 工具注册表，管理所有工具的注册、发现和执行
- **核心特性**:
  - 使用 `MiddlewarePipeline` 处理横切逻辑（权限、超时、Plan Mode 拦截）
  - 支持 Plan Mode（只读模式，拦截写操作）
  - 工具克隆（为子代理创建受限工具集）
- **中间件链**:
  ```
  ErrorHandling → Logging → Timeout → AbortCheck → PlanMode → Permission → Tool.execute()
  ```
- **依赖**:
  - `PermissionController` — 权限检查（通过 PermissionMiddleware）
  - 各种 Tool 实现（ReadTool, WriteTool, BashTool 等）

#### PermissionController (`src/permission/PermissionController.ts`)
- **职责**: 权限决策核心，双层防护设计
- **决策流程**:
  1. 守卫层评估风险级别（FileGuard / CommandGuard）
  2. 意图过滤（阻止同一意图下的重复尝试）
  3. 分流决策：
     - `safe` → 自动放行
     - `warn` → 根据配置决定（ask / auto-allow）
     - `danger` → 强制用户确认
  4. 缓存层（会话缓存 + 持久化缓存）
  5. 用户确认（通过 ConfirmationHandler）
- **事件发布**:
  - `permission:checked` — 权限检查完成
  - `plan:reviewed` — 计划审查完成
- **依赖**:
  - `EventBus` — 发布权限事件（解耦审计逻辑）
  - `DecisionStore` — 持久化决策存储
  - `PolicyEngine` — 策略引擎

#### MemoryManager (`src/memory/MemoryStore.ts`)
- **职责**: 分层记忆管理（短期对话 + 长期索引 + 项目知识）
- **存储层次**:
  - 短期记忆：当前会话的消息历史
  - 长期记忆：跨会话的用户偏好、项目知识
  - 项目记忆：代码索引、符号表、依赖关系
- **依赖**:
  - `EmbeddingService` — 向量化服务（语义检索）
  - `Storage` — 持久化存储

---

### 3. Application Layer (应用层)

#### ChatSession (`src/core/chat/ChatSession.ts`)
- **职责**: 会话管理器，协调所有子系统
- **核心功能**:
  - 初始化所有依赖（通过 SessionInitializer）
  - 管理 AgentLoop 生命周期
  - 提供统一的会话接口（run, stop, saveSession, resumeSession）
- **依赖注入**:
  - `AgentLoop` — 主循环
  - `ToolRegistry` — 工具系统
  - `PermissionController` — 权限系统
  - `MemoryManager` — 记忆系统
  - `SkillRouter` — Skill 路由
  - `PromptOrchestrator` — Prompt 编排
  - `TurnLifecycleManager` — 轮次生命周期

#### SkillRouter (`src/core/chat/SkillRouter.ts`)
- **职责**: Skill 路由和执行
- **流程**:
  1. 意图识别（判断用户输入是否匹配 Skill）
  2. Skill 执行（调用对应的 Skill 实现）
  3. 返回执行结果
- **依赖**:
  - `SkillRegistry` — Skill 注册表
  - `IntentRouter` — 意图识别

#### PromptOrchestrator (`src/core/chat/PromptOrchestrator.ts`)
- **职责**: System Prompt 编排
- **核心功能**:
  - 使用 `LayeredPromptBuilder` 按需加载 Prompt 组件
  - 根据场景（coding / life）动态过滤工具集
  - 配置 thinking 模式
- **分层组件**:
  - L0: 总是加载（identity, safety）
  - L1: 按场景加载（coding, life）
  - L2: 按复杂度加载（planning, agent-rules, safety）
  - L3: 项目上下文（project）
- **依赖**:
  - `LayeredPromptBuilder` — 分层 Prompt 构建器
  - `DynamicToolFilter` — 工具过滤器

#### TurnLifecycleManager (`src/core/chat/TurnLifecycleManager.ts`)
- **职责**: 轮次生命周期管理
- **核心功能**:
  - 自动保存会话
  - 消息淘汰（超过阈值时压缩历史消息）
  - 会话归档
- **依赖**:
  - `SessionStorage` — 会话存储
  - `MessageManager` — 消息管理

---

### 4. Adapters Layer (适配器层)

#### CLI Adapter (`src/adapters/cli/App.tsx`)
- **职责**: Ink (React) 终端 UI
- **核心功能**:
  - 渲染对话界面
  - 处理用户输入
  - 展示权限确认弹窗
  - 展示计划审查界面
- **依赖**:
  - `ChatSession` — 会话管理
  - `PermissionPrompt` — 权限确认 UI
  - `PlanReview` — 计划审查 UI

#### IM Bots (`src/adapters/im/`)
- **职责**: IM 机器人适配（钉钉/企微/飞书）
- **核心功能**:
  - 接收 IM 消息
  - 调用 ChatSession 处理
  - 返回响应到 IM 平台
- **依赖**:
  - `ChatSession` — 会话管理

#### Electron Desktop (`src/adapters/electron/`)
- **职责**: 桌面应用适配
- **核心功能**:
  - 三栏布局（会话列表 + 对话区 + 右侧面板）
  - 气泡式对话界面
  - Markdown 渲染 + 代码高亮
- **依赖**:
  - `ChatSession` — 会话管理

---

## 关键交互流程

### 1. 用户输入处理流程

```
User Input (CLI/IM/Desktop)
    ↓
ChatSession.run(input)
    ↓
SkillRouter.match(input)  ← 判断是否为 Skill
    ├─ Yes → SkillRouter.execute(skill)
    └─ No  → AgentLoop.run(input)
              ↓
         PromptOrchestrator.buildSystemPrompt()
              ↓
         ProviderManager.streamChat()  ← LLM 调用
              ↓
         解析工具调用请求
              ↓
         ToolRegistry.execute(toolName, input)
              ↓
         MiddlewarePipeline 处理
              ├─ ErrorHandling
              ├─ Logging
              ├─ Timeout
              ├─ AbortCheck
              ├─ PlanMode (拦截写操作)
              ├─ Permission (权限检查)
              └─ Tool.execute()
                   ↓
              返回工具结果
              ↓
         追加到消息历史
              ↓
         继续循环或输出最终回复
              ↓
    TurnLifecycleManager.afterTurn()
         ├─ 自动保存会话
         ├─ 消息淘汰
         └─ 会话归档
```

### 2. 权限检查流程

```
ToolRegistry.execute(toolName, input)
    ↓
PermissionMiddleware.execute(context, next)
    ↓
PermissionController.check(request)
    ↓
评估守卫 (FileGuard / CommandGuard)
    ↓
意图过滤 (阻止重复尝试)
    ↓
风险分流
    ├─ safe → 自动放行
    ├─ warn → 检查配置 (ask / auto-allow)
    │         ├─ 检查缓存 (会话 + 持久化)
    │         └─ 触发用户确认
    └─ danger → 强制用户确认
                 ├─ 检查缓存
                 └─ 触发用户确认
                      ↓
                 ConfirmationHandler (CLI/IM/Desktop)
                      ↓
                 用户决策 (Allow / Deny / Remember)
                      ↓
                 更新缓存 + 持久化
                      ↓
                 发布事件 (permission:checked)
                      ↓
                 EventBus → AuditLogger (订阅者)
```

### 3. 事件驱动审计流程

```
PermissionController.check()
    ↓
做出决策 (allowed / denied)
    ↓
EventBus.emit('permission:checked', event)
    ↓
AuditLogger (订阅者)
    ↓
记录审计日志 (文件 / 数据库)
```

**优势**:
- PermissionController 不再直接依赖 AuditLogger
- 易于扩展：可添加多个订阅者（监控、统计、告警）
- 解耦：审计逻辑变更不影响权限决策

---

## 依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                         Adapters                             │
│  CLI (App.tsx) │ IM Bots │ Electron Desktop                 │
└────────────────────────┬────────────────────────────────────┘
                         │ 依赖
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                      ChatSession                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ SessionInitializer → 初始化所有依赖                    │   │
│  │ SkillRouter → Skill 路由                              │   │
│  │ PromptOrchestrator → Prompt 编排                      │   │
│  │ TurnLifecycleManager → 轮次生命周期                    │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ 依赖
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                       AgentLoop                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ToolRegistry → 工具执行                               │   │
│  │ MessageManager → 消息管理                             │   │
│  │ ProviderManager → LLM 调用                            │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ 依赖
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                     ToolRegistry                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ MiddlewarePipeline → 横切逻辑                         │   │
│  │   ├─ PermissionMiddleware → PermissionController     │   │
│  │   ├─ TimeoutMiddleware                               │   │
│  │   ├─ LoggingMiddleware                               │   │
│  │   └─ ErrorHandlingMiddleware                         │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ 依赖
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                  PermissionController                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ EventBus → 发布权限事件                               │   │
│  │ FileGuard / CommandGuard → 风险评估                  │   │
│  │ PolicyEngine → 策略引擎                               │   │
│  │ DecisionStore → 持久化决策                            │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ 依赖
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    Infrastructure                            │
│  EventBus │ MessageBus │ MiddlewarePipeline │ Storage       │
└─────────────────────────────────────────────────────────────┘
```

---

## 设计原则总结

### 1. 单一职责原则 (SRP)
- 每个模块只负责一个明确的功能
- 例如：ToolRegistry 只负责工具管理，权限检查委托给 PermissionController

### 2. 开闭原则 (OCP)
- 通过中间件扩展功能，无需修改核心代码
- 例如：ToolRegistry 通过 MiddlewarePipeline 扩展横切逻辑

### 3. 依赖倒置原则 (DIP)
- 高层模块不依赖低层模块，都依赖抽象
- 例如：ChatSession 依赖 IPermissionController 接口，而非具体实现

### 4. 接口隔离原则 (ISP)
- 客户端不应依赖它不需要的接口
- 例如：Tool 接口只定义必要的方法（name, description, execute）

### 5. 事件驱动解耦
- 使用 EventBus 解耦模块间的通知机制
- 例如：PermissionController 发布事件，AuditLogger 订阅事件

### 6. 中间件模式
- 使用 MiddlewarePipeline 处理横切关注点
- 例如：ToolRegistry 使用中间件处理权限、超时、日志、错误

---

## 扩展点

### 1. 新增工具
1. 创建 `src/core/tools/XxxTool.ts`
2. 在 `ToolRegistry.ts` 中注册
3. 可选：加到 `ToolCategories.ts` 场景过滤

### 2. 新增中间件
1. 创建 `src/infrastructure/middleware/XxxMiddleware.ts`
2. 实现 `IMiddleware<TContext, TResult>` 接口
3. 在 ToolRegistry 或其他地方使用

### 3. 新增事件订阅者
1. 获取 `PermissionController.getEventBus()`
2. 调用 `eventBus.on('permission:checked', handler)`
3. 实现自定义逻辑（监控、统计、告警等）

### 4. 新增 Prompt 组件
1. 创建 `src/core/prompt/components/lX-xxx.ts`
2. 导出满足 `PromptComponent` 接口的对象
3. 自动扫描注册，无需改其他文件

### 5. 新增 Agent
1. 在 `src/core/agent/builtin/` 下新建 `.json5` 文件
2. 定义 Agent 配置（model, tools, systemPrompt 等）
3. 用户可在 `~/.xuanji/agents/` 或 `.xuanji/agents/` 中覆盖

---

## 总结

璇玑的架构设计遵循 SOLID 原则，通过分层架构、依赖注入、事件驱动、中间件模式等设计模式，实现了高内聚、低耦合、易扩展的系统。

**核心优势**:
1. **模块化**: 每个模块职责清晰，易于理解和维护
2. **可扩展**: 通过中间件、事件、插件等机制轻松扩展功能
3. **可测试**: 依赖注入和接口抽象使得单元测试更容易
4. **解耦**: 事件驱动和中间件模式解耦模块间的依赖关系
5. **类型安全**: TypeScript 提供编译时类型检查，减少运行时错误
