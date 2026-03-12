# SubAgent 和 Agent Team 架构分析

## 概述

Xuanji 提供两种多 agent 协作机制：

1. **SubAgent（子代理）** — 单个独立的 agent 执行特定任务
2. **Agent Team（团队协作）** — 多个 agent 通过不同策略协同完成复杂任务

本文档详细分析这两种机制的上下文处理和运作原理。

---

## 一、SubAgent（子代理）机制

### 1.1 核心组件

```
┌─────────────────────────────────────────────┐
│            Parent Agent                     │
│  (Main AgentLoop + MessageManager)          │
└──────────────┬──────────────────────────────┘
               │ TaskTool.execute()
               ↓
┌──────────────────────────────────────────────┐
│         SubAgentContext                      │
│  - task: string                              │
│  - parentContext?: string (optional)         │
│  - role: AgentRoleType                       │
│  - depth: number (嵌套深度)                  │
│  - restrictedTools: string[]                 │
│  - timeout: number                           │
│  - useLightModel: boolean                    │
└──────────────┬───────────────────────────────┘
               │ runSubAgent()
               ↓
┌──────────────────────────────────────────────┐
│         SubAgent AgentLoop                   │
│  - 独立的 MessageManager                     │
│  - 过滤后的 ToolRegistry                     │
│  - 自己的消息历史                            │
│  - 独立的 token 统计                         │
└──────────────┬───────────────────────────────┘
               │ 执行完成
               ↓
        SubAgentResult
        (返回给 Parent)
```

### 1.2 上下文隔离

#### 完全隔离的部分

1. **MessageManager（消息历史）**
   ```typescript
   // SubAgentLoop.ts
   const agentLoop = new AgentLoop(
     provider,
     filteredRegistry,
     agentConfig,
     memoryStore ?? undefined,
   );
   ```
   - 每个 SubAgent 创建独立的 `MessageManager`
   - **不共享**父代理的对话历史
   - 初始消息只有 `task` 参数指定的任务描述

2. **工具注册表（FilteredToolRegistry）**
   ```typescript
   class FilteredToolRegistry implements IToolRegistry {
     constructor(inner: IToolRegistry, restrictedTools: string[]) {
       this.inner = inner;
       this.restrictedTools = new Set(restrictedTools);
     }
     
     get(name: string): Tool | undefined {
       if (this.restrictedTools.has(name)) return undefined;
       return this.inner.get(name);
     }
   }
   ```
   - **排除工具**：
     - `task` 工具（防止无限递归）
     - `agent_team` 工具（Team 内的 SubAgent 不能创建 Team）
     - 角色特定限制：
       - `explore` 和 `plan` 角色：不能使用 `write_file`、`edit_file`、`bash`

3. **Token 统计**
   - 独立统计，不累加到父代理
   - 执行完成后返回 `SubAgentResult.tokensUsed`

#### 部分共享的部分

1. **Provider（LLM 提供者）**
   ```typescript
   // 根据 role 选择 provider
   const provider = context.useLightModel ? lightProvider : mainProvider;
   ```
   - `explore` 角色默认使用 `lightProvider`（Haiku，节省成本）
   - 其他角色使用 `mainProvider`（Sonnet）

2. **MemoryStore（记忆存储）**
   ```typescript
   const agentLoop = new AgentLoop(
     provider,
     filteredRegistry,
     agentConfig,
     memoryStore ?? undefined,  // 传递父代理的 memoryStore
   );
   ```
   - **共享同一个 MemoryStore 实例**
   - SubAgent 可以读取和写入记忆
   - 记忆跨 SubAgent 持久化

3. **HookRegistry（Hook 系统）**
   - 共享同一个 HookRegistry
   - SubAgent 的工具调用会触发 `SubAgentToolUse` 事件
   - 便于监控和调试

#### 可选传递的部分

1. **ParentContext（父代理上下文）**
   ```typescript
   interface SubAgentOptions {
     task: string;
     parentContext?: string;  // 可选
   }
   ```
   - **默认不传递**（`includeParentContext: false`）
   - 显式启用时，传递父代理的上下文摘要
   - 追加到 SubAgent 的 `systemPrompt`：
     ```
     [Parent Context]
     The parent agent is working on a complex task...
     ```

### 1.3 System Prompt 构建

```typescript
// SubAgentContext.buildAgentConfig()
buildAgentConfig(parentConfig: AgentConfig): AgentConfig {
  let systemPrompt = parentConfig.systemPrompt ?? '';

  // 1. 追加角色特定提示
  const subAgentHeader = [
    `\n\n---\n[SubAgent Mode - Depth: ${this.depth}, Role: ${this.role}]`,
    this.getRolePromptSuffix(),
    `Do NOT ask clarifying questions. Do NOT start new sub-tasks.`,
  ].join('\n');
  systemPrompt += subAgentHeader;

  // 2. 追加父上下文（如果有）
  if (this.parentContext) {
    systemPrompt += `\n\n[Parent Context]\n${this.parentContext}`;
  }

  return {
    ...parentConfig,
    systemPrompt,
    maxIterations: this.maxIterations,
  };
}
```

**角色特定提示**：
- `explore`: "Fast exploration agent. Use Glob, Grep, Read tools. Be concise."
- `plan`: "Software architect. Design plans, identify critical files."
- `coder`: "Coding agent. Write, edit, test code."
- `general-purpose`: "Execute specific task. Focus and be concise."

### 1.4 执行流程

```
1. Parent Agent 调用 TaskTool
   ↓
2. TaskTool 创建 SubAgentContext
   - 设置 task、role、depth
   - 确定 restrictedTools
   ↓
3. runSubAgent() 函数
   ├─ 检查嵌套深度（MAX_NESTING_DEPTH = 3）
   ├─ 创建 FilteredToolRegistry
   ├─ 选择 Provider（lightProvider or mainProvider）
   ├─ 创建独立的 AgentLoop
   │   └─ 新建 MessageManager（空历史）
   ├─ 设置超时定时器（默认 5 分钟）
   └─ 执行 agentLoop.run(task)
   ↓
4. SubAgent 内部循环
   ├─ LLM 生成响应
   ├─ 执行工具调用（受限工具集）
   └─ 重复直到 end_turn 或超时
   ↓
5. 返回 SubAgentResult
   {
     result: string,        // 最终输出
     tokensUsed: {...},     // Token 消耗
     duration: number,      // 执行耗时
     timedOut: boolean,     // 是否超时
     iterations: number,    // 迭代次数
   }
   ↓
6. TaskTool 格式化结果返回给 Parent
```

### 1.5 安全机制

1. **最大嵌套深度**：默认 3 层，防止无限递归
2. **并发限制**：同时最多 3 个 SubAgent
3. **超时控制**：默认 5 分钟自动终止
4. **工具过滤**：
   - 始终排除 `task` 工具
   - 角色特定限制（explore/plan 不能写文件）
5. **独立消息历史**：不污染父代理上下文

---

## 二、Agent Team（团队协作）机制

### 2.1 核心组件

```
┌─────────────────────────────────────────────┐
│            TeamTool                          │
│  (LLM 调用 agent_team 工具)                 │
└──────────────┬──────────────────────────────┘
               │ 创建 TeamManager
               ↓
┌──────────────────────────────────────────────┐
│         TeamManager                          │
│  - TeamContext (团队上下文)                  │
│    - config: TeamConfig                      │
│    - sharedKnowledge: Map                    │
│    - messageHistory: TeamMessage[]           │
│    - memberStates: Map                       │
│    - currentRound: number                    │
└──────────────┬───────────────────────────────┘
               │ 根据策略执行
               ↓
┌──────────────────────────────────────────────┐
│         执行策略                             │
│  - Sequential (串行)                         │
│  - Parallel (并行)                           │
│  - Hierarchical (层级)                       │
│  - Debate (辩论)                             │
│  - Pipeline (流水线)                         │
└──────────────┬───────────────────────────────┘
               │ 每个成员
               ↓
┌──────────────────────────────────────────────┐
│      executeMemberTask()                     │
│  ├─ enrichTaskForMember()                    │
│  │   (增强任务描述 + 共享知识)              │
│  ├─ 创建 SubAgentContext                     │
│  └─ runSubAgent()                            │
│      (每个成员是一个独立的 SubAgent)        │
└──────────────┬───────────────────────────────┘
               │ 收集结果
               ↓
        aggregateResults()
        (根据策略聚合)
               ↓
        TeamExecutionResult
```

### 2.2 上下文管理

#### TeamContext 结构

```typescript
interface TeamContext {
  config: TeamConfig;                        // 团队配置
  sharedKnowledge: Map<string, unknown>;     // 共享知识库
  messageHistory: TeamMessage[];             // 消息历史
  memberStates: Map<string, AgentState>;     // 成员状态
  currentRound: number;                      // 当前轮次
  startTime: number;                         // 开始时间
}
```

#### 共享知识库（SharedKnowledge）

```typescript
// 目前是简化实现，预留扩展
sharedKnowledge: Map<string, unknown>

// 未来可扩展为：
// - 成员间共享的发现（findings）
// - 关键决策和结论
// - 中间结果缓存
```

**当前状态**：
- 创建时初始化为空 `Map`
- `enrichTaskForMember()` 中可以访问
- 目前未实际使用，预留给未来版本

#### 消息历史（MessageHistory）

```typescript
interface TeamMessage {
  id: string;
  from: string;                // 发送者 ID
  to: string | 'all' | 'manager';  // 接收者
  type: TeamMessageType;       // task/result/question/answer/broadcast/handoff
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

**当前状态**：
- 类型定义完整
- `sendMessage()` 方法实现
- 根据 `recordHistory` 配置决定是否记录
- **目前主要用于调试和日志**，成员间不直接通信

### 2.3 成员任务增强

每个成员执行前，任务描述会被增强：

```typescript
private enrichTaskForMember(
  member: TeamMember,
  task: string,
  previousResults: TaskExecutionResult[],
): string {
  let enriched = task;

  // 1. 添加成员能力说明
  if (member.capabilities.length > 0) {
    enriched += `\n\nYour capabilities: ${member.capabilities.join(', ')}`;
  }

  // 2. 添加成员特定提示
  if (member.systemPrompt) {
    enriched += `\n\n${member.systemPrompt}`;
  }

  // 3. 添加共享知识（如果启用）
  if (this.context!.config.enableSharedKnowledge && 
      this.context!.sharedKnowledge.size > 0) {
    const knowledge = Array.from(this.context!.sharedKnowledge.entries())
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');
    enriched += `\n\nShared Knowledge:\n${knowledge}`;
  }

  return enriched;
}
```

### 2.4 五种协作策略

#### 1. Sequential（串行）

```typescript
private async executeSequential(goal: string): Promise<TaskExecutionResult[]> {
  const results: TaskExecutionResult[] = [];
  const members = this.getSortedMembers();  // 按 priority 排序

  for (const member of members) {
    const result = await this.executeMemberTask(member, goal, results);
    results.push(result);
    
    if (!result.success) {
      log.warn(`Member ${member.id} failed, stopping sequential execution`);
      break;
    }
  }

  return results;
}
```

**特点**：
- 按优先级顺序执行
- 后面的成员可以看到前面的结果（通过 `previousResults`）
- 一个失败，后续停止

#### 2. Parallel（并行）

```typescript
private async executeParallel(goal: string): Promise<TaskExecutionResult[]> {
  const members = this.context!.config.members;
  
  const promises = members.map(member =>
    this.executeMemberTask(member, goal, [])
  );
  
  return Promise.all(promises);
}
```

**特点**：
- 所有成员同时工作
- 彼此不共享结果（`previousResults` 为空）
- 适合独立的并行任务

#### 3. Hierarchical（层级）

```typescript
private async executeHierarchical(goal: string): Promise<TaskExecutionResult[]> {
  const results: TaskExecutionResult[] = [];
  const members = this.getSortedMembers();

  // 1. 主 agent（优先级最高）
  const leader = members[0];
  const leaderResult = await this.executeMemberTask(leader, goal, []);
  results.push(leaderResult);

  if (!leaderResult.success) return results;

  // 2. 根据主 agent 的输出，分配给其他成员
  const workers = members.slice(1);
  const workerPromises = workers.map(worker =>
    this.executeMemberTask(
      worker,
      `Based on the leader's analysis:\n${leaderResult.result}\n\nYour task: ${goal}`,
      results,
    )
  );

  const workerResults = await Promise.all(workerPromises);
  results.push(...workerResults);

  return results;
}
```

**特点**：
- 优先级最高的是 leader
- Leader 先分析，workers 根据 leader 的分析执行
- 适合需要总体规划的任务

#### 4. Debate（辩论）

```typescript
private async executeDebate(goal: string): Promise<TaskExecutionResult[]> {
  const results: TaskExecutionResult[] = [];
  const members = this.context!.config.members;
  const maxRounds = this.context!.config.maxRounds!;

  for (let round = 0; round < maxRounds && this.running; round++) {
    this.context!.currentRound = round + 1;
    
    // 每轮所有成员发言
    for (const member of members) {
      const previousResults = results.filter(r => r.taskId.startsWith(`debate-round-${round}`));
      const context = previousResults.length > 0
        ? `Previous opinions:\n${previousResults.map(r => `${r.memberId}: ${r.result}`).join('\n\n')}`
        : '';

      const taskDescription = context
        ? `${goal}\n\n${context}\n\nYour turn to respond:`
        : goal;

      const result = await this.executeMemberTask(
        member,
        taskDescription,
        results,
        `debate-round-${round + 1}-${member.id}`,
      );
      results.push(result);
    }

    // 检查是否达成共识
    const roundResults = results.slice(-members.length);
    const allAgree = roundResults.every(r =>
      r.result.toLowerCase().includes('agree') || 
      r.result.toLowerCase().includes('consensus')
    );

    if (allAgree) {
      log.info('Consensus reached, ending debate');
      break;
    }
  }

  return results;
}
```

**特点**：
- 多轮讨论
- 每轮每个成员都发言
- 可以看到其他成员的观点
- 达成共识或达到最大轮次后结束

#### 5. Pipeline（流水线）

```typescript
private async executePipeline(goal: string): Promise<TaskExecutionResult[]> {
  const results: TaskExecutionResult[] = [];
  const members = this.getSortedMembers();

  let currentInput = goal;

  for (const member of members) {
    const result = await this.executeMemberTask(member, currentInput, results);
    results.push(result);

    if (!result.success) {
      log.warn(`Pipeline failed at member ${member.id}`);
      break;
    }

    // 下一个成员的输入是当前成员的输出
    currentInput = result.result;
  }

  return results;
}
```

**特点**：
- 前一个的输出是下一个的输入
- 数据逐步加工
- 适合数据处理管道

### 2.5 结果聚合

```typescript
private aggregateResults(results: TaskExecutionResult[]): string {
  const strategy = this.context!.config.strategy;

  switch (strategy) {
    case 'sequential':
    case 'pipeline':
      // 返回最后一个成员的结果
      return results[results.length - 1].result;

    case 'parallel':
      // 合并所有成员的结果
      return results
        .map(r => `[${r.memberId}]\n${r.result}`)
        .join('\n\n---\n\n');

    case 'hierarchical':
      // Leader + Workers
      const leaderResult = results[0];
      const workerResults = results.slice(1);
      return [
        `[Leader Analysis]`,
        leaderResult.result,
        '',
        `[Team Execution]`,
        ...workerResults.map(r => `- ${r.memberId}: ${r.result}`),
      ].join('\n');

    case 'debate':
      // 最后一轮的总结
      const lastRound = results.slice(-this.context!.config.members.length);
      return [
        `[Team Consensus]`,
        ...lastRound.map(r => `${r.memberId}: ${r.result}`),
      ].join('\n\n');
  }
}
```

---

## 三、对比分析

### 3.1 上下文隔离对比

| 特性 | SubAgent | Agent Team |
|------|----------|------------|
| **MessageManager** | 完全隔离（独立） | 成员间隔离，Team 级别有 messageHistory |
| **工具注册表** | 过滤后独立 | 成员间共享（通过 TeamManager 传递） |
| **Token 统计** | 独立统计 | Team 聚合所有成员 |
| **MemoryStore** | 共享父代理的 | 共享（TeamManager 传递） |
| **HookRegistry** | 共享 | 共享 |
| **Provider** | 根据 role 选择 | 成员间共享 |
| **父上下文** | 可选传递（默认不传） | 通过 enrichTaskForMember 传递 |

### 3.2 通信机制对比

| 机制 | SubAgent | Agent Team |
|------|----------|------------|
| **父子通信** | Task → SubAgent → Result | Goal → Team → Members → Results |
| **成员间通信** | 无（单个 SubAgent） | 通过 previousResults 参数 |
| **共享知识** | 无 | TeamContext.sharedKnowledge（预留） |
| **消息历史** | 无 | TeamContext.messageHistory（记录但未用于通信） |

### 3.3 执行模式对比

| 特性 | SubAgent | Agent Team |
|------|----------|------------|
| **执行方式** | 单个独立执行 | 多个按策略协作执行 |
| **并发支持** | 父代理可并发启动多个 SubAgent | Team 内根据策略（parallel/hierarchical） |
| **深度限制** | 3 层嵌套 | Team 成员也是 SubAgent，深度 +1 |
| **超时控制** | 单个 SubAgent 超时 | Team 整体超时 |
| **结果聚合** | 单个返回 | 根据策略聚合多个结果 |

### 3.4 实现关系

```
Agent Team 是 SubAgent 的高层编排：

TeamManager
  ├─ executeMemberTask()
  │   ├─ enrichTaskForMember()
  │   └─ runSubAgent()  ← 调用 SubAgent 机制
  │       └─ new AgentLoop()
  └─ aggregateResults()

每个 Team Member 本质上是一个 SubAgent
```

### 3.5 使用场景对比

#### SubAgent 适用场景

- ✅ 单一、明确的子任务
- ✅ 需要快速探索（explore 角色）
- ✅ 只读操作（plan 角色）
- ✅ 独立的代码编写（coder 角色）
- ✅ 并行执行多个独立任务（父代理并发启动）

#### Agent Team 适用场景

- ✅ 需要多个专业角色协作
- ✅ 复杂任务需要分解和聚合
- ✅ 需要辩论和多角度评估
- ✅ 数据处理流水线
- ✅ 层级化的规划和执行

---

## 四、关键设计决策

### 4.1 为什么 SubAgent 不共享消息历史？

**原因**：
1. **上下文隔离**：避免 SubAgent 看到父代理的无关对话
2. **Token 节省**：只传递必要的任务描述，减少 Token 消耗
3. **清晰边界**：SubAgent 专注于单一任务，不受父代理上下文干扰

**例外**：
- 可通过 `parentContext` 参数显式传递上下文摘要
- 共享 MemoryStore，可以访问长期记忆

### 4.2 为什么 Team Member 之间不直接通信？

**当前设计**：
- 通过 `previousResults` 参数传递前面成员的结果
- `messageHistory` 和 `sharedKnowledge` 预留但未实际用于通信

**原因**：
1. **简化实现**：避免复杂的消息路由和协调
2. **策略驱动**：不同策略有不同的信息流动方式
3. **可扩展性**：预留接口，未来可以实现更复杂的通信

**未来扩展**：
- 点对点消息传递（handoff）
- 共享知识库的读写
- 成员间问答机制

### 4.3 为什么 Team 成员都是 SubAgent？

**原因**：
1. **代码复用**：SubAgent 已经实现完整的独立执行逻辑
2. **一致的隔离**：每个成员都有独立的 MessageManager
3. **工具过滤**：Team 成员不能创建新的 Team（防止复杂度爆炸）
4. **深度追踪**：Team 层级也计入嵌套深度

### 4.4 为什么有 5 种协作策略？

**设计哲学**：不同任务有不同的协作模式

- **Sequential**: 流程化任务（代码审查）
- **Parallel**: 独立任务（多源搜索）
- **Hierarchical**: 需要规划（特性开发）
- **Debate**: 需要讨论（架构设计）
- **Pipeline**: 数据加工（提取-清洗-分析-总结）

每种策略对应不同的信息流动和结果聚合方式。

---

## 五、性能考虑

### 5.1 Token 消耗

| 机制 | Token 消耗 | 优化 |
|------|-----------|------|
| **SubAgent** | 单个任务的 input + output | explore 角色使用 lightProvider（Haiku） |
| **Agent Team** | 所有成员的 Token 之和 | Sequential 可节省，Debate 消耗最多 |

### 5.2 并发限制

- **SubAgent**: 最多 3 个并发
- **Team Parallel**: 成员数量无限制（但受 SubAgent 并发限制）

### 5.3 嵌套深度

```
Parent Agent (depth=0)
  └─ SubAgent (depth=1)
      └─ SubAgent (depth=2)
          └─ SubAgent (depth=3) ← MAX_NESTING_DEPTH

Team (depth=0)
  └─ Member as SubAgent (depth=1)
      └─ 不能再创建 Team 或深层 SubAgent
```

---

## 六、总结

### SubAgent（子代理）

**核心特点**：
- 完全隔离的消息历史
- 独立的工具集（过滤后）
- 角色特定的 system prompt
- 轻量模型优化（explore 角色）

**适用场景**：
- 单一、明确的任务
- 快速探索和规划
- 并行独立任务

### Agent Team（团队协作）

**核心特点**：
- 多成员协作编排
- 5 种协作策略
- 基于 SubAgent 实现
- 共享知识和历史（预留）

**适用场景**：
- 复杂任务分解
- 多角色协作
- 需要辩论和讨论
- 数据处理流水线

### 设计哲学

**层次化架构**：
```
User ← ChatSession ← AgentLoop ← MessageManager
                ↓
           TaskTool ← SubAgentLoop ← AgentLoop (独立)
                ↓
           TeamTool ← TeamManager ← SubAgentLoop × N
```

**关键原则**：
1. **上下文隔离**：避免污染和混淆
2. **工具过滤**：防止无限递归
3. **代码复用**：Team 基于 SubAgent
4. **可扩展性**：预留通信和共享机制

这种设计在隔离性、灵活性和可维护性之间取得了很好的平衡。
