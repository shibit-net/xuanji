# 多 Agent 工作模式与上下文管理

## 核心架构

### 1. 上下文隔离机制

**每个子 Agent 都有独立的上下文**，不共享父 Agent 的对话历史。

```typescript
// SubAgentLoop.ts - 每个子 Agent 创建独立的 AgentLoop
const agentLoop = new AgentLoop(
  provider,
  filteredRegistry,
  agentConfig,
  undefined,  // ← 不传递 memoryStore，禁用自动注入
);
```

**关键设计：**
- 每个子 Agent 有独立的 `MessageManager`（管理对话历史）
- 子 Agent 不能访问父 Agent 的消息历史
- 父 Agent 必须在任务描述中显式传递所有必要上下文

### 2. 上下文传递方式

#### 方式 1：通过任务描述传递（主要方式）

```typescript
// TaskTool.ts - 父 Agent 通过 description 传递上下文
{
  description: `
    你需要分析以下代码：
    
    文件路径: src/core/agent/AgentLoop.ts
    当前问题: 内存泄漏
    已知信息: 
    - MessageManager 没有清理旧消息
    - 每次迭代都会累积消息
    
    请找出问题并提供修复方案。
  `
}
```

**重要提示（在 TaskTool 的 description 中明确说明）：**
```
IMPORTANT: The sub-agent only knows what you put in "description".
You must distill all necessary context into the description yourself:
- Relevant findings from the current conversation
- Constraints, file paths, or decisions already made
- Expected output format
Do NOT assume the sub-agent has any background knowledge from the parent session.
```

#### 方式 2：通过共享记忆系统（可选）

```typescript
// SubAgentContext.ts - 子 Agent 可以访问 retrieve_memory 工具
const memoryGuideline = `
**Memory System**: You have access to \`retrieve_memory\` tool.
- Use it when task references "previous work", "like last time", or "my usual style"
- Use it when you need user preferences or project context
- Do NOT use it for self-contained atomic tasks
- Query example: "user's coding preferences", "previous similar implementations"
`;
```

**记忆系统特点：**
- 子 Agent 可以主动调用 `retrieve_memory` 工具查询长期记忆
- 但不会自动注入父 Agent 的对话历史
- 适合获取用户偏好、项目约定等长期知识

### 3. 工具隔离

子 Agent 的工具访问受到限制：

```typescript
// SubAgentContext.ts
export const ALWAYS_RESTRICTED_TOOLS = ['task'];  // 防止递归

// 探索型和规划型代理仅允许只读工具
if (this.role === 'explore' || this.role === 'plan') {
  restricted.add('write_file');
  restricted.add('edit_file');
  restricted.add('bash');
}
```

**工具过滤机制：**
- `FilteredToolRegistry` 包装父 Agent 的工具注册表
- 过滤掉受限工具（如 `task` 工具，防止无限递归）
- 根据角色限制工具访问（如探索型 Agent 只读）

---

## 多 Agent 协作模式

### 模式 1：独立任务（TaskTool）

**特点：**
- 父 Agent 通过 `task` 工具启动子 Agent
- 子 Agent 完全独立执行，无法与父 Agent 通信
- 执行完成后，结果作为工具返回值返回给父 Agent

**流程：**
```
父 Agent
  ↓ (调用 task 工具)
子 Agent (独立上下文)
  ↓ (执行完成)
父 Agent (接收结果)
```

**代码示例：**
```typescript
// 父 Agent 调用
await toolRegistry.execute('task', {
  description: '分析 src/core/agent/AgentLoop.ts 的性能问题',
  subagent_type: 'coder',
});

// 子 Agent 执行（独立上下文）
// - 只能看到 description 中的信息
// - 无法访问父 Agent 的对话历史
// - 执行完成后返回结果
```

### 模式 2：团队协作（TeamManager）

#### 2.1 顺序执行（Sequential）

```typescript
// TeamManager.ts - executeSequential
for (const member of members) {
  const result = await this.executeMemberTask(member, goal, results);
  results.push(result);
}
```

**特点：**
- 成员按顺序执行
- 每个成员可以看到前面成员的结果
- 适合流水线式任务

#### 2.2 并行执行（Parallel）

```typescript
// TeamManager.ts - executeParallel
const promises = members.map(member =>
  this.executeMemberTask(member, goal, [])
);
const results = await Promise.all(promises);
```

**特点：**
- 所有成员同时执行
- 成员之间不共享中间结果
- 适合独立的并行任务

#### 2.3 辩论模式（Debate）⭐

**这是你问的重点！**

```typescript
// TeamManager.ts - executeDebate
private async executeDebate(goal: string): Promise<TaskExecutionResult[]> {
  const results: TaskExecutionResult[] = [];
  const members = this.context!.config.members;
  const maxRounds = this.context!.config.maxRounds!;

  for (let round = 0; round < maxRounds && this.running; round++) {
    this.context!.currentRound = round + 1;
    
    // 每轮所有成员发言
    for (const member of members) {
      // 🔑 关键：获取本轮之前的所有观点
      const previousResults = results.filter(r => 
        r.taskId.startsWith(`debate-round-${round}`)
      );
      
      // 🔑 构建上下文：包含其他成员的观点
      const context = previousResults.length > 0
        ? `Previous opinions:\n${previousResults.map(r => 
            `${r.memberId}: ${r.result}`
          ).join('\n\n')}`
        : '';

      // 🔑 将其他成员的观点作为任务描述的一部分传递
      const taskDescription = context
        ? `${goal}\n\n${context}\n\nYour turn to respond:`
        : goal;

      const result = await this.executeMemberTask(
        member,
        taskDescription,  // ← 包含其他成员的观点
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

**辩论模式的通信机制：**

1. **轮次循环**：多轮辩论，每轮所有成员都发言
2. **上下文传递**：每个成员发言时，会收到本轮之前其他成员的观点
3. **任务描述注入**：通过 `taskDescription` 参数将其他成员的观点传递给当前成员
4. **共识检测**：检查所有成员是否达成一致意见

**通信流程示例：**

```
Round 1:
  Agent A: "我认为应该用方案 X"
  Agent B: "我认为应该用方案 Y"  (看到 A 的观点)
  Agent C: "我同意 A 的方案 X"   (看到 A 和 B 的观点)

Round 2:
  Agent A: "考虑到 B 的意见，我修改为方案 Z"  (看到 B 和 C 的观点)
  Agent B: "我同意方案 Z"                    (看到 A 的新观点)
  Agent C: "我也同意方案 Z"                  (看到 A 和 B 的观点)
  
→ 达成共识，结束辩论
```

#### 2.4 层级执行（Hierarchical）

```typescript
// TeamManager.ts - executeHierarchical
const leader = members[0];
const leaderResult = await this.executeMemberTask(leader, goal, []);

// 根据主 agent 的输出，分配给其他成员
const workers = members.slice(1);
const workerPromises = workers.map(worker =>
  this.executeMemberTask(
    worker,
    `Based on the leader's analysis:\n${leaderResult.result}\n\nYour task: ${goal}`,
    results,
  )
);
```

**特点：**
- Leader 先执行，分析任务
- Worker 根据 Leader 的分析结果执行
- 适合有明确层级的任务

#### 2.5 流水线（Pipeline）

```typescript
// TeamManager.ts - executePipeline
let currentInput = goal;

for (const member of members) {
  const result = await this.executeMemberTask(member, currentInput, results);
  results.push(result);
  
  // 🔑 下一个成员的输入是上一个成员的输出
  currentInput = result.result;
}
```

**特点：**
- 成员按顺序执行
- 每个成员的输出是下一个成员的输入
- 适合数据处理流水线

---

## 关键设计原则

### 1. 显式上下文传递

**不依赖隐式共享：**
- ❌ 子 Agent 不能自动访问父 Agent 的对话历史
- ✅ 父 Agent 必须显式地在任务描述中包含所有必要信息

**好处：**
- 避免上下文污染
- 清晰的依赖关系
- 更容易调试和理解

### 2. 工具隔离

**防止递归和权限滥用：**
- 子 Agent 不能创建更多子 Agent（`task` 工具被禁用）
- 探索型 Agent 只能读取，不能修改文件
- 最大嵌套深度限制（默认 3 层）

### 3. 超时和资源控制

```typescript
// SubAgentContext.ts
export const DEFAULT_TIMEOUT = 300_000;  // 5 分钟
export const MAX_CONCURRENT_SUBAGENTS = 3;  // 最多 3 个并发子 Agent
export const MAX_NESTING_DEPTH = 3;  // 最大嵌套深度 3 层
```

### 4. 记忆系统的角色

**长期知识 vs 短期上下文：**
- **长期知识**：通过 `retrieve_memory` 工具访问（用户偏好、项目约定）
- **短期上下文**：通过任务描述显式传递（当前任务的具体信息）

---

## 总结

### 上下文管理

| 维度 | 设计 |
|------|------|
| **独立性** | 每个子 Agent 有独立的 MessageManager 和对话历史 |
| **传递方式** | 通过任务描述显式传递（主要）+ 记忆系统（辅助） |
| **工具隔离** | FilteredToolRegistry 过滤受限工具 |
| **资源控制** | 超时、嵌套深度、并发数限制 |

### 辩论模式通信

| 阶段 | 机制 |
|------|------|
| **轮次循环** | 多轮辩论，每轮所有成员发言 |
| **上下文收集** | 收集本轮之前其他成员的观点 |
| **任务注入** | 将其他成员的观点作为任务描述的一部分 |
| **共识检测** | 检查是否所有成员达成一致 |

**关键点：Agent 之间不是直接通信，而是通过 TeamManager 协调，将前面 Agent 的输出作为后面 Agent 的输入。**
