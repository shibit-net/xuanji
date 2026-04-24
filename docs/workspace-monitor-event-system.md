# 执行流程可视化事件系统设计

## 目标

将 MainAgent 执行流程的所有阶段通过 Hook 事件暴露给主进程，实现在 WorkspaceMonitor 中的实时可视化。

---

## 核心设计

### 1. 事件分层

```
L1: 主流程事件（MainAgent 级别）
  - IntentAnalysisStart
  - IntentAnalysisEnd
  - TaskPlanningStart
  - TaskPlanningEnd
  - TaskExecutionStart
  - TaskExecutionEnd

L2: 子流程事件（SubAgent 级别）
  - SubAgentStart（已有）
  - SubAgentEnd（已有）
  - SubAgentToolUse（已有）

L3: 工具级事件（Tool 级别）
  - ToolStart（已有）
  - ToolEnd（已有）
```

### 2. 事件数据结构

```typescript
interface MainAgentEvent {
  // 基础信息
  eventType: 'IntentAnalysis' | 'TaskPlanning' | 'TaskExecution';
  phase: 'start' | 'end';
  timestamp: number;
  
  // 上下文信息
  userInput: string;
  sessionId: string;
  
  // 阶段特定数据
  data: IntentAnalysisData | TaskPlanningData | TaskExecutionData;
}

interface IntentAnalysisData {
  // 开始阶段
  enableIntentRouter?: boolean;
  enableSceneAnalysis?: boolean;
  
  // 结束阶段
  intent?: Intent | null;
  scene?: string;
  complexity?: 'simple' | 'standard' | 'complex';
  matchMethod?: 'keyword' | 'embedding' | 'default';
  confidence?: number;
}

interface TaskPlanningData {
  // 开始阶段
  scene: string;
  complexity: string;
  
  // 结束阶段
  strategy?: 'single' | 'sequential' | 'parallel';
  tasks?: Array<{
    id: string;
    agentId: string;
    scene: string;
    description: string;
  }>;
}

interface TaskExecutionData {
  // 开始阶段
  strategy: 'single' | 'sequential' | 'parallel';
  taskCount: number;
  
  // 结束阶段
  success?: boolean;
  duration?: number;
  output?: string;
}
```

---

## 新增 Hook 事件

### 在 `src/hooks/types.ts` 中添加

```typescript
export type HookEvent =
  // ... 现有事件
  
  // 🆕 MainAgent 流程事件
  | 'IntentAnalysisStart'      // 意图分析开始
  | 'IntentAnalysisEnd'        // 意图分析结束
  | 'TaskPlanningStart'        // 任务规划开始
  | 'TaskPlanningEnd'          // 任务规划结束
  | 'TaskExecutionStart'       // 任务执行开始
  | 'TaskExecutionEnd'         // 任务执行结束
  | 'ResultAggregationStart'   // 结果汇总开始
  | 'ResultAggregationEnd'     // 结果汇总结束
  
  // 🆕 Prompt 构建事件
  | 'PromptBuildStart'         // Prompt 构建开始
  | 'PromptBuildEnd'           // Prompt 构建结束
  
  // 🆕 Agent 选择事件
  | 'AgentSelectionStart'      // Agent 选择开始
  | 'AgentSelectionEnd';       // Agent 选择结束
```

---

## 实现方案

### 方案 1: 在 MainAgent 中发射事件

#### 修改 `src/core/agent/dispatch/MainAgent.ts`

```typescript
export class MainAgent {
  constructor(
    private intentRouter: IntentRouter,
    private intentAnalyzer: IntentAnalyzer,
    private teamManager: TeamManager,
    private promptStore: PromptStore,
    private taskPlanner: TaskPlanner,
    private resultAggregator: ResultAggregator,
    private hookRegistry: HookRegistry,  // 🆕 注入 HookRegistry
    private config: MainAgentConfig,
  ) {}

  async execute(userInput: string, signal?: AbortSignal): Promise<string> {
    const sessionId = generateId();
    
    try {
      // ━━━ 阶段 1: 意图识别 ━━━
      await this.hookRegistry.emit('IntentAnalysisStart', {
        userInput,
        sessionId,
        enableIntentRouter: this.config.enableIntentRouter,
        enableSceneAnalysis: this.config.enableSceneAnalysis,
      });

      let intent = null;
      let scene = 'write_code';
      let complexity: 'simple' | 'standard' | 'complex' = 'standard';

      if (this.config.enableIntentRouter) {
        const intents = await this.intentRouter.route(userInput, [], {
          threshold: 0.7,
          enableVector: true,
          enableLLM: false,
        });
        intent = intents[0] || null;
      }

      if (this.config.enableSceneAnalysis) {
        const analysis = await this.intentAnalyzer.analyze(userInput, true);
        scene = analysis.scene || 'write_code';
        complexity = analysis.complexity;
      }

      await this.hookRegistry.emit('IntentAnalysisEnd', {
        userInput,
        sessionId,
        intent,
        scene,
        complexity,
        matchMethod: analysis?.matchMethod,
        confidence: analysis?.confidence,
      });

      // ━━━ 阶段 2: 任务规划 ━━━
      await this.hookRegistry.emit('TaskPlanningStart', {
        userInput,
        sessionId,
        scene,
        complexity,
      });

      const plan = await this.taskPlanner.plan(intent, scene, complexity, userInput);

      await this.hookRegistry.emit('TaskPlanningEnd', {
        userInput,
        sessionId,
        strategy: plan.strategy,
        tasks: plan.tasks.map(t => ({
          id: t.id,
          agentId: t.agentId,
          scene: t.scene,
          description: t.description,
        })),
      });

      // ━━━ 阶段 3: 任务执行 ━━━
      await this.hookRegistry.emit('TaskExecutionStart', {
        userInput,
        sessionId,
        strategy: plan.strategy,
        taskCount: plan.tasks.length,
      });

      const startTime = Date.now();
      let result: TeamExecutionResult;

      if (plan.strategy === 'single') {
        result = await this.executeSingleTask(plan, signal);
      } else {
        result = await this.executeTeamTasks(plan, signal);
      }

      const duration = Date.now() - startTime;

      await this.hookRegistry.emit('TaskExecutionEnd', {
        userInput,
        sessionId,
        success: true,
        duration,
        output: result.output,
      });

      // ━━━ 阶段 4: 结果汇总 ━━━
      let finalOutput = result.output;
      if (this.config.enableResultAggregation && result.memberResults.length > 1) {
        await this.hookRegistry.emit('ResultAggregationStart', {
          userInput,
          sessionId,
          memberCount: result.memberResults.length,
        });

        finalOutput = await this.resultAggregator.aggregate(result, userInput);

        await this.hookRegistry.emit('ResultAggregationEnd', {
          userInput,
          sessionId,
          output: finalOutput,
        });
      }

      return finalOutput;

    } catch (error) {
      await this.hookRegistry.emit('TaskExecutionEnd', {
        userInput,
        sessionId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
```

### 方案 2: 在 PromptStore 中发射事件

#### 修改 `src/core/agent/dispatch/PromptStore.ts`

```typescript
export class PromptStore {
  constructor(
    private promptBuilder: LayeredPromptBuilder,
    private hookRegistry?: HookRegistry,  // 🆕 可选注入
  ) {
    this.sceneConfigs = getCodingSceneConfigs();
  }

  async getSceneEnhancement(scene: SceneType, context?: PromptContext): Promise<string> {
    // 🆕 发射事件
    await this.hookRegistry?.emit('PromptBuildStart', {
      scene,
      context,
    });

    try {
      const config = this.sceneConfigs.get(scene);
      const prompt = config?.description || '';

      // 🆕 发射事件
      await this.hookRegistry?.emit('PromptBuildEnd', {
        scene,
        prompt,
        success: true,
      });

      return prompt;
    } catch (error) {
      await this.hookRegistry?.emit('PromptBuildEnd', {
        scene,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
```

### 方案 3: 在 TaskPlanner 中发射事件

#### 修改 `src/core/agent/dispatch/TaskPlanner.ts`

```typescript
export class TaskPlanner {
  constructor(
    private config: TaskPlannerConfig,
    private modelClassifier?: ModelClassifier,
    private hookRegistry?: HookRegistry,  // 🆕 可选注入
  ) {}

  private async selectAgentForScene(scene: SceneType, userInput: string): Promise<string> {
    // 🆕 发射事件
    await this.hookRegistry?.emit('AgentSelectionStart', {
      scene,
      userInput,
    });

    let selectedAgent = this.config.defaultAgent;
    let method: 'rule' | 'model' | 'default' = 'default';

    // 1. 规则匹配
    if (this.config.sceneToAgentHints?.[scene]) {
      selectedAgent = this.config.sceneToAgentHints[scene];
      method = 'rule';
    }
    // 2. 小模型分类
    else if (this.modelClassifier && this.modelClassifier.isAvailable()) {
      const result = await this.modelClassifier.classify(userInput);
      if (result && result.confidence >= 0.7) {
        selectedAgent = result.agent;
        method = 'model';
      }
    }

    // 🆕 发射事件
    await this.hookRegistry?.emit('AgentSelectionEnd', {
      scene,
      userInput,
      selectedAgent,
      method,
    });

    return selectedAgent;
  }
}
```

---

## Desktop App 集成

### 1. 在 `desktop/main/agent-bridge.ts` 中监听事件

```typescript
// 监听 MainAgent 流程事件
hookRegistry.on('IntentAnalysisStart', async (context) => {
  safeSend({
    type: 'workspace:event',
    data: {
      eventType: 'IntentAnalysisStart',
      timestamp: Date.now(),
      ...context,
    },
  });
});

hookRegistry.on('IntentAnalysisEnd', async (context) => {
  safeSend({
    type: 'workspace:event',
    data: {
      eventType: 'IntentAnalysisEnd',
      timestamp: Date.now(),
      ...context,
    },
  });
});

hookRegistry.on('TaskPlanningStart', async (context) => {
  safeSend({
    type: 'workspace:event',
    data: {
      eventType: 'TaskPlanningStart',
      timestamp: Date.now(),
      ...context,
    },
  });
});

hookRegistry.on('TaskPlanningEnd', async (context) => {
  safeSend({
    type: 'workspace:event',
    data: {
      eventType: 'TaskPlanningEnd',
      timestamp: Date.now(),
      ...context,
    },
  });
});

// ... 其他事件
```

### 2. 在 Renderer 中接收事件

```typescript
// desktop/renderer/stores/workspaceStore.ts

interface WorkspaceEvent {
  eventType: string;
  timestamp: number;
  data: any;
}

class WorkspaceStore {
  private events: WorkspaceEvent[] = [];
  private currentPhase: string | null = null;

  constructor() {
    // 监听事件
    window.electron.ipcRenderer.on('workspace:event', (event, data) => {
      this.handleEvent(data);
    });
  }

  private handleEvent(event: WorkspaceEvent) {
    this.events.push(event);

    // 更新当前阶段
    switch (event.eventType) {
      case 'IntentAnalysisStart':
        this.currentPhase = 'intent-analysis';
        break;
      case 'IntentAnalysisEnd':
        this.currentPhase = null;
        break;
      case 'TaskPlanningStart':
        this.currentPhase = 'task-planning';
        break;
      case 'TaskPlanningEnd':
        this.currentPhase = null;
        break;
      case 'TaskExecutionStart':
        this.currentPhase = 'task-execution';
        break;
      case 'TaskExecutionEnd':
        this.currentPhase = null;
        break;
    }

    // 通知 WorkspaceMonitor 更新
    this.notifyMonitor();
  }

  private notifyMonitor() {
    // 触发 WorkspaceMonitor 重新渲染
    window.dispatchEvent(new CustomEvent('workspace-update', {
      detail: {
        events: this.events,
        currentPhase: this.currentPhase,
      },
    }));
  }
}
```

### 3. 在 WorkspaceMonitor 中渲染

```typescript
// desktop/renderer/components/WorkspaceMonitor/index.tsx

export function WorkspaceMonitor() {
  const [events, setEvents] = useState<WorkspaceEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);

  useEffect(() => {
    const handleUpdate = (e: CustomEvent) => {
      setEvents(e.detail.events);
      setCurrentPhase(e.detail.currentPhase);
    };

    window.addEventListener('workspace-update', handleUpdate);
    return () => window.removeEventListener('workspace-update', handleUpdate);
  }, []);

  return (
    <div className="workspace-monitor">
      {/* 主流程可视化 */}
      <MainFlowVisualization
        events={events}
        currentPhase={currentPhase}
      />

      {/* 子 Agent 树 */}
      <SubAgentTree
        subAgents={state.subAgents}
      />

      {/* 时间线 */}
      <Timeline
        events={events}
      />
    </div>
  );
}
```

---

## WorkspaceMonitor 渲染设计

### 1. 主流程可视化

```
┌─────────────────────────────────────────────────────────┐
│ 主流程                                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [1] 意图分析  →  [2] 任务规划  →  [3] 任务执行       │
│      ✓ 完成          ✓ 完成          🔄 进行中         │
│                                                         │
│  Scene: write_code                                      │
│  Agent: coder                                           │
│  Strategy: single                                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2. 详细信息面板

```
┌─────────────────────────────────────────────────────────┐
│ 阶段详情                                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 📊 意图分析                                             │
│   - 场景: write_code                                    │
│   - 复杂度: standard                                    │
│   - 匹配方式: keyword                                   │
│   - 置信度: 0.95                                        │
│   - 耗时: 23ms                                          │
│                                                         │
│ 📋 任务规划                                             │
│   - 策略: single                                        │
│   - Agent: coder                                        │
│   - 选择方式: model (Qwen2.5-1.5B)                     │
│   - 耗时: 156ms                                         │
│                                                         │
│ ⚙️ 任务执行                                             │
│   - 子 Agent: coder-task-1                             │
│   - Prompt: L0 + coder.systemPrompt + write_code      │
│   - 工具调用: 3 次                                      │
│   - 耗时: 2.3s                                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3. 时间线视图

```
┌─────────────────────────────────────────────────────────┐
│ 时间线                                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 0ms    ●─────────────────────────────────────────────  │
│        IntentAnalysisStart                              │
│                                                         │
│ 23ms   ●─────────────────────────────────────────────  │
│        IntentAnalysisEnd (scene: write_code)            │
│                                                         │
│ 25ms   ●─────────────────────────────────────────────  │
│        TaskPlanningStart                                │
│                                                         │
│ 181ms  ●─────────────────────────────────────────────  │
│        TaskPlanningEnd (agent: coder)                   │
│                                                         │
│ 185ms  ●─────────────────────────────────────────────  │
│        TaskExecutionStart                               │
│                                                         │
│ 190ms  ●─────────────────────────────────────────────  │
│        SubAgentStart (coder-task-1)                     │
│                                                         │
│ 2.5s   ●─────────────────────────────────────────────  │
│        SubAgentEnd (coder-task-1)                       │
│                                                         │
│ 2.51s  ●─────────────────────────────────────────────  │
│        TaskExecutionEnd                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 实现步骤

### 步骤 1: 定义事件类型

```bash
# 修改文件
src/hooks/types.ts
```

添加新的 Hook 事件类型。

### 步骤 2: 修改 MainAgent

```bash
# 修改文件
src/core/agent/dispatch/MainAgent.ts
```

在各个阶段发射事件。

### 步骤 3: 修改 SessionFactory

```bash
# 修改文件
src/core/chat/SessionFactory.ts
```

将 `HookRegistry` 注入到 `MainAgent`、`PromptStore`、`TaskPlanner`。

### 步骤 4: Desktop App 集成

```bash
# 修改文件
desktop/main/agent-bridge.ts
desktop/renderer/stores/workspaceStore.ts
desktop/renderer/components/WorkspaceMonitor/index.tsx
```

监听事件并渲染。

### 步骤 5: 渲染组件

```bash
# 新增文件
desktop/renderer/components/WorkspaceMonitor/MainFlowVisualization.tsx
desktop/renderer/components/WorkspaceMonitor/PhaseDetails.tsx
desktop/renderer/components/WorkspaceMonitor/TimelineView.tsx
```

实现可视化组件。

---

## 优势

### 1. 完整的可观测性

- ✅ 每个阶段都有明确的开始/结束事件
- ✅ 包含详细的上下文信息
- ✅ 支持实时监控

### 2. 解耦设计

- ✅ MainAgent 不需要知道 WorkspaceMonitor 的存在
- ✅ 通过 Hook 系统解耦
- ✅ 易于扩展和维护

### 3. 灵活的渲染

- ✅ 可以选择性渲染某些阶段
- ✅ 支持多种视图（流程图、时间线、详情面板）
- ✅ 可以回放历史事件

### 4. 性能友好

- ✅ 事件异步发射，不阻塞主流程
- ✅ 可以控制事件频率
- ✅ 支持事件过滤

---

## 总结

**核心思路**：
- 在 MainAgent 的各个阶段发射 Hook 事件
- Desktop App 监听这些事件
- WorkspaceMonitor 根据事件实时渲染

**事件层级**：
- L1: 主流程事件（IntentAnalysis / TaskPlanning / TaskExecution）
- L2: 子流程事件（SubAgentStart / SubAgentEnd）
- L3: 工具级事件（ToolStart / ToolEnd）

**渲染方式**：
- 主流程可视化：显示当前阶段和进度
- 详细信息面板：显示每个阶段的详细数据
- 时间线视图：显示所有事件的时间序列

需要我开始实现这个方案吗？
