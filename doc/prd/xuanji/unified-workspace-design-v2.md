# 统一工作台设计 V2 - 层级化视图

## 核心洞察

**工具不是独立的事件，而是 Agent 的子操作。应该有明确的上下级结构关系。**

## 设计原则

### 1. Agent 执行为单位
每次用户提问 → Agent 回复是一个**完整的执行单元**，包含：
- 思考过程
- 工具调用
- 回复生成

### 2. 树状层级结构
```
📝 执行单元 #1 (20:15:30 - 20:15:45)
  ├─ 💭 思考: "需要读取配置文件..."
  ├─ 🔧 工具
  │   ├─ Read(src/config.json) ✓ 120ms
  │   └─ Grep(*.ts) ✓ 80ms
  ├─ 💭 思考: "根据配置文件分析..."
  ├─ 🔧 工具
  │   └─ Edit(src/config.json) ✓ 250ms
  └─ ✨ 回复: "根据分析结果..." (245 tokens)

📝 执行单元 #2 (20:16:00 - 20:16:20)
  ├─ 💭 思考: "需要运行测试..."
  ├─ 🔧 工具
  │   └─ Bash(npm test) 🔄 执行中...
  └─ ⏳ 等待中...
```

### 3. 可折叠的展示
- 默认展开当前执行单元
- 历史执行单元折叠，只显示摘要
- 点击展开查看详细过程

## 完整布局设计

```
┌────────────────────────────────────────────────────────┐
│ 🤖 Xuanji 工作台                                        │ ← 顶部状态栏
│ ──────────────────────────────────────────────────── │
│ 当前: 🟢 执行中 · 迭代 #3 · Token: 1.2k · $0.015      │
│ [暂停] [重置] [导出]                                   │
├────────────────────────────────────────────────────────┤
│                                                        │
│ 🔽 执行单元 #3 (当前) ─ 20:16:00 ~ 执行中             │ ← 当前执行（展开）
│ ┌────────────────────────────────────────────────────┐ │
│ │ 💭 思考阶段 (20:16:00)                             │ │
│ │ ─────────────────────────────────────────────────  │ │
│ │ "用户要求优化性能，我需要先分析当前代码结构..."    │ │
│ │                                                    │ │
│ │ 🔧 工具执行 (2 个)                                 │ │
│ │ ─────────────────────────────────────────────────  │ │
│ │   ├─ Read                                          │ │
│ │   │   📄 src/App.tsx                               │ │
│ │   │   ✓ 120ms · [查看内容]                        │ │
│ │   │                                                │ │
│ │   └─ Grep                                          │ │
│ │       🔍 *.ts "useState"                           │ │
│ │       🔄 执行中... (已用时 2.3s)                   │ │
│ │                                                    │ │
│ │ ⏳ 等待工具执行完成...                             │ │
│ │                                                    │ │
│ │ 📊 统计                                            │ │
│ │ Token: 180 (↑120 ↓60) · Cost: $0.002              │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ ▷ 执行单元 #2 ─ 20:15:30 ~ 20:15:45 (15s) ✓           │ ← 历史执行（折叠）
│   摘要: 分析配置文件 · 3 个工具 · 245 tokens          │
│                                                        │
│ ▷ 执行单元 #1 ─ 20:10:00 ~ 20:10:20 (20s) ✓           │
│   摘要: 读取项目结构 · 5 个工具 · 380 tokens          │
│                                                        │
│ [加载更多历史...]                                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## 执行单元卡片设计

### 展开状态（当前执行）

```tsx
┌────────────────────────────────────────────────────────┐
│ 🔽 执行单元 #3 (当前)                                   │
│ ──────────────────────────────────────────────────── │
│ 开始: 20:16:00 · 状态: 🟢 执行中 · 已用时: 12.5s      │
├────────────────────────────────────────────────────────┤
│                                                        │
│ ⏱️ 时间线                                              │
│                                                        │
│ 00:00  💭 开始思考                                     │
│        "用户要求优化性能..."                           │
│        ↓                                               │
│ 00:02  🔧 调用 Read                                    │
│        📄 src/App.tsx                                  │
│        ✓ 完成 (120ms)                                 │
│        ↓                                               │
│ 00:05  🔧 调用 Grep                                    │
│        🔍 *.ts "useState"                              │
│        🔄 执行中... (已用时 7.5s)                      │
│                                                        │
├────────────────────────────────────────────────────────┤
│ 📂 上下文                                              │
│ 关注文件: src/App.tsx, src/components/Header.tsx      │
│ 工作目录: ~/project                                    │
├────────────────────────────────────────────────────────┤
│ 📊 统计                                                │
│ Token: 180 (输入 120, 输出 60, 缓存 0)                │
│ Cost: $0.002                                           │
│ 工具: 2 个 (1 成功, 1 执行中)                         │
└────────────────────────────────────────────────────────┘
```

### 折叠状态（历史执行）

```tsx
┌────────────────────────────────────────────────────────┐
│ ▷ 执行单元 #2 ────────────────────── [点击展开]        │
│ ──────────────────────────────────────────────────── │
│ 时间: 20:15:30 ~ 20:15:45 (15s)                        │
│ 摘要: 分析配置文件结构                                 │
│ 工具: Read, Edit, Bash (3 个, 全部成功)               │
│ Token: 245 · Cost: $0.003                              │
└────────────────────────────────────────────────────────┘
```

点击后展开完整的时间线。

## 工具调用的层级展示

### 设计 1：缩进式

```
🔧 工具执行 (3 个)
────────────────
  ├─ Read
  │   📄 src/config.json
  │   ✓ 120ms
  │
  ├─ Edit
  │   📄 src/config.json
  │   ✓ 250ms
  │   [查看修改内容] →
  │
  └─ Bash
      💻 npm test
      🔄 执行中... (5.2s)
      [查看输出] →
```

### 设计 2：卡片式

```
🔧 工具调用
────────────────────────────────────

┌──────────────────────────────┐
│ 📄 Read                       │
│ src/config.json              │
│ ✓ 120ms                      │
│ [查看内容] →                 │
└──────────────────────────────┘

┌──────────────────────────────┐
│ ✏️ Edit                       │
│ src/config.json              │
│ ✓ 250ms                      │
│ [查看修改] →                 │
└──────────────────────────────┘

┌──────────────────────────────┐
│ 💻 Bash                       │
│ npm test                     │
│ 🔄 执行中... (5.2s)          │
│ [查看输出] →                 │
└──────────────────────────────┘
```

**推荐：设计 2（卡片式）**
- 更清晰的视觉分隔
- 更容易点击交互
- 更好的扩展性（可以添加更多信息）

## SubAgent 的嵌套展示

### 场景：主 Agent 调用 SubAgent

```
🔽 执行单元 #3 (当前)
├─ 💭 思考: "这个任务很复杂，我需要委托给专门的 Agent..."
│
├─ 🤖 SubAgent: CodeAnalyzer ──────────────────┐
│   ├─ 💭 思考: "开始分析代码结构..."         │ ← 子 Agent 的执行过程
│   ├─ 🔧 工具                                │
│   │   ├─ Read(src/App.tsx) ✓ 120ms          │
│   │   └─ Grep(*.ts) ✓ 80ms                  │
│   └─ ✨ 返回结果: "分析完成，发现..."       │
│   └─────────────────────────────────────────┘
│
├─ 💭 思考: "根据 SubAgent 的分析结果..."
│
└─ ✨ 回复: "经过深入分析..."
```

**层级关系**：
- 主 Agent 是第 1 层
- SubAgent 是第 2 层（视觉上缩进）
- SubAgent 的工具调用是第 3 层（再缩进）

### SubAgent 折叠状态

```
├─ 🤖 SubAgent: CodeAnalyzer ▷ 展开查看详情
│   结果: "分析完成，发现 3 个组件..." (5 个工具, 8.5s)
```

## Agent Team 的并行展示

### 场景：多个 Agent 并行执行

```
🔽 执行单元 #3 (当前)
├─ 💭 思考: "需要同时进行代码分析和测试..."
│
├─ 👥 Agent Team (并行执行)
│   ├─ 🤖 CodeAnalyzer ───────────────┐
│   │   ├─ 💭 "开始代码分析..."      │
│   │   ├─ 🔧 Read, Grep (2 个)      │
│   │   └─ ✨ "分析完成" ✓           │
│   │   └───────────────────────────┘
│   │
│   ├─ 🤖 TestRunner ──────────────────┐
│   │   ├─ 💭 "运行测试..."           │
│   │   ├─ 🔧 Bash(npm test) 🔄       │
│   │   └─ ⏳ 执行中...               │
│   │   └───────────────────────────┘
│   │
│   └─ 🤖 DocumentWriter ──────────────┐
│       ├─ 💭 "生成文档..."           │
│       ├─ 🔧 Read, Write (2 个)      │
│       └─ ✨ "文档完成" ✓            │
│       └───────────────────────────┘
│
├─ 💭 思考: "汇总所有结果..."
│
└─ ✨ 回复: "综合分析、测试和文档..."
```

**并行标识**：
- 使用不同的连接线样式（虚线？）
- 显示"并行执行"标签
- 同时显示多个 Agent 的进度

## 数据模型重构

### ExecutionUnit（执行单元）

```typescript
interface ExecutionUnit {
  id: string;
  序号: number;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed';

  // 执行阶段（按时间顺序）
  phases: ExecutionPhase[];

  // 统计信息
  stats: {
    tokenUsage: TokenUsage;
    cost: number;
    duration: number;
    toolCount: number;
  };
}

type ExecutionPhase =
  | ThinkingPhase
  | ToolPhase
  | SubAgentPhase
  | ResponsePhase;

interface ThinkingPhase {
  type: 'thinking';
  timestamp: number;
  thought: string;
}

interface ToolPhase {
  type: 'tool';
  timestamp: number;
  tools: ToolExecution[];  // 可能有多个工具
}

interface ToolExecution {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'running' | 'success' | 'error';
  duration?: number;
  startTime: number;
  endTime?: number;
}

interface SubAgentPhase {
  type: 'subagent';
  timestamp: number;
  agentName: string;
  agentType: 'delegate' | 'team_member';
  execution: ExecutionUnit;  // 递归：SubAgent 也是一个执行单元
}

interface ResponsePhase {
  type: 'response';
  timestamp: number;
  content: string;
  tokenUsage: TokenUsage;
}
```

### ExecutionStore 重构

```typescript
interface ExecutionStore {
  // 所有执行单元（按时间顺序）
  units: ExecutionUnit[];

  // 当前执行单元
  currentUnit: ExecutionUnit | null;

  // 添加新的执行单元
  startNewUnit(): void;

  // 添加阶段到当前执行单元
  addThinkingPhase(thought: string): void;
  addToolPhase(tools: ToolExecution[]): void;
  addSubAgentPhase(agent: SubAgentPhase): void;
  addResponsePhase(response: ResponsePhase): void;

  // 完成当前执行单元
  completeCurrentUnit(): void;

  // 获取执行单元
  getUnit(id: string): ExecutionUnit | undefined;
  getAllUnits(): ExecutionUnit[];
}
```

## 组件设计

### UnifiedWorkspace 组件

```tsx
export default function UnifiedWorkspace() {
  const units = useExecutionStore(state => state.units);
  const currentUnit = useExecutionStore(state => state.currentUnit);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部状态栏 */}
      <WorkspaceStatusBar />

      {/* 执行单元列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 当前执行单元（始终展开） */}
        {currentUnit && (
          <ExecutionUnitCard
            unit={currentUnit}
            expanded={true}
            isCurrent={true}
          />
        )}

        {/* 历史执行单元（默认折叠） */}
        {units.reverse().map(unit => (
          <ExecutionUnitCard
            key={unit.id}
            unit={unit}
            expanded={false}
            isCurrent={false}
          />
        ))}
      </div>
    </div>
  );
}
```

### ExecutionUnitCard 组件

```tsx
interface ExecutionUnitCardProps {
  unit: ExecutionUnit;
  expanded: boolean;
  isCurrent: boolean;
}

export default function ExecutionUnitCard({
  unit,
  expanded: initialExpanded,
  isCurrent
}: ExecutionUnitCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);

  return (
    <div className={`
      border rounded-lg
      ${isCurrent ? 'border-primary bg-primary/5' : 'border-bg-tertiary'}
    `}>
      {/* 头部（始终显示） */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown /> : <ChevronRight />}
          <span className="font-semibold">
            执行单元 #{unit.序号}
            {isCurrent && <span className="text-primary ml-2">(当前)</span>}
          </span>
          <span className="text-xs text-text-secondary ml-auto">
            {formatTime(unit.startTime)}
            {unit.endTime && ` ~ ${formatTime(unit.endTime)}`}
            {unit.endTime && ` (${formatDuration(unit.duration)})`}
          </span>
        </div>

        {/* 折叠时显示摘要 */}
        {!expanded && (
          <div className="mt-2 text-sm text-text-secondary">
            {/* 生成摘要 */}
            {generateSummary(unit)}
          </div>
        )}
      </div>

      {/* 内容（展开时显示） */}
      {expanded && (
        <div className="p-4 pt-0 space-y-4">
          {/* 时间线 */}
          <div className="space-y-3">
            {unit.phases.map((phase, index) => (
              <PhaseCard key={index} phase={phase} />
            ))}
          </div>

          {/* 底部统计 */}
          <div className="border-t border-bg-tertiary pt-4">
            <UnitStats stats={unit.stats} />
          </div>
        </div>
      )}
    </div>
  );
}
```

### PhaseCard 组件

```tsx
function PhaseCard({ phase }: { phase: ExecutionPhase }) {
  switch (phase.type) {
    case 'thinking':
      return <ThinkingPhaseCard phase={phase} />;
    case 'tool':
      return <ToolPhaseCard phase={phase} />;
    case 'subagent':
      return <SubAgentPhaseCard phase={phase} />;
    case 'response':
      return <ResponsePhaseCard phase={phase} />;
  }
}
```

## 视觉设计细节

### 连接线样式

```
时间线连接线：

  ├─ 思考阶段
  │   ↓
  ├─ 工具阶段
  │   ├─ Read
  │   └─ Grep
  │   ↓
  ├─ SubAgent
  │   │ (SubAgent 的内部时间线)
  │   ↓
  └─ 回复阶段
```

使用 CSS 边框或 SVG 绘制连接线。

### 颜色系统

```typescript
const phaseColors = {
  thinking: 'text-purple-500 bg-purple-500/10',
  tool: 'text-blue-500 bg-blue-500/10',
  subagent: 'text-green-500 bg-green-500/10',
  response: 'text-orange-500 bg-orange-500/10',
};

const statusColors = {
  running: 'text-yellow-500',
  success: 'text-green-500',
  error: 'text-red-500',
};
```

### 图标系统

- 💭 思考：Brain
- 🔧 工具：Wrench
- 🤖 SubAgent：Bot
- ✨ 回复：Sparkles
- ⏳ 等待：Clock
- ✓ 成功：CheckCircle
- ❌ 失败：XCircle
- 🔄 执行中：Loader2（旋转动画）

## 交互设计

### 1. 展开/折叠
- 点击执行单元头部 → 展开/折叠
- 点击工具卡片 → 展开 input/output
- 点击 SubAgent → 展开内部执行过程

### 2. 跳转定位
- 点击"关注文件" → 高亮相关的工具调用
- 点击统计信息 → 滚动到相关阶段

### 3. 自动滚动
- 新阶段出现时 → 自动滚动到最新
- 用户手动滚动时 → 暂停自动滚动
- 显示"跳转到最新"按钮

## 性能优化

### 1. 虚拟滚动
- 当执行单元 > 20 时启用
- 只渲染可见区域的单元

### 2. 懒加载
- 折叠的单元不渲染详细内容
- 展开时才加载和渲染

### 3. 增量更新
- 只更新变化的阶段
- 使用 React.memo 优化渲染

## 实现计划

### Phase 1: 数据模型（1 天）
- [ ] 定义 ExecutionUnit 类型
- [ ] 定义 ExecutionPhase 类型
- [ ] 重构 ExecutionStore
- [ ] 实现事件聚合逻辑

### Phase 2: 基础组件（2 天）
- [ ] UnifiedWorkspace 容器
- [ ] ExecutionUnitCard 组件
- [ ] PhaseCard 基础组件
- [ ] 展开/折叠交互

### Phase 3: 阶段卡片（2 天）
- [ ] ThinkingPhaseCard
- [ ] ToolPhaseCard
- [ ] SubAgentPhaseCard
- [ ] ResponsePhaseCard

### Phase 4: 高级功能（2 天）
- [ ] SubAgent 嵌套展示
- [ ] Agent Team 并行展示
- [ ] 时间线可视化
- [ ] 统计信息展示

### Phase 5: 优化和测试（1 天）
- [ ] 虚拟滚动
- [ ] 性能优化
- [ ] 测试和调试

## 用户体验目标

### 1. 清晰的层级关系
- 一眼看出 Agent 和工具的父子关系
- SubAgent 的嵌套层级清晰
- 并行执行的 Agent 一目了然

### 2. 完整的执行轨迹
- 每个执行单元的完整过程
- 从思考到工具到回复的流程
- 时间轴清晰可追溯

### 3. 高效的信息获取
- 折叠历史，专注当前
- 快速查看摘要
- 点击展开查看详情

### 4. 流畅的交互体验
- 平滑的展开/折叠动画
- 自动滚动到最新
- 响应式布局

## 总结

新的设计强调：

**层级化**：
- Agent 是第一层
- 工具是 Agent 的子节点
- SubAgent 可以递归嵌套

**单元化**：
- 每次执行是一个完整单元
- 包含完整的思考 → 工具 → 回复流程
- 可以独立展开/折叠

**可视化**：
- 清晰的时间线
- 明确的父子关系
- 直观的状态指示

这将让用户真正像看工作台一样，清楚地了解 Xuanji 的工作过程！
