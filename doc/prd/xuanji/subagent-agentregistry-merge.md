# SubAgent 和 AgentRegistry 合并方案

## 问题分析

当前系统中存在两套重复的 Agent 定义机制：

### 1. SubAgent（硬编码）
- 位置：`SubAgentContext.ts`
- 定义：4 种硬编码角色（general-purpose, explore, plan, coder）
- 配置：systemPrompt、工具限制、模型选择都硬编码在代码中
- 调用：通过 `TaskTool` 的 `subagent_type` 参数

### 2. AgentRegistry（可配置）
- 位置：`AgentRegistry.ts` + JSON5 配置文件
- 定义：支持用户自定义 Agent（如 stock-analyst）
- 配置：systemPrompt、tools、model、skills、knowledgeBase 等在配置文件中
- 调用：目前只用于 GUI 展示，不参与实际的子 Agent 创建

**核心矛盾**：两套系统都在定义"一个 Agent 应该是什么样的"，但它们不互通。

---

## 合并方案

### 核心思路

**AgentRegistry = 唯一的 Agent 定义源**

- 将硬编码的 4 种角色改为内置 Agent Profiles（builtin）
- SubAgentContext 不再硬编码配置，而是从 AgentRegistry 读取
- TaskTool 的 `subagent_type` 改为 `agent_id`，支持引用任何注册的 Agent

### 架构层次

```
┌─────────────────────────────────────────────────────┐
│              AgentRegistry                          │
│  ┌──────────────┬──────────────┬──────────────┐    │
│  │   Builtin    │    Global    │   Project    │    │
│  ├──────────────┼──────────────┼──────────────┤    │
│  │ xuanji       │ my-agent     │ stock-analyst│    │
│  │ general-...  │ reviewer     │ code-auditor │    │
│  │ explore      │              │              │    │
│  │ plan         │              │              │    │
│  │ coder        │              │              │    │
│  └──────────────┴──────────────┴──────────────┘    │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              TaskTool / TeamTool                    │
│  agent_id: "explore" | "stock-analyst" | ...        │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              SubAgentLoop                           │
│  从 AgentRegistry 读取 Agent 配置并执行              │
└─────────────────────────────────────────────────────┘
```

---

## 实施步骤

### Step 1: 创建内置 Agent Profiles

已完成：
- ✅ `src/core/agent/builtin/xuanji.json5` - 主 Agent
- ✅ `src/core/agent/builtin/general-purpose.json5` - 通用子代理
- ✅ `src/core/agent/builtin/explore.json5` - 探索型（只读，轻量模型）
- ✅ `src/core/agent/builtin/plan.json5` - 规划型（只读）
- ✅ `src/core/agent/builtin/coder.json5` - 编程型（完整工具）

配置要点：
- `metadata.isSubAgent: true` - 标识为子代理
- `metadata.useLightModel: true` - 使用轻量模型（explore）
- `permissions` - 定义权限（explore/plan 禁止写入和命令）
- `execution.maxIterations` - 根据角色调整（explore 20 次，coder 40 次）

### Step 2: 修改 SubAgentContext

**之前**（硬编码）：
```typescript
private getRolePromptSuffix(): string {
  switch (this.role) {
    case 'explore':
      return 'You are a fast exploration agent...';
    case 'plan':
      return 'You are a software architect...';
    // ...
  }
}
```

**之后**（从配置读取）：
```typescript
constructor(
  options: SubAgentOptions,
  agentProfile: ConfigurableAgentConfig  // 新增参数
) {
  // 从 AgentProfile 读取配置
  this.systemPrompt = agentProfile.systemPrompt;
  this.tools = agentProfile.tools.map(t => t.name);
  this.model = agentProfile.model.primary;
  this.maxIterations = agentProfile.execution.maxIterations;
  this.permissions = agentProfile.permissions;

  // 删除硬编码的 getRolePromptSuffix()
}
```

### Step 3: 修改 TaskTool

**之前**：
```typescript
input_schema: {
  subagent_type: {
    type: 'string',
    enum: ['general-purpose', 'explore', 'plan', 'coder'],
  }
}
```

**之后**：
```typescript
input_schema: {
  agent_id: {
    type: 'string',
    description: [
      'Agent ID to delegate the task to.',
      'Built-in agents: general-purpose, explore, plan, coder',
      'Custom agents: any agent from AgentRegistry',
      'Default: general-purpose'
    ].join('\n')
  }
}

// 执行逻辑
async execute(input: Record<string, unknown>): Promise<ToolResult> {
  const agentId = (input.agent_id as string) ?? 'general-purpose';

  // 从 AgentRegistry 获取配置
  const agentProfile = this.agentRegistry?.get(agentId);
  if (!agentProfile) {
    return this.error(`Agent "${agentId}" not found in registry`);
  }

  // 使用 agentProfile 创建 SubAgentContext
  const context = new SubAgentContext(options, agentProfile);
  // ...
}
```

### Step 4: 注入 AgentRegistry 到 TaskTool

在 `ChatSession.ts` 的 `initTaskTool()` 方法中：

```typescript
private async initTaskTool(): Promise<void> {
  const { TaskTool } = await import('@/core/tools/TaskTool');
  this._taskTool = new TaskTool();
  this.baseRegistry?.register(this._taskTool);

  // 注入 AgentRegistry（新增）
  if (this.agentRegistry) {
    this._taskTool.setAgentRegistry(this.agentRegistry);
  }
}
```

### Step 5: 删除硬编码逻辑

可以删除的代码：
- `SubAgentContext.getRolePromptSuffix()` - 整个方法
- `SubAgentContext.inferUseLightModel()` - 从配置读取
- `SubAgentContext` 中根据 role 添加工具限制的逻辑 - 从配置读取

---

## 优势对比

### 之前（硬编码）

❌ 只有 4 种预定义角色
❌ 新增角色需要修改代码
❌ 配置分散在多处
❌ 用户无法自定义子 Agent
❌ GUI 配置的 Agent 无法被调用

### 之后（统一配置）

✅ 支持无限种 Agent（内置 + 自定义）
✅ 新增 Agent 只需创建配置文件
✅ 配置集中管理（JSON5）
✅ 用户可自定义领域 Agent（如 stock-analyst）
✅ GUI 配置的 Agent 可被 LLM 调用
✅ 支持 global/project 级别覆盖内置 Agent
✅ 版本控制友好（配置即代码）

---

## 向后兼容

### 兼容策略

1. **保留旧参数名**（短期）：
   ```typescript
   input_schema: {
     agent_id: { type: 'string' },
     subagent_type: {  // 废弃但兼容
       type: 'string',
       description: 'DEPRECATED: use agent_id instead'
     }
   }

   // 执行时兼容
   const agentId = input.agent_id || input.subagent_type || 'general-purpose';
   ```

2. **降级处理**：
   如果 AgentRegistry 未初始化或 Agent 不存在，降级到硬编码逻辑（发出警告）

3. **迁移指南**：
   在文档中说明从 `subagent_type` 迁移到 `agent_id` 的方法

---

## 扩展能力

### 1. 智能 Agent 匹配

当用户不指定 `agent_id` 时，自动选择最合适的 Agent：

```typescript
// TaskTool
async execute(input: Record<string, unknown>): Promise<ToolResult> {
  let agentId = input.agent_id as string | undefined;

  if (!agentId) {
    // 基于任务描述自动选择 Agent
    agentId = await this.selectBestAgent(input.description as string);
  }

  // ...
}

private async selectBestAgent(taskDescription: string): Promise<string> {
  // 1. 向量匹配：taskDescription embedding vs Agent.capabilities embedding
  // 2. 关键词匹配：提取关键词匹配 Agent.tags
  // 3. 默认 general-purpose
}
```

### 2. Agent 调用统计

在 AgentProfile 中记录调用统计：

```typescript
metadata: {
  stats: {
    totalCalls: 152,
    successRate: 0.94,
    avgDuration: 8500,  // ms
    lastUsed: '2026-03-14T10:30:00Z'
  }
}
```

### 3. Agent 学习和优化

根据历史执行结果动态调整 Agent 选择策略。

---

## 实施优先级

### P0（核心功能）
- ✅ 创建 4 个内置 Agent Profiles
- ⏳ 修改 SubAgentContext 从配置读取
- ⏳ 修改 TaskTool 支持 agent_id
- ⏳ 注入 AgentRegistry 到 TaskTool

### P1（用户体验）
- ⏳ GUI 展示所有可用 Agent（包括 SubAgent）
- ⏳ LLM 可查询 Agent 列表（新增 list_agents tool）
- ⏳ 更新文档和示例

### P2（高级功能）
- ⏳ 智能 Agent 匹配
- ⏳ Agent 调用统计和可视化
- ⏳ Agent 学习和优化

---

## 示例：用户自定义股票分析 Agent

用户可创建 `~/.xuanji/agents/stock-analyst.json5`：

```json5
{
  id: 'stock-analyst',
  name: '股票分析师',
  description: '专业的股票数据分析和投资建议',

  tags: ['finance', 'stock', 'analysis', 'investment'],
  capabilities: [
    '股票数据分析',
    'K线图解读',
    '财报分析',
    '投资建议',
  ],

  skills: {
    builtin: ['code-assistant'],
    custom: [{
      id: 'stock-knowledge',
      category: 'prompt',
      content: `
## 股票分析专业知识

### 技术指标
- MACD：趋势指标
- RSI：超买超卖
- KDJ：随机指标

### 财报关键指标
- PE：市盈率
- PB：市净率
- ROE：净资产收益率
      `
    }]
  },

  knowledgeBase: {
    path: '.xuanji/knowledge/stock',
    sources: [
      { type: 'csv', path: 'stock_history.csv' },
      { type: 'json', path: 'financial_reports.json' }
    ]
  },

  tools: [
    { name: 'read_file' },
    { name: 'web_fetch' },  // 获取实时行情
    { name: 'bash' },       // 运行 Python 分析脚本
  ],

  systemPrompt: '你是专业的股票分析师...',

  // 其他配置...
}
```

然后 LLM 可以直接调用：

```typescript
task({
  agent_id: 'stock-analyst',
  description: '分析 $AAPL 最新财报，给出投资建议'
});
```

---

**总结**：通过合并 SubAgent 和 AgentRegistry，实现了统一的 Agent 管理系统，消除了重复，增强了扩展性，让用户可以自定义任意领域的 Agent。
