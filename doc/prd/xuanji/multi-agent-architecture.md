# Multi-Agent 系统架构文档

## 概述

Xuanji Multi-Agent 系统采用 Router-Executor 模式，支持用户自定义 Specialist Agent 和 Coordinator Agent（团队协作）。

## 核心组件

### 1. Agent 角色

- **Router Agent** (`router`): 分析用户意图，推荐最合适的 Specialist Agent
- **Specialist Agent** (`specialist`): 领域专家，执行具体任务
- **Coordinator Agent** (`coordinator`): 协调多个 Agent 团队协作

### 2. 工作流程

```
用户消息 → Router Agent (意图分析)
         ↓
    推荐 Specialist Agent
         ↓
    Specialist Agent 执行任务
         ↓
    返回结果
```

### 3. 核心类

- `AgentCoordinator`: 总协调器，管理所有 Agent
- `AgentFactory`: Agent 工厂，创建和管理 Agent 实例
- `AgentLoader`: 从文件系统加载用户自定义 Agent
- `RouterAgent`: 路由 Agent 实现
- `SpecialistAgent`: 专家 Agent 实现
- `CoordinatorAgent`: 协调器 Agent 实现

## 配置

### 启用 Multi-Agent 模式

在配置文件中设置：

```json
{
  "agents": {
    "enabled": true,
    "defaultAgent": "code-assistant",
    "confidenceThreshold": 0.6
  }
}
```

### 默认 Agent 定义

系统内置两个默认 Agent：

1. **Router Agent** - 使用 Haiku 轻量模型，降低成本
2. **Code Assistant** - 默认编程助手，使用 Sonnet 主模型

### 自定义 Agent

在以下目录创建 JSON 配置文件：

- 项目级: `.xuanji/agents/`
- 全局: `~/.xuanji/agents/`

#### Specialist Agent 示例

```json
{
  "id": "code-reviewer",
  "name": "Code Reviewer",
  "role": "specialist",
  "description": "专业代码审查 Agent",
  "domains": ["code-review", "security", "architecture"],
  "keywords": ["review", "审查", "检查"],
  "priority": 5,
  "enabled": true,
  "config": {
    "model": "claude-sonnet-4-20250514",
    "systemPrompt": "你是一个专业的代码审查专家...",
    "tools": ["read_file", "grep_search", "list_files"],
    "maxIterations": 15,
    "temperature": 0.3,
    "maxTokens": 4096
  }
}
```

#### Coordinator Agent 示例

```json
{
  "id": "fullstack-team",
  "name": "全栈开发团队",
  "role": "coordinator",
  "description": "全栈开发协调器",
  "domains": ["development", "full-stack"],
  "keywords": ["开发", "实现", "功能"],
  "priority": 8,
  "enabled": true,
  "config": {
    "model": "claude-sonnet-4-20250514",
    "systemPrompt": "你是一个全栈开发团队协调器...",
    "tools": [],
    "team": {
      "members": ["architect-agent", "backend-agent", "frontend-agent", "qa-agent"],
      "mode": "sequential",
      "weights": {
        "architect-agent": 3,
        "backend-agent": 2,
        "frontend-agent": 2,
        "qa-agent": 1
      }
    }
  }
}
```

### 团队协作模式

Coordinator Agent 支持三种协作模式：

1. **parallel** - 并行执行，聚合结果
2. **sequential** - 串行执行，链式传递
3. **vote** - 投票模式，选择最佳结果（基于权重）

## CLI 命令

### /agent list [role]

列出所有已注册的 Agent，可选按角色过滤。

```bash
/agent list
/agent list specialist
/agent list coordinator
```

### /agent info <id>

查看指定 Agent 的详细信息。

```bash
/agent info code-assistant
/agent info code-reviewer
```

### /agent current

查看当前活跃的 Specialist Agent。

```bash
/agent current
```

### /agent create

显示创建自定义 Agent 的指南和示例。

```bash
/agent create
```

### /agent help

显示 /agent 命令的帮助信息。

```bash
/agent help
```

## 路由机制

### 意图分析

Router Agent 分析用户消息，返回：

- `intent`: 意图类型（如 "code_review", "data_analysis"）
- `domain`: 领域（如 "coding", "data"）
- `recommendedAgent`: 推荐的 Specialist Agent ID
- `confidence`: 置信度（0-1）
- `reasoning`: 推荐理由

### 置信度阈值

如果置信度低于阈值（默认 0.6），使用默认 Agent。

### 降级策略

- Router 失败 → 使用默认 Agent
- 推荐的 Agent 不存在 → 使用默认 Agent
- 置信度过低 → 使用默认 Agent

## 动态模型选择

每个 Agent 可以配置独立的模型：

- Router Agent 推荐使用轻量模型（Haiku）降低成本
- Specialist Agent 根据任务复杂度选择合适模型
- Coordinator Agent 可以使用主模型协调团队

AgentFactory 会根据 Agent 定义中的 `config.model` 动态创建对应的 Provider。

## 工具白名单

每个 Specialist Agent 有独立的工具白名单（`config.tools`），只能使用允许的工具。

Router Agent 不使用工具（`tools: []`）。

## 集成点

### ChatSession

- `agentCoordinator`: AgentCoordinator 实例
- `runMultiAgent()`: Multi-Agent 执行流程
- `runSingleAgent()`: 单 Agent 执行流程（降级）

### SessionInitializer

- `initAgentCoordinator()`: 初始化 AgentCoordinator
- 加载配置中的 Agent 定义
- 加载用户自定义 Agent

### CLI

- `AgentCommands`: /agent 命令处理器
- `onAgentQuery`: 回调函数，连接 ChatSession 和 CLI

## 示例配置文件

项目中提供了三个示例配置文件：

1. `.xuanji/agents/code-reviewer.json.example` - 代码审查专家
2. `.xuanji/agents/data-analyst.json.example` - 数据分析专家
3. `.xuanji/agents/fullstack-team.json.example` - 全栈开发团队

将 `.example` 后缀去掉即可启用。

## 最佳实践

1. **Router Agent 使用轻量模型** - 降低路由成本
2. **Specialist Agent 按需选择模型** - 简单任务用 Haiku，复杂任务用 Sonnet
3. **合理设置置信度阈值** - 避免误路由
4. **工具白名单最小化** - 只给 Agent 必需的工具
5. **团队协作选择合适模式** - 根据任务特点选择 parallel/sequential/vote

## 扩展性

- 支持加载外部 Agent 定义（JSON 文件）
- 支持动态注册 Agent
- 支持自定义协作模式
- 支持多层嵌套（Coordinator 调用 Coordinator）

## 性能优化

- Router Agent 使用轻量模型，降低首次路由成本
- 路由结果缓存（首次路由后，后续消息直接使用同一 Specialist）
- 工具按需加载（根据 Agent 白名单过滤）
- 流式输出（所有 Agent 都支持流式响应）

## 未来计划

- [ ] Agent 性能统计和监控
- [ ] Agent 自动选择（基于历史表现）
- [ ] Agent 热重载（无需重启）
- [ ] GUI 可视化 Agent 切换和团队协作
- [ ] Agent 市场（分享和下载社区 Agent）
