# 璇玑 (Xuanji) 整体架构集成设计

> 版本: v2.0.0
> 日期: 2026-03-14
> 作者: Shibit Team
> 目标: 全面梳理 Skill、MCP、主 Agent、子 Agent 之间的数据和调用关系

---

## 目录

1. [架构总览](#1-架构总览)
2. [核心概念与职责](#2-核心概念与职责)
3. [配置层级与加载优先级](#3-配置层级与加载优先级)
4. [数据流与调用链路](#4-数据流与调用链路)
5. [Agent 系统](#5-agent-系统)
6. [Skill 系统](#6-skill-系统)
7. [MCP 系统](#7-mcp-系统)
8. [Tool 系统](#8-tool-系统)
9. [完整初始化流程](#9-完整初始化流程)
10. [运行时交互模型](#10-运行时交互模型)
11. [最佳实践](#11-最佳实践)

---

## 1. 架构总览

### 1.1 四层架构

```
┌────────────────────────────────────────────────────────────────────────┐
│  Layer 1: 用户交互层                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │  CLI (Ink)   │  │  Desktop GUI │  │  IM Bot      │                 │
│  │  终端界面     │  │  Electron    │  │  飞书/钉钉    │                 │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                 │
└─────────┼──────────────────┼──────────────────┼─────────────────────────┘
          │                  │                  │
          └──────────────────┴──────────────────┘
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Layer 2: 会话编排层                                                    │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                        ChatSession                              │   │
│  │  • 会话生命周期管理                                              │   │
│  │  • 路由决策（直接执行 vs Multi-Agent）                           │   │
│  │  • Skill 意图匹配与注入                                          │   │
│  │  • 记忆检索与上下文构建                                           │   │
│  └────────────────────────────────────────────────────────────────┘   │
└─────────────────┬──────────────────────────────────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    ▼                           ▼
┌──────────────────┐    ┌──────────────────┐
│  直接执行模式     │    │  Multi-Agent 模式 │
│  (AgentLoop)     │    │  (智能路由)       │
└──────────────────┘    └──────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────────────┐
│  Layer 3: Agent 执行层                                                   │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐     │
│  │  AgentLoop   │  │ OrchestratorAgent│  │ ConfigurableWorker   │     │
│  │  主执行循环   │  │  任务编排器       │  │  可配置工作 Agent     │     │
│  └──────┬───────┘  └─────────┬────────┘  └──────────┬───────────┘     │
│         │                    │                       │                 │
│         └────────────────────┴───────────────────────┘                 │
│                              │                                          │
│  ┌───────────────────────────┴───────────────────────────────┐        │
│  │            SubAgentLoop (子 Agent 嵌套执行)                │        │
│  └─────────────────────────────────────────────────────────────┘       │
└─────────┬──────────────────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Layer 4: 能力资源层                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │ToolRegistry  │  │SkillRegistry │  │  MCPManager  │  │ Provider │  │
│  │  工具仓库     │  │  能力仓库     │  │  外部服务     │  │ LLM 模型 │  │
│  │              │  │              │  │              │  │          │  │
│  │ • 内置工具   │  │ • 内置 Skill │  │ • MCP Tools  │  │ Anthropic│  │
│  │ • MCP 工具   │  │ • 自定义 Skill│  │ • MCP Prompts│  │ OpenAI   │  │
│  │ • 子 Agent工具│  │ • Agent Skill│  │              │  │ Ollama   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心组件关系

```
                    ┌─────────────────┐
                    │   ChatSession   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
    ┌─────────▼─────────┐        ┌─────────▼──────────┐
    │  DirectExecution  │        │   Multi-Agent      │
    │   (AgentLoop)     │        │   (TaskRouter)     │
    └─────────┬─────────┘        └─────────┬──────────┘
              │                             │
              │                   ┌─────────▼──────────┐
              │                   │ OrchestratorAgent  │
              │                   │  + ExecutionPlan   │
              │                   └─────────┬──────────┘
              │                             │
              │                   ┌─────────▼──────────┐
              │                   │  WorkerAgent (N个) │
              │                   │ (SubAgentLoop)     │
              │                   └────────────────────┘
              │                             │
              └─────────────┬───────────────┘
                            │
                ┌───────────▼────────────┐
                │   Resource Layers      │
                ├────────────────────────┤
                │ ToolRegistry           │
                │  ├─ 内置工具 (18个)     │
                │  ├─ MCP 工具 (动态)     │
                │  └─ task (子 Agent)     │
                ├────────────────────────┤
                │ SkillRegistry          │
                │  ├─ 内置 Skill (10个)   │
                │  ├─ 自定义 Skill        │
                │  └─ MCP Skill (动态)    │
                ├────────────────────────┤
                │ MCPManager             │
                │  ├─ stdio 服务器        │
                │  └─ SSE 服务器          │
                ├────────────────────────┤
                │ Provider (LLM)         │
                │  ├─ Anthropic          │
                │  ├─ OpenAI             │
                │  └─ Ollama             │
                └────────────────────────┘
```

---

## 2. 核心概念与职责

### 2.1 Agent（代理）

**定义**: 具有独立执行能力的智能体，包含 LLM、工具集、系统提示词

| 类型 | 职责 | 实现类 | 特点 |
|------|------|--------|------|
| **Main Agent** | 直接执行用户任务 | `AgentLoop` | 单一 LLM 循环，完整工具集 |
| **Orchestrator Agent** | 任务分解与协调 | `OrchestratorAgent` | 使用 Sonnet，生成执行计划 |
| **Worker Agent** | 执行子任务 | `ConfigurableWorkerAgent` | 可配置模型/工具/权限 |
| **Sub Agent** | 嵌套执行复杂任务 | `SubAgentLoop` | 受限工具集，嵌套深度限制 |

**Agent 配置来源**:
1. **内置 Agent**: 代码硬编码（如 `router`、`code-assistant`）
2. **Agent Registry**: `~/.xuanji/agents/` 或 `.xuanji/agents/` 的 JSON5 文件
3. **Agent Skill**: Skill 系统中 `category: 'agent'` 的 Skill

### 2.2 Skill（能力）

**定义**: 可注入到 Agent 的行为配置单元

| 类别 | 用途 | 输出 | 示例 |
|------|------|------|------|
| **prompt** | 扩展 system prompt | `render()` 返回 Markdown | `xuanji-assistant`, `code-assistant` |
| **agent** | 提供 Agent 配置 | `content: AgentConfig` | `react-loop-default` |
| **workflow** | 斜杠命令流程 | `execute()` 执行逻辑 | `/commit`, `/review-pr` |

**Skill 来源**:
1. **内置 Skill**: `src/core/skills/builtin/prompts/`（10个）
2. **自定义 Skill**: `~/.xuanji/skills/` 或 `.xuanji/skills/`（递归扫描 `.ts`/`.js`/`.json`/`.yaml`）
3. **MCP Skill**: MCP 服务器的 Prompts 转换而来（`priority=70`）

**核心 Skill**（始终加载，不参与意图过滤）:
- `xuanji-assistant`, `project-rules`, `memory-context`
- `tool-guidance`, `security-rules`, `agent-rules`

### 2.3 MCP（Model Context Protocol）

**定义**: 外部服务通过标准协议接入的工具和能力

| 资源类型 | 转换目标 | 命名规则 | 优先级 |
|---------|---------|---------|-------|
| **MCP Tools** | `Tool` (MCPToolAdapter) | `{serverName}:{toolName}` | - |
| **MCP Prompts** | `Skill` (MCPSkillAdapter) | `{serverName}:{promptName}` | 70 |

**MCP 服务器类型**:
- **stdio**: 本地子进程，通过 stdin/stdout 通信
- **SSE**: 远程 HTTP 服务，通过 Server-Sent Events 通信

**配置文件**: `~/.xuanji/mcp.json`

### 2.4 Tool（工具）

**定义**: Agent 可调用的原子能力，接收参数返回结果

| 工具来源 | 数量 | 示例 |
|---------|------|------|
| **内置工具** | 18 个 | `read`, `write`, `edit`, `bash`, `grep`, `glob` |
| **MCP 工具** | 动态 | `market:stock_price`, `weather:get_weather` |
| **特殊工具** | 1 个 | `task`（启动子 Agent） |

**工具特性**:
- `readonly`: 是否只读（影响并行执行）
- `permissions`: 权限限制（文件路径、命令白名单）

---

## 3. 配置层级与加载优先级

### 3.1 配置文件层级

```
优先级: 高 → 低

1. 环境变量
   XUANJI_*

2. 项目级配置
   .xuanji/config.json

3. 全局配置
   ~/.xuanji/config.json

4. 默认配置
   src/config/defaults.ts
```

### 3.2 Agent 配置加载

```
AgentRegistry.load()
  │
  ├── 1. 扫描 ~/.xuanji/agents/*.json5
  │      └── source: 'global'
  │
  ├── 2. 扫描 .xuanji/agents/*.json5
  │      └── source: 'project'
  │
  ├── 3. 加载内置 Agent（代码硬编码）
  │      └── source: 'builtin'
  │
  └── 优先级: builtin > global > project
      （ID 冲突时，builtin 不可覆盖，global 覆盖 project）
```

### 3.3 Skill 配置加载

```
SkillRegistry.initialize()
  │
  ├── 1. 注册内置 Skill (10个)
  │      ├── xuanji-assistant (priority=100)
  │      ├── project-rules (动态优先级)
  │      ├── memory-context (priority=95)
  │      ├── code-assistant (场景 Skill)
  │      ├── life-secretary (priority=90)
  │      ├── tool-guidance, security-rules, agent-rules (priority=80)
  │      └── commit, review-pr (workflow)
  │
  ├── 2. 扫描自定义 Skill
  │      ├── ~/.xuanji/skills/**/*.{ts,js,json,yaml}
  │      └── .xuanji/skills/**/*.{ts,js,json,yaml}
  │
  └── 3. 加载 MCP Skill (priority=70)
         └── MCPManager.getAllPrompts() → MCPSkillAdapter
```

### 3.4 MCP 配置加载

```
MCPManager.initialize(config.mcp)
  │
  ├── 读取 ~/.xuanji/mcp.json
  │      {
  │        "servers": [
  │          { "name": "market", "command": "...", "env": {...} },
  │          { "name": "weather", "transport": "sse", "sseUrl": "..." }
  │        ],
  │        "timeout": 30000
  │      }
  │
  ├── 为每个 server 创建 MCPClient / MCPSSEClient
  │      └── 懒启动：首次调用时才真正连接
  │
  ├── MCPManager.getAllTools()
  │      └── 遍历 clients → client.listTools() → MCPToolAdapter
  │
  └── MCPManager.getAllPrompts()
         └── 遍历 clients → client.listPrompts() → MCPSkillAdapter
```

---

## 4. 数据流与调用链路

### 4.1 初始化阶段数据流

```
main.ts (程序入口)
  │
  ▼
ChatSession.init()
  │
  ├──> ConfigLoader.load()  ────────┐
  │      ├─ defaults.ts             │
  │      ├─ ~/.xuanji/config.json   │
  │      ├─ .xuanji/config.json     │  Config
  │      ├─ 环境变量                │  Object
  │      └─ ~/.xuanji/mcp.json      │
  │                                 │
  ├──> initProvider(config) ────────┤
  │      └─ AnthropicProvider       │
  │                                 │
  ├──> initToolRegistry() ──────────┤
  │      └─ 注册 18 个内置工具       │
  │                                 │
  ├──> initSkillSystem() ───────────┤
  │      ├─ 内置 Skill (10个)        │
  │      └─ 自定义 Skill (扫描文件)  │  ToolRegistry
  │                                 │  SkillRegistry
  ├──> initMCPSystem() ─────────────┤  MCPManager
  │      ├─ MCPManager.initialize() │  Provider
  │      ├─ getAllTools() → ToolReg │
  │      └─ getAllPrompts() → SkillReg
  │                                 │
  ├──> initMemorySystem() ──────────┤
  │      └─ MemoryManager           │
  │                                 │
  ├──> initAgentRegistry() ─────────┤
  │      ├─ 扫描 ~/.xuanji/agents/   │
  │      └─ 扫描 .xuanji/agents/     │
  │                                 │
  ├──> initTaskRouter() ────────────┤
  │      ├─ ComplexityAnalyzer      │
  │      └─ ExecutionPlanner        │
  │                                 │
  └──> createAgentLoop() ───────────┘
         └─ AgentLoop 实例
```

### 4.2 运行时执行流程（直接模式）

```
用户输入 "帮我实现用户登录功能"
  │
  ▼
ChatSession.run(userInput)
  │
  ├──> 1. TaskRouter.route(userInput)
  │       ├─ mode='never' → 直接执行
  │       ├─ mode='always' → Multi-Agent
  │       └─ mode='auto' → ComplexityAnalyzer 分析
  │             └─ 返回: { mode: 'direct', reason: 'simple-task' }
  │
  ├──> 2. Skill 意图路由 (首条消息)
  │       ├─ VectorSkillMatcher.match(userInput)
  │       │    └─ 语义匹配 → ['code-assistant', 'life-secretary', ...]
  │       └─ filterByIntent(userInput)  (降级)
  │             └─ 正则匹配 → ['code-assistant']
  │
  ├──> 3. 构建 System Prompt
  │       ├─ SkillRegistry.getEnabled()
  │       │    └─ 核心 Skill + 匹配的 Skill
  │       └─ SkillRegistry.composeBatch([...skills])
  │             ├─ xuanji-assistant.render()
  │             ├─ project-rules.render()
  │             ├─ code-assistant.render()
  │             └─ tool-guidance.render()
  │
  ├──> 4. 检索记忆上下文
  │       └─ MemoryManager.retrieve(userInput, limit=5)
  │             ├─ VectorStore 语义检索
  │             └─ 降级到 JSONL 关键词检索
  │
  ├──> 5. 准备消息列表
  │       └─ MessageManager.prepareMessages()
  │             ├─ system: [systemPrompt, memoryContext]
  │             └─ messages: [历史消息, 新用户消息]
  │
  └──> 6. AgentLoop.run(messages)
         │
         ├──> ToolRegistry.getSchemas()
         │      ├─ 内置工具 schema (18个)
         │      ├─ MCP 工具 schema (动态)
         │      └─ task 工具 schema
         │
         ├──> Provider.stream(messages, toolSchemas, config)
         │      └─ Anthropic API 流式请求
         │
         └──> StreamProcessor.process(stream)
                │
                ├─ text_delta → UI 渲染
                │
                ├─ tool_use → ToolDispatcher.executeAll(toolCalls)
                │      │
                │      ├──> PermissionController.check(tool, args)
                │      │      └─ 文件路径、命令白名单验证
                │      │
                │      ├──> ToolRegistry.execute(toolName, args)
                │      │      ├─ 内置工具: ReadTool.execute()
                │      │      ├─ MCP 工具: MCPToolAdapter.execute()
                │      │      │     └─ MCPManager.callTool(server, tool, args)
                │      │      │           └─ MCPClient.callTool() → stdio/SSE
                │      │      └─ 子 Agent: TaskTool.execute()
                │      │            └─ SubAgentLoop.run()
                │      │
                │      └──> Hook: PostToolExecution
                │
                ├─ thinking → 思考过程展示
                │
                └─ stream 结束 → 返回最终响应
```

### 4.3 运行时执行流程（Multi-Agent 模式）

```
用户输入 "帮我实现一个完整的电商系统，包括前端、后端、数据库设计"
  │
  ▼
ChatSession.run(userInput)
  │
  ├──> 1. TaskRouter.route(userInput)
  │       └─ ComplexityAnalyzer.analyze(userInput)
  │             ├─ LLM (Haiku) 分析任务复杂度
  │             └─ 返回: {
  │                   mode: 'multi-agent',
  │                   complexity: 'complex',
  │                   estimatedSteps: 25,
  │                   requiresSpecialist: true
  │                 }
  │
  ├──> 2. ExecutionPlanner.generatePlan(userInput, complexity)
  │       ├─ LLM (Sonnet) 生成执行计划
  │       └─ 返回: ExecutionPlan {
  │             taskId: 'task-001',
  │             steps: [
  │               {
  │                 id: 'step-1',
  │                 agentId: 'architect-agent',
  │                 task: '设计系统架构',
  │                 dependencies: []
  │               },
  │               {
  │                 id: 'step-2',
  │                 agentId: 'backend-agent',
  │                 task: '实现后端 API',
  │                 dependencies: ['step-1']
  │               },
  │               {
  │                 id: 'step-3',
  │                 agentId: 'frontend-agent',
  │                 task: '实现前端界面',
  │                 dependencies: ['step-1', 'step-2']
  │               }
  │             ],
  │             estimatedTokens: 50000
  │           }
  │
  ├──> 3. 用户确认执行计划
  │       └─ UI 展示计划详情，用户点击"确认执行"
  │
  └──> 4. OrchestratorAgent.execute(plan)
         │
         ├──> 按依赖顺序执行 steps
         │
         ├──> Step 1: architect-agent
         │      ├─ AgentRegistry.get('architect-agent')
         │      │     └─ 加载 ~/.xuanji/agents/architect-agent.json5
         │      │           {
         │      │             id: 'architect-agent',
         │      │             model: 'claude-3-5-sonnet-20241022',
         │      │             systemPrompt: '你是系统架构师...',
         │      │             tools: ['read', 'write', 'bash'],
         │      │             skills: { builtin: ['code-assistant'] }
         │      │           }
         │      │
         │      ├─ ConfigurableWorkerAgent.create(config)
         │      │     ├─ 创建独立 Provider (Sonnet)
         │      │     ├─ 创建 FilteredToolRegistry (仅 read/write/bash)
         │      │     └─ 构建 systemPrompt (注入 code-assistant Skill)
         │      │
         │      └─ workerAgent.run(step.task)
         │            └─ SubAgentLoop.run()  (嵌套执行)
         │                  ├─ 最大嵌套深度: 3
         │                  ├─ 并发限制: 3 个
         │                  ├─ 超时: 300s
         │                  └─ 受限工具: ALWAYS_RESTRICTED_TOOLS 不可用
         │
         ├──> Step 2: backend-agent (依赖 step-1 完成)
         │      └─ 类似 step-1 流程
         │
         ├──> Step 3: frontend-agent (依赖 step-1, step-2 完成)
         │      └─ 类似 step-1 流程
         │
         └──> 汇总结果，返回最终响应
```

---

## 5. Agent 系统

### 5.1 Agent 类型对比

| 特性 | Main Agent | Orchestrator | Worker Agent | Sub Agent |
|------|-----------|--------------|--------------|-----------|
| **实现类** | AgentLoop | OrchestratorAgent | ConfigurableWorkerAgent | SubAgentLoop |
| **调用方** | ChatSession | TaskRouter | OrchestratorAgent | TaskTool |
| **模型** | 配置指定 | Sonnet | 可配置 | 继承或指定 |
| **工具集** | 完整 | 完整 | 受限（白名单） | 受限（ALWAYS_RESTRICTED） |
| **嵌套深度** | - | - | - | 最多 3 层 |
| **并发限制** | - | - | - | 最多 3 个 |
| **超时** | 无限制 | 无限制 | 可配置 | 300s |
| **Skill** | 全部 | 核心 | 可配置 | 继承 |

### 5.2 Agent 配置格式

```json5
// ~/.xuanji/agents/code-reviewer.json5
{
  id: 'code-reviewer',
  name: 'Code Reviewer',
  version: '1.0.0',
  description: '专业代码审查 Agent，检查安全、性能、规范',
  enabled: true,
  tags: ['code', 'review', 'security'],
  capabilities: ['代码审查', '安全检查', '性能分析'],

  // 系统提示词
  systemPrompt: `你是一个专业的代码审查专家...`,

  // 模型配置
  model: {
    primary: 'claude-3-5-sonnet-20241022',
    temperature: 0.3
  },

  // 工具白名单
  tools: [
    { name: 'read', enabled: true },
    { name: 'grep', enabled: true },
    { name: 'bash', enabled: true }
  ],

  // Skill 配置
  skills: {
    builtin: ['code-assistant', 'security-rules'],
    custom: []
  },

  // 执行配置
  execution: {
    maxSteps: 20,
    timeout: 300000,
    retryOnError: false
  },

  // 权限配置
  permissions: {
    allowedTools: ['read', 'grep', 'bash'],
    allowedPaths: ['**/*'],
    deniedPaths: ['node_modules/**', '.git/**'],
    allowedCommands: ['git', 'eslint', 'prettier']
  }
}
```

### 5.3 Agent Registry 工作流

```
AgentRegistry.load()
  │
  ├──> 1. 扫描全局目录
  │      └─ globby('~/.xuanji/agents/**/*.json5')
  │           └─ 解析 JSON5 → AgentConfig[]
  │
  ├──> 2. 扫描项目目录
  │      └─ globby('.xuanji/agents/**/*.json5')
  │           └─ 解析 JSON5 → AgentConfig[]
  │
  ├──> 3. 加载内置 Agent
  │      └─ builtin/defaultAgents.ts
  │           ├─ router (RouterAgent, Haiku, tools=[])
  │           └─ code-assistant (SpecialistAgent, Sonnet, tools=all)
  │
  ├──> 4. 合并与去重
  │      └─ 优先级: builtin > global > project
  │           └─ 相同 ID → builtin 不可覆盖，global 覆盖 project
  │
  └──> 5. 验证与过滤
         ├─ 验证必填字段 (id, name, version, description)
         ├─ 验证工具依赖 (requiredTools 是否已注册)
         └─ enabled=false → 跳过
```

### 5.4 配置化 Worker Agent 创建流程

```
ConfigurableWorkerAgent.create(agentConfig, context)
  │
  ├──> 1. 创建 Provider
  │      └─ ProviderFactory.create(agentConfig.model.primary)
  │           ├─ claude-* → AnthropicProvider
  │           ├─ gpt-* → OpenAIProvider
  │           └─ llama-* → OllamaProvider
  │
  ├──> 2. 创建 FilteredToolRegistry
  │      ├─ 从主 ToolRegistry 获取全部工具
  │      ├─ 过滤: agentConfig.tools (白名单)
  │      └─ 过滤: ALWAYS_RESTRICTED_TOOLS
  │           └─ ['task'] 永远不在子 Agent 中注册
  │
  ├──> 3. 构建 System Prompt
  │      ├─ agentConfig.systemPrompt (基础提示词)
  │      ├─ 注入 Skill:
  │      │    └─ agentConfig.skills.builtin.forEach(skillId => {
  │      │          skill = SkillRegistry.get(skillId);
  │      │          systemPrompt += skill.render();
  │      │        })
  │      └─ 追加上下文 (context.previousResults, context.sharedMemory)
  │
  ├──> 4. 创建 SubAgentLoop
  │      └─ new SubAgentLoop(provider, filteredToolRegistry, config)
  │           ├─ maxDepth: 3
  │           ├─ concurrency: 3
  │           ├─ timeout: agentConfig.execution.timeout || 300000
  │           └─ permissions: agentConfig.permissions
  │
  └──> 5. 返回 WorkerAgent 实例
```

---

## 6. Skill 系统

### 6.1 Skill 分类与用途

```
Skill
  │
  ├── prompt Skill (注入 system prompt)
  │     ├─ 核心 Skill (始终加载)
  │     │    ├─ xuanji-assistant (priority=100, 人格与核心准则)
  │     │    ├─ project-rules (动态优先级, CLAUDE.md 等)
  │     │    ├─ memory-context (priority=95, 记忆上下文)
  │     │    ├─ tool-guidance (priority=80, 工具使用指导)
  │     │    ├─ security-rules (priority=80, 安全规则)
  │     │    └─ agent-rules (priority=80, Agent 行为规则)
  │     │
  │     ├─ 场景 Skill (意图匹配)
  │     │    ├─ code-assistant (编程领域)
  │     │    └─ life-secretary (priority=90, 生活秘书)
  │     │
  │     └─ MCP Skill (外部服务)
  │          └─ market:analysis_report (priority=70)
  │
  ├── agent Skill (提供 Agent 配置)
  │     ├─ react-loop-default (priority=100, 默认 ReAct 循环)
  │     └─ multi-turn-handling (priority=90, 多轮对话策略)
  │
  └── workflow Skill (斜杠命令)
        ├─ commit (priority=10, /commit)
        └─ review-pr (priority=10, /review-pr)
```

### 6.2 Skill 意图路由

```
ChatSession.run(userInput)  // 首条消息
  │
  ├──> 1. 核心 Skill 始终保留
  │      └─ CORE_SKILL_IDS = ['xuanji-assistant', 'project-rules', ...]
  │
  ├──> 2. 优先使用 VectorSkillMatcher（语义匹配）
  │      ├─ VectorSkillMatcher.match(userInput, threshold=0.3)
  │      │    ├─ userEmbedding = await EmbeddingService.embed(userInput)
  │      │    ├─ skillEmbeddings = await Promise.all(skills.map(s => embed(s.description)))
  │      │    ├─ scores = cosineSimilarity(userEmbedding, skillEmbeddings)
  │      │    └─ return skills.filter((s, i) => scores[i] >= 0.3)
  │      │
  │      └─ 返回: ['code-assistant', 'tool-guidance']  (示例)
  │
  ├──> 3. 降级使用 filterByIntent（正则匹配）
  │      └─ 关键词匹配:
  │           ├─ '代码|编程|bug|函数|类' → code-assistant
  │           └─ '提醒|日程|备忘|记住' → life-secretary
  │
  ├──> 4. 无匹配 → 全部保留（安全降级）
  │      └─ 返回所有非核心 Skill
  │
  └──> 5. 合并结果
         └─ finalSkills = CORE_SKILLS + matchedSkills
```

### 6.3 Skill 渲染与组合

```
SkillRegistry.composeBatch(skillIds, options)
  │
  ├──> 1. 获取 Skill 列表
  │      └─ skills = skillIds.map(id => SkillRegistry.get(id))
  │
  ├──> 2. 处理依赖关系
  │      └─ skills.forEach(skill => {
  │           if (skill.dependencies) {
  │             depSkills = skill.dependencies.map(id => get(id));
  │             skills.push(...depSkills);
  │           }
  │         })
  │
  ├──> 3. 去重与排序
  │      ├─ 去重: Set(skills.map(s => s.id))
  │      └─ 排序: skills.sort((a, b) => (b.priority || 50) - (a.priority || 50))
  │
  ├──> 4. 渲染每个 Skill
  │      └─ results = await Promise.all(
  │           skills.map(async skill => {
  │             if (skill.category === 'prompt') {
  │               if (skill.render) {
  │                 return await skill.render(options);
  │               } else if (skill.content) {
  │                 return renderTemplate(skill.content, options.params);
  │               }
  │             }
  │             return '';
  │           })
  │         )
  │
  └──> 5. 拼接输出
         └─ return results.filter(Boolean).join('\n\n---\n\n')
```

### 6.4 Skill 文件格式示例

#### TypeScript 格式（推荐）

```typescript
// .xuanji/skills/golang-expert.ts
import type { Skill } from 'xuanji/core/skills/types';

const golangExpert: Skill = {
  id: 'golang-expert',
  name: 'Go Expert',
  version: '1.0.0',
  description: '为 Go 语言开发提供专业指导，包括并发模式、错误处理和性能优化',
  category: 'prompt',
  tags: ['coding', 'golang'],
  priority: 80,
  requiredTools: ['read', 'write', 'bash'],

  render() {
    return `## Go 开发专家

你是一位资深 Go 语言专家，遵循以下原则：
- 优先使用标准库，避免不必要的第三方依赖
- 错误处理使用 errors.Is/As 而非字符串匹配
- 并发使用 context 传播取消信号
- 测试使用 table-driven tests 风格`.trim();
  }
};

export default golangExpert;
```

#### JSON5 格式

```json5
// .xuanji/skills/api-guidelines.json5
{
  id: 'api-guidelines',
  name: 'API Design Guidelines',
  version: '1.0.0',
  description: 'RESTful API 设计规范和最佳实践',
  category: 'prompt',
  tags: ['coding', 'api'],
  priority: 70,
  content: `## API 设计规范

1. 使用名词复数作为资源路径
2. 使用 HTTP 动词表示操作
3. 返回合适的 HTTP 状态码
4. 使用 JSON 作为响应格式`
}
```

---

## 7. MCP 系统

### 7.1 MCP 架构

```
                    ┌─────────────────┐
                    │   MCPManager    │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
    ┌─────────▼─────────┐        ┌─────────▼──────────┐
    │   MCPClient       │        │  MCPSSEClient      │
    │   (stdio)         │        │  (SSE/HTTP)        │
    └─────────┬─────────┘        └─────────┬──────────┘
              │                             │
    ┌─────────▼─────────┐        ┌─────────▼──────────┐
    │  本地 MCP Server  │        │  远程 MCP Server   │
    │  (子进程)         │        │  (HTTP 服务)        │
    └───────────────────┘        └────────────────────┘
              │                             │
              └──────────────┬──────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
    ┌─────────▼─────────┐        ┌─────────▼──────────┐
    │  MCPToolAdapter   │        │  MCPSkillAdapter   │
    │  (Tool)           │        │  (Skill)           │
    └─────────┬─────────┘        └─────────┬──────────┘
              │                             │
              ▼                             ▼
    ┌──────────────────┐        ┌──────────────────┐
    │  ToolRegistry    │        │  SkillRegistry   │
    └──────────────────┘        └──────────────────┘
```

### 7.2 MCP 工具注册流程

```
MCPManager.getAllTools()
  │
  ├──> 1. 遍历所有 MCPClient
  │      └─ clients.forEach(async (client, serverName) => {
  │           tools = await client.listTools();
  │           // tools: [{ name, description, inputSchema }]
  │         })
  │
  ├──> 2. 转换为 MCPToolAdapter
  │      └─ tools.forEach(tool => {
  │           adapter = new MCPToolAdapter(serverName, tool);
  │           // adapter.name = `${serverName}:${tool.name}`
  │           // adapter.description = tool.description
  │           // adapter.input_schema = tool.inputSchema
  │           // adapter.readonly = true  (支持并行执行)
  │         })
  │
  └──> 3. 注册到 ToolRegistry
         └─ ToolRegistry.register(adapter)
```

**工具命名示例**:
- MCP Server: `name: "market"`
- MCP Tool: `{ name: "stock_price", ... }`
- 注册后工具名: `market:stock_price`

### 7.3 MCP Skill 转换流程

```
MCPManager.getAllPrompts()
  │
  ├──> 1. 遍历所有 MCPClient
  │      └─ clients.forEach(async (client, serverName) => {
  │           prompts = await client.listPrompts();
  │           // prompts: [{ name, description, arguments }]
  │         })
  │
  ├──> 2. 转换为 MCPSkillAdapter
  │      └─ prompts.forEach(prompt => {
  │           adapter = new MCPSkillAdapter(serverName, prompt);
  │           // adapter.id = `${serverName}:${prompt.name}`
  │           // adapter.name = `${serverName}/${prompt.name}`
  │           // adapter.category = 'prompt'
  │           // adapter.priority = 70  (低于内置 Skill)
  │           // adapter.tags = ['mcp', serverName]
  │         })
  │
  └──> 3. 注册到 SkillRegistry
         └─ SkillRegistry.register(adapter)
```

**MCPSkillAdapter.render() 机制**:
```typescript
async render(options?: SkillRenderOptions): Promise<string> {
  // 每次渲染都实际调用 MCP Server 的 prompts/get
  const params = options?.params || {};
  const result = await this.mcpManager.getPrompt(
    this.serverName,
    this.prompt.name,
    params  // 所有参数转为字符串传递
  );

  // result: { description, messages: [{ role, content }] }
  return result.messages
    .map(m => m.content.text)
    .join('\n');
}
```

### 7.4 MCP 工具执行链路

```
AgentLoop: LLM 返回 tool_use { name: "market:stock_price", input: { symbol: "AAPL" } }
  │
  ▼
StreamProcessor 解析 tool_use
  │
  ▼
Hook: PreToolUse (可阻止执行)
  │
  ▼
ToolDispatcher.executeAll([toolCall])
  │
  ├──> MCP 工具 readonly=true → 参与并行批量执行
  │
  └──> ToolRegistry.execute("market:stock_price", { symbol: "AAPL" })
         │
         ├──> PermissionController.check("market:stock_price", args)
         │      └─ 权限验证通过
         │
         └──> MCPToolAdapter.execute({ symbol: "AAPL" })
                │
                └──> getMCPManager().callTool("market", "stock_price", { symbol: "AAPL" })
                       │
                       └──> MCPClient.callTool("stock_price", { symbol: "AAPL" })
                              │
                              ├─ stdio 模式:
                              │    stdin →  {
                              │               jsonrpc: "2.0",
                              │               id: 1,
                              │               method: "tools/call",
                              │               params: {
                              │                 name: "stock_price",
                              │                 arguments: { symbol: "AAPL" }
                              │               }
                              │             }
                              │    stdout ← {
                              │               jsonrpc: "2.0",
                              │               id: 1,
                              │               result: {
                              │                 content: [{ type: "text", text: "AAPL: $150.25" }]
                              │               }
                              │             }
                              │
                              └─ SSE 模式:
                                   HTTP POST (httpUrl) →  { ... }
                                   SSE (sseUrl)        ← data: { ... }
```

### 7.5 MCP 重连与容错

```
MCP Server 意外退出/连接断开
  │
  ├──> MCPClient.reconnect()
  │      ├─ 重连延迟: min(1000 * 2^(attempt-1), 30000) ms
  │      ├─ 最大重连次数: 10
  │      └─ 每次重连:
  │           ├─ stdio: 重新 spawn 子进程
  │           └─ SSE: 重新建立 SSE 连接
  │
  ├──> 重连成功:
  │      ├─ emit('reconnected')
  │      └─ MCPManager.refreshServerTools(serverName)
  │           ├─ invalidateToolsCache(serverName)
  │           ├─ listTools() → 获取最新工具
  │           ├─ listPrompts() → 获取最新 Prompts
  │           └─ onToolsChanged() → 通知外部刷新
  │
  └──> 重连失败 (10次用完):
         ├─ emit('reconnect_failed')
         └─ MCPManager: 从 clients Map 移除该服务器
              └─ 该服务器的所有工具和 Skill 不再可用
```

---

## 8. Tool 系统

### 8.1 工具分类与特性

| 工具类别 | 数量 | 特性 | 示例 |
|---------|------|------|------|
| **内置工具** | 18 | 核心功能，始终可用 | `read`, `write`, `edit`, `bash`, `grep`, `glob` |
| **MCP 工具** | 动态 | 外部服务，按需启用 | `market:stock_price`, `weather:get_weather` |
| **特殊工具** | 1 | 子 Agent 启动 | `task` |

### 8.2 内置工具清单

| 工具名 | 功能 | readonly | 权限检查 |
|--------|------|----------|---------|
| `read` | 读取文件 | ✓ | 文件路径 |
| `write` | 写入文件 | ✗ | 文件路径 |
| `edit` | 编辑文件 | ✗ | 文件路径 |
| `bash` | 执行命令 | ✗ | 命令白名单 |
| `grep` | 搜索内容 | ✓ | 文件路径 |
| `glob` | 查找文件 | ✓ | 文件路径 |
| `memory_search` | 记忆检索 | ✓ | - |
| `memory_store` | 记忆存储 | ✗ | - |
| `web_search` | 网络搜索 | ✓ | API Key |
| `web_fetch` | 网页获取 | ✓ | URL 白名单 |
| ... | ... | ... | ... |

### 8.3 工具权限控制

```
PermissionController.check(toolName, args)
  │
  ├──> 1. 工具级权限检查
  │      ├─ 工具是否在 allowedTools 列表中
  │      └─ 工具是否被禁用 (tool.enabled === false)
  │
  ├──> 2. 参数级权限检查
  │      ├─ 文件路径工具 (read/write/edit/grep/glob):
  │      │    ├─ 检查 allowedPaths 白名单
  │      │    └─ 检查 deniedPaths 黑名单
  │      │         └─ 使用 minimatch 匹配路径模式
  │      │
  │      └─ 命令工具 (bash):
  │           ├─ 检查 allowedCommands 白名单
  │           └─ 危险命令检查 (rm -rf /, sudo rm, etc.)
  │
  ├──> 3. 子 Agent 特殊限制
  │      └─ ALWAYS_RESTRICTED_TOOLS = ['task']
  │           └─ 子 Agent 中永远不可用，避免无限嵌套
  │
  └──> 返回: { allowed: boolean, reason?: string }
```

### 8.4 Task 工具（子 Agent 启动）

```
TaskTool.execute(args: { task: string, config?: SubAgentConfig })
  │
  ├──> 1. 验证嵌套深度
  │      └─ if (currentDepth >= MAX_DEPTH) throw Error('超过最大嵌套深度 3')
  │
  ├──> 2. 验证并发限制
  │      └─ if (runningSubAgents >= MAX_CONCURRENCY) throw Error('超过最大并发数 3')
  │
  ├──> 3. 创建 SubAgentContext
  │      └─ context = {
  │           parentId: currentAgentId,
  │           depth: currentDepth + 1,
  │           sharedMemory: parentContext.sharedMemory,
  │           previousResults: parentContext.results
  │         }
  │
  ├──> 4. 创建 FilteredToolRegistry
  │      └─ filteredTools = ToolRegistry.filter(tool => {
  │           return !ALWAYS_RESTRICTED_TOOLS.includes(tool.name);
  │         })
  │
  ├──> 5. 创建 SubAgentLoop
  │      └─ subAgent = new SubAgentLoop(
  │           provider,
  │           filteredTools,
  │           {
  │             maxDepth: 3,
  │             timeout: 300000,
  │             permissions: config?.permissions || parentPermissions
  │           }
  │         )
  │
  ├──> 6. 执行子任务
  │      └─ result = await subAgent.run(args.task)
  │
  ├──> 7. Hook: SubAgentCompleted
  │
  └──> 8. 返回结果
         └─ return {
              success: result.success,
              output: result.finalResponse,
              metadata: {
                agentId: subAgent.id,
                depth: context.depth,
                tokensUsed: result.tokensUsed
              }
            }
```

---

## 9. 完整初始化流程

### 9.1 初始化序列图

```
main.ts
  │
  ▼
ChatSession.init()
  │
  ├──> [1] ConfigLoader.load()
  │      ├─ defaults.ts
  │      ├─ ~/.xuanji/config.json
  │      ├─ .xuanji/config.json
  │      ├─ 环境变量 (XUANJI_*)
  │      └─ ~/.xuanji/mcp.json
  │
  ├──> [2] initProvider(config)
  │      └─ AnthropicProvider / OpenAIProvider / OllamaProvider
  │
  ├──> [3] initToolRegistry()
  │      └─ 注册 18 个内置工具
  │           ├─ ReadTool, WriteTool, EditTool
  │           ├─ BashTool, GrepTool, GlobTool
  │           └─ MemorySearchTool, MemoryStoreTool, ...
  │
  ├──> [4] initSkillSystem()
  │      ├─ new SkillRegistry()
  │      ├─ initializeBuiltinSkills()
  │      │    ├─ xuanji-assistant (priority=100)
  │      │    ├─ project-rules (动态)
  │      │    ├─ memory-context (priority=95)
  │      │    ├─ code-assistant (场景)
  │      │    ├─ life-secretary (priority=90)
  │      │    ├─ tool-guidance, security-rules, agent-rules (priority=80)
  │      │    └─ commit, review-pr (workflow)
  │      └─ SkillLoader.load()
  │           ├─ ~/.xuanji/skills/**/*.{ts,js,json,yaml}
  │           └─ .xuanji/skills/**/*.{ts,js,json,yaml}
  │
  ├──> [5] initMemorySystem()
  │      ├─ new MemoryManager()
  │      ├─ new VectorStore('~/.xuanji/vector.db')
  │      └─ new EmbeddingService() (异步初始化)
  │
  ├──> [6] initVectorSkillMatcherAsync()  (不阻塞启动)
  │      └─ new VectorSkillMatcher(EmbeddingService, SkillRegistry)
  │
  ├──> [7] initReminderSystem()
  │      └─ new ReminderManager()
  │
  ├──> [8] initMCPSystem()  ★★★ MCP 集成 ★★★
  │      ├─ MCPManager.initialize(config.mcp)
  │      │    ├─ 读取 ~/.xuanji/mcp.json
  │      │    └─ 创建 MCPClient / MCPSSEClient (懒启动)
  │      │
  │      ├─ mcpManager.getAllTools()
  │      │    └─ 遍历 clients → client.listTools()
  │      │         └─ MCPToolAdapter → ToolRegistry.register()
  │      │
  │      └─ mcpManager.getAllPrompts()
  │           └─ 遍历 clients → client.listPrompts()
  │                └─ MCPSkillAdapter → SkillRegistry.register()
  │
  ├──> [9] initWebSearch()
  │      └─ 注册 web_search 工具 (需 TAVILY_API_KEY / BRAVE_API_KEY)
  │
  ├──> [10] initAgentRegistry()
  │       ├─ AgentRegistry.load()
  │       │    ├─ 扫描 ~/.xuanji/agents/**/*.json5
  │       │    ├─ 扫描 .xuanji/agents/**/*.json5
  │       │    └─ 加载内置 Agent (router, code-assistant)
  │       │
  │       └─ AgentRegistry.validate()
  │            └─ 验证必填字段，验证工具依赖
  │
  ├──> [11] initTaskRouter()
  │       ├─ new TaskRouter(config.routing)
  │       ├─ new ComplexityAnalyzer(provider, config)
  │       └─ new ExecutionPlanner(provider, agentRegistry)
  │
  ├──> [12] initTaskTool()
  │       └─ 注册 task 工具 (启动子 Agent)
  │            └─ ToolRegistry.register(new TaskTool(context))
  │
  ├──> [13] buildSystemPrompt()
  │       ├─ 获取 enabled prompt Skills
  │       ├─ SkillRegistry.composeBatch([...skills])
  │       └─ 追加提醒上下文
  │
  └──> [14] createAgentLoop(systemPrompt)
         └─ new AgentLoop(provider, toolRegistry, config)
```

### 9.2 初始化依赖关系

```
ConfigLoader
  │
  ├──> Provider ──────┐
  │                   │
  ├──> ToolRegistry   │
  │                   ├──> AgentLoop
  ├──> SkillRegistry  │
  │                   │
  ├──> MCPManager ────┘
  │      ├──> ToolRegistry (注册 MCP 工具)
  │      └──> SkillRegistry (注册 MCP Skill)
  │
  ├──> MemoryManager
  │
  ├──> AgentRegistry
  │      └──> TaskRouter
  │
  └──> TaskRouter
         ├──> ComplexityAnalyzer (Provider)
         └──> ExecutionPlanner (Provider, AgentRegistry)
```

---

## 10. 运行时交互模型

### 10.1 直接执行模式（Simple Task）

```
用户: "帮我写个函数计算两个数的和"
  │
  ▼
ChatSession.run(userInput)
  │
  ├──> TaskRouter.route(userInput)
  │      └─ 返回: { mode: 'direct', reason: 'simple-task' }
  │
  ├──> Skill 意图路由 (首条消息)
  │      └─ 匹配: ['code-assistant']
  │
  ├──> 构建 System Prompt
  │      ├─ xuanji-assistant.render()
  │      ├─ project-rules.render()
  │      ├─ code-assistant.render()
  │      └─ tool-guidance.render()
  │
  ├──> 准备消息列表
  │      └─ [
  │           { role: 'user', content: '帮我写个函数计算两个数的和' }
  │         ]
  │
  └──> AgentLoop.run(messages)
         │
         ├──> Provider.stream(messages, toolSchemas)
         │      └─ LLM 返回:
         │           text: "好的，我来帮你写一个函数..."
         │           tool_use: {
         │             name: 'write',
         │             input: {
         │               path: 'sum.ts',
         │               content: 'function sum(a: number, b: number) { return a + b; }'
         │             }
         │           }
         │
         ├──> StreamProcessor.process(stream)
         │      ├─ text_delta → UI 渲染
         │      └─ tool_use → ToolDispatcher.executeAll([...])
         │
         ├──> ToolRegistry.execute('write', args)
         │      └─ WriteTool.execute()
         │           └─ fs.writeFile('sum.ts', content)
         │
         └──> 返回最终响应
                └─ "已创建文件 sum.ts，包含 sum 函数。"
```

### 10.2 Multi-Agent 模式（Complex Task）

```
用户: "帮我实现一个完整的 Todo 应用，包括前端、后端、数据库"
  │
  ▼
ChatSession.run(userInput)
  │
  ├──> TaskRouter.route(userInput)
  │      ├─ ComplexityAnalyzer.analyze(userInput)
  │      │    └─ LLM (Haiku) 返回:
  │      │         {
  │      │           complexity: 'complex',
  │      │           estimatedSteps: 30,
  │      │           requiresSpecialist: true,
  │      │           domains: ['frontend', 'backend', 'database']
  │      │         }
  │      │
  │      └─ 返回: { mode: 'multi-agent', reason: 'complexity' }
  │
  ├──> ExecutionPlanner.generatePlan(userInput, complexity)
  │      ├─ LLM (Sonnet) 生成执行计划
  │      └─ 返回: ExecutionPlan {
  │            taskId: 'task-001',
  │            steps: [
  │              {
  │                id: 'step-1',
  │                agentId: 'architect-agent',
  │                task: '设计系统架构和数据库 schema',
  │                dependencies: []
  │              },
  │              {
  │                id: 'step-2',
  │                agentId: 'backend-agent',
  │                task: '实现 RESTful API (CRUD)',
  │                dependencies: ['step-1']
  │              },
  │              {
  │                id: 'step-3',
  │                agentId: 'frontend-agent',
  │                task: '实现 React 组件和状态管理',
  │                dependencies: ['step-1', 'step-2']
  │              },
  │              {
  │                id: 'step-4',
  │                agentId: 'qa-agent',
  │                task: '编写端到端测试',
  │                dependencies: ['step-2', 'step-3']
  │              }
  │            ],
  │            estimatedTokens: 80000,
  │            estimatedTime: 1800000  // 30 分钟
  │          }
  │
  ├──> 用户确认执行计划
  │      └─ UI 展示:
  │           ┌────────────────────────────────────┐
  │           │ 执行计划预览                        │
  │           ├────────────────────────────────────┤
  │           │ 总步骤: 4                          │
  │           │ 预计耗时: 30 分钟                   │
  │           │ 预计 Token: 80,000                 │
  │           │                                    │
  │           │ 步骤详情:                          │
  │           │  1. 架构设计 (architect-agent)      │
  │           │  2. 后端实现 (backend-agent)        │
  │           │  3. 前端实现 (frontend-agent)       │
  │           │  4. 测试编写 (qa-agent)             │
  │           │                                    │
  │           │ [确认执行] [取消]                   │
  │           └────────────────────────────────────┘
  │
  └──> OrchestratorAgent.execute(plan)
         │
         ├──> Step 1: architect-agent
         │      ├─ AgentRegistry.get('architect-agent')
         │      │    └─ 加载 ~/.xuanji/agents/architect-agent.json5
         │      │
         │      ├─ ConfigurableWorkerAgent.create(config)
         │      │    ├─ Provider: Sonnet
         │      │    ├─ Tools: [read, write, bash]
         │      │    ├─ Skills: [code-assistant]
         │      │    └─ SystemPrompt: "你是系统架构师..."
         │      │
         │      └─ workerAgent.run('设计系统架构和数据库 schema')
         │           └─ SubAgentLoop.run()
         │                ├─ 生成架构文档: architecture.md
         │                ├─ 生成数据库 schema: schema.sql
         │                └─ 返回: { success: true, output: "..." }
         │
         ├──> Step 2: backend-agent (等待 step-1 完成)
         │      ├─ AgentRegistry.get('backend-agent')
         │      ├─ ConfigurableWorkerAgent.create(config)
         │      │    └─ 注入上下文: step-1 的 architecture.md
         │      └─ workerAgent.run('实现 RESTful API (CRUD)')
         │           └─ SubAgentLoop.run()
         │                ├─ 创建 server.ts
         │                ├─ 创建 routes/todos.ts
         │                ├─ 创建 models/Todo.ts
         │                └─ 返回: { success: true, output: "..." }
         │
         ├──> Step 3: frontend-agent (等待 step-1, step-2 完成)
         │      └─ ...
         │
         ├──> Step 4: qa-agent (等待 step-2, step-3 完成)
         │      └─ ...
         │
         └──> 汇总结果
                └─ 返回最终响应:
                     "Todo 应用已完成！包括：
                      - 架构设计: architecture.md
                      - 数据库: schema.sql
                      - 后端: server.ts, routes/, models/
                      - 前端: src/components/, src/stores/
                      - 测试: tests/e2e/"
```

### 10.3 子 Agent 嵌套执行（Task Tool）

```
用户: "帮我分析这个项目的代码质量"
  │
  ▼
AgentLoop.run(messages)
  │
  ├──> LLM 返回:
  │      text: "我需要先统计代码量，然后分析复杂度..."
  │      tool_use: [
  │        {
  │          name: 'task',
  │          input: {
  │            task: '统计项目代码量，按语言分类',
  │            config: {
  │              tools: ['bash', 'read'],
  │              permissions: { allowedCommands: ['cloc', 'wc'] }
  │            }
  │          }
  │        }
  │      ]
  │
  ├──> ToolDispatcher.executeAll([taskTool])
  │
  └──> TaskTool.execute(args)
         │
         ├──> 验证嵌套深度: currentDepth=0, MAX=3 ✓
         ├──> 验证并发限制: running=0, MAX=3 ✓
         │
         ├──> 创建 SubAgentContext
         │      └─ { parentId: 'main', depth: 1, sharedMemory: {} }
         │
         ├──> 创建 FilteredToolRegistry
         │      └─ 过滤: tools=['bash', 'read']
         │      └─ 排除: ALWAYS_RESTRICTED_TOOLS=['task']
         │
         ├──> 创建 SubAgentLoop
         │      └─ new SubAgentLoop(provider, filteredTools, config)
         │           ├─ maxDepth: 3
         │           ├─ timeout: 300000
         │           └─ permissions: { allowedCommands: ['cloc', 'wc'] }
         │
         ├──> SubAgentLoop.run('统计项目代码量，按语言分类')
         │      │
         │      ├──> LLM 返回:
         │      │      tool_use: { name: 'bash', input: { command: 'cloc . --json' } }
         │      │
         │      ├──> BashTool.execute({ command: 'cloc . --json' })
         │      │      └─ 权限检查: 'cloc' in allowedCommands ✓
         │      │      └─ 执行: cloc . --json
         │      │           └─ 返回: { TypeScript: 15000, JavaScript: 8000, ... }
         │      │
         │      └──> 返回: {
         │             success: true,
         │             output: "项目代码统计：\n- TypeScript: 15,000 行\n- JavaScript: 8,000 行\n...",
         │             metadata: { tokensUsed: 1200 }
         │           }
         │
         ├──> Hook: SubAgentCompleted
         │
         └──> 返回 tool_result
                └─ { success: true, output: "..." }

主 AgentLoop 继续:
  │
  ├──> LLM 收到 tool_result
  │
  └──> LLM 返回:
         tool_use: [
           {
             name: 'task',
             input: {
               task: '分析代码复杂度，生成报告',
               config: { tools: ['read', 'grep', 'write'] }
             }
           }
         ]

         ... (启动第二个子 Agent)
```

---

## 11. 最佳实践

### 11.1 Agent 配置建议

1. **模型选择**:
   - 简单任务 → Haiku（成本低、速度快）
   - 复杂任务 → Sonnet（能力强、精度高）
   - 路由 Agent → Haiku（降低路由成本）
   - Orchestrator → Sonnet（需要高质量计划）

2. **工具白名单**:
   - 最小化原则：只给 Agent 必需的工具
   - 只读 Agent → `['read', 'grep', 'glob']`
   - 代码 Agent → `['read', 'write', 'edit', 'bash']`
   - 数据 Agent → `['read', 'bash', 'web_fetch']`

3. **Skill 配置**:
   - 核心 Skill 始终启用（不需要配置）
   - 场景 Skill 按需启用（意图匹配自动筛选）
   - Agent Skill 用于自定义 Agent 行为

4. **权限配置**:
   - `allowedPaths`: 使用 glob 模式限制文件访问范围
   - `deniedPaths`: 排除敏感目录（`.git`, `node_modules`, `.env`）
   - `allowedCommands`: 命令白名单，避免危险命令

### 11.2 Skill 开发建议

1. **优先级设置**:
   - 核心人格：100
   - 项目规则：动态（根据文件存在性）
   - 记忆上下文：95
   - 生活秘书：90
   - 工具指导、安全规则、Agent 规则：80
   - 自定义 Skill：70-80
   - MCP Skill：70

2. **依赖管理**:
   - 明确声明 `requiredTools`：工具未注册时 Skill 自动禁用
   - 使用 `dependencies`：自动注入依赖 Skill
   - 避免循环依赖

3. **文件格式选择**:
   - TypeScript：推荐，支持 `render()` 动态逻辑
   - JSON5：简单静态 Skill，无动态逻辑
   - YAML：团队习惯使用 YAML 时

### 11.3 MCP 集成建议

1. **服务器命名**:
   - 使用简短、语义化的名称（`market`, `weather`, `internal`）
   - 避免特殊字符和空格

2. **工具设计**:
   - 单一职责：一个工具做一件事
   - 清晰描述：`description` 要准确，LLM 依赖它选择工具
   - 参数验证：在 MCP Server 侧做严格验证

3. **Prompt 设计**:
   - 模板化：使用 `arguments` 定义参数
   - 动态生成：每次 `render()` 都调用 MCP Server 获取最新内容
   - 优先级：MCP Skill 优先级=70，低于内置 Skill

4. **容错处理**:
   - 启用自动重连（默认最多 10 次）
   - 监听 `reconnect_failed` 事件，及时通知用户
   - 关键服务使用 SSE 模式（稳定性更好）

### 11.4 Multi-Agent 使用建议

1. **路由策略**:
   - `mode: 'auto'`：默认，自动分析任务复杂度
   - `mode: 'never'`：简单项目，始终直接执行
   - `mode: 'always'`：复杂项目，始终使用 Multi-Agent

2. **执行计划设计**:
   - 明确步骤依赖关系，避免阻塞
   - 合理评估耗时和 Token 使用
   - 步骤粒度适中（太细浪费协调成本，太粗失去并行优势）

3. **Worker Agent 配置**:
   - 每个 Worker 专注一个领域（frontend, backend, database, qa）
   - 共享上下文通过 `sharedMemory` 传递
   - 输出标准化，方便下游 Agent 使用

4. **性能优化**:
   - 路由结果缓存（首次路由后复用）
   - 工具按需加载（根据 Agent 白名单过滤）
   - 流式输出（所有 Agent 都支持）

### 11.5 子 Agent 使用建议

1. **适用场景**:
   - 复杂任务分解（如"分析项目代码质量"分为"统计代码量"+"分析复杂度"）
   - 并行执行（如同时统计前端和后端代码）
   - 权限隔离（子 Agent 受限工具集，避免危险操作）

2. **限制**:
   - 最大嵌套深度：3 层
   - 最大并发数：3 个
   - 超时时间：300s
   - 受限工具：`task` 工具不可用（避免无限嵌套）

3. **上下文传递**:
   - `sharedMemory`：跨子 Agent 共享数据
   - `previousResults`：前序子 Agent 的结果
   - `context`：父 Agent 的上下文信息

---

## 总结

璇玑的整体架构围绕**四层模型**组织：

1. **用户交互层**：CLI / GUI / IM Bot
2. **会话编排层**：ChatSession，路由决策（直接 vs Multi-Agent）
3. **Agent 执行层**：AgentLoop / OrchestratorAgent / WorkerAgent / SubAgentLoop
4. **能力资源层**：ToolRegistry / SkillRegistry / MCPManager / Provider

**核心设计原则**：

- **模块化**：Agent、Skill、MCP、Tool 各司其职，清晰分层
- **可扩展**：通过配置文件扩展 Agent、Skill、MCP，无需修改代码
- **智能化**：自动复杂度分析、意图路由、执行计划生成
- **可控性**：多层权限控制、嵌套深度限制、超时保护

**数据流方向**：

- **配置加载**：defaults → 全局配置 → 项目配置 → 环境变量
- **初始化**：Config → Provider → Tools → Skills → MCP → Agent → AgentLoop
- **运行时**：用户输入 → 路由决策 → Skill 匹配 → 构建 Prompt → Agent 执行 → 工具调用 → 返回结果

**关键集成点**：

- **MCP → Tool/Skill**：MCP 服务器的 Tools 和 Prompts 通过适配器转换为内部 Tool 和 Skill
- **Skill → Agent**：Skill 的 `render()` 输出注入到 Agent 的 system prompt
- **Agent → SubAgent**：`task` 工具启动 SubAgentLoop，嵌套执行子任务
- **TaskRouter → OrchestratorAgent**：复杂任务路由到 Orchestrator，生成执行计划并协调 Worker Agent

璇玑通过这套架构，实现了从简单任务（直接执行）到复杂任务（Multi-Agent 协同）的无缝切换，同时保持了高度的可配置性和可扩展性。
