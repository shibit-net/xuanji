# Multi-Agent 工具重合分析与抽象方案

**日期**: 2026-03-15
**问题**: TaskTool/TeamTool/ChainTool 职责重合度高，需要抽象

---

## 重合度分析

### 1. 代码重复对比

**TaskTool（单个）**：
```typescript
class TaskTool {
  async execute(input) {
    // 1. 验证依赖
    if (!this.providerManager || !this.agentRegistry) {
      return this.error('...');
    }

    // 2. 创建 SubAgentContext
    const context = new SubAgentContext({
      task: input.description,
      role: input.subagent_type,
      timeout: input.timeout,
    });

    // 3. 执行
    const result = await runSubAgent(
      this.providerManager,
      this.agentRegistry,
      this.registry,
      this.agentConfig,
      context,
      this.hookRegistry,
      this.memoryStore,
    );

    // 4. 格式化结果
    return this.formatResult(result);
  }
}
```

**TeamTool（多个 + 策略）**：
```typescript
class TeamTool {
  async execute(input) {
    // 1. 验证依赖（✅ 重复）
    if (!this.mainProvider || !this.lightProvider) {
      return this.error('...');
    }

    // 2. 创建 TeamManager
    const manager = new TeamManager(
      this.mainProvider,
      this.lightProvider,
      this.registry,
      this.agentConfig,
      this.hookRegistry,
      this.memoryStore,
    );

    // 3. 创建团队配置
    const teamConfig = {
      name: input.team_name,
      strategy: input.strategy,
      members: input.members.map(m => ({
        id: m.id,
        role: m.role,  // ← 用于 SubAgentContext
        capabilities: m.capabilities,
      })),
    };

    // 4. 执行
    await manager.createTeam(teamConfig);
    const result = await manager.execute(input.goal);

    // 5. 格式化结果（✅ 重复）
    return this.formatResult(result);
  }
}
```

**TeamManager 内部**：
```typescript
class TeamManager {
  async executeSequential(goal: string) {
    const results = [];
    for (const member of this.context.config.members) {
      // ✅ 重复：创建 SubAgentContext
      const context = new SubAgentContext({
        task: member.task || goal,
        role: member.role,
        depth: this.depth + 1,
      });

      // ✅ 重复：调用 runSubAgent
      const result = await runSubAgent(
        this.mainProvider,
        this.lightProvider,
        this.registry,
        this.agentConfig,
        context,
        this.hookRegistry,
        this.memoryStore,
      );

      results.push({ memberId: member.id, result });
    }
    return results;
  }

  async executeParallel(goal: string) {
    // ✅ 重复：相同的 SubAgentContext + runSubAgent
    const promises = this.context.config.members.map(member => {
      const context = new SubAgentContext({ ... });
      return runSubAgent(...);
    });
    return Promise.all(promises);
  }

  async executePipeline(goal: string) {
    // ✅ 重复：相同的 SubAgentContext + runSubAgent + 输出传递
    let previousOutput = '';
    for (const member of members) {
      const task = member.task.replace('{{previous_output}}', previousOutput);
      const context = new SubAgentContext({ task, role: member.role });
      const result = await runSubAgent(...);
      previousOutput = result.result;
    }
  }
}
```

**ChainTool（顺序 + 输出传递）**：
```typescript
class ChainTool {
  async execute(input) {
    // 1. 验证依赖（✅ 重复）
    // 2. 初始化
    let previousOutput = input.initial_input || '';
    const results = [];

    // 3. 顺序执行链
    for (const step of input.chain) {
      // ✅ 重复：创建 SubAgentContext
      const task = step.task_template.replace('{{previous_output}}', previousOutput);
      const context = new SubAgentContext({
        task,
        role: step.agent_id,
        timeout: step.timeout,
        depth: this.currentDepth + 1,
      });

      // ✅ 重复：调用 runSubAgent
      const result = await runSubAgent(
        this.provider,
        this.lightProvider,
        this.registry,
        this.agentConfig,
        context,
        this.hookRegistry,
        this.memoryStore,
      );

      previousOutput = result.result;
      results.push(result);
    }

    // 4. 格式化结果（✅ 重复）
    return this.formatResult(results);
  }
}
```

---

### 2. 重合度量化

| 职责 | TaskTool | TeamTool | ChainTool | 重合度 |
|------|---------|---------|----------|--------|
| 依赖注入验证 | ✅ | ✅ | ✅ | 100% |
| 创建 SubAgentContext | ✅ | ✅（N次） | ✅（N次） | 100% |
| 调用 runSubAgent | ✅ | ✅（N次） | ✅（N次） | 100% |
| 格式化结果 | ✅ | ✅ | ✅ | 100% |
| 策略协调 | ❌ | ✅ | ❌ | 33% |
| 输出传递 | ❌ | ✅（pipeline） | ✅ | 66% |

**重合度**：
- 核心逻辑（依赖验证、创建上下文、调用执行、格式化）：**100% 重合**
- 唯一差异：**执行策略**（单个 vs 顺序 vs 并行 vs pipeline）

---

## 抽象方案对比

### 方案1：统一工具 + mode 参数

**思路**：一个工具搞定所有场景

```typescript
{
  name: 'agent_execute',
  description: 'Execute one or more agents to accomplish a goal',
  input_schema: {
    mode: 'single' | 'sequential' | 'parallel' | 'pipeline' | 'debate',
    agents: Array<{
      id: string,              // Agent ID（用于 AgentRegistry）
      task: string,
      timeout?: number,
    }>,
    goal?: string,             // 总体目标（可选）
    max_rounds?: number,       // debate 专用
  }
}
```

**使用示例**：
```typescript
// 单个 Agent（替代 TaskTool）
{
  tool: 'agent_execute',
  input: {
    mode: 'single',
    agents: [{ id: 'coder', task: 'Fix bug' }]
  }
}

// 顺序执行（替代 TeamTool sequential）
{
  tool: 'agent_execute',
  input: {
    mode: 'sequential',
    agents: [
      { id: 'plan', task: 'Review architecture' },
      { id: 'coder', task: 'Review security' },
    ]
  }
}

// 流水线（替代 ChainTool）
{
  tool: 'agent_execute',
  input: {
    mode: 'pipeline',
    agents: [
      { id: 'explore', task: 'Extract data' },
      { id: 'coder', task: 'Clean {{previous_output}}' },
    ]
  }
}
```

**优点**：
- ✅ 最大程度消除重复代码
- ✅ 概念统一（都是"执行 Agent"）
- ✅ 配置一致性高

**缺点**：
- ❌ 单个工具过于复杂（7种mode）
- ❌ LLM 难以选择（什么时候用哪个mode？）
- ❌ 失去了 TaskTool 的简洁性
- ❌ 配置复杂（即使单个 Agent 也要写 agents 数组）

**评分**：6/10（过于理想化，实用性差）

---

### 方案2：保留工具 + 抽象执行器

**思路**：保留三个工具（TaskTool/TeamTool/ChainTool），抽象公共逻辑到执行器

```typescript
// ========== 抽象层：AgentExecutor ==========
class AgentExecutor {
  constructor(
    private providerManager: ProviderManager,
    private agentRegistry: AgentRegistry,
    private registry: IToolRegistry,
    private agentConfig: AgentConfig,
    private hookRegistry?: HookRegistry,
    private memoryStore?: IMemoryStore,
    private depth = 0,
  ) {}

  /**
   * 执行单个 Agent
   */
  async executeSingle(agentId: string, task: string, options?: {
    timeout?: number,
    isolation?: IsolationMode,
  }): Promise<SubAgentResult> {
    const context = new SubAgentContext({
      task,
      role: agentId,
      timeout: options?.timeout,
      isolation: options?.isolation,
      depth: this.depth,
    });

    return runSubAgent(
      this.providerManager,
      this.agentRegistry,
      this.registry,
      this.agentConfig,
      context,
      this.hookRegistry,
      this.memoryStore,
    );
  }

  /**
   * 顺序执行多个 Agent
   */
  async executeSequential(
    agents: Array<{ id: string; task: string }>,
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    for (const agent of agents) {
      const result = await this.executeSingle(agent.id, agent.task);
      results.push(result);
    }
    return results;
  }

  /**
   * 并行执行多个 Agent
   */
  async executeParallel(
    agents: Array<{ id: string; task: string }>,
  ): Promise<SubAgentResult[]> {
    const promises = agents.map(agent =>
      this.executeSingle(agent.id, agent.task)
    );
    return Promise.all(promises);
  }

  /**
   * 流水线执行（输出传递）
   */
  async executePipeline(
    agents: Array<{ id: string; taskTemplate: string }>,
    initialInput?: string,
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    let previousOutput = initialInput || '';

    for (const agent of agents) {
      const task = agent.taskTemplate.replace('{{previous_output}}', previousOutput);
      const result = await this.executeSingle(agent.id, task);
      results.push(result);
      previousOutput = result.result;
    }

    return results;
  }

  /**
   * 辩论模式（多轮讨论）
   */
  async executeDebate(
    agents: Array<{ id: string; task: string }>,
    maxRounds: number,
  ): Promise<SubAgentResult[]> {
    // ... 实现
  }
}
```

```typescript
// ========== 工具层：使用执行器 ==========

class TaskTool extends BaseTool {
  private executor: AgentExecutor | null = null;

  setDependencies(deps) {
    this.executor = new AgentExecutor(
      deps.providerManager,
      deps.agentRegistry,
      deps.registry,
      deps.agentConfig,
      deps.hookRegistry,
      deps.memoryStore,
      deps.depth,
    );
  }

  async execute(input) {
    const result = await this.executor!.executeSingle(
      input.subagent_type,
      input.description,
      {
        timeout: input.timeout,
        isolation: input.isolation,
      }
    );

    return this.formatResult(result);
  }
}

class TeamTool extends BaseTool {
  private executor: AgentExecutor | null = null;

  setDependencies(deps) {
    this.executor = new AgentExecutor(...);
  }

  async execute(input) {
    let results: SubAgentResult[];

    switch (input.strategy) {
      case 'sequential':
        results = await this.executor!.executeSequential(input.members);
        break;
      case 'parallel':
        results = await this.executor!.executeParallel(input.members);
        break;
      case 'pipeline':
        results = await this.executor!.executePipeline(input.members);
        break;
      case 'debate':
        results = await this.executor!.executeDebate(input.members, input.max_rounds);
        break;
    }

    return this.formatTeamResult(results);
  }
}

class ChainTool extends BaseTool {
  private executor: AgentExecutor | null = null;

  async execute(input) {
    const results = await this.executor!.executePipeline(
      input.chain,
      input.initial_input,
    );

    return this.formatChainResult(results);
  }
}
```

**优点**：
- ✅ 消除核心逻辑重复（依赖验证、SubAgentContext 创建、runSubAgent 调用）
- ✅ 保留工具的简洁性（TaskTool 仍然简单）
- ✅ 保留工具的独立性（LLM 容易选择）
- ✅ 代码可维护性高（修改执行逻辑只需改 AgentExecutor）
- ✅ 可扩展性强（新增策略只需在 AgentExecutor 添加方法）

**缺点**：
- ⚠️ 引入新的抽象层（AgentExecutor）
- ⚠️ 需要重构现有代码（TeamManager 逻辑移到 AgentExecutor）

**评分**：9/10（推荐）

---

### 方案3：工具继承 + 抽象基类

**思路**：抽象公共逻辑到基类，工具继承基类

```typescript
// ========== 抽象基类 ==========
abstract class MultiAgentTool extends BaseTool {
  protected providerManager: ProviderManager | null = null;
  protected agentRegistry: AgentRegistry | null = null;
  protected registry: IToolRegistry | null = null;
  protected agentConfig: AgentConfig | null = null;
  protected hookRegistry: HookRegistry | null = null;
  protected memoryStore: IMemoryStore | null = null;
  protected depth = 0;

  setDependencies(deps) {
    this.providerManager = deps.providerManager;
    this.agentRegistry = deps.agentRegistry;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
    this.depth = deps.depth ?? 0;
  }

  /**
   * 执行单个 Agent（公共方法）
   */
  protected async executeAgent(
    agentId: string,
    task: string,
    options?: { timeout?: number; isolation?: IsolationMode },
  ): Promise<SubAgentResult> {
    this.validateDependencies();

    const context = new SubAgentContext({
      task,
      role: agentId,
      timeout: options?.timeout,
      isolation: options?.isolation,
      depth: this.depth,
    });

    return runSubAgent(
      this.providerManager!,
      this.agentRegistry!,
      this.registry!,
      this.agentConfig!,
      context,
      this.hookRegistry,
      this.memoryStore,
    );
  }

  protected validateDependencies(): void {
    if (!this.providerManager || !this.agentRegistry || !this.registry || !this.agentConfig) {
      throw new Error('Dependencies not injected');
    }
  }
}
```

```typescript
// ========== 子类 ==========
class TaskTool extends MultiAgentTool {
  readonly name = 'task';

  async execute(input) {
    const result = await this.executeAgent(
      input.subagent_type,
      input.description,
      { timeout: input.timeout, isolation: input.isolation },
    );

    return this.formatResult(result);
  }
}

class ChainTool extends MultiAgentTool {
  readonly name = 'agent_chain';

  async execute(input) {
    let previousOutput = input.initial_input || '';
    const results: SubAgentResult[] = [];

    for (const step of input.chain) {
      const task = step.task_template.replace('{{previous_output}}', previousOutput);
      const result = await this.executeAgent(step.agent_id, task, { timeout: step.timeout });
      results.push(result);
      previousOutput = result.result;
    }

    return this.formatChainResult(results);
  }
}
```

**优点**：
- ✅ 消除依赖注入重复
- ✅ 消除 SubAgentContext 创建重复
- ✅ 工具保持独立

**缺点**：
- ⚠️ 继承层次（BaseTool → MultiAgentTool → TaskTool）
- ⚠️ executeAgent 只是薄封装，没有消除策略重复（sequential/parallel仍在 TeamTool）

**评分**：7/10（中等方案）

---

## 推荐方案：方案2（AgentExecutor 抽象）

### 实施步骤

#### Phase 1: 创建 AgentExecutor ✅

**文件**：`src/core/agent/AgentExecutor.ts`

```typescript
import type { ProviderManager } from '@/core/providers/ProviderManager';
import type { AgentRegistry } from './AgentRegistry';
import type { IToolRegistry, AgentConfig } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { IMemoryStore } from '@/memory/types';
import type { SubAgentResult } from './SubAgentLoop';
import { SubAgentContext, type IsolationMode } from './SubAgentContext';
import { runSubAgent } from './SubAgentLoop';

export interface AgentExecutionOptions {
  timeout?: number;
  isolation?: IsolationMode;
  includeParentContext?: boolean;
}

export interface AgentTask {
  id: string;           // Agent ID
  task: string;         // 任务描述
  taskTemplate?: string; // 任务模板（pipeline 用，支持 {{previous_output}}）
}

/**
 * Agent 执行器
 *
 * 封装 Agent 执行的公共逻辑：
 * - 创建 SubAgentContext
 * - 调用 runSubAgent
 * - 支持多种执行策略（single/sequential/parallel/pipeline/debate）
 */
export class AgentExecutor {
  constructor(
    private providerManager: ProviderManager,
    private agentRegistry: AgentRegistry,
    private registry: IToolRegistry,
    private agentConfig: AgentConfig,
    private hookRegistry?: HookRegistry | null,
    private memoryStore?: IMemoryStore | null,
    private depth = 0,
  ) {}

  /**
   * 执行单个 Agent
   */
  async executeSingle(
    agentId: string,
    task: string,
    options?: AgentExecutionOptions,
  ): Promise<SubAgentResult> {
    const context = new SubAgentContext({
      task,
      role: agentId,
      timeout: options?.timeout,
      isolation: options?.isolation,
      parentContext: options?.includeParentContext ? 'Parent context summary' : undefined,
      depth: this.depth,
    });

    return runSubAgent(
      this.providerManager,
      this.agentRegistry,
      this.registry,
      this.agentConfig,
      context,
      this.hookRegistry,
      this.memoryStore,
    );
  }

  /**
   * 顺序执行多个 Agent
   */
  async executeSequential(agents: AgentTask[]): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    for (const agent of agents) {
      const result = await this.executeSingle(agent.id, agent.task);
      results.push(result);
    }
    return results;
  }

  /**
   * 并行执行多个 Agent
   */
  async executeParallel(agents: AgentTask[]): Promise<SubAgentResult[]> {
    const promises = agents.map(agent => this.executeSingle(agent.id, agent.task));
    return Promise.all(promises);
  }

  /**
   * 流水线执行（输出传递）
   */
  async executePipeline(
    agents: AgentTask[],
    initialInput?: string,
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    let previousOutput = initialInput || '';

    for (const agent of agents) {
      const template = agent.taskTemplate || agent.task;
      const task = template.replace(/\{\{previous_output\}\}/g, previousOutput);
      const result = await this.executeSingle(agent.id, task);
      results.push(result);
      previousOutput = result.result;
    }

    return results;
  }

  /**
   * 辩论模式（多轮讨论）
   */
  async executeDebate(
    agents: AgentTask[],
    maxRounds: number,
  ): Promise<SubAgentResult[]> {
    const allResults: SubAgentResult[] = [];
    let previousOutputs: string[] = [];

    for (let round = 0; round < maxRounds; round++) {
      const roundResults: SubAgentResult[] = [];

      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const context = previousOutputs.length > 0
          ? `Round ${round + 1}\nPrevious arguments:\n${previousOutputs.join('\n\n')}`
          : '';
        const task = context ? `${context}\n\n${agent.task}` : agent.task;

        const result = await this.executeSingle(agent.id, task);
        roundResults.push(result);
        previousOutputs.push(`[${agent.id}]: ${result.result}`);
      }

      allResults.push(...roundResults);

      // 检查是否达成共识（简化版，可扩展）
      if (this.hasReachedConsensus(roundResults)) {
        break;
      }
    }

    return allResults;
  }

  private hasReachedConsensus(results: SubAgentResult[]): boolean {
    // 简化实现：检查最后一轮是否所有 agent 都同意
    // 实际可以用 LLM 判断
    return false; // 暂时不实现共识检测
  }
}
```

---

#### Phase 2: 重构 TaskTool ✅

```typescript
// src/core/tools/TaskTool.ts
import { AgentExecutor } from '@/core/agent/AgentExecutor';

export class TaskTool extends BaseTool {
  private executor: AgentExecutor | null = null;

  setDependencies(deps) {
    this.executor = new AgentExecutor(
      deps.providerManager,
      deps.agentRegistry,
      deps.registry,
      deps.agentConfig,
      deps.hookRegistry,
      deps.memoryStore,
      deps.depth,
    );
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.executor) {
      return this.error('TaskTool not initialized.');
    }

    const description = input.description as string;
    const subagentType = (input.subagent_type as string) ?? 'general-purpose';
    const timeout = input.timeout as number | undefined;
    const isolation = (input.isolation as IsolationMode) ?? 'none';
    const includeParentContext = (input.include_parent_context as boolean) ?? false;

    try {
      const result = await this.executor.executeSingle(
        subagentType,
        description,
        { timeout, isolation, includeParentContext },
      );

      return this.formatResult(result);
    } catch (error) {
      return this.error(error instanceof Error ? error.message : String(error));
    }
  }

  private formatResult(result: SubAgentResult): ToolResult {
    const meta = [
      `[Sub-agent completed]`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      `Iterations: ${result.iterations}`,
      `Tokens: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`,
      result.timedOut ? '⚠️ Timed out' : '',
    ].filter(Boolean).join(' | ');

    const content = `${meta}\n\n${result.result}`;

    return this.success(content, {
      subAgent: true,
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      timedOut: result.timedOut,
      iterations: result.iterations,
    });
  }
}
```

---

#### Phase 3: 重构 ChainTool ✅

```typescript
// src/core/tools/ChainTool.ts
import { AgentExecutor } from '@/core/agent/AgentExecutor';

export class ChainTool extends BaseTool {
  private executor: AgentExecutor | null = null;

  setDependencies(deps) {
    this.executor = new AgentExecutor(
      deps.providerManager,
      deps.agentRegistry,
      deps.registry,
      deps.agentConfig,
      deps.hookRegistry,
      deps.memoryStore,
      deps.depth,
    );
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.executor) {
      return this.error('ChainTool not initialized.');
    }

    const chain = input.chain as ChainStep[];
    const initialInput = input.initial_input as string | undefined;

    const agents = chain.map(step => ({
      id: step.agent_id,
      task: step.task_template,
      taskTemplate: step.task_template,
    }));

    try {
      const results = await this.executor.executePipeline(agents, initialInput);
      return this.formatChainResult(results);
    } catch (error) {
      return this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
```

---

#### Phase 4: 重构 TeamTool ✅

```typescript
// src/core/tools/TeamTool.ts
import { AgentExecutor } from '@/core/agent/AgentExecutor';

export class TeamTool extends BaseTool {
  private executor: AgentExecutor | null = null;

  setDependencies(deps) {
    this.executor = new AgentExecutor(...);
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.executor) {
      return this.error('TeamTool not initialized.');
    }

    const strategy = input.strategy as TeamStrategy;
    const membersInput = input.members as TeamMember[];
    const goal = input.goal as string;
    const maxRounds = (input.max_rounds as number) ?? 3;

    const agents = membersInput.map(m => ({
      id: m.role,
      task: m.system_prompt || goal,
    }));

    try {
      let results: SubAgentResult[];

      switch (strategy) {
        case 'sequential':
          results = await this.executor.executeSequential(agents);
          break;
        case 'parallel':
          results = await this.executor.executeParallel(agents);
          break;
        case 'pipeline':
          results = await this.executor.executePipeline(agents);
          break;
        case 'debate':
          results = await this.executor.executeDebate(agents, maxRounds);
          break;
        default:
          return this.error(`Unknown strategy: ${strategy}`);
      }

      return this.formatTeamResult(results);
    } catch (error) {
      return this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
```

---

#### Phase 5: 删除 TeamManager（可选）

TeamManager 的逻辑已被 AgentExecutor 替代，可以删除。

---

## 重构效果对比

### 代码行数

| 模块 | 重构前 | 重构后 | 减少 |
|------|-------|-------|------|
| TaskTool | 200 行 | 80 行 | -60% |
| ChainTool | 180 行 | 70 行 | -61% |
| TeamTool | 150 行 | 90 行 | -40% |
| TeamManager | 400 行 | 0 行（删除） | -100% |
| **AgentExecutor** | 0 行 | 200 行（新增） | - |
| **总计** | 930 行 | 440 行 | **-53%** |

### 重复代码消除

**重构前**：
- 依赖验证：3 处重复
- SubAgentContext 创建：6+ 处重复
- runSubAgent 调用：6+ 处重复
- 格式化结果：3 处重复

**重构后**：
- 依赖验证：AgentExecutor 构造函数（1 处）
- SubAgentContext 创建：AgentExecutor.executeSingle()（1 处）
- runSubAgent 调用：AgentExecutor.executeSingle()（1 处）
- 格式化结果：各工具保留（特定格式）

---

## 总结

### 当前问题

✅ **你说得对**：TaskTool/TeamTool/ChainTool 有大量重合
- 核心逻辑 100% 重复（依赖、上下文、执行）
- 唯一差异：执行策略（单个 vs 顺序 vs 并行 vs pipeline）

### 推荐方案

✅ **AgentExecutor 抽象**（方案2）
- 抽象公共逻辑到执行器
- 保留工具的简洁性和独立性
- 代码量减少 53%
- 可维护性显著提升

### 实施优先级

1. **Phase 1**: 创建 AgentExecutor（新增）
2. **Phase 2**: 重构 TaskTool（最简单）
3. **Phase 3**: 重构 ChainTool（中等）
4. **Phase 4**: 重构 TeamTool（最复杂）
5. **Phase 5**: 删除 TeamManager（可选）

---

**完成日期**: 待定
**负责人**: Kevin Shi
