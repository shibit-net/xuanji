# ExecutionWorkspace 最终设计 - Agent 卡片式监视器

## 最终需求

用户的核心诉求（通过三次迭代明确）：

### 第一次需求
> "应该根据实际运行时，LLM的决策动态展示工作区状态，不是累积的拓扑结构"

**理解**：不要显示历史累积，只显示当前正在运行的内容。

### 第二次需求
> "要清晰的表示出来，现在都有哪个agent在运行，是plan模式，还是subagent还是agent team的执行方式，哪些任务在串行，哪些任务在并行，最终汇总给谁"

**理解**：需要显示：
1. Agent 运行模式（Plan / SubAgent / Team）
2. 任务关系（串行 / 并行）
3. 汇总关系（结果给谁）

### 第三次需求（最终）
> "以agent维度，展示每个agent在做的事情"

**理解**：以 Agent 为中心的布局，每个 Agent 是一个卡片，显示其任务和工具。

## 最终设计

### 布局结构

```
┌─────────────────────────────────────────┐
│ 👤 用户输入: "帮我实现登录功能"          │
└─────────────────────────────────────────┘
              ↓ 开始执行
┌─────────────────────────────────────────┐
│ 🤖 Main Agent            [📋 Plan 模式] │
├─────────────────────────────────────────┤
│ 任务：设计实现方案                       │
│ 正在运行的工具：                         │
│   🔧 EnterPlanMode (2.3s)               │
│   🔧 Write plan.md (1.5s)               │
└─────────────────────────────────────────┘
              ↓
┌─ 以下 2 个 Agent 并行执行 ──────────────┐
│                                         │
│ ┌─────────────┬─────────────┐          │
│ │ 🤖 Backend  │ 🤖 Frontend │ [🔀 并行]│
│ ├─────────────┼─────────────┤          │
│ │ 任务：后端  │ 任务：前端  │          │
│ │ 工具：      │ 工具：      │          │
│ │  🔧 Write   │  🔧 Write   │          │
│ └─────────────┴─────────────┘          │
│                                         │
└─────────────────────────────────────────┘
              ↓
        结果汇总到 Main Agent
```

### 核心特性

**1. Agent 卡片**

每个卡片包含：
- **头部**：
  - Agent 图标（🤖）
  - Agent 名称
  - 当前任务（如果有）
  - 模式徽章（Plan / Team / SubAgent / 执行中）
  - 并行标识（如果是并行执行）

- **工具列表**：
  - 正在运行的工具名称
  - 工具图标（🔧）
  - 执行时长（实时更新）
  - Loading 动画

**2. 模式检测**

```typescript
const detectMode = (): 'plan' | 'team' | 'main' => {
  const recentTools = toolExecutions.slice(-5);

  // Plan 模式：检测 EnterPlanMode / ExitPlanMode
  const hasPlanMode = recentTools.some(
    (t) => t.name === 'EnterPlanMode' || t.name === 'ExitPlanMode'
  );
  if (hasPlanMode) return 'plan';

  // Team 模式：检测 QuickTeam / Orchestrate
  const hasTeamTool = recentTools.some(
    (t) => t.name === 'QuickTeam' || t.name === 'Orchestrate'
  );
  if (hasTeamTool) return 'team';

  return 'main';
};
```

**3. 串行 / 并行布局**

**串行**（垂直排列）：
```tsx
<div className="space-y-4">
  {card.children.map((child) => renderAgentCard(child, depth + 1))}
</div>
```

**并行**（Grid 2列）：
```tsx
<div className="grid grid-cols-2 gap-4">
  {card.children.map((child) => renderAgentCard(child, depth + 1))}
</div>
```

**4. 可视化指示器**

**并行指示器**：
```tsx
{card.children[0]?.isParallel && (
  <div className="flex items-center gap-2 text-orange-400">
    <div className="flex items-center gap-1">
      <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
      <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
    </div>
    <span>以下 {card.children.length} 个 Agent 并行执行</span>
  </div>
)}
```

**汇总指示器**：
```tsx
<div className="flex items-center gap-2 text-blue-400">
  <ChevronDown size={14} />
  <span>结果汇总到 {card.name}</span>
</div>
```

## 数据结构

### AgentCard

```typescript
interface AgentCard {
  id: string;
  name: string;
  mode: 'plan' | 'team' | 'subagent' | 'main';
  currentTask?: string; // Agent 当前任务描述
  tools: {
    id: string;
    name: string;
    status: string;
    startTime: number;
  }[];
  children: AgentCard[]; // 子 Agent
  isParallel: boolean; // 是否并行执行
  status: 'running' | 'completed' | 'failed';
}
```

### 递归构建卡片树

```typescript
const buildAgentCard = (
  agent: any,
  mode: 'plan' | 'team' | 'subagent' | 'main'
): AgentCard | null => {
  if (agent.status !== 'running') return null;

  // 找出属于该 Agent 的工具（运行中的）
  const agentTools = toolExecutions
    .filter((t) => t.status === 'running')
    .map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      startTime: t.startTime,
    }));

  // 递归处理子 Agent
  const children: AgentCard[] = [];
  if (agent.children && agent.children.length > 0) {
    const runningChildren = agent.children.filter((c: any) => c.status === 'running');
    const isParallel = runningChildren.length > 1;

    runningChildren.forEach((child: any) => {
      const childCard = buildAgentCard(child, 'subagent');
      if (childCard) {
        childCard.isParallel = isParallel;
        children.push(childCard);
      }
    });
  }

  return {
    id: agent.id,
    name: agent.name,
    mode: agent.id === rootAgent.id ? detectMode() : mode,
    currentTask: agent.currentTask,
    tools: agentTools,
    children,
    isParallel: false,
    status: agent.status,
  };
};
```

## 视觉设计

### 1. 模式徽章

| 模式 | 图标 | 文字 | 颜色 |
|------|------|------|------|
| Plan | 📋 | Plan 模式 | 紫色 (`bg-purple-500/20 border-purple-500`) |
| Team | 👥 | Team | 橙色 (`bg-orange-500/20 border-orange-500`) |
| SubAgent | 🔀 | SubAgent | 绿色 (`bg-green-500/20 border-green-500`) |
| Main | ▶️ | 执行中 | 蓝色 (`bg-blue-500/20 border-blue-500`) |

### 2. 并行标识

```tsx
<div className="flex items-center gap-1 px-2 py-1 bg-orange-500/20 border border-orange-500 rounded">
  <GitBranch size={12} />
  <span>并行</span>
</div>
```

### 3. 工具卡片

```tsx
<div className="flex items-center gap-3 px-3 py-2 bg-white/5 border border-white/10 rounded">
  <Loader2 size={14} className="animate-spin text-blue-400" />
  <div className="flex-1">
    <div className="text-sm text-white">🔧 {tool.name}</div>
  </div>
  <div className="text-xs text-gray-400">
    {((Date.now() - tool.startTime) / 1000).toFixed(1)}s
  </div>
</div>
```

### 4. 层级缩进

```typescript
style={{ marginLeft: `${depth * 32}px` }}
```

- Main Agent：0px
- SubAgent Level 1：32px
- SubAgent Level 2：64px

## 用户体验

### 1. 实时更新

- Agent 卡片只在运行时显示，完成后自动消失
- 工具执行时长实时刷新（每秒更新）
- Loading 动画持续旋转

### 2. 清晰的视觉层次

- **用户输入**：浅色卡片，顶部
- **Main Agent**：主色调（蓝色/紫色/橙色）
- **Sub Agent**：绿色，缩进显示
- **工具**：白色半透明，嵌入在 Agent 卡片内

### 3. 关系指示

- **串行**：垂直排列 + "开始执行" / "结果汇总到" 提示
- **并行**：Grid 布局 + "以下 N 个 Agent 并行执行" 提示 + 橙色双点图标

### 4. 空状态

```tsx
<div className="text-center">
  <Activity size={64} className="animate-pulse text-blue-400/40" />
  <div>等待执行任务...</div>
  <div>发送消息后将显示 Agent 执行情况</div>
</div>
```

## 技术实现

### 1. React 组件渲染（非 Canvas）

**原因**：
- 卡片式布局更适合 DOM 渲染
- 支持滚动、交互、响应式
- 易于维护和扩展

**性能优化**：
- 只渲染运行中的 Agent（通常 ≤ 5 个）
- 递归渲染深度有限（最多 3 层）
- 无需虚拟化

### 2. 状态管理

```typescript
const [agentCards, setAgentCards] = useState<AgentCard[]>([]);

useEffect(() => {
  if (!rootAgent || rootAgent.status !== 'running') {
    setAgentCards([]);
    return;
  }

  const mainCard = buildAgentCard(rootAgent, detectMode());
  setAgentCards(mainCard ? [mainCard] : []);
}, [rootAgent, toolExecutions]);
```

### 3. 递归渲染

```typescript
const renderAgentCard = (card: AgentCard, depth: number = 0) => {
  return (
    <div key={card.id}>
      {/* Agent 卡片 */}
      <div style={{ marginLeft: `${depth * 32}px` }}>
        {/* 卡片内容 */}
      </div>

      {/* 子 Agent（递归） */}
      {card.children.length > 0 && (
        <div>
          {card.children[0]?.isParallel ? (
            <div className="grid grid-cols-2 gap-4">
              {card.children.map((child) => renderAgentCard(child, depth + 1))}
            </div>
          ) : (
            <div className="space-y-4">
              {card.children.map((child) => renderAgentCard(child, depth + 1))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

## 测试场景

### 场景 1：简单执行（Main Agent）

**用户输入**："读取 README.md"

**显示**：
```
👤 用户输入: "读取 README.md"
    ↓
🤖 Main Agent [▶️ 执行中]
  正在运行的工具：
    🔧 Read (0.5s)
```

### 场景 2：Plan 模式

**用户输入**："帮我实现登录功能"

**显示**：
```
👤 用户输入: "帮我实现登录功能"
    ↓
🤖 Main Agent [📋 Plan 模式]
  任务：设计实现方案
  正在运行的工具：
    🔧 EnterPlanMode (1.2s)
    🔧 Write plan.md (0.8s)
```

### 场景 3：并行 SubAgent

**用户输入**："实现前后端功能"

**显示**：
```
👤 用户输入: "实现前后端功能"
    ↓
🤖 Main Agent [▶️ 执行中]
  正在运行的工具：
    🔧 QuickTeam (2.1s)
    ↓
┌─ 以下 2 个 Agent 并行执行 ─┐
│  🤖 Backend   🤖 Frontend  │ [🔀 并行]
│    工具：        工具：     │
│     🔧 Write     🔧 Write  │
└────────────────────────────┘
    ↓
  结果汇总到 Main Agent
```

### 场景 4：嵌套 SubAgent（3层）

**显示**：
```
🤖 Main Agent
    ↓
  🤖 SubAgent 1 (缩进 32px)
      ↓
    🤖 SubAgent 1.1 (缩进 64px)
        工具：🔧 Write
```

## 数据依赖

### executionStore 字段

| 字段 | 用途 |
|------|------|
| `rootAgent.status` | 判断是否有运行中的任务 |
| `rootAgent.name` | Agent 名称 |
| `rootAgent.currentTask` | 当前任务描述 |
| `rootAgent.children` | 子 Agent 列表 |
| `toolExecutions` | 工具执行记录（模式检测 + 工具列表） |
| `systemStatus.currentIteration` | 迭代次数 |
| `systemStatus.tokenUsage` | Token 统计 |
| `systemStatus.cost` | 成本统计 |

### chatStore 字段

| 字段 | 用途 |
|------|------|
| `messages` | 获取最后一条用户消息 |

## 未来扩展

### 1. 工具分组

如果工具有 `agentId` 字段，可以将工具按所属 Agent 分组显示。

### 2. 交互功能

- 点击 Agent 卡片：展开 / 折叠子 Agent
- 点击工具：显示工具输入参数和输出结果
- Hover 工具：显示 Tooltip（工具描述）

### 3. 历史回放

添加"历史"按钮，切换到历史模式，显示所有执行过的 Agent。

### 4. 性能指标

在工具卡片上显示：
- 执行进度条
- CPU / 内存占用
- 失败重试次数

## 总结

**核心变化**：
- ❌ Canvas 节点绘制
- ✅ React 卡片式布局

**实现要点**：
1. 以 Agent 为中心的卡片设计
2. 递归构建 AgentCard 树
3. 清晰的模式标识（Plan / Team / SubAgent）
4. 串行 / 并行布局自动切换
5. 实时显示工具执行情况

**用户价值**：
- 一目了然知道"谁在做什么"
- 清晰的执行模式和任务关系
- 实时的工具执行状态
- 简洁的视觉层次
