# Xuanji 职责重构设计方案

> 目标：将当前以 AgentLoop 为核心的"大循环"架构，彻底重构为 13 个职责分离、通过接口和事件总线协作的独立模块。

---

## 一、当前架构病灶

### 1.1 AgentLoop 上帝对象

`AgentLoop`（1198 行）承载了 7 类互不相关的职责：

| 职责 | 对应组件 | 为什么会在这里 |
|------|---------|-------------|
| 消息构建/注入 | MessageManager.setSystemPromptSuffix() | 循环内部直接调用 |
| Token 预算/压缩 | TokenManager, ContextCompressor | 循环内部触发 |
| 流处理/重试 | StreamRetryHandler | 打包成一个黑盒 |
| 工具执行协调 | ToolExecutionCoordinator | 写在循环体里 |
| 异步任务通知 | AsyncAgentTaskManager 回调注册 | 构造函数里注册 |
| 中断/追加状态机 | interrupt(), appendMessage(), _pendingAppendMessage | 循环体内散落多处 |
| 遥测/日志 | SessionRecorder, AgentLoopLogger | 混在 run() 里 |

### 1.2 缺少调度层

当前调用链 `Desktop → ChatSession → MainAgent → AgentLoop` 是一条直线，`MainAgent.run()` 里把意图分析、prompt 构建、agent 执行耦合在一个方法中。结果：

- 无法在 agent 执行前拦截用户输入（比如"执行中追加指令"只能靠 AgentLoop 内部的 `_interrupted` 标志）
- 无法在 agent 空闲时自动消费异步任务结果栈
- 无法做多会话并行调度

### 1.3 Hook 系统充当了 EventBus 替身

Hook（PreToolUse / PostToolUse / SubAgentStart / SubAgentEnd / ErrorOccurred）本来是为扩展预留的，现在被滥用来做模块间通信。Hook 的 `emit()` 是 fire-and-forget 无返回值，不适合需要回传结果的模块间调用。

---

## 二、目标架构全景图

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Xuanji Runtime                                │
│                                                                      │
│   Desktop Bridge ◄─────────────────────────────────────► UI Renderer │
│        │                                                             │
│        ▼                                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              1. ConversationManager (对话管理中心)             │   │
│  │   InputReceiver  │  IntentAnalyzer  │  StateTracker           │   │
│  │   RoutingDecider │  ResponseDispatcher                        │   │
│  └────────────────────────┬─────────────────────────────────────┘   │
│                           │ createTask / terminate / query           │
│                           ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              2. TaskOrchestrator (任务管理中心)                │   │
│  │   TaskPlanner │ TaskScheduler │ ExecutionEngine               │   │
│  │   RetryManager │ ProgressTracker │ ResultAggregator           │   │
│  │   ResultStack (异步结果队列)                                    │   │
│  └───────┬──────────────┬──────────────┬────────────────────────┘   │
│          │              │              │                             │
│          ▼              ▼              ▼                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐                      │
│  │  3.Agent │  │  4.Prompt    │  │ 5.Provider│                     │
│  │  Factory │  │  Composer    │  │   Pool    │                      │
│  └──────────┘  └──────────────┘  └──────────┘                      │
│                                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐       │
│  │  6.Tool  │  │  7.Context   │  │8.Session │  │ 9.Event  │       │
│  │  Gateway │  │   Manager    │  │  Manager │  │   Bus    │       │
│  └──────────┘  └──────────────┘  └──────────┘  └──────────┘       │
│                                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐       │
│  │10.Memory │  │ 11.Permission│  │12.Config │  │13.Stream │       │
│  │ Manager  │  │  Controller  │  │  Manager │  │ Pipeline │       │
│  └──────────┘  └──────────────┘  └──────────┘  └──────────┘       │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              14. Workspace Monitor (可视化大盘)                │   │
│  │  订阅 EventBus，渲染完整的系统运行状态图                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**核心通信原则：**
- **调用** — 有明确请求-响应语义的走接口调用（如 `TaskOrchestrator.createTask()` → `Task`）
- **事件** — 状态变更通知走 EventBus（如 `TASK_COMPLETED`），消费者自己决定如何处理
- **共享状态** — 只有 WorkspaceMonitor 的展示数据通过 EventBus 广播，各模块不直接读别人的内部状态

---

## 三、13 个模块详细设计

---

### 模块 1：ConversationManager（对话管理中心）

**一句话职责：管控用户输入的完整生命周期，决定"现在该做什么"。**

```
ConversationManager
├── InputReceiver        # 输入接收 + 预处理
├── IntentAnalyzer       # 意图分析（LLM→向量→关键词三层匹配）
├── StateTracker         # 对话状态机
├── RoutingDecider       # 路由决策（基于状态+意图）
└── ResponseDispatcher   # 响应分发（流式文本 / 结果汇总 / 错误提示）
```

#### 1.1 InputReceiver

```typescript
class InputReceiver {
  /**
   * 接收用户原始输入，返回标准化后的输入对象
   * 包含：原文、时间戳、来源（对话框/快捷键/外部触发）
   */
  receive(raw: string, source: InputSource): UserInput;

  /**
   * 预处理管道（按顺序执行）：
   * 1. 敏感词过滤
   * 2. @mention 解析（指定 agent / 引用消息）
   * 3. 上下文注入（当前工作目录、最近文件操作）
   * 4. 历史会话引用解析（"上一个任务的结果" → 实际 taskId）
   */
  preprocess(input: UserInput): ProcessedInput;

  /**
   * 温和追加：不中断当前执行，消息排队等待自然边界点消费
   */
  enqueue(message: string): void;

  /**
   * 强制中断追加：终止当前执行，消息作为新任务的输入
   */
  interrupt(message: string): void;

  /**
   * 消费排队消息（当 ConversationManager 空闲时调用）
   */
  consumePending(): ProcessedInput | null;
}
```

#### 1.2 IntentAnalyzer

```typescript
class IntentAnalyzer {
  /**
   * 三层匹配策略（按优先级）：
   * L1: LLM 分类（覆盖率 100%，使用 IntentAnalyzer Agent，~2s）
   *     — 优先使用 LLM 分析，结果最准确
   * L2: 向量语义匹配（命中率 ~70%，<50ms，依赖向量模型）
   *     — LLM 不可用时降级，或作为结果校验
   * L3: 关键词规则匹配（命中率 ~20%，<5ms）
   *     — 极简快速的兜底方案
   *
   * 返回：{ scene, agent, complexity, confidence, matchMethod }
   */
  async analyze(input: string, history: Message[]): Promise<IntentResult>;

  // 意图结果缓存（同一用户短时间内相同意图跳过分析）
  private intentCache: LRUMap<string, IntentResult>;
}
```

#### 1.3 StateTracker（状态机）

```
                            用户输入
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
              ┌──────────┐         ┌──────────┐
    任务完成  │          │ 开始执行 │          │ 异步任务
   ┌─────────│  IDLE    │────────►│EXECUTING │──────────┐
   │         │          │         │          │          │
   │         └──────────┘         └────┬─────┘          │
   │              ▲                    │                │
   │              │                    │ 主agent输出     │
   │              │                    ▼                │
   │              │              ┌──────────┐           │
   │              │     用户清空 │          │           │
   │              │     ┌───────│OUTPUTTING│           │
   │              │     │       │          │           │
   │              │     │       └──────────┘           │
   │              │     │                              │
   │              │     │ 用户中断                     │
   │              │     │ (terminate)                  │
   │              │     │                              ▼
   │              │     │  ┌─────────────────►┌──────────────┐
   │              │     │  │ 输出完成         │  WAITING     │
   │              │     │  │ 自动汇总结果     │  _ASYNC      │
   │              │     │  └─────────────────┤  (主agent空闲) │
   │              │     │                    └──────┬───────┘
   │              │     │                           │
   │              └─────┴───────────────────────────┘
   │                      异步任务完成，自动触发汇总
   │
   └── 新任务完成 / 异步结果消费完毕
```

```typescript
enum ConversationState {
  IDLE = 'idle',
  ANALYZING = 'analyzing',
  EXECUTING = 'executing',
  OUTPUTTING = 'outputting',
  WAITING_ASYNC = 'waiting_async',
}

class StateTracker {
  private state: ConversationState = 'idle';
  private currentTask: Task | null = null;
  private asyncTasks: Map<string, AsyncTaskHandle> = new Map();
  private lastIntent: IntentResult | null = null;
  private stateChangeHandlers: Set<StateChangeHandler> = new Set();

  getState(): ConversationState;
  getCurrentTask(): Task | null;
  getLastIntent(): IntentResult | null;

  transitionTo(newState: ConversationState): void {
    const oldState = this.state;
    this.state = newState;
    // 同步通知 EventBus
    eventBus.emit(XuanjiEvent.CONVERSATION_STATE_CHANGED, { from: oldState, to: newState });
    // 通知本地处理器
    for (const h of this.stateChangeHandlers) h(oldState, newState);
  }

  // 快照（用于中断恢复）
  takeSnapshot(): ConversationSnapshot;
  restoreSnapshot(snapshot: ConversationSnapshot): void;

  // 持有意图，跳过下一次分析
  keepIntent(): void;
  clearIntent(): void;
}
```

#### 1.4 RoutingDecider

```typescript
class RoutingDecider {
  /**
   * 核心决策：拿到意图分析结果 + 当前状态 → 决定处理路径
   */
  decide(intent: IntentResult, state: ConversationState): RoutingDecision;

  /**
   * 执行中收到新输入 → 三种处理策略
   */
  whileExecuting(input: ProcessedInput, state: ConversationState): ExecuteAction {
    // 策略 1: 立即终止所有任务，合并已完成结果，跳过一次意图分析重新开始
    // 策略 2: 温和追加，等当前边界点消费
    // 策略 3: 排队等待当前任务完成
  }

  /**
   * 输出中收到新输入 → 等待输出完成再处理
   */
  whileOutputting(input: ProcessedInput): OutputAction {
    // 消息排队，当前 end_turn 后合并上下文创建新任务
  }

  /**
   * 异步等待中收到新输入 → 空闲逻辑正常处理（新任务）
   */
  whileWaitingAsync(input: ProcessedInput): RoutingDecision {
    // 等同于 IDLE 状态的处理逻辑
  }
}

type RoutingDecision =
  | { action: 'delegate_single_agent'; agentId: string; scene: string }
  | { action: 'delegate_agent_team'; members: TeamMember[]; strategy: TeamStrategy }
  | { action: 'run_main_agent'; prompt: string }
  | { action: 'direct_answer'; answer: string }
  | { action: 'execute_async'; task: Task }
  | { action: 'ask_user'; question: string };

type ExecuteAction =
  | { action: 'terminate_and_restart'; mergedInput: string; partialResults: PartialResult[] }
  | { action: 'gentle_append'; message: string }
  | { action: 'queue'; message: string };
```

#### 1.5 ResponseDispatcher

```typescript
class ResponseDispatcher {
  /**
   * 最终输出分发——只负责把结果送到正确的通道
   */
  dispatch(result: DispatchableResult): void {
    switch (result.type) {
      case 'stream_text':
        this.streamPipeline.feed(result.text);      // → UI 流式更新
        break;
      case 'stream_thinking':
        this.streamPipeline.feedThinking(result.text);
        break;
      case 'tool_start':
        eventBus.emit(AGENT_TOOL_START, result);    // → WorkspaceMonitor
        break;
      case 'tool_end':
        eventBus.emit(AGENT_TOOL_END, result);
        break;
      case 'task_created':
        eventBus.emit(TASK_CREATED, result);        // → WorkspaceMonitor
        break;
      case 'async_task_started':
        this.uiBridge.showAsyncTaskCard(result);     // → UI 异步卡片
        break;
      case 'async_task_completed':
        eventBus.emit(ASYNC_TASK_COMPLETED, result); // → StateTracker 检查是否空闲
        break;
      case 'error':
        this.uiBridge.showError(result.error);
        break;
    }
  }
}
```

---

### 模块 2：TaskOrchestrator（任务管理中心）

**一句话职责：接收对话管理中心的调度指令，编排 agent 真正执行任务。**

```
TaskOrchestrator
├── TaskPlanner          # 意图 → 任务计划（拆 step，分配 agent）
├── TaskScheduler        # 同步/异步调度队列
├── ExecutionEngine      # 驱动 agent 执行单个 step
├── RetryManager         # step 级别重试 + 指数退避
├── ProgressTracker      # 实时进度推送 → EventBus
├── ResultAggregator     # 多 step 结果合并
└── ResultStack          # 异步完成结果队列
```

#### 2.1 Task & TaskStep 模型

```typescript
interface Task {
  id: string;                          // task-{uuid}
  type: 'sync' | 'async';
  status: TaskStatus;
  priority: number;                    // 0-10，越高越优先

  intent: IntentResult;                // 触发此任务的意图
  goal: string;                        // 自然语言目标
  complexity: 'simple' | 'standard' | 'complex';

  steps: TaskStep[];                   // 执行计划
  currentStepIndex: number;

  context: TaskContext;                // 工作目录、用户ID、父任务ID
  parentTaskId?: string;

  result?: TaskResult;
  completedSteps: TaskStepResult[];

  abortController: AbortController;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  timeout: number;
  retryCount: number;
  maxRetries: number;
}

interface TaskStep {
  id: string;
  type: StepType;
  agentId: string;                     // 哪个 agent 执行这个 step
  scene: string;                       // 场景类型，用于 PromptComposer
  description: string;                 // 这个 step 要完成什么
  input: string;                       // 传给 agent 的 user message

  dependencies: string[];              // 依赖的 step id（拓扑排序）
  status: TaskStatus;

  result?: TaskStepResult;
  startedAt?: number;
  completedAt?: number;
}

type StepType =
  | 'intent_analysis'    // 意图分析 agent
  | 'main_agent'         // 主调度 agent
  | 'sub_agent'          // 单个子 agent（通过 task 工具）
  | 'agent_team'         // 团队协作（通过 agent_team 工具）
  | 'synthesis'          // 结果汇总（主 agent）
  | 'user_confirmation'; // 等待用户确认（plan_review, ask_user）

type TaskStatus =
  | 'pending' | 'running' | 'paused'
  | 'completed' | 'failed' | 'cancelled' | 'terminated';
```

#### 2.2 TaskPlanner

```typescript
class TaskPlanner {
  /**
   * 把意图分析结果翻译成可执行的 step 序列
   */
  plan(intent: IntentResult): TaskPlan {
    const steps: TaskStep[] = [];

    switch (intent.complexity) {
      case 'simple':
        // 简单专业任务：直接委派给目标 agent
        steps.push({
          type: 'sub_agent',
          agentId: intent.agent,
          scene: intent.scene,
          description: intent.goal,
          input: intent.goal,
        });
        break;

      case 'standard':
        // 标准任务：主 agent 分析 → 委派执行 → 汇总
        steps.push({ type: 'main_agent', agentId: 'main', scene: intent.scene, ... });
        break;

      case 'complex':
        // 复杂任务：主 agent 规划 → plan_review → agent_team → 主 agent 汇总
        steps.push(
          { type: 'main_agent', agentId: 'main', scene: intent.scene, ... },
          { type: 'synthesis', agentId: 'main', ... },
        );
        break;
    }

    return { steps, estimatedDuration: this.estimateDuration(steps) };
  }

  /**
   * 根据历史执行数据估算耗时
   */
  private estimateDuration(steps: TaskStep[]): number;
}
```

#### 2.3 TaskScheduler

```typescript
class TaskScheduler {
  private syncQueue: Task[] = [];          // 同步任务队列（同时最多1个）
  private asyncPool: Task[] = [];          // 异步任务池（同时最多3个）
  private maxAsyncConcurrent = 3;

  /**
   * 调度任务
   */
  schedule(task: Task, mode: 'sync' | 'async'): void {
    if (mode === 'sync') {
      if (this.syncQueue.length > 0) {
        // 同步任务排队（上一个完成后再执行）
        this.syncQueue.push(task);
        eventBus.emit(TASK_QUEUED, { taskId: task.id });
      } else {
        this.syncQueue.push(task);
        this.executeNextSync();
      }
    } else {
      if (this.asyncPool.length >= this.maxAsyncConcurrent) {
        // 异步池满 → 排队
        this.asyncPool.push(task);
      } else {
        this.asyncPool.push(task);
        this.executeAsync(task);
      }
    }
  }

  private async executeNextSync(): Promise<void> {
    const task = this.syncQueue[0];
    await this.executionEngine.execute(task);
    this.syncQueue.shift();
    // 执行排队的下一个同步任务
    if (this.syncQueue.length > 0) this.executeNextSync();
  }

  private async executeAsync(task: Task): Promise<void> {
    this.executionEngine.executeAsync(task).finally(() => {
      const idx = this.asyncPool.findIndex(t => t.id === task.id);
      if (idx >= 0) this.asyncPool.splice(idx, 1);
    });
  }
}
```

#### 2.4 ExecutionEngine

```typescript
class ExecutionEngine {
  /**
   * 同步执行一个 step
   */
  async executeStep(step: TaskStep, task: Task): Promise<TaskStepResult> {
    // 1. 创建 agent
    const agent = this.agentFactory.create(step.agentId, {
      scene: step.scene,
      task: step.description,
      parentTaskId: task.id,
      workingDir: task.context.workingDir,
      depth: task.context.depth + 1,
    });

    // 2. 组合 prompt
    const systemPrompt = this.promptComposer.composeForStep(step, task);
    agent.setSystemPrompt(systemPrompt);

    // 3. 执行
    eventBus.emit(TASK_STEP_STARTED, { taskId: task.id, stepId: step.id });
    try {
      await agent.run(step.input);
      const state = agent.getState();
      eventBus.emit(TASK_STEP_COMPLETED, { taskId: task.id, stepId: step.id, state });
      return { success: true, output: state.output, tokenUsage: state.tokenUsage, duration: Date.now() - step.startedAt! };
    } catch (err) {
      return await this.retryManager.handleError(task, step, err);
    } finally {
      this.agentFactory.release(step.agentId);
    }
  }
}
```

#### 2.5 RetryManager

```typescript
class RetryManager {
  /**
   * 指数退避重试策略
   */
  async handleError(task: Task, step: TaskStep, error: Error): Promise<TaskStepResult> {
    if (task.retryCount >= task.maxRetries) {
      return { success: false, error: error.message };
    }

    task.retryCount++;

    // 退避延迟：1s, 2s, 4s, 8s, ...
    const delay = Math.min(1000 * Math.pow(2, task.retryCount - 1), 30000);
    await sleep(delay);

    // 重试前可能调整参数（增大 timeout、简化描述等）
    const adjustedStep = this.adjustStep(step, error);

    return this.executionEngine.executeStep(adjustedStep, task);
  }
}
```

#### 2.6 中断处理（terminate）

```typescript
class TaskOrchestrator {
  /**
   * 级联终止所有任务
   */
  async terminateAll(): Promise<void> {
    // 1. 终止当前同步任务
    const currentTask = this.stateTracker.getCurrentTask();
    if (currentTask) {
      currentTask.abortController.abort();
      currentTask.status = 'terminated';
      eventBus.emit(TASK_TERMINATED, { taskId: currentTask.id });
    }

    // 2. 终止所有子 agent（通过 AbortController 级联）
    this.agentFactory.abortAll();

    // 3. 取消排队的同步任务
    for (const task of this.scheduler.drainSyncQueue()) {
      task.status = 'cancelled';
      eventBus.emit(TASK_CANCELLED, { taskId: task.id });
    }

    // 4. 异步任务不受影响（继续在后台执行）
    //    等它们完成后结果会进 ResultStack
  }

  /**
   * 收集已完成的部分结果（中断后使用）
   */
  collectPartialResults(): PartialResult[] {
    const task = this.stateTracker.getCurrentTask();
    if (!task) return [];
    return task.completedSteps.map(s => ({
      stepId: s.id,
      type: s.type,
      output: s.result?.output ?? '',
      success: s.result?.success ?? false,
    }));
  }
}
```

#### 2.7 ResultStack（异步结果队列）

```typescript
class ResultStack {
  private pending: CompletedAsyncTask[] = [];
  private maxSize = 50;

  push(task: CompletedAsyncTask): void {
    this.pending.push(task);
    if (this.pending.length > this.maxSize) this.pending.shift();
    eventBus.emit(ASYNC_TASK_COMPLETED, { taskId: task.id });
  }

  /** 是否有待处理结果 */
  hasPending(): boolean;

  /** FIFO 取出一个 */
  pop(): CompletedAsyncTask | null;

  /** 一次性消费所有待处理结果 */
  drain(): CompletedAsyncTask[] {
    const tasks = [...this.pending];
    this.pending = [];
    return tasks;
  }
}
```

---

### 模块 3：AgentFactory（Agent 工厂）

**一句话职责：创建完整的、配置正确的、可直接使用的 AgentLoop 实例。**

```
AgentFactory
├── ConfigResolver        # 用户配置优先，缺失从模板同步
├── ProviderResolver      # 独立 provider vs 继承父 provider
├── ToolFilter            # 按 agent 配置过滤可用工具
├── ContextPopulator      # 注入项目规则、工作目录、depth 标记
├── AgentPool             # 短生命周期 agent 实例复用
└── TemporaryAgentCreator # 动态创建临时 agent
```

```typescript
class AgentFactory {
  /**
   * 统一创建入口
   */
  create(agentId: string, options: AgentCreateOptions): AgentLoop {
    // 1. 解析配置
    const config = this.configResolver.resolve(agentId);
    if (!config) throw new AgentNotFoundError(agentId);

    // 2. 解析 provider（独立 vs 继承）
    const provider = this.providerResolver.resolve(config, options.parentProvider);

    // 3. 组合 prompt（委托给 PromptComposer）
    const systemPrompt = this.promptComposer.composeForAgent(agentId, {
      scene: options.scene,
      taskDescription: options.task,
      depth: options.depth,
    });

    // 4. 过滤工具
    const toolRegistry = this.toolFilter.filter(
      this.toolGateway.getBaseRegistry(),
      config.tools,
      options.toolWhitelist,
    );

    // 5. 注入上下文
    const runtimeConfig = this.contextPopulator.populate(config, systemPrompt, options);

    // 6. 创建 AgentLoop
    return new AgentLoop(provider, toolRegistry, runtimeConfig);
  }

  /** 获取或复用已创建的 agent（AgentPool） */
  acquire(agentId: string): AgentLoop;
  release(agentId: string): void;
  abortAll(): void;
}
```

**AgentPool 设计：**

```typescript
class AgentPool {
  private pool: Map<string, PooledAgent> = new Map();
  private maxSize = 10;
  private maxIdleMs = 5 * 60 * 1000; // 5 分钟无使用则回收

  acquire(agentId: string, factory: () => AgentLoop): AgentLoop {
    const entry = this.pool.get(agentId);
    if (entry && !entry.inUse) {
      entry.inUse = true;
      entry.lastUsed = Date.now();
      return entry.agent;
    }
    // 池满则回收最久未用的
    if (this.pool.size >= this.maxSize) this.evictOne();
    const agent = factory();
    this.pool.set(agentId, { agent, inUse: true, lastUsed: Date.now() });
    return agent;
  }

  release(agentId: string): void {
    const entry = this.pool.get(agentId);
    if (entry) entry.inUse = false;
    // 不立即销毁，保留供复用
  }

  private evictOne(): void;     // LRU 淘汰
  evictIdle(): void;            // 定时清理过期实例
}
```

---

### 模块 4：PromptComposer（Prompt 动态组合模块）

**一句话职责：根据 scene + complexity + agentId 动态组合分层的 system prompt。**

**Prompt 最终组成 = Agent.systemPrompt + L0 + L1 + L2 + L3(项目 Prompt)**

```
┌────────────────────────────────────────────┐
│ Agent 自身的 systemPrompt                   │ 始终
│   - Agent 配置中定义的 systemPrompt          │
│   - 临时 Agent 的 LLM 指定 systemPrompt     │
├────────────────────────────────────────────┤
│ L3: 项目 Prompt (.xuanji/prompts/ 等)      │ 始终加载
│   - 项目规则 (XUANJI.md, rules.md)          │
│   - 项目/用户级 prompt 组件                  │
│   - 运行上下文 (工作目录、时间等)             │
├────────────────────────────────────────────┤
│ L2: 团队协作策略（l2-team-coordination）     │ complex
│   - 策略选择、成员角色分配、阶段衔接          │
├────────────────────────────────────────────┤
│ L1: 场景 Prompt（l1-{scene}）              │ standard+
│   - write_code / debug / review / plan      │
│   - research / security / optimize          │
│   - 按 scene 匹配加载                        │
├────────────────────────────────────────────┤
│ L0: 基础 Prompt（l0-main-agent /            │ 始终
│     l0-task-planning）                      │
│   - Agent 身份定义 + 输出纪律                │
│   - 调度协作规则 + 执行原则                  │
└────────────────────────────────────────────┘
```

```typescript
class PromptComposer {
  /**
   * 为 MainAgent 构建 system prompt（对话管理中心调用）
   */
  async composeForMainAgent(ctx: {
    userMessage: string;
    scene: string;
    complexity: 'simple' | 'standard' | 'complex';
    agent: string;
    intentHint: string;                // 意图分析注入的提示
  }): Promise<ComposedPrompt>;

  /**
   * 为子 Agent 构建 system prompt（AgentFactory 调用）
   */
  async composeForSubAgent(ctx: {
    agentId: string;
    scene: string;
    taskDescription: string;
    depth: number;
  }): Promise<ComposedPrompt>;

  /**
   * 构建意图分析用的 prompt（轻量，仅分类能力）
   */
  composeForIntentAnalysis(userMessage: string): string;

  /**
   * 构建异步结果汇总用的 prompt
   */
  composeForResultSynthesis(tasks: CompletedAsyncTask[]): string;

  /** 构建特定 step 的 prompt */
  composeForStep(step: TaskStep, task: Task): Promise<ComposedPrompt>;

  /** 注册自定义 prompt 组件 */
  registerComponent(component: PromptComponent): void;

  /** 预估 token 数 */
  estimateTokens(prompt: string): number;
}

interface ComposedPrompt {
  systemPrompt: string;
  components: string[];       // 加载了哪些组件的 id
  estimatedTokens: number;
  scene: string;
  complexity: string;
}
```

**Prompt 加载优先级：**

```typescript
class LayerLoader {
  loadL0(): PromptComponent[];     // 基础调度规则（始终加载）
  loadL1(scene: string): PromptComponent[];  // scene 匹配（standard+ 加载）
  loadL2(): PromptComponent[];     // 团队协作（仅 complex 加载）
  loadL3(ctx: BuildContext): PromptComponent[];  // 项目 Prompt（始终加载）

  /**
   * 组件来源（优先级从高到低）：
   * 1. 项目级: .xuanji/prompts/      — 项目自定义组件
   * 2. 用户级: ~/.xuanji/prompts/    — 用户自定义组件
   * 3. 应用级: src/core/prompt/app/  — xuanji 自带组件（作为默认模板）
   *
   * 同名组件按此优先级覆盖，应用级组件作为兜底
   */
  resolve(componentId: string): PromptComponent | null;
}
```

---

### 模块 5：ProviderPool（LLM Provider 连接池）

**一句话职责：管理所有 LLM Provider 实例的创建、复用、故障转移。**

```typescript
class ProviderPool {
  /**
   * 获取或创建 Provider（相同 model+apiKey+baseURL 会复用）
   */
  getProvider(config: ProviderConfig): ILLMProvider;

  /**
   * 释放引用（引用计数减 1，归零后回收）
   */
  releaseProvider(provider: ILLMProvider): void;

  /**
   * 故障转移：主模型连续失败 n 次后自动切换备用模型
   */
  getFallbackProvider(failedProvider: ILLMProvider): ILLMProvider;

  /**
   * 预热连接（减少首次调用的冷启动延迟）
   */
  warmup(configs: ProviderConfig[]): Promise<void>;

  /**
   * 速率限制：全局并发请求上限
   */
  acquireRateSlot(): Promise<void>;
  releaseRateSlot(): void;

  /**
   * 健康状态
   */
  healthCheck(): Promise<Map<string, HealthStatus>>;
}

interface ProviderConfig {
  adapter: 'openai' | 'anthropic' | 'custom';
  model: string;
  apiKey: string;
  baseURL: string;
  maxConcurrent?: number;
  timeout?: number;
}
```

---

### 模块 6：ToolGateway（工具网关）

**一句话职责：工具注册、发现、权限控制、执行的统一入口。**

```typescript
class ToolGateway {
  /**
   * 获取基础工具注册表（所有可用工具）
   */
  getBaseRegistry(): IToolRegistry;

  /**
   * 发现工具：内置 + MCP + Skill
   */
  async discover(): Promise<ToolSchema[]>;

  /**
   * 注册/注销工具
   */
  register(tool: ITool): void;
  unregister(toolName: string): void;

  /**
   * 创建过滤后的注册表（按 Agent 配置限制可用工具）
   */
  createFilteredRegistry(
    allowedTools: string[],
    context: AgentContext,
  ): FilteredToolRegistry;

  /**
   * 执行单个工具（带权限检查 + 沙箱 + 指标记录）
   */
  async execute(
    toolCall: ToolCall,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    // 1. 权限检查
    const permission = this.permissionController.check(toolCall.name, toolCall.input);
    if (permission === 'denied') return error('Permission denied');
    if (permission === 'confirm') {
      const approved = await this.permissionController.requestConfirmation(toolCall);
      if (!approved) return error('User denied');
    }

    // 2. 沙箱安全化
    const sanitizedInput = this.toolSandbox.sanitize(toolCall.name, toolCall.input);

    // 3. 执行 + 计时 + 记录指标
    const start = Date.now();
    try {
      const result = await this.registry.execute(toolCall.name, sanitizedInput, context.signal);
      this.toolMetrics.record(toolCall.name, Date.now() - start, false);
      return result;
    } catch (err) {
      this.toolMetrics.record(toolCall.name, Date.now() - start, true);
      throw err;
    }
  }

  /**
   * 批量执行工具（并行 + 串行混合）
   */
  async executeBatch(
    toolCalls: ToolCall[],
    context: ExecutionContext,
  ): Promise<Map<string, ToolResult>>;
}
```

---

### 模块 7：ContextManager（上下文管理器）

**一句话职责：管理 LLM 对话上下文——消息构建、token 预算、上下文压缩。**

```typescript
class ContextManager {
  private messageHistory: MessageManager;
  private tokenCounter: TokenCounter;
  private budgetMonitor: BudgetMonitor;
  private compressor: ContextCompressor;

  /**
   * 获取当前消息数组（system prompt + 历史 + tool results）
   */
  getMessages(): Message[];

  /**
   * 添加 assistant 消息
   */
  addAssistantMessage(blocks: ContentBlock[]): void;

  /**
   * 添加 tool result 消息
   */
  addToolResults(results: Map<string, ToolResult>): void;

  /**
   * Token 预算检查：主动预警，预防 413
   */
  checkBudget(): BudgetStatus;

  /**
   * 触发上下文压缩
   */
  async compress(strategy: CompressionStrategy): Promise<CompressionResult>;

  /**
   * 消息历史快照 / 回滚（用于 API 调用失败恢复）
   */
  snapshot(): number;           // 返回快照索引
  rollback(snapshotIndex: number): void;

  /**
   * 替换 system prompt（动态更新）
   */
  updateSystemPrompt(prompt: string): void;

  /**
   * 清空（会话重置）
   */
  clear(): void;
}

type BudgetStatus =
  | { level: 'green'; usagePercent: number }
  | { level: 'yellow'; usagePercent: number; suggestion: string }
  | { level: 'red'; usagePercent: number; requiredAction: 'compress' | 'truncate' };
```

---

### 模块 8：SessionManager（会话管理器）

**一句话职责：管理对话会话的生命周期、持久化、恢复、多会话切换。**

```typescript
class SessionManager {
  /**
   * 创建新会话
   */
  create(name: string, config: SessionConfig): Session;

  /**
   * 切换活跃会话
   */
  switchTo(sessionId: string): Promise<void>;

  /**
   * 列出所有会话
   */
  list(): SessionSummary[];

  /**
   * 保存当前会话到磁盘（checkpoint）
   */
  save(sessionId: string): Promise<void>;

  /**
   * 从磁盘恢复会话
   */
  restore(sessionId: string): Promise<Session>;

  /**
   * 自动保存（定时 + 关键事件触发）
   */
  enableAutoSave(intervalMs: number): void;

  /**
   * 删除会话
   */
  delete(sessionId: string): Promise<void>;

  /**
   * 导出会话（Markdown / JSON）
   */
  export(sessionId: string, format: 'markdown' | 'json'): string;
}
```

---

### 模块 9：EventBus（事件总线）

**一句话职责：模块间解耦通信——替代当前的 Hook 滥用和直接方法调用。**

```typescript
class EventBus {
  /** 订阅事件 */
  on(event: XuanjiEvent, handler: EventHandler, options?: SubscribeOptions): Unsubscribe;

  /** 一次性订阅 */
  once(event: XuanjiEvent, handler: EventHandler): Unsubscribe;

  /** 发射事件 */
  emit(event: XuanjiEvent, payload: any): void;

  /** 请求-响应模式（等待订阅者返回结果） */
  request<T>(event: XuanjiEvent, payload: any, timeout: number): Promise<T[]>;

  /** 事件日志（调试用） */
  getRecentEvents(count: number): LoggedEvent[];

  /** 桥接到 renderer 进程 */
  bridge(channel: string): void;
}
```

**核心事件全集：**

```typescript
enum XuanjiEvent {
  // === 对话管理中心 ===
  CONVERSATION_STATE_CHANGED = 'conv.state.changed',
  USER_INPUT_RECEIVED        = 'conv.input.received',
  INTENT_ANALYZED            = 'conv.intent.analyzed',
  RESPONSE_STARTED           = 'conv.response.started',
  RESPONSE_COMPLETED         = 'conv.response.completed',

  // === 任务管理中心 ===
  TASK_CREATED               = 'task.created',
  TASK_QUEUED                = 'task.queued',
  TASK_STARTED               = 'task.started',
  TASK_STEP_STARTED          = 'task.step.started',
  TASK_STEP_COMPLETED        = 'task.step.completed',
  TASK_COMPLETED             = 'task.completed',
  TASK_FAILED                = 'task.failed',
  TASK_CANCELLED             = 'task.cancelled',
  TASK_TERMINATED            = 'task.terminated',
  ASYNC_TASK_STARTED         = 'async.task.started',
  ASYNC_TASK_PROGRESS        = 'async.task.progress',
  ASYNC_TASK_COMPLETED       = 'async.task.completed',
  ASYNC_TASK_FAILED          = 'async.task.failed',

  // === Agent ===
  AGENT_CREATED              = 'agent.created',
  AGENT_STARTED              = 'agent.started',
  AGENT_TOOL_START           = 'agent.tool.start',
  AGENT_TOOL_DELTA           = 'agent.tool.delta',
  AGENT_TOOL_END             = 'agent.tool.end',
  AGENT_TEXT_DELTA           = 'agent.text.delta',
  AGENT_THINKING_DELTA       = 'agent.thinking.delta',
  AGENT_FILE_CHANGES         = 'agent.file.changes',
  AGENT_COMPLETED            = 'agent.completed',
  AGENT_ERROR                = 'agent.error',

  // === Workspace Monitor ===
  WORKSPACE_STATE_SNAPSHOT   = 'workspace.state.snapshot',
  WORKSPACE_NODE_ADDED       = 'workspace.node.added',
  WORKSPACE_NODE_UPDATED     = 'workspace.node.updated',
  WORKSPACE_NODE_REMOVED     = 'workspace.node.removed',
  WORKSPACE_EDGE_ADDED       = 'workspace.edge.added',
  WORKSPACE_EDGE_REMOVED     = 'workspace.edge.removed',

  // === Provider ===
  PROVIDER_HEALTH_CHANGED    = 'provider.health.changed',
  PROVIDER_FALLBACK_TRIGGERED = 'provider.fallback.triggered',

  // === Context ===
  CONTEXT_COMPRESSION_STARTED = 'context.compression.started',
  CONTEXT_COMPRESSION_DONE    = 'context.compression.done',
  TOKEN_BUDGET_WARNING        = 'context.token.warning',

  // === Session ===
  SESSION_SAVED              = 'session.saved',
  SESSION_RESTORED           = 'session.restored',
  SESSION_SWITCHED           = 'session.switched',

  // === System ===
  SYSTEM_ERROR               = 'system.error',
}
```

---

### 模块 10：MemoryManager（记忆管理器）⚠️ 占位

**一句话职责：管理跨会话的持久记忆——用户偏好、项目约定、知识片段。**

> **状态：未实现，先占位。** 当前设计为预留接口，后续版本实现。记忆模块将依赖向量模型配置（作为特殊 Agent 配置管理）。

```typescript
// 预留接口，暂不实现
class MemoryManager {
  async save(memory: Memory): Promise<void>;
  async retrieve(query: string, options: RetrieveOptions): Promise<Memory[]>;
  async extractFromConversation(messages: Message[]): Promise<Memory[]>;
  async delete(memoryId: string): Promise<void>;
}

interface Memory {
  id: string;
  type: 'user_preference' | 'project_convention' | 'knowledge_snippet' | 'feedback';
  content: string;
  embedding?: number[];
  createdAt: number;
}
```

---

### 模块 11：PermissionController（权限控制器）

**一句话职责：工具执行前的权限检查、用户确认、操作审批。**

```typescript
class PermissionController {
  /**
   * 检查是否允许执行
   */
  check(toolName: string, input: Record<string, unknown>): PermissionResult;

  /**
   * 请求用户确认（弹框）
   */
  async requestConfirmation(request: ConfirmationRequest): Promise<boolean>;

  /**
   * 设置权限规则
   */
  setRule(rule: PermissionRule): void;

  /**
   * 设置确认处理器
   */
  setConfirmationHandler(handler: ConfirmationHandler): void;

  /**
   * 设置计划审批处理器
   */
  setPlanReviewHandler(handler: PlanReviewHandler): void;

  /**
   * 跟踪同一意图下的拒绝次数
   */
  trackDenial(intent: string): void;
  shouldAutoDeny(intent: string): boolean;  // 同一意图连续拒绝 3 次 → 自动拒绝
}

type PermissionResult = 'allowed' | 'denied' | 'confirm';

interface PermissionRule {
  toolName: string;
  pattern?: RegExp;          // 匹配 input 的正则（如禁止 rm -rf /）
  autoAllow?: boolean;
  autoDeny?: boolean;
  requireConfirmation?: boolean;
}
```

---

### 模块 12：ConfigManager（配置管理器）

**一句话职责：管理多用户隔离的配置。xuanji 是多用户应用，除系统配置外，所有用户配置严格隔离。**

**配置模型：**

```
多用户配置架构：

用户A (~/.xuanji/users/user-a/)
├── agents/              # Agent 配置（用户隔离）
├── prompts/             # 用户自定义 prompt 组件（用户隔离）
├── settings.json        # 用户设置（API Key、默认模型等，用户隔离）
└── ...

用户B (~/.xuanji/users/user-b/)
├── agents/
├── prompts/
├── settings.json
└── ...

系统配置 (~/.xuanji/system/)
├── settings.json        # 应用级系统配置（全局生效，非用户隔离）
│   ├── language         # 语言
│   ├── theme            # 主题
│   ├── keybindings      # 快捷键
│   └── ...

配置模板 (src/core/config/templates/)
├── agents/              # Agent 配置模板
├── prompts/             # Prompt 组件模板
└── settings.json        # 默认设置模板
— 仅在创建新用户时，从模板初始化用户配置目录
— 模板 = 当前用户配置作为最新的基础模板使用

初始化流程：
1. 新用户首次使用 → 从 templates/ 复制到 ~/.xuanji/users/{userId}/
2. 用户配置必然存在（初始化保证）
3. Desktop 面板 → 直接读写对应用户的配置文件
4. 向量模型配置 → 作为特殊 Agent（type: "embedding"）管理，同样用户隔离
   — 用途：IntentAnalyzer 的向量匹配 ｜ MemoryManager 的语义检索（后续实现）
```

```typescript
class ConfigManager {
  private userId: string;                    // 当前用户 ID
  private userConfigDir: string;             // ~/.xuanji/users/{userId}/
  private systemConfigDir: string;           // ~/.xuanji/system/
  private templateDir: string;               // src/core/config/templates/

  /**
   * 初始化当前用户配置：
   * 1. 检查 ~/.xuanji/users/{userId}/ 是否存在
   * 2. 不存在 → 从 templates/ 复制创建
   * 3. 用户配置必然存在（初始化后保证）
   */
  async initForUser(userId: string): Promise<void>;

  /**
   * === 用户配置（用户隔离）===
   */

  /** 获取当前用户的 Agent 配置列表 */
  getAgentConfigs(): AgentConfig[];

  /** 获取当前用户的单个 Agent 配置 */
  getAgentConfig(agentId: string): AgentConfig | null;

  /** 保存 Agent 配置（Desktop 面板直接写用户配置文件） */
  async saveAgentConfig(agentId: string, config: AgentConfig): Promise<void>;

  /** 删除 Agent 配置 */
  async deleteAgentConfig(agentId: string): Promise<void>;

  /** 获取当前用户设置（API Key、默认模型等） */
  getSettings(): UserSettings;

  /** 更新当前用户设置（Desktop 面板直接写用户配置文件） */
  async updateSettings(patch: Partial<UserSettings>): Promise<void>;

  /** 获取当前用户的 Provider 配置 */
  getProviderConfig(agentId?: string): ProviderConfig;

  /** 获取当前用户的向量模型配置（特殊 Agent，type: "embedding"） */
  getEmbeddingConfig(): AgentConfig | null;

  /**
   * === 系统配置（全局，所有用户共享）===
   */

  /** 获取系统配置（语言、主题、快捷键等） */
  getSystemConfig(): SystemConfig;

  /** 更新系统配置 */
  async updateSystemConfig(patch: Partial<SystemConfig>): Promise<void>;

  /** 监听当前用户配置文件变更 */
  watchUserConfig(handler: (path: string) => void): Unsubscribe;
}

interface UserSettings {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;  // API Key 等
  defaultModel: string;
  maxIterations: number;
  // ...
}

interface SystemConfig {
  language: 'zh-CN' | 'en';
  theme: 'light' | 'dark';
  keybindings: Record<string, string>;
  // ...
}
```

---

### 模块 13：StreamPipeline（流式管道）

**一句话职责：管理 LLM 响应流的解析、分发、缓冲、重试。**

```typescript
class StreamPipeline {
  /**
   * 执行一次带流的 LLM 调用
   */
  async execute(
    messages: Message[],
    toolSchemas: ToolSchema[],
    options: StreamOptions,
  ): Promise<StreamResult>;

  /**
   * 注册流事件处理器
   */
  onTextDelta(handler: (text: string) => void): void;
  onThinkingDelta(handler: (thinking: string) => void): void;
  onToolCallStart(handler: (toolCall: ToolCall) => void): void;
  onToolCallDelta(handler: (id: string, delta: string) => void): void;
  onUsage(handler: (usage: TokenUsage) => void): void;

  /**
   * 设置中断检查（当 ConversationManager 请求中断时，流应停止读取）
   */
  setInterruptChecker(checker: () => boolean): void;

  /**
   * 设置活跃流引用（用于外部终止）
   */
  setCurrentStream(stream: AsyncIterable<StreamEvent> | null): void;

  /**
   * 带重试的执行
   */
  executeWithRetry(
    messages: Message[],
    toolSchemas: ToolSchema[],
    maxRetries: number,
  ): Promise<StreamResult>;
}
```

---

### 模块 14：WorkspaceMonitor（可视化大盘）

**一句话职责：订阅 EventBus，构建实时系统运行状态图，通过 IPC 推送到前端渲染。**

```typescript
class WorkspaceMonitor {
  /**
   * 初始化：订阅所有相关事件
   */
  init(): void {
    this.eventBus.on(TASK_CREATED,         this.onTaskCreated);
    this.eventBus.on(TASK_STARTED,         this.onTaskStarted);
    this.eventBus.on(TASK_STEP_STARTED,    this.onStepStarted);
    this.eventBus.on(TASK_STEP_COMPLETED,  this.onStepCompleted);
    this.eventBus.on(TASK_COMPLETED,       this.onTaskCompleted);
    this.eventBus.on(AGENT_CREATED,        this.onAgentCreated);
    this.eventBus.on(AGENT_STARTED,        this.onAgentStarted);
    this.eventBus.on(AGENT_TOOL_START,     this.onToolStarted);
    this.eventBus.on(AGENT_TOOL_END,       this.onToolEnded);
    this.eventBus.on(AGENT_TEXT_DELTA,     this.onTextDelta);
    this.eventBus.on(AGENT_THINKING_DELTA, this.onThinkingDelta);
    this.eventBus.on(AGENT_COMPLETED,      this.onAgentCompleted);
    this.eventBus.on(ASYNC_TASK_STARTED,   this.onAsyncTaskStarted);
    this.eventBus.on(ASYNC_TASK_PROGRESS,  this.onAsyncProgress);
    this.eventBus.on(CONVERSATION_STATE_CHANGED, this.onStateChanged);
    this.eventBus.on(CONTEXT_COMPRESSION_DONE, this.onCompression);
    this.eventBus.on(TOKEN_BUDGET_WARNING, this.onTokenWarning);
    this.eventBus.on(PROVIDER_FALLBACK_TRIGGERED, this.onFallback);
  }

  /**
   * 构建当前完整的 WorkspaceState 快照 → 定期推送到前端
   */
  buildSnapshot(): WorkspaceState {
    return {
      conversationState: this.stateTracker.getState(),
      mainAgent: this.buildMainAgentState(),
      tasks: this.buildTasksState(),
      asyncTasks: this.buildAsyncTasksState(),
      agentTree: this.buildAgentTree(),
      stats: this.buildStats(),
      recentEvents: this.eventLog.getRecent(20),
    };
  }
}

interface WorkspaceState {
  conversationState: ConversationState;
  mainAgent: MainAgentDisplayState;
  tasks: TaskDisplayState[];
  asyncTasks: AsyncTaskCard[];
  agentTree: AgentTreeNode[];
  collaborations: CollaborationEdge[];
  stats: {
    totalTokens: number;
    totalDuration: number;
    totalIterations: number;
    toolCallCount: number;
    providerLatency: number;
  };
  recentEvents: LoggedEvent[];
}

/** 异步任务卡片（前端侧边栏展示） */
interface AsyncTaskCard {
  taskId: string;
  goal: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: { completedMembers: number; totalMembers: number };
  elapsed: number;
  estimatedRemaining: number;
  members: { name: string; status: string }[];
  canCancel: boolean;
  canQuery: boolean;
}
```

**前端 WorkspaceMonitor 组件职责（纯展示层）：**

```
WorkspaceMonitor (renderer)
├── GraphCanvas          # OffscreenCanvas + Web Worker 渲染拓扑图
├── StatsPanel           # Token / 耗时 / 迭代统计面板
├── AsyncTaskSidebar     # 异步任务进度卡片列表
├── EventTimeline        # 最近事件时间线
├── AgentDetailPopover   # 点击 agent 节点的详情弹出
└── MiniMap              # 全局缩略图
```

---

## 四、模块依赖关系图

```
                     ┌─────────────┐
                     │ ConfigManager│◄──── 所有模块启动时读取配置
                     └──────┬──────┘
                            │
                     ┌──────▼──────┐
                     │  EventBus   │◄──── 所有模块的通信中枢
                     └──────┬──────┘
                            │
     ┌──────────────────────┼──────────────────────┐
     │                      │                      │
     ▼                      ▼                      ▼
┌─────────────┐    ┌──────────────┐     ┌──────────────┐
│Conversation │───►│TaskOrchstrtr │     │Workspace     │
│Manager      │    │              │     │Monitor       │
└─────────────┘    └──┬───┬───┬──┘     │(纯消费者)    │
                      │   │   │        └──────────────┘
          ┌───────────┘   │   └──────────┐
          ▼               ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  Agent   │   │ Prompt   │   │ Provider │
    │ Factory  │   │ Composer │   │  Pool    │
    └────┬─────┘   └──────────┘   └──────────┘
         │
    ┌────┼────┬──────────┬──────────┐
    ▼    ▼    ▼          ▼          ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐
│Tool  │ │Context│ │Stream│ │Permission│
│Gatway│ │Manager│ │Pipel.│ │Control   │
└──────┘ └──────┘ └──────┘ └──────────┘
```

**依赖规则：**
- 上层可以调用下层
- 下层通过 EventBus 通知上层
- 同层之间不直接调用（通过 EventBus）
- ConfigManager 和 EventBus 是全局基础设施，所有模块可以依赖它们

---

## 五、AgentLoop 的精简

重构后 `AgentLoop` 从 ~1200 行砍到 ~300 行，只做一件事：**ReAct 循环**。

```typescript
class AgentLoop {
  constructor(
    private provider: ILLMProvider,
    private toolRegistry: IToolRegistry,
    private config: AgentConfig,
  ) {
    this.contextManager = new ContextManager(config.systemPrompt);
    this.streamPipeline = new StreamPipeline(provider, config);
    this.toolGateway = new ToolGateway(toolRegistry);
  }

  private contextManager: ContextManager;
  private streamPipeline: StreamPipeline;
  private toolGateway: ToolGateway;
  private running = false;
  private currentIteration = 0;
  private signal: AbortSignal | null = null;

  // 回调（仅用于输出给上层，不做任何业务逻辑）
  private callbacks: AgentCallbacks = {};

  on(callbacks: AgentCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  async run(userMessage: string, signal?: AbortSignal): Promise<void> {
    this.running = true;
    this.currentIteration = 0;
    this.signal = signal ?? null;
    const maxIterations = this.config.maxIterations ?? 50;

    this.contextManager.addUserMessage(userMessage);

    try {
      while (this.running && this.currentIteration < maxIterations) {
        if (signal?.aborted) break;

        this.currentIteration++;

        // 1. Token 预算检查（交给 ContextManager）
        const budget = this.contextManager.checkBudget();
        if (budget.level === 'red') {
          await this.contextManager.compress('aggressive');
        } else if (budget.level === 'yellow') {
          await this.contextManager.compress('summarize_early');
        }

        // 2. 构建消息 + 工具 schema
        const messages = this.contextManager.getMessages();
        const toolSchemas = this.toolGateway.getSchemas();

        // 3. LLM 调用（通过 StreamPipeline）
        const result = await this.streamPipeline.execute(messages, toolSchemas, {
          signal,
          onText: (text) => this.callbacks.onText?.(text),
          onThinking: (thinking) => this.callbacks.onThinking?.(thinking),
          onToolStart: (tc) => this.callbacks.onToolStart?.(tc.id, tc.name, tc.input),
          onUsage: (usage) => this.callbacks.onUsage?.(usage),
        });

        // 4. 记录 assistant 消息
        this.contextManager.addAssistantMessage(result.contentBlocks);

        // 5. 如果没有工具调用，结束
        if (!result.toolCalls || result.toolCalls.length === 0) break;
        if (result.stopReason === 'end_turn') break;

        // 6. 执行工具
        const toolResults = await this.toolGateway.executeBatch(
          result.toolCalls,
          { signal, workingDir: this.config.workingDir },
        );

        // 7. 工具结果回传
        this.contextManager.addToolResults(toolResults);
      }
    } finally {
      this.running = false;
      this.callbacks.onEnd?.(this.getState());
    }
  }

  stop(): void {
    this.running = false;
    this.streamPipeline.abort();
    this.toolGateway.abortAll();
  }

  getState(): AgentState {
    return {
      status: this.running ? 'thinking' : 'idle',
      messages: this.contextManager.getHistory(),
      tokenUsage: this.contextManager.getTokenUsage(),
      currentIteration: this.currentIteration,
    };
  }

  getContextManager(): ContextManager { return this.contextManager; }
  reset(): void { this.contextManager.clear(); }
}
```

**AgentLoop 不再需要的东西全部移除：**
- `MessageManager` → ContextManager
- `TokenManager` → ContextManager.tokenCounter
- `ContextCompressor` → ContextManager.compressor
- `StreamProcessor` → StreamPipeline
- `ToolDispatcher` → ToolGateway
- `ToolExecutionCoordinator` → ToolGateway.executeBatch
- `ErrorRecovery` → StreamPipeline（内部重试）
- `StreamRetryHandler` → StreamPipeline.executeWithRetry
- `MessagePreparationHandler` → ConversationManager.InputReceiver
- `MessageContextHandler` → ContextManager
- `ResultProcessor` → ExecutionEngine
- `AsyncAgentTaskManager callback` → TaskOrchestrator + EventBus
- `interrupt() / appendMessage()` → ConversationManager
- `SessionRecorder / UsageStatsRecorder` → EventBus 事件被 Telemetry 模块消费

---

## 六、完整场景流程

### 场景 1：同步简单任务

```
用户: "分析出师表的文学价值"

1. Desktop Bridge → ConversationManager.receive("分析出师表的文学价值")

2. ConversationManager:
   StateTracker.getState() → IDLE
   InputReceiver.preprocess() → 标准化输入

   IntentAnalyzer.analyze():
     L1 LLM:  使用 IntentAnalyzer Agent → { scene: "research", agent: "literary-researcher", complexity: "simple" }

   RoutingDecider.decide() → { action: "delegate_single_agent", agentId: "literary-researcher", scene: "research" }

   StateTracker.transitionTo(EXECUTING)

3. ConversationManager → TaskOrchestrator.createTask(intent)

4. TaskOrchestrator:
   TaskPlanner.plan() → Task(1 step: sub_agent "literary-researcher")
   TaskScheduler.schedule(task, 'sync')

   ExecutionEngine.executeStep():
     AgentFactory.create("literary-researcher", { scene: "research", task: "分析出师表..." })
       ├─ ConfigResolver → 找到 preset "literary-researcher"
       ├─ ProviderResolver → 独立 provider (apiKey 已配置)
       ├─ PromptComposer.composeForSubAgent() → L0 + L1(research) + task
       ├─ ToolFilter → [read_file, grep, web_search]
       └─ ContextPopulator → 注入工作目录 + depth=1

     AgentLoop.run("分析出师表..."):
       Iteration 1: read_file("出师表.txt")
       Iteration 2: 分析文本 → 输出结果 → end_turn

     AgentFactory.release("literary-researcher")

   ResultAggregator.aggregate() → 最终输出
   EventBus.emit(TASK_COMPLETED)

5. ConversationManager:
   ResponseDispatcher.dispatch(stream_text) → UI 显示结果
   StateTracker.transitionTo(IDLE)

6. WorkspaceMonitor 全程展示:
   - 对话状态: ANALYZING → EXECUTING → IDLE
   - agent 节点树: main → literary-researcher
   - literary-researcher 状态: created → running → reading_file → outputting → completed
```

### 场景 2：同步复杂任务（Agent Team）

```
用户: "用 agent team 优化项目性能"

1. ConversationManager:
   IntentAnalyzer → { scene: "optimize", agent: "coder", complexity: "complex" }
   RoutingDecider → { action: "run_main_agent" }
   StateTracker → EXECUTING

2. TaskOrchestrator:
   TaskPlanner.plan() → Task(steps: [
     { type: "main_agent", agentId: "main", scene: "optimize" },
     { type: "synthesis", agentId: "main" }
   ])

   ExecutionEngine.executeStep(step1):
     AgentFactory.create("main", { scene: "optimize" })
     PromptComposer.composeForMainAgent():
       L0: l0-main-agent + l0-task-planning
       L1: l1-optimize
       L2: l2-team-coordination
       + intentHint

     MainAgent.run():
       Iteration 1: todo_create 创建优化子任务
       Iteration 2: agent_team({ strategy: "hierarchical", members: [architect, coder, tester], ... })
         ├─ AgentFactory.create("architect", { scene: "optimize", ... })
         ├─ AgentFactory.create("coder", { scene: "write_code", ... })
         ├─ AgentFactory.create("tester", { scene: "test", ... })
         └─ TeamManager 协调执行
       Iteration 3: 汇总团队结果 → end_turn

   ExecutionEngine.executeStep(step2):
     MainAgent.run("汇总上述优化结果，用中文输出")

   EventBus.emit(TASK_COMPLETED)

3. WorkspaceMonitor:
   agent team 树可视化:
     main
     └── team "性能优化组" [hierarchical]
         ├── architect ✅ 已完成 (45s)
         ├── coder     🔄 执行中 (2m30s)
         └── tester    ⏳ 等待中
   Token: 45K input / 8K output
```

### 场景 3：异步任务 + 用户中途新对话

```
用户: "全面审计代码安全性，后台跑"

1. ConversationManager:
   IntentAnalyzer → { scene: "security-audit", complexity: "complex" }
   RoutingDecider → { action: "execute_async" }

2. TaskOrchestrator:
   TaskScheduler.schedule(task, 'async')
   ExecutionEngine.executeAsync() → 后台线程运行
     ├─ security-scanner: scan_code → running
     ├─ dependency-checker: check_vulnerabilities → running
     └─ report-generator: pending

3. ConversationManager:
   ResponseDispatcher.dispatch(async_task_started, {
     taskId: "at-abc123",
     goal: "全面审计代码安全性",
     estimatedDuration: "~5min"
   })
   StateTracker.transitionTo(WAITING_ASYNC)

4. UI: 显示异步任务卡片（侧边栏），主对话框空闲

5. 用户: "帮我改一下登录按钮的颜色"
   ConversationManager:
     StateTracker.getState() → WAITING_ASYNC
     RoutingDecider.decide() → 等同于 IDLE 时的新任务
     → 创建新的同步任务 "修改登录按钮颜色"
     StateTracker → EXECUTING

6. 新任务完成 → StateTracker → WAITING_ASYNC（异步任务仍运行中）

7. 异步任务完成:
   EventBus.emit(ASYNC_TASK_COMPLETED, { taskId: "at-abc123" })
   ResultStack.push(taskId, result)

   StateTracker.getState() → WAITING_ASYNC（空闲）
   → ConversationManager.startAutoSummarize("at-abc123")
   → 创建 synthesis 任务: MainAgent.run("汇总安全审计结果")
   → 输出到对话框

8. WorkspaceMonitor:
   - 异步任务卡片: "安全审计 ✅ 已完成 4/4 - 用时 5m20s"
   - 对话状态: WAITING_ASYNC → EXECUTING (汇总) → IDLE
   - 最近事件: 审计完成 → 自动汇总 → 输出
```

### 场景 4：执行中用户中断

```
1. 用户正在执行一个耗时任务（如重构代码），状态为 EXECUTING

2. 用户输入新指令: "配置文件不要动"

3. ConversationManager.receive("配置文件不要动"):
   StateTracker.getState() → EXECUTING
   RoutingDecider.whileExecuting():
     判断：用户要求改变任务范围 → 应终止重建

4. TaskOrchestrator.terminateAll():
   - 当前 mainAgent loop → abort
   - 所有子 agent → 级联 abort
   - 排队任务 → cancel
   - 异步任务 → 不受影响（继续后台运行）

5. TaskOrchestrator.collectPartialResults():
   [
     { stepId: "step-1", type: "main_agent", output: "已完成 plan_review，计划修改 5 个文件..." },
     { stepId: "step-2", type: "sub_agent", output: "已分析 index.ts，找到 3 处性能瓶颈..." }
   ]

6. ConversationManager 合并输入:
   "[已完成的部分结果] + [用户新指令: 配置文件不要动]"
   StateTracker.keepIntent() // 跳过意图分析

7. 重新创建任务执行

8. WorkspaceMonitor:
   - 旧任务节点: 灰色 + "已终止" 标记
   - 新任务节点: 创建 + 继承已完成步骤的显示
```

### 场景 5：输出中温和追加

```
1. 主 agent 正在输出文本（state = OUTPUTTING）

2. 用户输入: "还要加上性能分析"

3. ConversationManager.receive():
   RoutingDecider.whileOutputting() → { action: "queue" }
   InputReceiver.enqueue("还要加上性能分析")
   // 不中断当前输出，不 abort 任何东西

4. 当前输出完成 → AgentLoop.run() 结束

5. ConversationManager 检测到:
   lastBoundary = "assistant"  // 以 assistant 消息结束
   有排队消息
   → 不做意图分析（上下文相关），直接创建新任务：
     input = 上一次完整对话 + "还要加上性能分析"
   → 执行
```

---

## 七、目录结构

```
src/
├── core/
│   ├── conversation/                 # 1. 对话管理中心
│   │   ├── ConversationManager.ts
│   │   ├── InputReceiver.ts
│   │   ├── IntentAnalyzer.ts        # LLM→向量→关键词三层匹配
│   │   ├── StateTracker.ts          # 对话状态机
│   │   ├── RoutingDecider.ts        # 路由决策
│   │   ├── ResponseDispatcher.ts    # 响应分发
│   │   └── types.ts
│   │
│   ├── task/                        # 2. 任务管理中心
│   │   ├── TaskOrchestrator.ts
│   │   ├── TaskPlanner.ts
│   │   ├── TaskScheduler.ts
│   │   ├── ExecutionEngine.ts
│   │   ├── RetryManager.ts
│   │   ├── ProgressTracker.ts
│   │   ├── ResultAggregator.ts
│   │   ├── ResultStack.ts
│   │   └── types.ts
│   │
│   ├── agent/                       # 3. Agent 工厂 + 运行时
│   │   ├── factory/
│   │   │   ├── AgentFactory.ts
│   │   │   ├── AgentPool.ts
│   │   │   └── TemporaryAgentCreator.ts
│   │   ├── AgentLoop.ts             # 精简后的 ReAct 循环（~300行）
│   │   ├── AgentRegistry.ts         # Agent 配置注册表
│   │   ├── AgentConfigManager.ts
│   │   ├── async/                   # 异步任务管理器
│   │   │   ├── AsyncAgentTaskManager.ts
│   │   │   └── types.ts
│   │   ├── team/                    # Team 协作引擎
│   │   │   ├── TeamManager.ts
│   │   │   └── types.ts
│   │   └── types.ts
│   │
│   ├── prompt/                      # 4. Prompt 动态组合
│   │   ├── PromptComposer.ts
│   │   ├── LayerLoader.ts
│   │   ├── PromptComponentRegistry.ts
│   │   ├── PromptValidator.ts
│   │   ├── app/                    # xuanji 自带 prompt 模板（可被覆盖）
│   │   └── types.ts
│   │
│   ├── provider/                    # 5. Provider Pool
│   │   ├── ProviderPool.ts
│   │   ├── ProviderFactory.ts
│   │   ├── FallbackManager.ts
│   │   ├── RateLimitManager.ts
│   │   └── types.ts
│   │
│   ├── tools/                       # 6. Tool Gateway
│   │   ├── ToolGateway.ts
│   │   ├── ToolRegistry.ts
│   │   ├── FilteredToolRegistry.ts
│   │   ├── PermissionGate.ts
│   │   ├── ToolMetrics.ts
│   │   ├── ExecutionContext.ts
│   │   └── tools/                   # 具体工具实现
│   │       ├── TaskTool.ts
│   │       ├── TeamTool.ts
│   │       ├── BashTool.ts
│   │       └── ...
│   │
│   ├── context/                     # 7. Context Manager
│   │   ├── ContextManager.ts
│   │   ├── MessageManager.ts
│   │   ├── TokenCounter.ts
│   │   ├── BudgetMonitor.ts
│   │   ├── ContextCompressor.ts
│   │   └── types.ts
│   │
│   ├── session/                     # 8. Session Manager
│   │   ├── SessionManager.ts
│   │   ├── SessionStore.ts
│   │   ├── SessionResumer.ts
│   │   └── types.ts
│   │
│   ├── events/                      # 9. Event Bus
│   │   ├── EventBus.ts
│   │   ├── EventLog.ts
│   │   ├── events.ts                # XuanjiEvent 枚举
│   │   └── types.ts
│   │
│   ├── memory/                      # 10. Memory Manager
│   │   ├── MemoryManager.ts
│   │   ├── MemoryStore.ts
│   │   ├── MemoryRetriever.ts
│   │   └── types.ts
│   │
│   ├── permission/                  # 11. Permission Controller
│   │   ├── PermissionController.ts
│   │   └── types.ts
│   │
│   ├── config/                      # 12. Config Manager
│   │   ├── ConfigManager.ts
│   │   ├── RuntimeConfig.ts
│   │   └── types.ts
│   │
│   ├── stream/                      # 13. Stream Pipeline
│   │   ├── StreamPipeline.ts
│   │   ├── StreamParser.ts
│   │   └── types.ts
│   │
│   └── intent/                      # 意图分析引擎
│       ├── LLMIntentClassifier.ts
│       ├── VectorMatcher.ts
│       └── types.ts
│
├── desktop/                         # Electron Desktop 层
│   ├── main/
│   │   └── bridge.ts               # IPC Bridge（精简，只做转发）
│   └── renderer/
│       ├── components/
│       │   ├── ChatArea.tsx
│       │   ├── InputArea.tsx
│       │   └── WorkspaceMonitor/   # 14. 可视化大盘（前端）
│       │       ├── index.tsx
│       │       ├── GraphCanvas.ts
│       │       ├── StatsPanel.tsx
│       │       ├── AsyncTaskSidebar.tsx
│       │       ├── EventTimeline.tsx
│       │       └── CanvasRenderer.ts
│       └── stores/
│           ├── chatStore.ts
│           ├── runtimeStore.ts     # 订阅 EventBus bridge 更新
│           └── workspaceStore.ts
```

---

## 八、重构实施顺序

总共 14 个模块，按依赖关系分 4 个阶段推进：

### Phase 1 — 基础设施（先铺路）
1. **ConfigManager** — 所有模块都需要读配置
2. **EventBus** — 所有模块的通信中枢
3. **StreamPipeline** — 独立 LLM 流处理（不依赖其他模块）

### Phase 2 — 核心能力（建工厂和工具）
4. **ProviderPool** — LLM 连接管理
5. **PromptComposer** — Prompt 动态组合
6. **ToolGateway** — 工具统一入口
7. **AgentFactory** — Agent 创建（依赖 4+5+6）
8. **ContextManager** — 上下文管理

### Phase 3 — 调度控制（搭大脑和双手）
9. **TaskOrchestrator** — 任务管理中心（依赖 7+8）
10. **ConversationManager** — 对话管理中心（依赖 9）
11. **PermissionController** — 权限控制（依赖 6）
12. **MemoryManager** — 记忆管理（⚠️ 占位，暂不实现）

### Phase 4 — 辅助和可视化（收尾）
13. **SessionManager** — 会话持久化
14. **WorkspaceMonitor** — 可视化大盘升级（订阅所有事件）

---

## 九、核心设计决策总结

| 决策 | 选择 | 理由 |
|------|------|------|
| 模块通信方式 | EventBus + 接口调用 | 有返回值用接口，纯通知用事件 |
| Agent 实例管理 | AgentPool（引用计数 + LRU） | 内部 agent 短生命周期，复用避免反复创建 |
| 异步结果处理 | ResultStack（FIFO 队列） | 保证顺序，防止结果丢失 |
| 用户中断策略 | 级联终止（AbortController 树） | 确保所有子任务同步终止 |
| 意图分析 | LLM → 向量 → 关键词（按优先级） | LLM 优先保证准确率，向量/关键词降级兜底 |
| Prompt 组成 | Agent.systemPrompt + L0 + L1 + L2 + L3（项目） | 无"内置"概念，所有组件可被覆盖 |
| 意图分析 | LLM → 向量 → 关键词（按优先级） | LLM 优先保证准确率，向量/关键词降级兜底 |
| 配置中心 | 用户配置隔离，缺失从模板初始化 | 多用户应用，仅系统配置全局共享 |
| 记忆模块 | 占位，暂不实现 | 后续版本实现，依赖向量模型配置 |

这 14 个模块各司其职，通过接口调用和事件总线形成完整的任务处理闭环。
