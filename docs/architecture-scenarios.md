# Xuanji 业务场景全景分析

> 更新日期：2026-05-03 | 基于 `feature/async-agent-task` 分支 | 反映最新架构（AgentLoop 精简版、AgentFactory、Infrastructure 层、Desktop Electron）

---

## 一、核心 ER 图 — 组件关系全景

```mermaid
erDiagram
    ChatSession ||--|| ConversationManager : "对话生命周期"
    ChatSession ||--|| TaskOrchestrator : "任务编排"
    ChatSession ||--|| AgentLoop : "ReAct循环"
    ChatSession ||--|| DependencyContainer : "DI容器"

    ConversationManager ||--|| InputReceiver : "输入解析"
    ConversationManager ||--|| prompt_IntentAnalyzer : "意图分析"
    ConversationManager ||--|| StateTracker : "状态机"
    ConversationManager ||--|| RoutingDecider : "路由决策"
    ConversationManager ||--|| ResponseDispatcher : "响应分发"
    ConversationManager ||--|| LayeredPromptBuilder : "分层提示构建"

    prompt_IntentAnalyzer {
        string method "LLM→Embedding→Keyword"
        string fallback "general/general/standard"
    }

    StateTracker {
        string state "idle|analyzing|executing|outputting|waiting_async"
    }

    RoutingDecider {
        string action "delegate_single|delegate_team|execute_async|direct_answer|ask_user"
    }

    TaskOrchestrator ||--|| TaskPlanner : "步骤规划"
    TaskOrchestrator ||--|| TaskScheduler : "同步异步队列"
    TaskOrchestrator ||--|| ExecutionEngine : "逐步执行"
    TaskOrchestrator ||--|| ResultStack : "结果聚合"
    TaskOrchestrator ||--|| RetryManager : "重试管理"
    TaskOrchestrator ||--|| ProgressTracker : "进度追踪"

    TaskScheduler {
        array syncQueue "串行队列"
        array asyncPool "并发池 max=3"
    }

    AgentLoop ||--|| ContextManager : "上下文管理"
    AgentLoop ||--|| StreamPipeline : "流式管道"
    AgentLoop ||--|| ToolGateway : "工具网关"
    AgentLoop ||--|| TodoContextInjector : "Todo注入"
    AgentLoop ||--|| TaskCompletionHandler : "异步任务完成"

    ContextManager {
        int maxTokens "最大Token数"
        int reserveForOutput "输出预留"
        function checkBudget "green|yellow|red"
        function compress "summarize_early|aggressive"
    }

    StreamPipeline {
        int maxRetries "3"
        function execute "LLM调用+重试"
        function processStream "事件分发"
    }

    ToolGateway {
        function executeBatch "只读并行+写入串行"
    }

    AgentLoop ||--o| AsyncAgentTaskManager : "后台任务事件"
    AsyncAgentTaskManager {
        int maxConcurrent "3"
        int maxLifetimeMs "4小时"
        int maxCompletedTasks "20"
    }

    AgentFactory ||--|| AgentPool : "Agent池 max=10"
    AgentFactory ||--|| TemporaryAgentCreator : "临时Agent创建"
    AgentFactory ||--|| AgentConfigManager : "按Agent配置"

    TeamManager ||--|| AgentFactory : "子Agent创建"
    TeamManager {
        string strategy "sequential|parallel|hierarchical|debate|pipeline"
        int maxParallelMembers "3 (滑动窗口)"
    }

    AgentFactory {
        int MAX_CONCURRENT_SUBAGENTS "3"
        int MAX_NESTING_DEPTH "3"
        int DEFAULT_TIMEOUT "5min"
    }

    EventBus {
        array log "200条环形"
        function emit "异步+优先级"
        function emitSync "即发即弃"
    }

    ProviderPool ||--|| ProviderFactory : "适配器工厂"
    ProviderPool ||--|| FallbackManager : "故障转移"
    ProviderPool ||--|| RateLimitManager : "速率限制"

    PermissionController ||--|| FileGuard : "文件风险"
    PermissionController ||--|| CommandGuard : "命令风险"
    PermissionController ||--|| PolicyEngine : "路径匹配"
    PermissionController ||--|| PermissionCache : "决策缓存"
    PermissionController ||--|| DecisionStore : "持久化审计"

    HookRegistry {
        array events "~40种事件类型"
    }

    SessionManager ||--|| SessionStore : "SQLite持久化"
    SessionManager ||--|| CheckpointManager : "消息级快照"

    InfrastructureLayer ||--|| StorageLayer : "SQLite/File"
    InfrastructureLayer ||--|| MessageBus : "消息总线"
    InfrastructureLayer ||--|| MiddlewarePipeline : "中间件链"
    InfrastructureLayer ||--|| ConfigService : "多层配置"

    EmbeddingService ||--|| VectorStore : "向量存储"
    EmbeddingService ||--|| ModelDownloader : "本地模型下载"

    MCPManager ||--|| MCPClient : "Stdio/SSE/HTTP"
    MCPManager ||--|| MCPToolAdapter : "工具适配"
    MCPManager ||--|| WebSearchAdapter : "搜索适配器"

    SkillRegistry ||--|| SkillLoader : "技能加载"
    SkillRegistry ||--|| SkillValidator : "技能校验"

    TiangongRegistry ||--|| MCPInstaller : "MCP安装"
    TiangongRegistry ||--|| SkillInstaller : "Skill安装"

    ReminderEngine ||--|| ReminderDaemon : "后台守护"

    ChatSession ||--|| SessionManager : "会话持久化"
    AgentLoop ||--|| HookRegistry : "生命周期事件"
    AgentLoop ||--|| EventBus : "异步通知"
    TeamManager ||--|| EventBus : "团队事件"
    AsyncAgentTaskManager ||--|| EventBus : "后台任务事件"
    ToolGateway ||--|| PermissionController : "权限拦截"
```

---

## 二、状态机图 — Conversation 生命周期

```mermaid
stateDiagram-v2
    [*] --> idle : 启动/重置

    idle --> analyzing : 用户输入
    analyzing --> executing : 路由决策(执行类)
    analyzing --> outputting : 路由决策(direct_answer)
    analyzing --> idle : 路由决策(ask_user, 等待回复)

    executing --> outputting : Agent完成
    executing --> waiting_async : 启动后台任务
    executing --> idle : 取消/失败

    outputting --> idle : 输出完成
    outputting --> executing : 用户追加输入(terminate_and_restart)

    waiting_async --> executing : 后台任务完成通知
    waiting_async --> idle : 超时/取消

    idle --> executing : 新输入直接执行
    idle --> [*] : 退出
```

---

## 三、同步执行完整流程

```mermaid
sequenceDiagram
    actor User
    participant CLI as CLI App
    participant CS as ChatSession
    participant CM as ConversationManager
    participant TO as TaskOrchestrator
    participant IA as IntentAnalyzer(prompt)
    participant LP as LayeredPromptBuilder
    participant AL as AgentLoop(精简版)
    participant SP as StreamPipeline
    participant TG as ToolGateway
    participant LLM as LLM Provider
    participant AF as AgentFactory
    participant TM as TeamManager

    Note over User,TM: ─── 场景A: 同步单个 task ───

    User->>CLI: 输入 "帮我创建一个React组件"
    CLI->>CS: session.run(input)

    CS->>CM: receive(raw) → processInput
    CM->>CM: StateTracker → 'analyzing'
    CM->>IA: analyze(input)
    IA->>IA: 3层分类: LLM→Embedding→Keyword
    IA-->>CM: {scene, agent, complexity}

    alt 意图明确
        CM->>CM: RoutingDecider → delegate_single_agent
        CM->>LP: build({scene, complexity})
        LP-->>CS: systemPrompt
    else 意图模糊
        CM->>CM: RoutingDecider → ask_user (反问)
        CM-->>User: "请问你想做什么？"
    end

    CS->>TO: createTask(intent, input, 'sync')
    TO->>TO: TaskPlanner → steps[]
    TO->>TO: TaskScheduler → schedule(task)
    CM->>CM: StateTracker → 'executing'

    loop ReAct循环 (每轮, AgentLoop ~469行精简版)
        AL->>AL: ContextManager.checkBudget → green/yellow/red
        alt budget=red
            AL->>AL: ContextManager.compress('aggressive')
        end
        AL->>SP: execute(messages, toolSchemas)
        SP->>LLM: POST /messages (stream)
        LLM-->>SP: SSE stream

        alt 有工具调用
            SP-->>AL: toolCalls[]
            AL->>TG: executeBatch(toolCalls)
            Note over TG: 只读工具→并行<br/>写入工具→串行

            alt 触发子Agent(task工具)
                TG->>AF: createAndRun(agentId, options)
                AF->>AL: 创建新AgentLoop (depth+1)
                Note over AL: 嵌套深度 ≤ 3
                AL-->>AF: result
                AF-->>TG: SubAgentResult
            end

            alt 触发团队(team工具)
                TG->>TM: execute(teamConfig, goal)
                TM->>TM: loadStrategy(sequential|parallel|...)
                loop 每个成员
                    TM->>AF: createAndRun(memberAgentId)
                    AF->>AL: AgentLoop
                    AL-->>AF: result
                end
                TM-->>TG: TeamExecutionResult
            end

            TG-->>AL: ToolResult[]
            AL->>AL: 追加结果到消息历史
        else 无工具调用 (stop_reason=end_turn)
            SP-->>AL: textContent
            AL-->>CLI: onText 回调 (流式输出)
        end
    end

    AL-->>CS: AgentState
    CS->>TO: ResultStack.aggregate()
    CM->>CM: StateTracker → 'idle'
    CS-->>CLI: 完成
    CLI-->>User: 显示结果
```

---

## 四、异步执行完整流程

```mermaid
sequenceDiagram
    actor User
    participant CLI as CLI App
    participant CS as ChatSession
    participant AL as AgentLoop (主)
    participant TG as ToolGateway
    participant AT as AsyncAgentTaskManager
    participant EB as EventBus
    participant BG as 后台AgentLoop

    Note over User,BG: ─── 场景B: 异步执行 task/team ───

    User->>CLI: "在后台帮我分析这三个项目的代码质量"
    CLI->>CS: session.run(input)

    CS->>AL: run(userMessage)
    AL->>AL: ReAct循环 → 调用 task 工具
    AL->>TG: executeBatch([task_tool])

    TG->>AT: startTask({type, goal, members, executor})
    AT->>AT: 检查并发数 (running < 3?)
    alt 超过并发上限
        AT-->>TG: error "已达后台任务上限(3)"
        TG-->>AL: 错误返回
        AL-->>User: "后台任务已满，请等待"
    else 可以启动
        AT->>AT: 创建AgentTaskGroup
        AT->>EB: emit(ASYNC_TASK_STARTED)
        AT->>BG: runTask(executor) ← 后台执行
        AT-->>TG: {groupId: "at-xxx"}
        TG-->>AL: 返回groupId
        AL-->>User: "后台任务已启动 at-xxx"
    end

    Note over CS: 主AgentLoop 继续运行(不阻塞)
    CS->>CM: StateTracker → 'idle' (或 waiting_async)
    User->>CLI: 可以继续输入其他指令

    Note over BG: ─── 后台执行 ───
    BG->>BG: AgentLoop.run(goal)
    loop 后台ReAct循环
        BG->>BG: LLM调用 + 工具执行
        BG->>AT: 进度回调 progressUpdate
    end
    BG-->>AT: result

    AT->>AT: notifyCompletion()
    AT->>EB: emit(ASYNC_TASK_COMPLETED)
    EB->>AL: 触发回调 (如果AgentLoop在运行中)
    AL->>AL: _pendingTaskCompletions.push(result)
    AL->>AL: 下轮迭代注入system prompt
    AL-->>User: "[后台任务完成通知] at-xxx ✅ 已完成"
```

---

## 五、用户输入中断处理

```mermaid
sequenceDiagram
    actor User
    participant CLI as CLI App
    participant AL as AgentLoop
    participant SP as StreamPipeline
    participant CM as ConversationManager

    Note over User,CM: ─── 场景C: 同步执行中用户输入 ───

    AL->>SP: LLM流式调用中...
    SP-->>CLI: onText("正在分析...")

    User->>CLI: 输入 "不对，用TypeScript写"

    CLI->>CM: whileExecuting(input)
    CM->>CM: RoutingDecider 判断

    alt 需要完全重启
        CM-->>CLI: {action: 'terminate_and_restart'}
        CLI->>AL: interrupt(message) ← 设置_interrupted=true
        AL->>SP: abortController.abort()
        SP-->>AL: 中断当前LLM调用
        AL->>AL: 保存partialResults
        AL->>AL: 退出当前循环
        AL->>AL: run(mergedInput) ← 带上次部分结果重新开始
    else 温柔追加
        CM-->>CLI: {action: 'gentle_append'}
        CLI->>AL: appendMessage(message)
        AL->>AL: _pendingAppendMessage = message
        Note over AL: 当前迭代完成后<br/>下轮开始时处理追加消息
        AL->>AL: contextManager.addUserMessage('[用户补充] ' + msg)
    else 排队等待
        CM-->>CLI: {action: 'queue'}
        CM->>CM: _pendingQueue.push(input)
        Note over CM: 当前任务完成后<br/>消费pendingQueue
    end

    Note over User,CM: ─── 场景D: 异步执行中用户输入 ───

    Note over AL: 异步任务在后台运行
    Note over AL: 主AgentLoop已回到idle
    User->>CLI: 输入任意内容
    CLI->>CS: session.run(input)
    Note over CS: 正常处理，不受后台任务影响
    Note over CS: 后台任务完成时通过EventBus通知
```

---

## 六、执行结果返回机制

```mermaid
sequenceDiagram
    actor User
    participant CLI as CLI App
    participant AL as AgentLoop
    participant EB as EventBus
    participant AT as AsyncAgentTaskManager

    Note over User,AT: ─── 场景E: 同步执行完成返回 ───

    AL->>AL: ReAct循环结束
    AL->>CLI: callbacks.onEnd(state)
    Note over CLI: 显示最终消息<br/>(文本块 + 工具结果摘要)
    CLI->>CLI: 更新ChatMessage列表
    CLI->>CLI: 显示Token用量
    CLI->>CLI: 显示文件变更列表
    CLI->>CLI: 渲染并行工具组
    CLI-->>User: 完整执行结果

    Note over User,AT: ─── 场景F: 异步执行完成返回 ───

    Note over AT: 后台任务完成后

    alt 主AgentLoop正在运行
        AT->>EB: emit(ASYNC_TASK_COMPLETED)
        EB->>AL: 触发注册的回调
        AL->>AL: _pendingTaskCompletions.push(result)
        AL->>AL: 下次迭代_start时注入system prompt
        AL->>AL: currentIteration=1 (auto-summarize run)
        AL-->>CLI: onText("[汇总] 后台任务已完成...")
    else 主AgentLoop处于idle
        AT->>EB: emit(ASYNC_TASK_COMPLETED)
        EB->>CLI: UI监听事件
        CLI->>CLI: 显示通知 "[后台任务 at-xxx 已完成]"
    end

    User->>CLI: "/task at-xxx" (手动查询)
    CLI->>CS: task_control tool
    CS->>AT: getResult(groupId, block=true)
    AT-->>CS: result
    CS-->>CLI: 格式化输出
    CLI-->>User: 显示任务结果
```

---

## 七、Agent 执行可视化

> 注：旧版 WorkspaceMonitor（Canvas 渲染）已删除，替换为 ReactFlow + dagre 的 ExecutionFlow 组件。

```mermaid
graph TD
    subgraph "CLI 渲染层 (Ink React)"
        APP[App.tsx<br/>根组件]
        APP --> INPUT[InputHandler<br/>用户输入框]
        APP --> CHAT[消息列表<br/>Static渲染]
        APP --> SB[StatusBar<br/>状态栏]
        APP --> SP[Spinner<br/>加载动画]
        APP --> TODO[TodoPanel<br/>任务进度]

        CHAT --> MSG[ChatMessage<br/>单条消息]
        MSG --> TEXT[MarkdownRenderer<br/>文本渲染]
        MSG --> TOOL[CollapsibleToolResult<br/>工具结果折叠]
        MSG --> PARALLEL[ParallelToolGroup<br/>并行工具组]
        MSG --> SUB[SubAgentProgress<br/>子Agent进度]
        MSG --> PERM[PermissionPrompt<br/>权限确认]

        SB --> MODEL[当前模型]
        SB --> TOKENS[Token用量]
        SB --> COST[费用统计]
        SB --> STATE[Agent状态]
    end

    subgraph "Desktop 渲染层 (React + shadcn/ui)"
        DESKTOP[MainPage.tsx<br/>主页面]
        DESKTOP --> CHAT_AREA[ChatArea<br/>虚拟滚动消息列表]
        DESKTOP --> EXEC_FLOW[ExecutionFlow<br/>ReactFlow + dagre<br/>Agent执行流程图]
        DESKTOP --> EXEC_WS[ExecutionWorkspace<br/>工作区监控集成]
        DESKTOP --> RIGHT_PANEL[RightPanel<br/>上下文面板]
        DESKTOP --> TODO_FLOAT[FloatingTodoPanel<br/>浮动Todo]

        CHAT_AREA --> MSG_BUBBLE[MessageBubble<br/>Markdown + 工具展示]
        EXEC_FLOW --> AGENT_NODES[Agent节点 + 工具子节点]
        EXEC_WS --> STORE[workspaceStore<br/>意图→规划→执行→聚合]
    end

    subgraph "渲染场景(桌面端)"
        S1["场景1: 空闲态<br/>历史消息 + 输入框 + Token累计"]
        S2["场景2: 分析中<br/>IntentDialog + '正在分析意图...'"]
        S3["场景3: 流式输出<br/>逐字渲染assistant回复"]
        S4["场景4: 工具调用<br/>CollapsibleToolResult + 并行分组"]
        S5["场景5: 子Agent<br/>AgentExecutionPanel + 进度条"]
        S6["场景6: 权限弹窗<br/>PermissionDialog"]
        S7["场景7: AskUser弹窗<br/>AskUserDialog"]
        S8["场景8: 后台任务<br/>StatusBar 'N个后台任务运行中'"]
        S9["场景9: 后台完成<br/>通知注入 + AutoSummarize"]
        S10["场景10: 错误态<br/>Toast红色错误 + 重试建议"]
        S11["场景11: Todo面板<br/>FloatingTodoPanel 进度统计"]
        S12["场景12: Plan模式<br/>PlanReviewDialog"]
        S13["场景13: ExecutionFlow<br/>ReactFlow实时Agent执行图"]
        S14["场景14: 执行详情<br/>ExecutionPanel + 工具调用详情"]
    end

    S1 --> S2
    S2 --> S3
    S3 --> S4
    S4 --> S5
    S5 --> S4
    S4 --> S3
    S3 --> S1

    style S1 fill:#e1f5e1
    style S3 fill:#d4e6f1
    style S4 fill:#f9e79f
    style S6 fill:#f5b7b1
    style S10 fill:#f5b7b1
```

---

## 八、能力边界 & 并发上限

```mermaid
graph LR
    subgraph "能力矩阵"
        direction TB

        subgraph "Agent并发"
            A1["主Agent: 1个"]
            A2["子Agent(嵌套): ≤3层"]
            A3["子Agent(并行): ≤3个"]
            A4["AgentPool: ≤10个实例"]
            A5["AgentPool空闲回收: 5min"]
        end

        subgraph "任务并发"
            B1["同步队列: 1个串行"]
            B2["异步池: ≤3个并行"]
            B3["任务重试: ≤3次"]
            B4["异步任务超时: 4小时"]
            B5["完成记录保留: 20个"]
        end

        subgraph "团队并发"
            C1["并行成员窗口: ≤3"]
            C2["5种策略: sequential/parallel/hierarchical/debate/pipeline"]
            C3["Checkpoint恢复: 支持"]
            C4["Worktree隔离: 并行成员独立"]
        end

        subgraph "LLM调用"
            D1["流式重试: ≤3次"]
            D2["Provider故障转移: sequential/failover"]
            D3["速率限制: 每分钟可配置"]
            D4["Token预算: green/yellow/red"]
            D5["Context压缩: summarize_early/aggressive"]
            D6["Prompt缓存: Anthropic cache_control"]
        end

        subgraph "工具执行"
            E1["只读工具: 完全并行"]
            E2["写入工具: 严格串行"]
            E3["中间件链: permission→logging→error→timeout→plan"]
            E4["Sandbox: Bubblewrap/Seatbelt"]
        end

        subgraph "基础设施"
            F1["存储: SQLite + File双模"]
            F2["消息总线: pub/sub + 请求响应"]
            F3["配置: 多层覆盖(模板→用户→运行时→内存)"]
            F4["中间件管道: 统一拦截链"]
        end

        subgraph "扩展能力"
            G1["MCP协议: Stdio/SSE/HTTP三模"]
            G2["Web搜索: 4引擎适配(Brave/Serper/Tavily/DuckDuckGo)"]
            G3["Embedding: ONNX本地 + API远程"]
            G4["Skill系统: 注册/加载/校验/热更新"]
            G5["Tiangong注册中心: MCP/Skill发现安装"]
            G6["Reminder: Cron定时 + 守护进程"]
            G7["i18n: 中英文双语"]
        end

        subgraph "桌面端"
            H1["Electron 41: 主进程+渲染进程+Agent子进程"]
            H2["MessageBus: 三层双向IPC通信"]
            H3["子进程隔离: 避免native模块ABI冲突"]
            H4["安全存储: Electron safeStorage加密凭据"]
            H5["GUI管理: Agent/Prompt/Permission/Session"]
        end
    end
```

### 理论上限计算

| 维度 | 上限 | 说明 |
|------|------|------|
| **同时运行的Agent Loop** | 1(主) + 3(子) + 3(异步后台) = **7个** | 但每个AgentLoop独立进行LLM调用 |
| **嵌套子Agent** | **3层** | Main → SubAgent → SubSubAgent → SubSubSubAgent |
| **团队并行成员** | **3个**(滑动窗口) | 超出窗口的排队等待 |
| **同步任务队列** | **串行** | 前一个完成才执行下一个 |
| **异步任务池** | **3个并行** | 第4个启动会被拒绝 |
| **Agent实例池** | **10个** | 超出的会被驱逐(5min空闲) |
| **LLM重试** | **3次** | 指数退避 |
| **任务重试** | **3次** | 可配置maxRetries |
| **后台任务生命周期** | **4小时** | 超时自动取消 |
| **完成记录上限** | **20个**(异步) + **200条**(EventBus) | 环形覆盖 |
| **全部工具数** | **35+** | ToolRegistry统一注册 |
| **Prompt组件数** | **28个**(L0:5 + L1:17 + L2:6) + 动态L3 | 分层按需加载 |
| **MCP传输协议** | **3种**(Stdio/SSE/HTTP) | 覆盖本地+远程 |
| **Web搜索引擎** | **4种**(Brave/Serper/Tavily/DuckDuckGo) | 速率限制 |
| **桌面IPC通道** | **60+** | preload.ts contextBridge |
| **i18n语言** | **2种**(zh/en) | 运行时切换 |

---

## 九、完整场景矩阵

| # | 场景分类 | 具体场景 | 核心处理路径 | 用户可感知 |
|---|---------|---------|------------|-----------|
| 1 | 同步-单Agent | 用户输入一句话，Agent直接执行 | ConversationManager → AgentLoop(ReAct精简版) | 流式输出 + 工具调用动画 |
| 2 | 同步-单Agent复杂 | 用户输入触发多轮工具调用 | AgentLoop多轮迭代，每轮LLM→Tool→LLM | 工具折叠 + 状态栏更新 |
| 3 | 同步-子Agent | Agent调用 task 工具委托子Agent | AgentFactory.createAndRun() → 新AgentLoop | SubAgentProgress组件 |
| 4 | 同步-团队(sequential) | 逐个Agent执行，失败即停 | TeamManager → sequential策略 | 成员逐个显示进度 |
| 5 | 同步-团队(parallel) | ≤3个Agent并行执行 | TeamManager → parallel策略 + WorktreeManager | 同时显示多个子Agent进度 |
| 6 | 同步-团队(hierarchical) | Leader分解 → Worker并行 → Leader汇总 | TeamManager → hierarchical策略 + [ASSIGN:id]解析 | Leader→Worker流程可视化 |
| 7 | 同步-团队(debate) | 多轮结构化辩论 | TeamManager → debate策略 + novelty检测 | 每轮论点展示 |
| 8 | 同步-团队(pipeline) | 阶段接力，文件传递 | TeamManager → pipeline策略 | 阶段进度展示 |
| 9 | 同步-嵌套 | 子Agent内部再次调用 task 工具 | AgentFactory嵌套创建 | 叠加的进度指示 |
| 10 | 同步-Token超限 | 上下文超过90% → 自动压缩 | ContextManager.checkBudget() → compress() | 💰 提示 + 压缩通知 |
| 11 | 同步-LLM失败 | API错误 → 重试 → 故障转移 | StreamPipeline重试3次 → FallbackManager | 错误提示 + 重试状态 |
| 12 | 同步-工具被拒 | 权限控制器拦截危险操作 | PermissionController → PermissionPrompt | 弹窗询问yes/no |
| 13 | 同步-Plan模式 | 进入计划模式 → 生成计划 → 用户确认 | enter_plan_mode → plan_review | PlanConfirm组件 |
| 14 | 同步-AskUser | Agent需要用户确认/选择 | ask_user工具 → AskUserPrompt | 弹窗选择 |
| 15 | 异步-单任务 | task工具使用async模式 | AsyncAgentTaskManager.startTask() | "后台任务已启动 at-xxx" |
| 16 | 异步-团队 | team工具使用async模式 | AsyncAgentTaskManager → TeamManager后台 | "后台团队任务已启动" |
| 17 | 异步-并发上限 | 第4个异步任务被拒绝 | runningCount >= maxConcurrent → error | 提示任务已满 |
| 18 | 异步-超时 | 4小时后自动取消 | timeoutTimer → abort + fail | 超时通知 |
| 19 | 异步-主动取消 | 用户 /task_control cancel | AsyncAgentTaskManager.cancelTask() | 取消确认 |
| 20 | 异步-查询进度 | 用户 /task 查询 | AsyncAgentTaskManager.getProgress() | 进度百分比 + 耗时 |
| 21 | 异步-获取结果 | 用户 /task_control 获取 | getResult(block=true, timeout=30s) | 任务输出 |
| 22 | 中断-温柔追加 | 执行中用户输入温和补充 | ConversationManager.enqueue() → 排队消费 | 当前轮完成后再处理 |
| 23 | 中断-强制重启 | 执行中用户输入大改 | ConversationManager.interrupt() → abort + restart | 输出中断 + 带上下文重启 |
| 24 | 中断-排队等待 | 执行中用户输入排队 | ConversationManager._pendingQueue | 当前任务完成后处理 |
| 25 | 中断-异步任务期间 | 异步后台运行中用户输入新内容 | 正常处理，不受影响 | 无缝体验 |
| 26 | 会话-持久化 | 自动保存到SQLite | SessionManager.save() 60s间隔 | 下次启动可恢复 |
| 27 | 会话-恢复 | 用户启动时恢复上次会话 | SessionResumer → load from SQLite | 历史消息恢复 |
| 28 | 会话-Checkpoint | 用户手动创建快照 | CheckpointManager.create() | 可回滚点 |
| 29 | 会话-回滚 | 用户回滚到Checkpoint | CheckpointManager.rewind() | 消息恢复到快照点 |
| 30 | 意图-LLM分类 | 远程LLM分析意图 | prompt/IntentAnalyzer → LLM | "正在分析意图..." |
| 31 | 意图-向量匹配 | ONNX本地模型余弦相似度 | prompt/IntentAnalyzer → Embedding | 透明 (<50ms) |
| 32 | 意图-关键词 | 正则/关键词匹配 | prompt/IntentAnalyzer → keyword fallback | 透明 (<5ms) |
| 33 | 意图-默认 | 全失败 → general/general/standard | prompt/IntentAnalyzer → default | 直接执行 |
| 34 | Provider-多Key | 不同Agent使用独立API Key | ProviderPool → agent config覆盖全局 | 每Agent独立计费 |
| 35 | Provider-故障转移 | 主Provider失败 → 备选 | FallbackManager → sequential/failover | 切换提示 |
| 36 | Provider-本地模型 | Ollama/node-llama-cpp | LocalLlamaAdapter | 离线可用 |
| 37 | Hooks-生命周期 | ~40种事件触发自定义逻辑 | HookRegistry → 配置驱动 | 可配置行为注入 |
| 38 | MCP-Stdio | 安装本地MCP协议工具 | MCPManager → MCPClient(stdio) | 工具列表更新 |
| 39 | MCP-SSE | 连接远程SSE MCP服务 | MCPManager → MCPSSEClient | 工具列表更新 |
| 40 | MCP-HTTP | 连接HTTP MCP服务 | MCPManager → HttpMCPClient | 工具列表更新 |
| 41 | IM-Bot | 钉钉/飞书/企业微信机器人 | adapters/im/ | 通过IM使用Agent |
| 42 | 内存-记忆 | 记忆提取/检索 | MemoryManager/MemoryStore/MemoryRetriever | 上下文增强 |
| 43 | Skill-安装 | 从Tiangong安装Skill | SkillRegistry → SkillLoader → SkillValidator | 新技能可用 |
| 44 | Skill-执行 | 内置Skill (commit/review) | CommitSkill / ReviewPRSkill | 自动化工作流 |
| 45 | Embedding-本地 | ONNX本地向量模型 | EmbeddingService → VectorStore | 离线语义搜索 |
| 46 | Embedding-远程 | API远程向量模型 | EmbeddingService → EmbeddingProvider | 云端语义搜索 |
| 47 | WebSearch | 多引擎Web搜索 | MCPManager → search/adapters/ | 搜索结果注入 |
| 48 | Reminder | Cron定时提醒 | ReminderEngine → daemon | 定时通知 |
| 49 | Desktop-启动 | Electron桌面端启动 | main/index.ts → createWindow() → agent子进程 | GUI界面 |
| 50 | Desktop-消息 | 用户通过GUI发送消息 | renderer → IPC → agent-bridge → ChatSession | 同CLI体验 |
| 51 | Desktop-权限弹窗 | GUI权限确认 | PermissionDialog → IPC response → agent-bridge | 可视化确认 |
| 52 | Desktop-Agent管理 | GUI管理Agent配置 | AgentEditor → IPC → agent-bridge → AgentConfigManager | 可视化配置 |
| 53 | Desktop-Prompt编辑 | GUI编辑Prompt组件 | SystemPromptManager → IPC → PromptComponentRegistry | 可视化编辑 |
| 54 | Desktop-Session管理 | GUI管理会话 | SessionPage → IPC → SessionManager | 可视化切换 |
| 55 | Config-多层覆盖 | 模板→用户→运行时→内存 | ConfigService → ConfigFactory | 透明覆盖 |
| 56 | Middleware-工具链 | permission→logging→error→timeout | MiddlewarePipeline | 统一拦截 |
| 57 | Worktree-隔离 | git worktree并行成员隔离 | WorktreeManager → git worktree | 文件系统隔离 |

---

## 十、关键设计约束与权衡

1. **同步任务严格串行** — 前一个不完成，后续任务排队（避免状态冲突）
2. **异步任务独立执行** — 通过AsyncAgentTaskManager管理，与主AgentLoop通过EventBus通信
3. **子Agent ≤ 3层嵌套** — 防止无限递归和token爆炸
4. **写入工具必须串行** — 保证文件系统一致性
5. **只读工具完全并行** — 最大化吞吐
6. **ContextManager** — 智能压缩策略 (70%黄色预警, 90%红色强制压缩)
7. **EventBus双模式** — emit(等待处理) vs emitSync(即发即弃)，平衡可靠性与性能
8. **所有状态变更通过EventBus/Hooks** — 解耦模块间通信
9. **权限两层** — LLM自治审查(软) + 硬编码安全网(硬)
10. **团队策略灵活切换** — sequential/parallel/hierarchical/debate/pipeline 覆盖不同协作模式
11. **Agent子进程隔离** — 桌面端通过独立Node.js子进程运行ChatSession，避免Electron原生模块ABI冲突
12. **意图分类三层降级** — LLM(远程) → Embedding(本地ONNX) → Keyword(正则)，保证离线可用
13. **存储双模** — SQLite用于结构化数据(会话/权限/遥测)，File用于配置和模板
14. **MCP三模传输** — Stdio(本地)/SSE(远程推送)/HTTP(远程请求)，覆盖不同部署场景

---

## 十一、Prompt 配置体系

### 组织架构图

```mermaid
graph TD
    subgraph "覆盖优先级: 项目 > 用户 > 内置"
        direction LR
        A[".xuanji/prompts/<br/>项目级 YAML"] -->|覆盖| B[".xuanji/users/{userId}/prompts/<br/>用户级 YAML"]
        B -->|首次同步自| C["src/core/templates/prompts/<br/>内置模板 YAML"]
    end

    subgraph "Prompt 引擎"
        D["LayeredPromptBuilder<br/>分层构建器（主力）"]
        E["PromptComposer<br/>旧版构建器（备用）"]
        F["PromptComponentRegistry<br/>组件注册中心 + fs.watch 热加载"]
        G["PromptValidator<br/>校验 Token / 组件数"]
        H["LayerLoader<br/>层名解析 + 禁用过滤"]
    end

    subgraph "意图分析驱动层选择"
        I["prompt/IntentAnalyzer<br/>3 层分类: LLM → Embedding → Keyword"]
        J["conversation/IntentAnalyzer<br/>包装器，委托给 prompt IntentAnalyzer"]
    end

    subgraph "Agent 注入"
        K["Agent YAML systemPrompt<br/>src/core/templates/agents/"]
        L["AgentConfigManager<br/>per-agent 覆盖: .xuanji/agent-overrides/"]
    end

    subgraph "额外注入源"
        M["Hook 系统 PromptHandler<br/>src/hooks/handlers/PromptHandler.ts"]
        N["L3 动态组件 l3-project.ts<br/>项目扫描 + 文件索引 + 依赖分析"]
        O["协议文档 protocols/<br/>agent-team-protocol.md"]
    end

    I --> D
    J --> D
    D --> F
    C --> F
    A --> F
    B --> F
    K --> D
    L --> K
    M --> D
    N --> D
```

### 分层模型 (L0 → L3)

```
复杂度:         simple          standard          complex
─────────────────────────────────────────────────────────
L0 核心层        ✅ 始终           ✅ 始终            ✅ 始终
L1 能力层        ❌ 不加载          ✅ 场景匹配         ✅ 场景匹配
L2 行为层        ❌ 不加载          ❌ 不加载           ✅ 场景 / 通用
L3 项目上下文     ✅ 始终           ✅ 始终            ✅ 始终
```

| 层 | 目录 | 文件数 | 估算 Token | 职责 |
|----|------|--------|-----------|------|
| **L0** | `prompts/l0-*.yaml` | 5 | ~2000 | 身份 + 安全 + 任务执行 + 调度 + 规划 |
| **L1** | `prompts/l1-*.yaml` | 17 | ~300/个 | 按场景加载（写代码 / 调试 / 重构 / 审查 / 测试 / 探索 / 设计 / 部署 / 股票分析...） |
| **L2** | `prompts/l2-*.yaml` | 6 | ~3000 | 团队协调 / Agent 规则 / 编码协作 / 安全增强 / 金融分析 |
| **L3** | `prompts/l3-project.ts` | 1 (TS) | 0~2000 | 动态构建项目上下文（Git / 依赖 / 文件索引 / 规则） |

### 内置模板清单

**L0 — 核心层（始终加载）：**

| 文件 | 优先级 | Token | 内容 |
|------|--------|-------|------|
| `l0-base-identity.yaml` | 100 | 300 | Agent 身份 "Xuanji"，核心原则，回复风格 |
| `l0-main-agent.yaml` | 90 | 600 | 调度协调规则，Agent 匹配流程 |
| `l0-base-task-execution.yaml` | 90 | 200 | 任务执行原则，代码质量，工具使用 |
| `l0-safety.yaml` | 90 | 200 | 安全基线 — 禁止操作，需确认操作列表 |
| `l0-task-planning.yaml` | 85 | 700 | 任务规划管线，同步 / 异步委托决策 |

**L1 — 能力层（standard/complex 且场景匹配时加载）：**

| 文件 | 匹配场景 | 关键词 |
|------|---------|--------|
| `l1-write-code.yaml` | write_code | write/create code |
| `l1-debug.yaml` | debug | debug/fix |
| `l1-refactor.yaml` | refactor | refactor/restructure |
| `l1-review.yaml` | review | review/code review |
| `l1-test.yaml` | test | test/unittest |
| `l1-explore.yaml` | explore | explore/understand |
| `l1-plan.yaml` | plan | plan/design/architecture |
| `l1-deploy.yaml` | deploy | deploy/release |
| `l1-monitor.yaml` | monitor | monitor/watch |
| `l1-discuss.yaml` | discuss | debate/discuss |
| `l1-interaction.yaml` | interaction | interaction/UX |
| `l1-design-system.yaml` | design_system | design system/components |
| `l1-ui-design.yaml` | ui_design | UI design |
| `l1-product-plan.yaml` | product_plan | product planning |
| `l1-requirement.yaml` | requirement | requirement analysis |
| `l1-user-research.yaml` | user_research | user research |
| `l1-stock-analysis.yaml` | stock_analysis | stock/financial analysis |

**L2 — 行为层（仅 complex 任务加载）：**

| 文件 | 优先级 | Token | 场景过滤 |
|------|--------|-------|---------|
| `l2-agent-rules.yaml` | 75 | 600 | 通用（无场景过滤） |
| `l2-team-coordination.yaml` | 74 | 900 | 通用 |
| `l2-planning.yaml` | 80 | 500 | 通用 |
| `l2-safety.yaml` | 70 | 200 | 通用 |
| `l2-coding-coordination.yaml` | 73 | 800 | 编码场景（write_code, debug, refactor, test, review, explore, plan, deploy, monitor） |
| `l2-financial-analysis.yaml` | 70 | 500 | 通用 |

**Agent 模板（`src/core/templates/agents/`）— 每个 YAML 包含 `systemPrompt` 字段：**

| 文件 | 用途 |
|------|------|
| `xuanji.yaml` | 主 Agent 身份定义 "璇玑" |
| `software-engineer.yaml` | 代码架构师子 Agent |
| `product-manager.yaml` | 产品策略师子 Agent |
| `ui-designer.yaml` | UI 设计师子 Agent |
| `stock-analyst.yaml` | 股票分析师子 Agent |
| `scene-classifier.yaml` | 内部意图分类器 |

**协议文档（`src/core/templates/protocols/`）— 注入到 team 工具的 system prompt：**

| 文件 | 内容 |
|------|------|
| `agent-team-protocol.md` | Team 工具强制执行协议 |
| `agent-team-strategies.md` | 5 种策略详细指南（parallel, sequential, hierarchical, debate, pipeline） |

### 用户可编辑副本

| 路径 | 说明 |
|------|------|
| `.xuanji/users/{userId}/prompts/*.yaml` | 所有内置模板的副本，首次从内置模板同步，之后不覆盖用户修改 |
| `.xuanji/users/{userId}/agents/*.yaml` | Agent 配置的副本 |
| `.xuanji/users/{userId}/agent-overrides/{agentId}.json5` | 按 Agent 覆盖 systemPrompt / model / provider / tools |
| `.xuanji/users/{userId}/prompt.json` | 旧版用户 prompt 文件（目前空字段，未被分层构建器使用） |
| `.xuanji/prompts/` | 项目级 prompt 组件（默认空，可手动添加） |

### 主 Agent Prompt 构建流程

```
用户发消息
  → ChatSession.run(userMessage)
    → ConversationManager.receive(input)
      1. StateTracker → 'analyzing'
      2. prompt/IntentAnalyzer.analyze(userMessage, history) ← 3 层 fallback
         a. LLM 分类（远程模型，~2s）
         b. Embedding 余弦相似度（ONNX本地模型，<50ms）
         c. Keyword 正则匹配（<5ms）
         d. 默认: {scene:'general', agent:'general', complexity:'simple'}

      3. RoutingDecider.decide(state, intent) → action
      4. LayeredPromptBuilder.build({ scene, complexity, agent, matchMethod })
         a. selectComponents(scene, complexity):
            - L0: 始终加载 (~2000 tokens)
            - L1: complexity ≠ 'simple' AND scene 匹配 (~300/个)
            - L2: complexity = 'complex' AND scene 匹配 (~500-900/个)
            - L3: 始终加载（动态项目上下文，无项目则为空）
         b. 按 priority 降序排列
         c. 逐个渲染组件 → 拼接
         d. 收集 requiredTools, thinking 配置

      5. AgentLoop.run(userMessage) → ReAct 循环开始
         - 精简版 AgentLoop（469 行），内部仅依赖:
           ContextManager + StreamPipeline + ToolGateway
         - 已移除: MessageManager, TokenManager, ContextCompressor,
           StreamRetryHandler, ToolExecutionCoordinator 等
```

### 子 Agent Prompt 拼装顺序

```
AgentFactory.createAndRun(options)
  └─ LayeredPromptBuilder.buildForSubAgent()
       └─ L0: base-identity + base-task-execution  （仅核心身份）
            + "---\n# Agent 特性\n"       + agentConfig.systemPrompt   ← Agent YAML
            + "---\n# 场景增强\n"         + options.scenePrompt
            + "---\n# 任务特定指令\n"     + options.systemPrompt
            + "---\n# 项目规则\n"         + projectRules（XUANJI.md）
            + "---\n# SubAgent 模式\n"    + depth/role 标记
```

> 注意：子 Agent 不加载 L1/L2 层，只加载 L0 核心身份。场景和任务特定行为通过 Agent YAML 的 systemPrompt + 参数注入。

### 热加载机制

- `PromptComponentRegistry` 通过 `fs.watch` 监听 `.xuanji/users/{userId}/prompts/` 和 `.xuanji/prompts/`
- 修改 YAML 文件后无需重启，下次 prompt 构建时自动生效
- 禁用组件：设置 YAML 中 `enabled: false` 即可
- 桌面端 GUI 编辑器：`desktop/renderer/components/SystemPromptManager.tsx` 提供可视化编辑

### 额外注入源

| 注入源 | 触发时机 | 机制 |
|--------|---------|------|
| **Hook 系统** | PromptBuildStart / PromptBuildEnd 事件 | `hooks/handlers/PromptHandler.ts` 注入配置的 prompt 内容 |
| **L3 动态组件** | 每次 prompt 构建 | `l3-project.ts` 运行时扫描项目（Git / 依赖 / 文件索引 / 规则） |
| **TodoContextInjector** | AgentLoop.run() 开始 | 注入当前 todo 列表上下文到 system prompt 后缀 |
| **TaskCompletionHandler** | 异步任务完成 | 注入 "[后台任务完成通知]" 到 system prompt 后缀 |
| **委托完成提示** | task/agent_team 工具执行后 | 注入 "[子任务已完成]" 到 system prompt 后缀 |

### 全部 Prompt 相关源文件

| 类别 | 文件路径 |
|------|---------|
| **分层构建器** | `src/core/prompt/LayeredPromptBuilder.ts` |
| **旧版构建器** | `src/core/prompt/PromptComposer.ts` |
| **组件注册中心** | `src/core/prompt/PromptComponentRegistry.ts` |
| **Prompt 校验器** | `src/core/prompt/PromptValidator.ts` |
| **意图分析引擎** | `src/core/prompt/IntentAnalyzer.ts` (3层分类: LLM→Embedding→Keyword) |
| **对话意图包装器** | `src/core/conversation/IntentAnalyzer.ts` (委托给 prompt/IntentAnalyzer) |
| **层加载器** | `src/core/prompt/LayerLoader.ts` |
| **类型定义** | `src/core/prompt/types.ts` |
| **L3 动态组件** | `src/core/prompt/components/l3-project.ts` |
| **AgentLoop (精简版)** | `src/core/agent/AgentLoop.ts` (469行, 仅依赖: ContextManager+StreamPipeline+ToolGateway) |
| **Agent 工厂** | `src/core/agent/factory/AgentFactory.ts` (替代旧 SubAgentFactory) |
| **Agent 池** | `src/core/agent/factory/AgentPool.ts` |
| **临时Agent创建** | `src/core/agent/factory/TemporaryAgentCreator.ts` |
| **上下文管理器** | `src/core/context/ContextManager.ts` |
| **Agent 注册中心** | `src/core/agent/AgentRegistry.ts` |
| **Agent 配置管理器** | `src/core/agent/AgentConfigManager.ts` |
| **Hook Prompt 处理器** | `src/hooks/handlers/PromptHandler.ts` |
| **Hook 类型定义** | `src/hooks/types.ts` |
| **GUI Prompt 管理器** | `desktop/renderer/components/SystemPromptManager.tsx` |
| **GUI Prompt 页面** | `desktop/renderer/pages/SystemPromptPage.tsx` |

---

## 十二、Desktop Electron 架构

### 进程模型

```mermaid
graph TD
    subgraph "Electron 主进程 (main/)"
        MAIN[index.ts<br/>入口: app.whenReady]
        WINDOW[window/index.ts<br/>BrowserWindow 创建]
        IPC[ipc/index.ts<br/>10个IPC模块注册]
        AUTH[config/auth.ts<br/>safeStorage加密凭据]
        AGENT_PROC[agent/index.ts<br/>子进程生命周期管理]

        MAIN --> WINDOW
        MAIN --> IPC
        MAIN --> AUTH
        MAIN --> AGENT_PROC
    end

    subgraph "Agent 子进程 (独立Node.js)"
        BRIDGE[agent-bridge.ts<br/>ChatSession运行时<br/>2462行]
        CORE[src/core/ 全部模块<br/>通过 SessionFactory 加载]

        AGENT_PROC -->|spawn tsx/node| BRIDGE
        BRIDGE --> CORE
    end

    subgraph "渲染进程 (renderer/)"
        APP[App.tsx<br/>HashRouter + 懒加载]
        PAGES[7个页面<br/>Main/Agents/Tools/Prompt/Permissions/Settings/Login]
        STORES[9个Store<br/>Zustand + 1个Class]
        COMPONENTS[35+组件<br/>Chat/Agent/Dialog/Panel/Editor/Monitor]

        APP --> PAGES
        APP --> STORES
        APP --> COMPONENTS
    end

    IPC <-->|EnhancedMessageBus<br/>60+ IPC通道| BRIDGE
    IPC <-->|ipcMain.handle| WINDOW
    WINDOW <-->|preload.ts<br/>contextBridge| APP
```

### 核心通信机制

```
用户点击发送
  → renderer: InputArea.tsx
    → window.electron.agentSendMessage(msg)
      → preload.ts: ipcRenderer.invoke('agent:send-message', msg)
        → main: ipc/agent.ts → sendRequest('agent:send-message', msg)
          → EnhancedMessageBus → agent-bridge.ts (子进程)
            → ChatSession.run(msg)
              → AgentLoop.run(msg)  [ReAct循环]

子进程事件回流:
  AgentLoop.onText(text)
    → agent-bridge callbacks
      → EnhancedMessageBus.send('agent:text', text)
        → 自动转发 → mainWindow.webContents.send('agent:text', text)
          → renderer: window.electron.onAgentText(cb)
            → runtimeStore 更新 → React 重渲染
```

### 三层 MessageBus 架构

| 层 | 文件 | 职责 |
|----|------|------|
| **MessageBus** | `main/ipc/MessageBus.ts` | 基础: 双向消息、请求/响应超时、自动重试(指数退避)、请求取消 |
| **EnhancedMessageChannel** | `main/ipc/EnhancedMessageBus.ts` | 增强: 类型事件订阅/发布、自动转发到渲染进程 |
| **EnhancedGlobalMessageBus** | `main/ipc/GlobalMessageBus.ts` | 全局单例: 统一通道管理、setMainWindow同步 |
| **RendererMessageBus** | `renderer/utils/MessageBus.ts` | 渲染端: window.electron.on/off 封装、类型事件订阅 |

### Agent 子进程隔离

- **目的**: 避免 Electron 与 `better-sqlite3`/`sqlite-vec` 等原生模块的 ABI 冲突
- **实现**: `main/agent/index.ts` spawn 独立 Node.js 进程运行 `agent-bridge.ts`
- **通信**: `ChildMessageChannel` (基于 `child_process.send()` 的 MessageBus 实现)
- **生命周期**: 主进程 `before-quit` 时调用 `cleanupAgentProcess()` 优雅关闭

### preload.ts 暴露的 API (60+ 方法)

| 类别 | 方法数 | 示例 |
|------|--------|------|
| Auth | 5 | `authLogin`, `authLogout`, `authCheck`, `authGetSavedAccounts` |
| Agent | 8 | `agentSendMessage`, `agentInterrupt`, `agentReset`, `agentInit` |
| Streaming | 12 | `onAgentText`, `onAgentThinking`, `onAgentToolStart/End` |
| Workspace | 10 | `onWorkspaceIntentAnalysisStart/End`, `onWorkspaceTaskPlanning` |
| Settings | 3 | `settingsGetConfig`, `settingsUpdateConfig` |
| Session | 7 | `sessionSave/Resume/List/Delete`, `checkpointCreate/List/Rewind` |
| Permission | 12 | `onPermissionRequest`, `permissionRespond`, `permissionAuditList` |
| Logs | 6 | `logsRead`, `logsReadLatest`, `logsStartWatch/StopWatch` |
| Download | 6 | `downloadCreate/Cancel/ClearFinished`, `localModelCheck/Download` |
| Prompt | 5 | `promptGetComponents`, `promptToggleComponent`, `promptPreview` |

### 渲染进程 Store 架构

| Store | 类型 | 用途 |
|-------|------|------|
| `authStore` | Zustand | 登录状态、账号切换 |
| `configStore` | Zustand+persist | 用户设置(主题/语言/工作区)、Agent/工具列表 |
| `chatStore` | Zustand | 消息历史、流式状态、权限/计划/AskUser请求 |
| `runtimeStore` | Zustand | Agent运行时状态、流式文本、工具调用、Token/费用 |
| `executionStore` | Zustand | Agent执行树(团队/子Agent层级)、工具记录、Todo |
| `activeAgentStore` | Zustand | 主Agent+子Agent实时快照、多Agent元数据 |
| `workspaceStore` | Class | MainAgent工作流阶段: 意图→规划→执行→聚合 |
| `historyStore` | Zustand | 会话列表、检查点、工具调用日志 |
| `unifiedLogStore` | Zustand | 统一日志查询、实时订阅、Loki集成 |

---

## 十三、Infrastructure 基础设施层

### 概述

`src/infrastructure/` 提供通用的、与业务无关的基础设施抽象，供上层模块依赖注入使用。

```
src/infrastructure/
├── storage/          # 统一存储抽象
│   ├── interfaces.ts    # IStorage, IBatchStorage, IQueryableStorage
│   ├── SQLiteStorage.ts # better-sqlite3 实现
│   └── FileStorage.ts   # JSON 文件实现
├── config/           # 多层配置管理
│   ├── ConfigService.ts # 配置读取/写入/监听
│   ├── ConfigSources.ts # 模板默认 → 用户配置 → 运行时覆盖 → 内存
│   └── ConfigFactory.ts # 配置工厂
├── messaging/        # 消息系统
│   ├── EventBus.ts      # 发布/订阅事件总线
│   └── MessageBus.ts    # 消息历史管理+过滤查询
└── middleware/       # 中间件管道
    ├── MiddlewarePipeline.ts  # 管道执行器
    └── builtins.ts             # 内置: permission/logging/error/timeout/retry/cache
```

### 设计原则

1. **接口先行** — 所有存储通过 `IStorage` 接口访问，方便替换实现
2. **双模存储** — SQLite 用于结构化数据(会话/权限/遥测)，File 用于配置和模板
3. **配置分层** — 4层覆盖: 模板默认 → 用户配置 → 运行时覆盖 → 内存临时
4. **中间件链** — 工具执行通过可组合的中间件管道，每个中间件独立职责

---

## 十四、扩展能力模块

### 14.1 MCP 系统 (`src/mcp/`)

```
src/mcp/
├── MCPManager.ts       # MCP生命周期管理(启动/停止/健康检查)
├── MCPClient.ts        # Stdio 本地客户端
├── MCPSSEClient.ts     # SSE 远程客户端
├── HttpMCPClient.ts    # HTTP 远程客户端
├── MCPToolAdapter.ts   # 将MCP工具适配为core工具
├── ResourceDiscovery.ts # MCP资源发现
└── search/             # Web搜索子系统
    ├── RateLimiter.ts       # 速率限制
    ├── adapters/
    │   ├── BraveAdapter.ts      # Brave Search API
    │   ├── SerperAdapter.ts     # Serper.dev API
    │   ├── TavilyAdapter.ts     # Tavily Search API
    │   └── DuckDuckGoAdapter.ts # DuckDuckGo (免费)
    └── EnhancedWebSearchTool.ts # 增强搜索工具
```

### 14.2 Embedding 向量系统 (`src/embedding/`)

```
src/embedding/
├── EmbeddingService.ts    # 主服务，可配置维度
├── EmbeddingProvider.ts   # 抽象接口 + getEmbeddingProvider() 工厂
├── VectorStore.ts         # 向量存储 + 余弦相似度搜索
├── ModelDownloader.ts     # ONNX本地模型下载
└── model-cache/           # 本地模型缓存目录
```

### 14.3 Tiangong 注册中心 (`src/tiangong/`)

```
src/tiangong/
├── RegistryClient.ts      # 远程注册中心API客户端
├── MCPInstaller.ts        # MCP安装器
├── SkillInstaller.ts      # Skill安装器
└── commands/              # CLI命令: search/install/list/uninstall/subscribe
```

### 14.4 Skill 技能系统 (`src/core/skills/`)

```
src/core/skills/
├── registry.ts            # Skill注册中心
├── loader.ts              # 从文件系统加载Skill
├── validator.ts           # 校验Skill定义合法性
├── types.ts               # Skill类型定义
└── builtin/
    └── workflows/
        ├── CommitSkill.ts     # 自动生成commit
        └── ReviewPRSkill.ts   # PR审查
```

### 14.5 Reminder 提醒系统 (`src/reminder/`)

```
src/reminder/
├── ReminderEngine.ts        # 核心引擎(创建/检查/通知)
├── ReminderStatsService.ts  # 统计分析
├── ReminderStatsFormatter.ts # 格式化输出
└── daemon/                  # 后台守护进程(持久化检查)
```

### 14.6 IM Bot 适配器 (`src/adapters/im/`)

| Bot | 文件 | 协议 |
|-----|------|------|
| 钉钉 | `DingtalkBot.ts` | WebSocket Stream |
| 飞书/Lark | `FeishuBot.ts` | WebSocket |
| 企业微信 | `WecomBot.ts` | HTTP Callback |

---

## 十五、模块规模统计

| 模块 | 文件 | 关键类 | 规模 |
|------|------|--------|------|
| **AgentLoop** | `core/agent/AgentLoop.ts` | AgentLoop | 469 行 (精简版，从 1198 行重构) |
| **AgentFactory** | `core/agent/factory/AgentFactory.ts` | AgentFactory | ~800 行 |
| **TeamManager** | `core/agent/team/TeamManager.ts` | TeamManager | 2357 行 |
| **PermissionController** | `permission/PermissionController.ts` | PermissionController | 914 行 |
| **SessionManager** | `session/SessionManager.ts` | SessionManager | 444 行 |
| **AsyncAgentTaskManager** | `core/agent/async/AsyncAgentTaskManager.ts` | AsyncAgentTaskManager | 380 行 |
| **ChatSession** | `core/chat/ChatSession.ts` | ChatSession | 311 行 |
| **agent-bridge** | `desktop/main/agent-bridge.ts` | (子进程入口) | 2462 行 |
| **总 TS 文件** | `src/**/*.ts` | — | 384 个 |
