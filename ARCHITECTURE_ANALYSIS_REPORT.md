# 璇玑 (Xuanji) 项目架构分析报告

> 分析日期：2025-05-01 | 分析范围：`src/` 目录 | 技术栈：TypeScript + Ink (React) + Node.js

---

## 一、架构总览

### 1.1 项目定位

璇玑 (Xuanji) 是一个开源的 AI 编程助手，架构设计以 **多 Agent 协作调度** 为核心，通过主 Agent（MainAgent）协调多个子 Agent（SubAgent/Team）完成代码分析、编写、审查等任务。项目支持 CLI、IM 机器人（钉钉/飞书/企微）、Electron 桌面端三种适配器模式。

### 1.2 分层架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    ADAPTERS 适配器层                          │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ CLI (Ink) │  │ IM Bots (钉钉/飞书/企微) │  │ Desktop (Electron) │  │
│  └────┬─────┘  └────────┬─────────┘  └────────┬──────────┘  │
│       │                 │                    │               │
├───────┼─────────────────┼────────────────────┼───────────────┤
│       │          CORE 核心业务层                              │
│       │    ┌──────────────────────────────────────┐          │
│       ├───►│  ChatSession / SessionFactory        │          │
│       │    │  (会话生命周期管理 + DI 容器)         │          │
│       │    └──────────────┬───────────────────────┘          │
│       │                   │                                   │
│       │    ┌──────────────▼───────────────────────┐          │
│       │    │  MainAgent (主调度器)                 │          │
│       │    │  ├─ IntentClassifier (意图分类)       │          │
│       │    │  ├─ LayeredPromptBuilder (分层 Prompt)│          │
│       │    │  └─ AgentLoop (ReAct 循环)            │          │
│       │    └──────────────┬───────────────────────┘          │
│       │                   │                                   │
│       │    ┌──────────────┼───────────────────────┐          │
│       │    │              │                        │          │
│       │    ▼              ▼                        ▼          │
│       │ ┌────────┐ ┌────────────┐ ┌──────────────────────┐   │
│       │ │Providers│ │ToolRegistry│ │ SubAgent/TeamManager │   │
│       │ │(LLM API)│ │(工具执行)  │ │ (多Agent协作委派)    │   │
│       │ └────────┘ └────────────┘ └──────────────────────┘   │
│       │                                                       │
├───────┼───────────────────────────────────────────────────────┤
│       │          INFRASTRUCTURE 基础设施层                     │
│       │    ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │
│       │    │ Storage  │ │Messaging │ │ MiddlewarePipeline │   │
│       │    │ (SQLite) │ │(EventBus)│ │ (洋葱模型横切)     │   │
│       │    └──────────┘ └──────────┘ └───────────────────┘   │
│       │                                                       │
├───────┴───────────────────────────────────────────────────────┤
│                    PERMISSION 权限层                           │
│    FileGuard / CommandGuard → PolicyEngine → DecisionStore    │
│    (双层防护: LLM主动审查 + 硬编码安全兜底)                    │
├──────────────────────────────────────────────────────────────┤
│                    SHARED 共享层                               │
│    types/ (Agent, Tool, Provider, Config) / utils/ / i18n/   │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 模块全景（按目录）

| 目录 | 职责 | 核心类/接口 |
|------|------|-------------|
| `adapters/cli/` | CLI 交互层 (Ink/React) | `App`, `InputHandler`, `MarkdownRenderer` |
| `adapters/im/` | IM 机器人适配 | `IMAdapter`, `DingtalkBot`, `FeishuBot`, `WecomBot` |
| `core/agent/` | Agent 核心循环与调度 | `AgentLoop`, `MainAgent`, `SubAgentFactory`, `TeamManager` |
| `core/providers/` | LLM Provider | `ILLMProvider`, `AnthropicProvider`, `OpenAIProvider`, `ProviderFactory` |
| `core/tools/` | 工具定义与执行 | `BaseTool`, `ToolRegistry`, 25+ 具体工具 |
| `core/config/` | 配置管理 | `ConfigLoader`, `ConfigValidator`, `GlobalConfig` |
| `core/prompt/` | Prompt 构建系统 | `LayeredPromptBuilder`, `IntentAnalyzer`, `PromptComponentRegistry` |
| `core/di/` | 依赖注入 | `DependencyContainer` |
| `infrastructure/` | 基础设施 | `SQLiteStorage`, `EventBus`, `MiddlewarePipeline` |
| `permission/` | 权限控制 | `PermissionController`, `FileGuard`, `CommandGuard` |
| `session/` | 会话持久化 | `SessionManager`, `SessionStorage` |
| `hooks/` | Hook 插件系统 | `HookRegistry` (30+ 事件类型) |
| `embedding/` | 本地向量化 | `EmbeddingService`, `VectorStore` |
| `mcp/` | MCP 协议 | `MCPClient`, `MCPManager` |
| `shared/` | 共享类型与工具 | 全局类型定义 |

---

## 二、分层架构分析

### 2.1 层次划分评估

**分层评分：★★★★☆ (4/5)** — 层次清晰，职责分离良好，存在少量越界。

#### 做得好的地方

1. **适配器层完全解耦**：CLI/IM/Desktop 三种入口独立，通过 `IMAdapter` 接口与核心层交互，`SessionFactory` 是适配器与核心的唯一桥梁。

2. **核心业务逻辑内聚**：`AgentLoop` 封装完整的 ReAct 循环，`MainAgent` 在此基础上叠加意图分析和 prompt 构建，Tool 执行通过 `MiddlewarePipeline` 统一横切关注点。

3. **基础设施层抽象良好**：`IStorage`/`IFullStorage` 接口支持多种存储后端，`EventBus`/`MessageBus` 提供标准发布订阅，`MiddlewarePipeline` 实现洋葱模型（Koa 风格）。

4. **权限控制独立成层**：双层防护设计（LLM 主动审查 + 硬编码安全兜底），`FileGuard`/`CommandGuard`/`PolicyEngine` 职责清晰，通过 `IPermissionController` 接口注入到工具层。

#### 需要改进的地方

1. **`index.ts` 入口文件职责过重**：包含 CLI 参数解析、Bot 启动、GUI 启动、会话创建、事件绑定等（640 行），建议拆分为 `cli-entry.ts`、`bot-entry.ts`、`gui-entry.ts`。

2. **AgentLoop 构造函数依赖过多**：直接 new 了 10+ 个内部对象，违反 DI 原则，应通过工厂或容器注入。

3. **SessionFactory 的注册逻辑过于集中**：`create()` 方法中包含大量基础设施初始化、Provider 创建、高级工具注册、MainAgent 创建，建议使用 Builder 模式。

### 2.2 依赖方向分析

```
adapters ──► core (ChatSession) ──► core/agent (AgentLoop/MainAgent)
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              core/providers      core/tools          core/prompt
                    │                    │                    │
                    ▼                    ▼                    ▼
              infrastructure     permission          embedding
```

**依赖规则遵守：**
- ✅ 适配器 → 核心：单向依赖
- ✅ 核心 → 基础设施：单向依赖
- ✅ 所有层 → shared/types：共享类型
- ✅ `infrastructure/middleware/builtins.ts` 反向依赖 `core/tools/ToolCategories`（轻量合理）
- ⚠️ `core/agent/AgentLoop.ts` 直接依赖 `core/telemetry`（建议事件化解耦）

---

## 三、关键调用链路

### 3.1 主流程：CLI 启动 → Agent 推理

```
index.ts main()
  │
  ├─ new SessionFactory('cli-user')
  │   └─ factory.create({ model })
  │       ├─ ConfigLoader.load()                    // 加载配置
  │       ├─ ProviderManager.getProvider()          // 创建 LLM Provider
  │       ├─ createDefaultRegistry()                // 注册 23 个内置工具
  │       ├─ PermissionController()                 // 注入权限控制
  │       ├─ AgentRegistry.init()                   // 加载 Agent 配置
  │       ├─ PromptComponentRegistry.init()         // 加载 Prompt 组件
  │       ├─ LayeredPromptBuilder.init()            // 分层 Prompt 构建器
  │       ├─ registerAdvancedTools()                // 注册 TaskTool/TeamTool
  │       └─ new MainAgent({ provider, registry, config })
  │           └─ new AgentLoop(provider, registry, config)
  │
  ├─ session.getAgentLoop()
  │   └─ agentLoop.run(userMessage)
  │       ┌─ ReAct 循环 ─────────────────────────────┐
  │       │  for (iteration < maxIterations):         │
  │       │    1. MessageManager.build()              │
  │       │    2. ContextCompressor (if needed)       │
  │       │    3. provider.stream(messages, tools)    │
  │       │    4. StreamProcessor.parse()             │
  │       │    5. if tools:                           │
  │       │         ToolRegistry.execute()            │
  │       │         └─ MiddlewarePipeline             │
  │       │             ├─ ErrorHandling              │
  │       │             ├─ Logging                    │
  │       │             ├─ Timeout                    │
  │       │             ├─ AbortCheck                 │
  │       │             ├─ PlanMode                   │
  │       │             └─ Permission                 │
  │       │    6. MessageManager.addToolResults()     │
  │       │    7. if end_turn → break                │
  │       └──────────────────────────────────────────┘
  │
  └─ render(<App agentLoop={...} />)  // Ink React 渲染
```

### 3.2 MainAgent 增强链（带意图分类）

```
MainAgent.run(userMessage)
  │
  ├─ IntentClassifier.classify(userMessage)     // 3 层降级：本地模型 → 语义 → 关键词
  │   → ClassificationResult { scene, agent, complexity }
  │
  ├─ LayeredPromptBuilder.build({ scene, complexity })
  │   ├─ L0: 基础身份+安全 (~600 tokens)
  │   ├─ L1: 场景专用 (write_code/debug/review...) (~800 tokens)
  │   ├─ L2: 复杂协调 (team-coordination/safety) (~1000 tokens)
  │   └─ L3: 项目上下文 (ProjectScanner + RulesLoader)
  │   → PromptBuildResult { prompt, components, estimatedTokens }
  │
  └─ agentLoop.run(userMessage)  // 使用动态构建的 systemPrompt
```

### 3.3 子 Agent 委派链

```
MainAgent → LLM → task / agent_team 工具调用
  │
  ├─ TaskTool.execute({ subagent_type, description, scene })
  │   └─ SubAgentFactory.createAndRun()
  │       ├─ AgentRegistry.resolve(agentId)
  │       ├─ ProviderManager.getProvider(agentConfig)
  │       ├─ FilteredToolRegistry (工具白名单)
  │       └─ new AgentLoop(subProvider, filteredRegistry, config).run(task)
  │
  └─ TeamTool.execute({ strategy, members, task })
      └─ TeamManager.execute()
          ├─ parallel → Promise.all(members.map(...))
          ├─ serial → for member of members
          └─ debate → 多轮辩论 + 评审员总结
```

### 3.4 工具执行中间件链（洋葱模型）

```
ToolRegistry.execute(toolName, input, signal)
  └─ MiddlewarePipeline<ToolContext, ToolResult>
      ┌─────────────────────────────────────────┐
      │ 1. ErrorHandlingMiddleware              │ ← 捕获所有异常
      │    ┌─────────────────────────────────┐  │
      │    │ 2. LoggingMiddleware            │  │ ← 记录耗时
      │    │    ┌─────────────────────────┐  │  │
      │    │    │ 3. TimeoutMiddleware    │  │  │ ← Promise.race
      │    │    │    ┌─────────────────┐  │  │  │
      │    │    │    │ 4. AbortCheck   │  │  │  │ ← AbortSignal
      │    │    │    │    ┌─────────┐  │  │  │  │
      │    │    │    │    │5.PlanMode│  │  │  │  │ ← 拦截写操作
      │    │    │    │    │    ┌───┐│  │  │  │  │
      │    │    │    │    │    │6. ││  │  │  │  │
      │    │    │    │    │    │Perm││  │  │  │  │ ← 权限+UI确认
      │    │    │    │    │    └───┘│  │  │  │  │
      │    │    │    │    └─────────┘  │  │  │  │
      │    │    │    └─────────────────┘  │  │  │
      │    │    └─────────────────────────┘  │  │
      │    └─────────────────────────────────┘  │
      └─────────────────────────────────────────┘
                           │
                           ▼
                    tool.execute(input, signal)
```

---

## 四、设计模式应用

### 4.1 模式清单

| 设计模式 | 应用位置 | 评分 |
|---------|---------|------|
| **依赖注入 (DI)** | `DependencyContainer` → `SessionFactory` | ⭐⭐⭐⭐ |
| **工厂模式** | `SessionFactory`, `ProviderFactory`, `SubAgentFactory` | ⭐⭐⭐⭐ |
| **策略模式** | `ILLMProvider` (Anthropic/OpenAI/LocalLlama) | ⭐⭐⭐⭐⭐ |
| **中间件/责任链** | `MiddlewarePipeline` (权限/日志/超时/错误) | ⭐⭐⭐⭐⭐ |
| **观察者模式** | `EventBus`, `HookRegistry`, `AgentCallbacks` | ⭐⭐⭐⭐ |
| **模板方法** | `BaseTool` (抽象 execute, isWriteOperation) | ⭐⭐⭐⭐ |
| **单例模式** | `EmbeddingService.getInstance()` | ⭐⭐⭐ |
| **注册表模式** | `ToolRegistry`, `AgentRegistry`, `PromptComponentRegistry` | ⭐⭐⭐⭐ |
| **外观模式** | `ChatSession` 封装 MainAgent + Container | ⭐⭐⭐⭐ |
| **适配器模式** | `IMAdapter` → DingtalkBot/FeishuBot/WecomBot | ⭐⭐⭐⭐⭐ |
| **建造者模式** | `LayeredPromptBuilder` (分层构建 L0-L3) | ⭐⭐⭐⭐ |

### 4.2 核心模式详解

#### 依赖注入容器（自实现，零外部依赖）

```typescript
class DependencyContainer {
  register<T>(key, factory, lifecycle: 'singleton'|'transient')
  registerSingleton<T>(key, instance)
  resolve<T>(key): Promise<T>     // 异步解析
  resolveSync<T>(key): T          // 同步解析（仅已缓存单例）
}
// 特性: singleton/transient 生命周期、循环依赖检测(resolving Set)
// 局限: 不支持构造函数注入、不支持自动依赖图解析
```

#### Provider 策略模式（无状态设计）

```typescript
interface ILLMProvider {
  stream(messages, tools, config): AsyncIterable<StreamEvent>;
}
// 实现: AnthropicProvider, OpenAIProvider, LocalLlamaAdapter
// ProviderFactory 按 model name 或 adapter 标识路由
// ProviderManager 支持字段级配置合并（Agent 配置 > 全局配置）
// 亮点: 无状态 Provider，同一实例可服务不同 Agent
```

#### 工具中间件管道（洋葱模型 + 动态重建）

```typescript
// 每个工具执行时动态创建临时 pipeline
const tempPipeline = new MiddlewarePipeline();
tempPipeline
  .use(new ErrorHandlingMiddleware())
  .use(new LoggingMiddleware())
  .use(new TimeoutMiddleware(toolTimeout))  // 工具特定超时
  .use(new AbortCheckMiddleware())
  .use(new PlanModeMiddleware())
  // agent_team 跳过 Timeout（内部自管理）
  .use(new PermissionMiddleware(controller));
```

### 4.3 模式评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 模式选择恰当性 | ⭐⭐⭐⭐ | 针对场景选择合适模式 |
| 模式实现质量 | ⭐⭐⭐⭐ | DI/中间件/策略实现良好 |
| 模式一致性 | ⭐⭐⭐ | DI 未在所有模块统一应用 |

---

## 五、模块间耦合度分析

### 5.1 耦合度矩阵

| 模块依赖关系 | 耦合类型 | 强度 | 说明 |
|-------------|---------|------|------|
| adapters → core/ChatSession | 接口依赖 | **低** | 通过 ChatSession 外观 |
| adapters → core/AgentLoop | 接口依赖 | **低** | 通过 AgentCallbacks |
| adapters/im → IMAdapter | 接口实现 | **低** | 统一 IMAdapter 接口 |
| core/agent → core/providers | 接口依赖 | **低** | ILLMProvider 接口 |
| core/agent → core/tools | 接口依赖 | **低** | IToolRegistry 接口 |
| core/agent → core/prompt | 具体依赖 | **中** | 直接依赖 LayeredPromptBuilder |
| core/agent → core/telemetry | 具体依赖 | **中** | AgentLoop 直接创建 telemetry 对象 |
| core/agent → hooks | 接口依赖 | **低** | HookRegistry（可选） |
| core/tools → permission | 接口依赖 | **低** | IPermissionController（可选） |
| core/tools → infrastructure | 具体依赖 | **中** | 直接使用 MiddlewarePipeline 类 |
| core/config → Node fs | 具体依赖 | **中** | 直接读写文件系统 |
| SessionFactory → * | 组装依赖 | **高** | 创建几乎所有核心对象 |
| AgentLoop → * | 具体依赖 | **高** | 构造函数直接 new 10+ 对象 |

### 5.2 接口抽象评估

#### ✅ 优秀的接口抽象

```typescript
// Provider 抽象 — 完全解耦
interface ILLMProvider { stream(...): AsyncIterable<StreamEvent>; }

// 工具注册表抽象 — 测试友好
interface IToolRegistry { register(tool): void; get(name): Tool; execute(...): ToolResult; }

// IM 适配器抽象 — 多平台统一
interface IMAdapter { start(session): Promise<void>; stop(): Promise<void>; }

// 权限控制抽象 — 可替换
interface IPermissionController { check(request): Promise<PermissionResult>; }

// 存储抽象 — 多后端支持
interface IStorage<T> { save(id, data): Promise<void>; load(id): Promise<T|null>; }
interface IFullStorage<T> extends IBatchStorage, ITransactionalStorage, IQueryableStorage {}
```

#### ⚠️ 缺少接口抽象的模块

- `AgentLoop` — 无 `IAgentLoop` 接口
- `ConfigLoader` — 虽有 `IConfigLoader` 但使用不充分
- `SessionManager` — 无 `ISessionManager` 接口
- `LayeredPromptBuilder` — 无 `IPromptBuilder` 接口
- `EmbeddingService` — 虽有单例但缺接口抽象

### 5.3 循环依赖

- ✅ **无已知的模块间循环依赖**（`DependencyContainer` 运行时检测）
- ✅ `shared/types/` 纯类型层，不依赖任何业务模块
- ✅ `infrastructure/` 不依赖 `core/`（除内置中间件对工具的轻量引用）

### 5.4 耦合度总体评分

| 维度 | 评分 |
|------|------|
| 接口抽象程度 | ⭐⭐⭐⭐ |
| 依赖方向控制 | ⭐⭐⭐⭐ |
| 模块内聚性 | ⭐⭐⭐⭐ |
| DI 使用一致性 | ⭐⭐⭐ |
| 测试友好度 | ⭐⭐⭐⭐ |

---

## 六、架构改进建议

### 6.1 高优先级 (P0)

#### 6.1.1 AgentLoop 依赖注入化

**现状：** 构造函数中直接 `new` 了 10+ 个内部对象。

```typescript
// 当前: 硬编码依赖
this.messageManager = new MessageManager(config.systemPrompt);
this.streamProcessor = new StreamProcessor();
this.toolDispatcher = new ToolDispatcher(registry);
// ... 10+ more
```

**建议：** 使用 AgentLoopDependencies 接口，通过 DI 容器注入：

```typescript
interface AgentLoopDependencies {
  messageManager: MessageManager;
  streamProcessor: StreamProcessor;
  toolDispatcher: ToolDispatcher;
  // ...
}
class AgentLoop {
  constructor(private deps: AgentLoopDependencies, provider, registry, config) {}
}
```

#### 6.1.2 入口文件职责拆分

**现状：** `index.ts` (640 行) 同时处理 CLI 参数、Bot 启动、GUI 启动、会话管理。

**建议：** 拆分为独立入口模块：
```
src/entries/
  cli.ts             // CLI 交互模式
  bot.ts             // IM Bot 模式
  gui.ts             // Electron 桌面模式
  non-interactive.ts // -p 非交互模式
src/index.ts         // 仅路由逻辑 (< 50 行)
```

### 6.2 中优先级 (P1)

#### 6.2.1 补充缺失的接口抽象

```typescript
interface IAgentLoop {
  run(userMessage: string): Promise<void>;
  stop(): void;
  on(callbacks: AgentCallbacks): void;
  getState(): AgentState;
}
interface IPromptBuilder {
  build(context: PromptBuildContext): Promise<PromptBuildResult>;
}
interface ISessionManager {
  save(...): Promise<string>;
  resume(sessionId: string): Promise<SessionData>;
  list(): Promise<SessionSummary[]>;
}
```

#### 6.2.2 ConfigLoader 与文件系统解耦

引入 `IConfigStorage` 接口，便于测试和远程配置支持。

#### 6.2.3 SessionFactory 使用 Builder 模式

```typescript
new SessionBuilder(userId)
  .withConfig(config)
  .withProvider(provider)
  .withTools(registry)
  .withAgent('xuanji')
  .build();
```

### 6.3 低优先级 (P2)

1. **统一日志门面**：合并 `core/logger/` 和 `core/logging/` 两套日志系统
2. **Model 层去重**：废弃 `core/model/`，统一使用 `core/providers/`
3. **增加架构约束测试**：自动化检测分层违规和循环依赖

---

## 七、总结

### 整体评分

| 维度 | 评分 | 评语 |
|------|------|------|
| 分层架构清晰度 | ⭐⭐⭐⭐ | 层次明确，适配器/核心/基础设施分离良好 |
| 接口抽象使用 | ⭐⭐⭐⭐ | Provider/Tool/Permission/Adapter 核心接口设计优秀 |
| 依赖注入模式 | ⭐⭐⭐ | 自实现 DI 容器良好，但未全局统一使用 |
| 模块间耦合度 | ⭐⭐⭐⭐ | 大部分解耦良好，AgentLoop/SessionFactory 需改善 |
| 设计模式应用 | ⭐⭐⭐⭐⭐ | 中间件/策略/工厂/观察者模式应用恰当 |
| 代码可测试性 | ⭐⭐⭐⭐ | 核心接口可 Mock，部分模块需 DI 化 |
| 扩展性 | ⭐⭐⭐⭐⭐ | 工具/Provider/Agent/IM 平台均可独立扩展 |

### 核心优势

1. **多 Agent 协作架构** — MainAgent + SubAgent + TeamManager，支持 parallel/serial/debate 模式
2. **中间件管道** — 洋葱模型的工具执行管道，优雅处理横切关注点
3. **Provider 策略** — 无状态 Provider + 字段级配置合并，支持多 Agent 独立 API Key
4. **分层 Prompt 系统** — L0-L3 四层按意图复杂度动态组合，控制 token 用量
5. **权限双层防护** — LLM 主动审查 + 硬编码安全兜底，防御 prompt injection

### 关键改进方向

1. **AgentLoop DI 化** — 解除构造函数硬编码依赖
2. **入口文件拆分** — 分离 CLI/Bot/GUI 入口逻辑
3. **补充接口抽象** — IAgentLoop/IPromptBuilder/ISessionManager
4. **统一日志和 Model 层** — 消除重复实现
5. **增加架构约束测试** — 自动化检测分层违规

---

*报告由璇玑架构分析引擎生成*
