# 璇玑 (Xuanji) 功能执行链路全景分析

> **版本**: 基于源码 `src/` 目录分析 · **最后更新**: 2025-07
>
> 本文档系统梳理 Xuanji 项目中所有核心功能模块的执行链路，涵盖 4 种启动模式、ReAct 推理循环、25+ 工具体系、记忆/提醒/MCP/Hook 等扩展子系统。

---

## 目录

- [1. 系统架构概览](#1-系统架构概览)
- [2. 启动链路](#2-启动链路)
  - [2.1 CLI 交互模式](#21-cli-交互模式)
  - [2.2 CLI 非交互模式](#22-cli-非交互模式)
  - [2.3 IM 机器人模式](#23-im-机器人模式)
  - [2.4 Electron GUI 模式](#24-electron-gui-模式)
- [3. ChatSession 初始化链路](#3-chatsession-初始化链路)
- [4. ReAct 对话循环 (AgentLoop)](#4-react-对话循环-agentloop)
- [5. 工具执行链路](#5-工具执行链路)
  - [5.1 工具注册与发现](#51-工具注册与发现)
  - [5.2 工具调度策略](#52-工具调度策略)
  - [5.3 权限控制链路](#53-权限控制链路)
  - [5.4 核心工具列表](#54-核心工具列表)
- [6. LLM Provider 链路](#6-llm-provider-链路)
- [7. Skill 系统链路](#7-skill-系统链路)
  - [7.1 Skill 加载与注册](#71-skill-加载与注册)
  - [7.2 意图路由](#72-意图路由)
  - [7.3 System Prompt 组装](#73-system-prompt-组装)
- [8. 记忆系统链路](#8-记忆系统链路)
- [9. 提醒系统链路](#9-提醒系统链路)
- [10. MCP 扩展链路](#10-mcp-扩展链路)
- [11. Hook 系统链路](#11-hook-系统链路)
- [12. 会话持久化链路](#12-会话持久化链路)
- [13. 子代理 (SubAgent) 链路](#13-子代理-subagent-链路)
- [14. 上下文压缩链路](#14-上下文压缩链路)
- [15. 配置加载链路](#15-配置加载链路)
- [16. 遥测与费用追踪链路](#16-遥测与费用追踪链路)

---

## 1. 系统架构概览

```
┌───────────────────────────────────────────────────────────────────┐
│                         适配器层 (Adapters)                        │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ CLI (Ink) │  │ IM (钉钉/飞书│  │ Electron │  │ 非交互 PIPE  │  │
│  │  App.tsx  │  │  /企微)      │  │   GUI    │  │   stdout     │  │
│  └─────┬────┘  └──────┬───────┘  └────┬─────┘  └──────┬───────┘  │
│        │               │               │               │          │
├────────┼───────────────┼───────────────┼───────────────┼──────────┤
│        └───────────────┴───────┬───────┴───────────────┘          │
│                                │                                   │
│                     ┌──────────▼──────────┐                       │
│                     │    ChatSession      │   ← 统一入口          │
│                     │  (会话抽象层)        │                       │
│                     └──────────┬──────────┘                       │
│                                │                                   │
│  ┌─────────────────────────────┼─────────────────────────────────┐│
│  │                   核心引擎层 (Core)                            ││
│  │  ┌──────────────────────────▼───────────────────────────────┐ ││
│  │  │                    AgentLoop                             │ ││
│  │  │              (ReAct 推理循环核心)                         │ ││
│  │  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │ ││
│  │  │  │MessageManager│ │StreamProcessor│ │ ToolDispatcher   │  │ ││
│  │  │  └─────────────┘ └──────────────┘ └──────────────────┘  │ ││
│  │  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │ ││
│  │  │  │TokenManager  │ │ContextCompressr│ │  CostTracker    │  │ ││
│  │  │  └─────────────┘ └──────────────┘ └──────────────────┘  │ ││
│  │  └──────────────────────────────────────────────────────────┘ ││
│  └───────────────────────────────────────────────────────────────┘│
│                                                                    │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │                      子系统层 (Subsystems)                     ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ││
│  │  │ToolRegistry│ │Permission│ │  Memory  │ │  Skill System   │ ││
│  │  │ (20+工具) │ │Controller│ │ Manager  │ │  (Prompt/WF)    │ ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ││
│  │  │  MCP     │ │  Hook    │ │ Reminder │ │  Session/        │ ││
│  │  │ Manager  │ │ Registry │ │  Engine  │ │  Checkpoint      │ ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                    │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │                      基础设施层 (Infra)                        ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ││
│  │  │ Provider │ │ Embedding│ │ Vector   │ │  Config Loader   │ ││
│  │  │ Factory  │ │ Service  │ │  Store   │ │  (多级合并)      │ ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ││
│  │  │ Logger   │ │ Telemetry│ │   i18n   │ │   Storage        │ ││
│  │  │ (debug)  │ │ Recorder │ │ (zh/en)  │ │  (JSONL/SQLite)  │ ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ ││
│  └────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. 启动链路

入口文件: `src/index.ts` → `main()`。根据命令行参数分流到 4 种运行模式。

### 2.1 CLI 交互模式（默认）

```
main()
  ├── parseArgs(process.argv)          // 解析命令行参数
  ├── new ChatSession({ model })       // 创建会话
  ├── session.init()                   // ⭐ 核心初始化（详见第3节）
  ├── ConfigManager.load()             // 加载 UI 配置
  ├── setLanguage(language)            // 设置国际化语言
  ├── import StartupLogo               // 动态导入启动 Logo
  └── render(React.createElement(AppWithLogo))  // Ink 渲染
        ├── <StartupLogo />            // 3秒 Logo 动画
        └── <App />                    // 主界面
              ├── agentLoop.on(callbacks)      // 注册回调
              ├── onPermissionSetup(handler)   // 注入权限确认 UI
              ├── onPlanReviewSetup(handler)   // 注入计划审查 UI
              ├── onAskUserSetup(handler)      // 注入用户提问 UI
              └── 用户输入 → agentLoop.run()   // 进入 ReAct 循环
```

### 2.2 CLI 非交互模式（管道/脚本集成）

```
main()
  ├── parseArgs(process.argv)  // 检测到 -p/--prompt 或非 flag 参数
  ├── new ChatSession({ model })
  ├── session.init()
  ├── agentLoop.on({
  │     onText: stdout.write,       // 文本输出到 stdout（可管道传递）
  │     onToolStart: stderr.write,  // 工具通知输出到 stderr（不干扰管道）
  │     onToolEnd: stderr.write,
  │     onEnd: process.exit(0),
  │   })
  └── agentLoop.run(args.prompt)   // 执行完毕后自动退出
```

适用场景: `xuanji -p "总结 README" | pbcopy` 或 CI/CD 脚本集成。

### 2.3 IM 机器人模式

```
main()
  ├── parseArgs(process.argv)       // 检测到 'bot' 子命令
  └── startBot(args)
        ├── ConfigManager.load()    // 加载全局配置
        ├── LogSystem.info()        // 初始化日志
        ├── new ChatSession()
        ├── session.init()
        ├── 收集机器人列表:
        │     ├── args.dingtalk → import DingtalkBot → adapters.push()
        │     ├── args.feishu  → import FeishuBot   → adapters.push()
        │     └── args.wecom   → import WecomBot    → adapters.push()
        ├── for adapter of adapters:
        │     └── adapter.start(session)   // IMAdapter.start()
        │           ├── 建立 WebSocket/HTTP 连接
        │           ├── 监听消息事件
        │           └── 收到消息 → session.run(message)
        └── 注册 SIGINT/SIGTERM → shutdown()
              └── for adapter: adapter.stop()
```

### 2.4 Electron GUI 模式

```
main()
  ├── parseArgs(process.argv)           // 检测到 'gui' 子命令
  └── startGui()
        ├── import('electron')          // 查找 electron 可执行文件
        ├── 检查 dist/electron/main.cjs // 编译后的主进程
        │     └── 不存在 → execSync('npm run build:electron')
        └── execFile(electronPath, [mainPath])  // 启动 Electron
```

---

## 3. ChatSession 初始化链路

`ChatSession.init()` 是整个系统的核心初始化入口，按序协调 16 个子系统的启动。所有适配器（CLI / IM Bot / Electron）共享同一初始化路径。

```
ChatSession.init()
  │
  ├── 1️⃣ initConfig()                    // 配置加载
  │     ├── ConfigLoader.load()
  │     │     ├── DEFAULT_CONFIG           // 默认配置
  │     │     ├── loadGlobalConfig()       // ~/.xuanji/config.json
  │     │     ├── loadProjectConfig()      // .xuanji/config.json
  │     │     ├── getEnvProviderConfig()   // 环境变量 (XUANJI_API_KEY 等)
  │     │     └── loadMCPConfig()          // ~/.xuanji/mcp.json
  │     └── 校验 API Key
  │
  ├── 2️⃣ initProvider()                   // LLM Provider 初始化
  │     └── ProviderFactory
  │           ├── getByAdapter(adapter)    // 按 adapter 标识路由
  │           └── getByModel(model)        // 按模型名称路由
  │               ├── AnthropicProvider    // claude-* 模型
  │               └── OpenAIProvider       // gpt-* / o1-* 模型
  │
  ├── 3️⃣ initToolRegistry()               // 工具注册表
  │     ├── createDefaultRegistry()        // 注册 20+ 内置工具
  │     ├── new PermissionController()     // 权限控制器
  │     │     ├── FileGuard                // 文件操作守卫
  │     │     ├── CommandGuard             // 命令执行守卫
  │     │     └── PolicyEngine             // 策略引擎
  │     └── initIgnoreFilter()             // 加载 .xuanji/ignore
  │
  ├── 4️⃣ setRuntimeConfig()               // 设置运行时配置（全局）
  │
  ├── 5️⃣ initSkillSystem()                // 技能系统
  │     ├── new SkillRegistry()
  │     ├── initializeBuiltinSkills()      // 内置 Skill 注册
  │     │     ├── xuanji-assistant         // 主人格 prompt
  │     │     ├── project-rules            // 项目规则
  │     │     ├── memory-context           // 记忆上下文
  │     │     ├── code-assistant           // 编程助手
  │     │     ├── life-secretary           // 生活管家
  │     │     ├── other-skills             // 安全/工具指南
  │     │     └── commit / review-pr       // Workflow Skills
  │     └── SkillLoader.load(customPath)   // 自定义 Skill
  │
  ├── 6️⃣ initMemorySystem()               // 记忆系统
  │     ├── new MemoryManager(config)
  │     ├── memoryManager.init()           // 加载 JSONL 数据
  │     ├── registry.register(MemoryStoreTool)    // 注册记忆存储工具
  │     ├── registry.register(MemorySearchTool)   // 注册记忆搜索工具
  │     └── new SmartMemoryExtractor()     // LLM 驱动的智能提取
  │
  ├── 7️⃣ initVectorSkillMatcherAsync()    // 向量语义匹配（异步，不阻塞）
  │     ├── waitForVectorReady()           // 等待向量系统就绪
  │     ├── new VectorSkillMatcher()
  │     └── matcher.init(skillRegistry)    // 预计算 Skill Embeddings
  │
  ├── 8️⃣ initReminderSystem()             // 提醒系统
  │     ├── new ReminderEngine()
  │     ├── engine.init()                  // 加载 reminders.jsonl
  │     ├── registry.register(ReminderSetTool)    // 提醒设置工具
  │     ├── registry.register(ReminderCheckTool)  // 提醒检查工具
  │     ├── engine.checkOnStartup()        // 检查到期提醒
  │     ├── engine.checkNeglectedRelationships()  // 关系维护检查
  │     └── engine.formatForPrompt()       // 格式化为 prompt 片段
  │
  ├── 9️⃣ initMCPSystem()                  // MCP 扩展系统
  │     ├── MCPManager.getInstance()       // 单例
  │     ├── manager.initialize(config)     // 初始化所有 MCP 服务器
  │     │     ├── MCPClient (stdio)        // 标准 I/O 传输
  │     │     └── MCPSSEClient (SSE)       // Server-Sent Events 传输
  │     ├── manager.getAllTools()           // 获取 MCP 工具
  │     │     └── registry.register(MCPToolAdapter)  // 适配为内置工具
  │     └── manager.getAllPrompts()         // 获取 MCP Prompts
  │           └── skillRegistry.register(MCPSkillAdapter)  // 适配为 Skill
  │
  ├── 🔟 initWebSearch()                  // Web 搜索工具
  │     └── createWebSearchTool(config)    // 基于 MCP 的 web_search
  │
  ├── 1️⃣1️⃣ initTaskTool()                 // 子代理工具
  │     └── registry.register(TaskTool)    // 支持启动子代理
  │
  ├── 1️⃣2️⃣ buildSystemPrompt()            // 组装 System Prompt
  │     ├── skillRegistry.composeBatch()   // 按优先级组合 Skills
  │     └── 追加 reminderContext           // 注入提醒上下文
  │
  ├── 1️⃣3️⃣ createAgentLoop(systemPrompt)  // 创建 AgentLoop
  │     └── new AgentLoop(provider, registry, config, memoryStore)
  │
  ├── 1️⃣4️⃣ injectTaskToolDeps()           // 注入 TaskTool 依赖
  │     └── taskTool.setDependencies(provider, registry, config, ...)
  │
  ├── 1️⃣5️⃣ initHookSystem()               // Hook 系统
  │     ├── HookConfigLoader.load()        // .xuanji/hooks.yaml
  │     └── hookRegistry.loadConfig()      // 注册 Handler
  │
  └── 1️⃣6️⃣ hookRegistry.emit('SessionStart')  // 触发会话开始事件
```

---

## 4. ReAct 对话循环 (AgentLoop)

`AgentLoop.run()` 实现标准 ReAct（Reason + Act）循环。单轮对话由 `ChatSession.run()` 触发，经过意图路由和记忆注入后进入核心循环。

### 4.0 ChatSession.run() 前置处理

```
ChatSession.run(userMessage)
  │
  ├── 1. 意图路由（仅首条消息）
  │     ├── VectorSkillMatcher.matchSkills()    // 向量语义匹配（优先）
  │     └── SkillRegistry.filterByIntent()      // 正则关键词匹配（降级）
  │     └── 重建 System Prompt（仅匹配的 Skills）
  │
  ├── 2. 记忆检索注入（每轮执行）
  │     ├── memoryManager.retrieve(userMessage, { maxResults: 10 })
  │     └── 格式化为 prompt suffix → 注入到 System Prompt 尾部
  │
  ├── 3. agentLoop.run(userMessage)   // ⭐ 进入 ReAct 循环
  │
  └── 4. 自动保存（每 5 轮）
        └── sessionManager.save(messages)
```

### 4.1 AgentLoop 核心循环

```
AgentLoop.run(userMessage)
  │
  ├── messageManager.build(userMessage)         // 构建初始消息数组
  │     └── [system_prompt, ...history, user_message]
  │
  └── while (running && iteration < maxIterations):  // 默认最大 50 次迭代
        │
        ├── 1. 智能压缩
        │     └── contextCompressor.compressAsync()
        │           ├── 检查 token 占比 > threshold
        │           ├── LLM 语义摘要（可选）
        │           └── 同步到 MessageManager
        │
        ├── 2. Token 窗口裁剪（兜底）
        │     └── tokenManager.fitWindow(messages)
        │
        ├── 3. 调用 LLM（带重试）
        │     ├── provider.stream(messages, toolSchemas, config)
        │     │     ├── AnthropicProvider → Anthropic SDK streaming
        │     │     └── OpenAIProvider    → OpenAI SDK streaming
        │     ├── streamProcessor.consume(stream)
        │     │     ├── text_delta    → callbacks.onText()
        │     │     ├── thinking      → callbacks.onThinking()
        │     │     ├── tool_use_start → callbacks.onToolStart()
        │     │     ├── tool_use_end  → 收集 ToolCall
        │     │     └── usage         → tokenManager.record() + costTracker.record()
        │     └── 重试逻辑:
        │           ├── shouldRetry(error, attempt, retryConfig)
        │           └── calculateBackoff(attempt, retryConfig)
        │
        ├── 4. 记录 assistant 消息
        │     └── messageManager.addAssistantMessage(contentBlocks)
        │
        ├── 5. 判断停止条件
        │     ├── end_turn / 无工具调用 → break（结束循环）
        │     └── max_tokens → 注入重试指令 → continue
        │
        ├── 6. 工具执行
        │     │
        │     ├── 6a. PreToolUse Hook（同步，可阻塞）
        │     │     └── hookRegistry.emitSync('PreToolUse')
        │     │           ├── blocked → 跳过执行
        │     │           ├── mockResult → 使用模拟结果
        │     │           └── modifiedInput → 修改参数
        │     │
        │     ├── 6b. ToolDispatcher.executeAll(toolCalls)
        │     │     ├── 分段策略:
        │     │     │     ├── 连续只读工具 → 并行执行（≤5并发）
        │     │     │     └── 写工具 → 串行执行
        │     │     └── registry.execute(name, input)
        │     │           ├── Plan Mode 检查
        │     │           ├── 权限检查 (PermissionController)
        │     │           └── tool.execute(input, signal)
        │     │
        │     ├── 6c. PostToolUse Hook（异步，不阻塞）
        │     │     └── hookRegistry.emit('PostToolUse')
        │     │
        │     └── 6d. 添加工具结果到消息
        │           └── messageManager.addToolResults(resultsMap)
        │
        └── 7. 重建消息数组
              └── messages = messageManager.getMessages()

  finally:
    ├── callbacks.onEnd(state)                    // 通知 UI 循环结束
    ├── sessionRecorder.record()                  // 记录会话统计 → sessions.jsonl
    ├── usageStatsRecorder.record()               // 使用统计 → usage-stats.jsonl
    ├── perfTimer.finish()                        // 性能指标 → perf.jsonl
    └── memoryStore.save(sessionMemory)           // 保存会话记忆
          ├── userMessages (≤10 条)
          ├── assistantHighlights (≤5 条)
          ├── toolCalls (名称 + 输入 + 结果摘要)
          └── duration + model
```

---

## 5. 工具执行链路

### 5.1 工具注册与发现

```
createDefaultRegistry()
  └── new ToolRegistry()
        ├── ReadTool          (read_file)       readonly ✅
        ├── WriteTool         (write_file)      write
        ├── EditTool          (edit_file)       write
        ├── MultiEditTool     (multi_edit)      write
        ├── BashTool          (bash)            write
        ├── GlobTool          (glob)            readonly ✅
        ├── GrepTool          (grep)            readonly ✅
        ├── LSTool            (list_directory)  readonly ✅
        ├── WebFetchTool      (web_fetch)       readonly ✅
        ├── PlanReviewTool    (plan_review)     readonly ✅
        ├── AskUserTool       (ask_user)        readonly ✅
        ├── TaskOutputTool    (task_output)     readonly ✅
        ├── TodoStorageTool   (todo_create)     write
        ├── TodoListTool      (todo_list)       readonly ✅
        ├── TodoUpdateTool    (todo_update)     write
        ├── SleepTool         (sleep)           readonly ✅
        ├── EnterPlanModeTool (enter_plan_mode) readonly ✅
        ├── ExitPlanModeTool  (exit_plan_mode)  readonly ✅
        ├── NotebookEditTool  (notebook_edit)   write
        └── WorktreeTool      (enter_worktree)  write

  动态注册（init 阶段）:
        ├── MemoryStoreTool   (memory_store)    write
        ├── MemorySearchTool  (memory_search)   readonly ✅
        ├── ReminderSetTool   (reminder_set)    write
        ├── ReminderCheckTool (reminder_check)  readonly ✅
        ├── TaskTool          (task)            write
        ├── WebSearchTool     (web_search)      readonly ✅ (MCP-based)
        └── MCPToolAdapter×N  (mcp_*)           varies
```

### 5.2 工具调度策略（分段并行）

```
ToolDispatcher.executeAll(toolCalls)
  │
  ├── 1. 分段: 按原始顺序扫描，保持 LLM 发出的调用顺序
  │     └── 示例: [read, read, edit, read, write]
  │          →  段1: readonly[read,read]  (并行)
  │          →  段2: write[edit]           (串行，等段1完成)
  │          →  段3: readonly[read]        (并行)
  │          →  段4: write[write]          (串行，等段3完成)
  │
  ├── 2. 按段顺序执行:
  │     ├── readonly 段 → executeParallel()
  │     │     ├── 分批 Promise.all（每批 ≤ maxParallel 个）
  │     │     └── maxParallel = RuntimeConfig.concurrency.maxParallel ?? 5
  │     └── write 段   → execute()（逐个串行执行）
  │
  └── 3. 结果收集: Map<toolCallId, ToolResult>（保持原始顺序）
```

> **设计意图**: 只读工具（grep/glob/read_file）天然幂等可并行；写工具（edit_file/bash）之间可能有依赖，必须串行。分段策略在保证正确性的前提下最大化并行度。

### 5.3 权限控制链路（双层防护）

```
ToolRegistry.execute(name, input)
  │
  ├── Plan Mode 检查
  │     └── 写操作 + planMode=true → 返回拦截消息（不执行）
  │
  ├── PermissionController.check(request)
  │     │
  │     ├── 1. 守卫评估 evaluateGuard()
  │     │     ├── 文件工具 → FileGuard.check()
  │     │     │     ├── IgnoreFilter 检查 (.xuanji/ignore)
  │     │     │     ├── 路径匹配: 系统路径/敏感文件 → danger
  │     │     │     └── PolicyEngine 匹配自定义规则
  │     │     └── bash 工具 → CommandGuard.check()
  │     │           ├── 危险命令: rm -rf /, sudo → danger
  │     │           └── 常规命令 → safe/warn
  │     │
  │     ├── 2. 风险级别决策
  │     │     ├── safe → 直接放行 ✅
  │     │     ├── warn →
  │     │     │     ├── warnLevel='auto-allow' → 放行 ✅
  │     │     │     └── warnLevel='ask' → 进入确认流程
  │     │     └── danger → 强制确认（不可绕过）
  │     │
  │     ├── 3. 缓存查询
  │     │     ├── 会话缓存 (decisionCache) → 命中则直接返回
  │     │     └── 持久化缓存 (DecisionStore) → 命中则回填会话缓存
  │     │
  │     └── 4. UI 确认 requestConfirmation()
  │           ├── 串行确认队列（同一时刻只弹一个确认框）
  │           ├── confirmationHandler(request, guardResult)
  │           │     └── UI 层: PermissionPrompt 组件
  │           ├── 用户选择: Allow / Deny / Always / Never
  │           └── 更新缓存（Always/Never）
  │
  └── tool.execute(input, abortSignal)    // 实际执行
        └── Promise.race([
              tool.execute(),             // 工具逻辑
              timeout(5min)               // 超时保护
            ])
```

### 5.4 核心工具列表

| 工具名 | 类 | 功能 | 只读 |
|--------|-----|------|------|
| `read_file` | ReadTool | 读取文件内容（支持 PDF/图片/文本） | ✅ |
| `write_file` | WriteTool | 创建/覆盖文件 | ❌ |
| `edit_file` | EditTool | 精确字符串替换 | ❌ |
| `multi_edit` | MultiEditTool | 批量多文件编辑 | ❌ |
| `bash` | BashTool | 执行 shell 命令（持久化 shell） | ❌ |
| `glob` | GlobTool | 文件路径匹配 | ✅ |
| `grep` | GrepTool | 内容搜索（ripgrep） | ✅ |
| `list_directory` | LSTool | 列出目录内容 | ✅ |
| `web_fetch` | WebFetchTool | 抓取网页内容并转 Markdown | ✅ |
| `plan_review` | PlanReviewTool | 提交执行计划供用户审查 | ✅ |
| `ask_user` | AskUserTool | 向用户提问 | ✅ |
| `task` | TaskTool | 启动子代理 | ❌ |
| `task_output` | TaskOutputTool | 查询后台任务输出 | ✅ |
| `memory_store` | MemoryStoreTool | 存储长期记忆 | ❌ |
| `memory_search` | MemorySearchTool | 搜索长期记忆 | ✅ |
| `reminder_set` | ReminderSetTool | 设置提醒 | ❌ |
| `reminder_check` | ReminderCheckTool | 检查提醒 | ✅ |
| `todo_create` | TodoStorageTool | 创建 TODO 任务 | ❌ |
| `todo_list` | TodoListTool | 列出 TODO | ✅ |
| `todo_update` | TodoUpdateTool | 更新 TODO | ❌ |
| `sleep` | SleepTool | 等待指定秒数 | ✅ |
| `enter_plan_mode` | EnterPlanModeTool | 进入只读规划模式 | ✅ |
| `exit_plan_mode` | ExitPlanModeTool | 退出规划模式 | ✅ |
| `notebook_edit` | NotebookEditTool | 编辑 Jupyter Notebook | ❌ |
| `enter_worktree` | WorktreeTool | Git Worktree 管理 | ❌ |

---

## 6. LLM Provider 链路

```
ProviderFactory
  ├── AnthropicProvider
  │     ├── isSupported(): /^claude-/
  │     └── stream(messages, tools, config)
  │           ├── new Anthropic({ apiKey, baseURL })
  │           ├── client.messages.stream({
  │           │     model, messages, tools, max_tokens,
  │           │     system: systemPrompt
  │           │   })
  │           └── yield* 转换为统一 StreamEvent:
  │                 ├── { type: 'text_delta', text }
  │                 ├── { type: 'thinking_delta', thinking }
  │                 ├── { type: 'tool_use_start', id, name }
  │                 ├── { type: 'tool_use_delta', id, input_json_delta }
  │                 ├── { type: 'tool_use_end', id, name, input }
  │                 ├── { type: 'message_stop', stopReason }
  │                 └── { type: 'usage', input, output, cacheRead, cacheWrite }
  │
  └── OpenAIProvider
        ├── isSupported(): /^(gpt-|o1-|o3-)/
        └── stream(messages, tools, config)
              ├── new OpenAI({ apiKey, baseURL })
              ├── 消息格式转换: Anthropic → OpenAI
              └── client.chat.completions.create({ stream: true })
                    └── yield* 转换为统一 StreamEvent
```

**重试策略 (RetryPolicy):**

```
shouldRetry(error, attempt, config)
  ├── 429 (Rate Limit)          → 重试 ✅ (指数退避)
  ├── 500/502/503 (Server Error) → 重试 ✅
  ├── ECONNRESET / ETIMEDOUT     → 重试 ✅
  ├── overloaded_error           → 重试 ✅
  └── 401/403/404 / 其他         → 不重试 ❌

calculateBackoff(attempt, config)
  └── min(baseDelay × 2^attempt + jitter, maxDelay)
      默认: base=1000ms, max=30000ms, jitter=±500ms
```

**错误恢复 (ErrorRecovery):**

连续错误计数器，第 1 次错误即停止循环。提供友好化的错误消息格式化（`ErrorRecovery.formatError()`），将底层 API 异常转换为用户可读信息。

---

## 7. Skill 系统链路

### 7.1 Skill 加载与注册

```
initSkillSystem()
  ├── new SkillRegistry()
  ├── initializeBuiltinSkills(registry)
  │     ├── 注册 Prompt Skills:
  │     │     ├── xuanji-assistant  (priority: 100) — 主人格定义
  │     │     ├── project-rules     (priority: 90)  — 项目规则/上下文
  │     │     ├── memory-context    (priority: 80)  — 记忆驱动上下文
  │     │     ├── code-assistant    (priority: 50)  — 编程领域专家
  │     │     ├── life-secretary    (priority: 50)  — 生活管家
  │     │     └── other-skills      (priority: 10)  — 安全/工具使用
  │     │
  │     └── 注册 Workflow Skills:
  │           ├── commit      (/commit)  — 自动生成 commit message
  │           └── review-pr   (/review)  — PR 代码审查
  │
  └── SkillLoader.load(customPath)
        └── 扫描 .xuanji/skills/ 目录
```

### 7.2 意图路由

仅在首条消息时执行，决定本次会话激活哪些 Skill（减少不必要的 System Prompt 膨胀）：

```
ChatSession.run(userMessage)  // intentRouted=false 时触发
  │
  ├── 方案 A: VectorSkillMatcher.matchSkills() (优先, 语义匹配)
  │     ├── embeddingService.embed(userMessage)  // 本地 384 维向量
  │     ├── 与预计算的 Skill Embeddings 计算余弦相似度
  │     ├── threshold > 0.3 → 匹配成功
  │     └── 返回: 核心 Skills（始终保留）+ 匹配的场景 Skills
  │
  ├── 方案 B: SkillRegistry.filterByIntent() (降级, 正则匹配)
  │     ├── 核心 Skill 始终保留 (xuanji-assistant, project-rules, ...)
  │     └── 场景 Skill 按关键词正则匹配:
  │           ├── code-assistant: /代码|编程|bug|git|npm|file.../
  │           └── life-secretary: /约会|餐厅|生日|提醒|天气.../
  │
  ├── Skill 列表有变化时:
  │     ├── skillRegistry.composeBatch(matchedIds)  // 重新渲染
  │     └── messageManager.setSystemPrompt(newPrompt)
  │
  └── 无法判断意图（无关键词匹配）→ 保留所有 Skill（安全降级）
```

### 7.3 System Prompt 组装

```
buildSystemPrompt(skillRegistry)
  │
  ├── 过滤启用的 Prompt Skills
  │     └── enabledIds.filter(id => skill.category === 'prompt')
  │
  ├── skillRegistry.composeBatch(promptSkillIds, { params })
  │     ├── 按 priority 排序 (高 → 低)
  │     ├── 递归处理依赖 (dependencies)
  │     ├── 渲染每个 Skill:
  │     │     ├── skill.render({ params })  // 自定义渲染
  │     │     └── replaceParameters(content, params)  // {{key}} 替换
  │     └── 拼接: skill1 + "\n\n" + skill2 + ...
  │
  └── 追加 Reminder Context
        └── systemPrompt += reminderContext
```

---

## 8. 记忆系统链路

```
MemoryManager (implements IMemoryStore)
  │
  ├── 存储层:
  │     ├── StorageBackend (JSONL 文件读写)
  │     │     └── ~/.xuanji/memory/long-term.jsonl
  │     ├── LongTermMemory (持久化管理)
  │     │     ├── 全局记忆: ~/.xuanji/memory/long-term.jsonl
  │     │     └── 项目记忆: {project}/.xuanji/memory/project-knowledge.jsonl
  │     └── ShortTermMemory (会话内缓存)
  │
  ├── 检索层:
  │     ├── MemoryRetriever (关键词检索 — 降级方案)
  │     │     ├── 关键词匹配
  │     │     ├── 类型过滤
  │     │     └── 时间衰减评分
  │     └── HybridRetriever (向量 + 关键词混合检索)
  │           ├── VectorStore.searchSimilar()  // 余弦相似度
  │           ├── 关键词精确匹配加权
  │           └── 时间衰减 + 访问频率加权
  │
  ├── 向量层（异步初始化，不阻塞启动）:
  │     ├── EmbeddingService (@xenova/transformers 本地模型)
  │     │     └── embed(text) → Float32Array[384]  // all-MiniLM-L6-v2
  │     └── VectorStore (SQLite + better-sqlite3)
  │           ├── ~/.xuanji/vector.db
  │           └── 余弦相似度搜索 + 纯 SQL 备份（无 sqlite-vec 时降级）
  │
  ├── 智能提取层:
  │     └── SmartMemoryExtractor
  │           ├── 分析对话 → 提取值得记忆的信息
  │           └── 使用 LLM 判断重要性和分类
  │
  └── 压缩层:
        └── MemoryCompactor
              ├── 合并相似/重复记忆
              └── 自动压缩老旧记忆

工具调用链路:

  memory_store(type, content, keywords)
    └── MemoryStoreTool.execute()
          └── memoryManager.store(entry)
                ├── longTerm.add(entry)          // JSONL 追加
                ├── shortTerm.add(entry)         // 内存缓存
                └── vectorStore.upsert(entry)    // 向量索引

  memory_search(query, type?, limit?)
    └── MemorySearchTool.execute()
          └── memoryManager.retrieve(query, options)
                ├── hybridRetriever.search()     // 向量+关键词
                │     ├── vectorStore.searchSimilar(embedding, limit)
                │     └── keywordMatch + timeDecay + accessFrequency
                └── 降级: retriever.search()     // 纯关键词
```

---

## 9. 提醒系统链路

```
ReminderEngine
  │
  ├── 存储: ~/.xuanji/reminders.jsonl
  │
  ├── 初始化链路 (ChatSession.init):
  │     ├── engine.init()                // 加载所有提醒
  │     ├── engine.checkOnStartup()      // 检查到期提醒
  │     │     ├── 过期提醒 (triggerDate < today)
  │     │     ├── 今日提醒 (triggerDate = today)
  │     │     └── 即将到来 (triggerDate ≤ today + 7)
  │     ├── engine.checkNeglectedRelationships()  // 关系维护
  │     │     └── 扫描 relationship 记忆中 lastAccessedAt > 60天
  │     └── engine.formatForPrompt()     // 注入 System Prompt
  │
  ├── 设置提醒链路:
  │     └── reminder_set(content, triggerDate, recurring?)
  │           └── ReminderSetTool.execute()
  │                 └── engine.set(reminder)
  │                       ├── 验证日期格式
  │                       ├── 生成 UUID
  │                       └── storage.append(filePath, reminder)
  │
  └── 检查提醒链路:
        └── reminder_check(includeUpcoming?, markDoneId?, dismissId?)
              └── ReminderCheckTool.execute()
                    └── engine.checkOnStartup()
                          ├── markDone → 标记已完成
                          └── dismiss → 标记已忽略
```

---

## 10. MCP 扩展链路

```
MCPManager (Singleton)
  │
  ├── initialize(config)
  │     └── for server in config.servers:
  │           ├── transport='stdio' → new MCPClient(config)
  │           │     ├── 启动子进程: spawn(command, args, { env })
  │           │     └── JSON-RPC 2.0 over stdio
  │           │
  │           └── transport='sse' → new MCPSSEClient(config)
  │                 ├── HTTP 连接到 SSE endpoint
  │                 └── JSON-RPC 2.0 over SSE
  │
  ├── getAllTools()
  │     └── for client: client.listTools()
  │           └── JSON-RPC: { method: 'tools/list' }
  │                 → MCPTool[] → MCPToolAdapter → ToolRegistry
  │
  ├── callTool(serverName, toolName, args)
  │     └── client.callTool(toolName, args)
  │           ├── JSON-RPC: { method: 'tools/call', params: { name, arguments } }
  │           └── 返回 CallToolResult { content, isError }
  │
  ├── getAllPrompts()
  │     └── for client: client.listPrompts()
  │           └── MCPPrompt[] → MCPSkillAdapter → SkillRegistry
  │
  └── 重连机制:
        ├── client.on('reconnect_failed') → 从 clients 中移除
        └── client.on('reconnected') → refreshServerTools()
              └── client.invalidateToolsCache() → client.listTools()

MCP 工具适配:

  MCPToolAdapter (Tool)
    ├── name: `mcp_${serverName}_${toolName}`
    ├── description: tool.description
    ├── input_schema: tool.inputSchema
    └── execute(input)
          └── mcpManager.callTool(serverName, toolName, input)

MCP Skill 适配:

  MCPSkillAdapter (Skill)
    ├── id: `mcp-prompt-${serverName}-${promptName}`
    ├── category: 'prompt'
    └── render()
          └── mcpManager.getPrompt(serverName, promptName, args)
```

---

## 11. Hook 系统链路

```
HookRegistry
  │
  ├── 配置加载:
  │     └── HookConfigLoader.load()
  │           ├── .xuanji/hooks.yaml (项目级)
  │           └── ~/.xuanji/hooks.yaml (全局)
  │
  ├── Handler 类型:
  │     ├── CommandHandler — 执行 shell 命令
  │     │     └── exec(handler.command, { env: context })
  │     ├── PromptHandler  — 注入 System Prompt 片段
  │     │     └── 生成 promptContent → promptInjector()
  │     └── AgentHandler   — 调用 LLM 子代理
  │           └── provider.stream(prompt + context)
  │
  ├── 事件类型:
  │     │
  │     ├── 同步事件 (emitSync, 可阻塞):
  │     │     └── PreToolUse
  │     │           ├── 检查 match.toolName 正则
  │     │           ├── blocked=true → 阻止工具执行
  │     │           ├── mockResult → 跳过真实执行
  │     │           └── modifiedInput → 修改工具参数
  │     │
  │     └── 异步事件 (emit, 不阻塞):
  │           ├── PostToolUse      — 工具执行后
  │           ├── SessionStart     — 会话开始
  │           ├── SessionEnd       — 会话结束
  │           ├── ErrorOccurred    — 错误发生
  │           ├── PreCompact       — 上下文压缩前
  │           ├── PostCompact      — 上下文压缩后
  │           ├── SubAgentStart    — 子代理启动
  │           ├── SubAgentToolUse  — 子代理使用工具
  │           └── SubAgentEnd      — 子代理结束
  │
  └── 作用域:
        ├── global   — 在所有上下文中执行
        ├── parent   — 仅在主代理中执行
        └── subagent — 仅在子代理中执行
```

---

## 12. 会话持久化链路

```
SessionManager + CheckpointManager
  │
  ├── 存储位置: ~/.xuanji/sessions/{sessionId}/
  │     ├── metadata.json    — 会话元数据
  │     ├── messages.jsonl   — 消息历史
  │     └── checkpoints.jsonl — 检查点
  │
  ├── 保存会话:
  │     └── session.saveSession(name?)
  │           └── SessionManager.save(messages, name)
  │                 ├── 生成 sessionId (UUID)
  │                 ├── 生成元数据:
  │                 │     ├── name (首条消息前30字)
  │                 │     ├── messageCount
  │                 │     ├── workingDirectory
  │                 │     ├── preview (最后Q&A摘要)
  │                 │     └── gitInfo (branch + commit)
  │                 └── SessionStorage.saveSnapshot()
  │
  ├── 自动保存:
  │     └── ChatSession.run() → afterRun()
  │           └── 每 5 轮自动保存 (turnCount % 5 === 0)
  │
  ├── 恢复会话:
  │     └── session.resumeSession(sessionId)
  │           ├── SessionManager.resume(sessionId)
  │           │     └── SessionStorage.loadSnapshot()
  │           └── agentLoop.restoreMessages(messages)
  │
  ├── 创建检查点:
  │     └── session.createCheckpoint(label?)
  │           └── CheckpointManager.create(sessionId, messages, label)
  │                 └── 保存当前消息快照到 checkpoints.jsonl
  │
  └── 回滚检查点:
        └── session.rewindToCheckpoint(checkpointId)
              ├── CheckpointManager.restore(sessionId, checkpointId)
              │     └── 截取消息到检查点位置
              └── agentLoop.restoreMessages(messages)
```

---

## 13. 子代理 (SubAgent) 链路

```
TaskTool.execute({ description, subagent_type, include_parent_context, isolation, timeout })
  │
  ├── 1. 验证并发限制
  │     └── activeSubAgents >= MAX_CONCURRENT_SUBAGENTS(3) → 拒绝
  │
  ├── 2. 构建 SubAgentContext
  │     └── new SubAgentContext({
  │           task: description,
  │           parentContext: include_parent_context ? summary : undefined,
  │           role: subagent_type,     // general-purpose|explore|plan|coder
  │           isolation: isolation,     // none|worktree
  │           timeout: timeout,         // 默认 300_000ms
  │           depth: parentDepth + 1,   // 最大深度 3
  │         })
  │         ├── role='explore'|'plan' → 额外限制写工具
  │         ├── role='explore' → 使用轻量模型
  │         └── 始终排除 'task' 工具 (防递归)
  │
  ├── 3. 隔离模式处理
  │     └── isolation='worktree'
  │           └── git worktree add .xuanji/worktrees/{name}
  │
  ├── 4. 触发 SubAgentStart Hook
  │     └── hookRegistry.emit('SubAgentStart', { subAgentId, task, depth })
  │
  ├── 5. 执行子代理
  │     └── runSubAgent(context, provider, registry, config, memoryStore, hookRegistry)
  │           ├── FilteredToolRegistry (排除受限工具)
  │           ├── context.buildAgentConfig() → 定制 systemPrompt
  │           ├── new AgentLoop(provider, filteredRegistry, subConfig)
  │           ├── agentLoop.run(task)        // 独立的 ReAct 循环
  │           └── Promise.race([
  │                 agentLoop完成,
  │                 timeout定时器
  │               ])
  │
  ├── 6. 触发 SubAgentEnd Hook
  │     └── hookRegistry.emit('SubAgentEnd', { subAgentId, result })
  │
  └── 7. 返回结果
        └── SubAgentResult { result, tokensUsed, duration, timedOut, iterations }
```

---

## 14. 上下文压缩链路

```
ContextCompressor.compressAsync(messages, tokenManager, customInstruction?)
  │
  ├── 1. 检查是否需要压缩
  │     ├── token 占比 = estimateTokens(messages) / maxContextTokens
  │     └── 占比 < threshold(0.8) → 跳过
  │
  ├── 2. 触发 PreCompact Hook
  │     └── hookRegistry.emitSync('PreCompact')
  │
  ├── 3. 消息分组
  │     ├── system     — System Prompt（始终保留）
  │     ├── summary    — 之前的压缩摘要（保留）
  │     ├── important  — 包含决策关键词的消息（保留）
  │     ├── recent     — 最近 N 轮（保留, keepRecentRounds=5）
  │     └── old        — 可压缩的旧消息（压缩目标）
  │
  ├── 4. LLM 语义压缩（可用时）
  │     ├── 构建压缩 prompt (COMPRESSION_PROMPT)
  │     ├── provider.stream(压缩请求)
  │     └── 获取结构化摘要:
  │           ├── Primary Request & Intent
  │           ├── Implementation Path
  │           ├── Key Files Modified/Created
  │           ├── Errors & Fixes
  │           └── Current Progress
  │
  ├── 5. 降级: 截断压缩（LLM 不可用时）
  │     └── 直接丢弃 old 组的消息
  │
  ├── 6. 触发 PostCompact Hook
  │     └── hookRegistry.emit('PostCompact')
  │
  └── 7. 返回 CompressionResult
        ├── compressed: Message[]      // 压缩后的消息
        ├── originalTokens: number
        ├── compressedTokens: number
        └── compressionRatio: number
```

---

## 15. 配置加载链路

```
ConfigLoader.load()
  │
  ├── 层级 1: DEFAULT_CONFIG              // 硬编码默认值
  │     ├── provider: { model, maxTokens, temperature }
  │     ├── tools: { permissions: { level, warnLevel } }
  │     ├── skills: { enabled: [...], loadCustom }
  │     ├── memory: { enabled, decayHalfLifeDays }
  │     ├── session: { autoSave, maxSessions }
  │     └── ui: { theme, language }
  │
  ├── 层级 2: loadGlobalConfig()          // ~/.xuanji/config.json
  │     └── deepMergeConfig(default, global)
  │
  ├── 层级 3: loadProjectConfig()         // .xuanji/config.json
  │     └── deepMergeConfig(merged, project)
  │
  ├── 层级 4: 环境变量
  │     ├── getEnvProviderConfig()
  │     │     ├── XUANJI_API_KEY → provider.apiKey
  │     │     ├── XUANJI_BASE_URL → provider.baseURL
  │     │     ├── XUANJI_MODEL → provider.model
  │     │     └── XUANJI_MAX_TOKENS → provider.maxTokens
  │     ├── getEnvUIConfig()
  │     │     └── XUANJI_THEME / XUANJI_LANGUAGE
  │     └── getEnvMemoryConfig()
  │           └── XUANJI_MEMORY_ENABLED
  │
  └── 层级 5: loadMCPConfig()             // ~/.xuanji/mcp.json (独立文件)
        └── config.mcp = mcpConfig

  优先级: CLI参数 > 环境变量 > 项目配置 > 全局配置 > 默认值
```

---

## 16. 遥测与费用追踪链路

```
遥测记录:

  SessionRecorder
    └── ~/.xuanji/telemetry/sessions.jsonl
          ├── timestamp, model
          ├── input/output tokens
          ├── cacheRead/cacheWrite
          └── durationMs

  UsageStatsRecorder
    └── ~/.xuanji/telemetry/usage-stats.jsonl
          ├── sessionId, model
          ├── tokens (input/output/cache)
          ├── iterations
          ├── toolCalls: [{ name, count, durationMs, errorCount }]
          └── durationMs

  AuditLogger
    └── ~/.xuanji/telemetry/audit.jsonl
          ├── 权限检查记录
          └── 计划审查记录

  PerfCollector
    └── ~/.xuanji/telemetry/perf.jsonl
          ├── model, iteration
          ├── ttft (time to first token)
          └── totalMs, inputTokens, outputTokens

费用追踪:

  CostTracker
    ├── PricingResolver — 三级降级获取模型定价:
    │     ├── Level 1: 本地配置 (config.json 自定义模型定价)
    │     ├── Level 2: 远程缓存 (shibit.net 定价 API, 异步预加载)
    │     └── Level 3: 内置默认定价表 (BUILTIN_PRICING 硬编码)
    │     注: PricingResolver 在 createAgentLoop 阶段异步初始化,
    │         远程定价获取失败不影响启动。
    │
    └── calculateCost(usage)
          ├── input_cost      = input_tokens / 1M × inputPerMillion
          ├── output_cost     = output_tokens / 1M × outputPerMillion
          ├── cache_read_cost = cacheRead / 1M × cacheReadPerMillion
          └── total = input_cost + output_cost + cache_read_cost
```

---

## 附录 A: 数据文件位置

> **清理链路**: 所有子系统资源在退出时由 `ChatSession.cleanup()` 统一回收：
> MCP 子进程关闭 → MemoryManager 数据库连接关闭 → PersistentShell bash 进程关闭 → BackgroundTaskManager 重置 → 最终会话保存。
> 进程信号 SIGINT/SIGTERM 均绑定到 `cleanup()` 实现优雅退出。

| 文件 | 路径 | 格式 | 用途 |
|------|------|------|------|
| 全局配置 | `~/.xuanji/config.json` | JSON | 用户全局设置 |
| 项目配置 | `.xuanji/config.json` | JSON | 项目级覆盖 |
| MCP 配置 | `~/.xuanji/mcp.json` | JSON | MCP 服务器列表 |
| Hook 配置 | `.xuanji/hooks.yaml` | YAML | 事件钩子定义 |
| Ignore 规则 | `.xuanji/ignore` | gitignore | 文件访问过滤 |
| 长期记忆 | `~/.xuanji/memory/long-term.jsonl` | JSONL | 用户记忆条目 |
| 项目知识 | `.xuanji/memory/project-knowledge.jsonl` | JSONL | 项目级知识 |
| 提醒 | `~/.xuanji/reminders.jsonl` | JSONL | 提醒列表 |
| 向量数据库 | `~/.xuanji/vector.db` | SQLite | Embedding 索引 |
| 会话存档 | `~/.xuanji/sessions/{id}/` | 目录 | 会话快照 |
| 权限决策 | `.xuanji/permission-decisions.json` | JSON | 持久化决策缓存 |
| 会话统计 | `~/.xuanji/telemetry/sessions.jsonl` | JSONL | 会话级遥测 |
| 使用统计 | `~/.xuanji/telemetry/usage-stats.jsonl` | JSONL | 详细使用数据 |
| 审计日志 | `~/.xuanji/telemetry/audit.jsonl` | JSONL | 权限审计 |
| 性能指标 | `~/.xuanji/telemetry/perf.jsonl` | JSONL | TTFT/延迟等 |

---

## 附录 B: 关键文件索引

| 模块 | 文件路径 | 核心类/函数 |
|------|----------|-------------|
| 入口 | `src/index.ts` | `main()`, `startBot()`, `startGui()` |
| 会话 | `src/core/chat/ChatSession.ts` | `ChatSession` |
| Agent | `src/core/agent/AgentLoop.ts` | `AgentLoop` |
| 消息 | `src/core/agent/MessageManager.ts` | `MessageManager` |
| 流处理 | `src/core/agent/StreamProcessor.ts` | `StreamProcessor` |
| 工具调度 | `src/core/agent/ToolDispatcher.ts` | `ToolDispatcher` |
| Token | `src/core/agent/TokenManager.ts` | `TokenManager` |
| 压缩 | `src/core/agent/ContextCompressor.ts` | `ContextCompressor` |
| 费用 | `src/core/agent/CostTracker.ts` | `CostTracker` |
| 子代理 | `src/core/agent/SubAgentLoop.ts` | `runSubAgent()` |
| 子代理上下文 | `src/core/agent/SubAgentContext.ts` | `SubAgentContext` |
| 工具注册表 | `src/core/tools/ToolRegistry.ts` | `ToolRegistry` |
| Provider | `src/core/providers/ProviderFactory.ts` | `ProviderFactory` |
| Anthropic | `src/core/providers/AnthropicProvider.ts` | `AnthropicProvider` |
| OpenAI | `src/core/providers/OpenAIProvider.ts` | `OpenAIProvider` |
| 配置 | `src/core/config/ConfigLoader.ts` | `ConfigLoader` |
| 权限 | `src/permission/PermissionController.ts` | `PermissionController` |
| Skill | `src/core/skills/registry.ts` | `SkillRegistry` |
| 向量匹配 | `src/core/skills/VectorSkillMatcher.ts` | `VectorSkillMatcher` |
| 记忆 | `src/memory/MemoryManager.ts` | `MemoryManager` |
| 向量存储 | `src/embedding/VectorStore.ts` | `VectorStore` |
| Embedding | `src/embedding/EmbeddingService.ts` | `EmbeddingService` |
| 提醒 | `src/reminder/ReminderEngine.ts` | `ReminderEngine` |
| MCP | `src/mcp/MCPManager.ts` | `MCPManager` |
| MCP Client | `src/mcp/MCPClient.ts` | `MCPClient` |
| Hook | `src/hooks/HookRegistry.ts` | `HookRegistry` |
| 会话存储 | `src/session/SessionManager.ts` | `SessionManager` |
| CLI UI | `src/adapters/cli/App.tsx` | `App` |
| IM 适配器 | `src/adapters/im/IMAdapter.ts` | `IMAdapter` |
| 错误恢复 | `src/core/agent/ErrorRecovery.ts` | `ErrorRecovery` |
| 定价解析 | `src/core/agent/PricingResolver.ts` | `PricingResolver` |
| 后台任务 | `src/core/tools/BackgroundTaskManager.ts` | `BackgroundTaskManager` |
| 持久Shell | `src/core/tools/PersistentShell.ts` | `PersistentShell` |
| 文件守卫 | `src/permission/guards/FileGuard.ts` | `FileGuard` |
| 命令守卫 | `src/permission/guards/CommandGuard.ts` | `CommandGuard` |
| 策略引擎 | `src/permission/policies/PolicyEngine.ts` | `PolicyEngine` |
| Ignore过滤 | `src/permission/policies/IgnoreFilter.ts` | `IgnoreFilter` |
| 会话存储 | `src/session/SessionStorage.ts` | `SessionStorage` |
| 检查点 | `src/session/CheckpointManager.ts` | `CheckpointManager` |
