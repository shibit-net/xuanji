# Xuanji 执行分支可视化设计

## 需求分析

展示Xuanji运行时的**所有可能执行分支**，包括：
1. **决策分支**：LLM的条件判断（Plan模式？权限？）
2. **并行分支**：多个SubAgent同时执行
3. **循环分支**：ReAct迭代循环
4. **异常分支**：工具失败、权限拒绝等

## 分支类型

### 1. 决策分支 (Decision Branch)
```
    [Thinking]
        ↓
   [是否Plan模式?]
    /           \
  Yes           No
   ↓             ↓
[EnterPlanMode] [直接执行工具]
```

触发条件：
- `EnterPlanMode` 工具调用 → Plan模式分支
- `AskUser` 工具调用 → 用户选择分支
- 权限请求 → 批准/拒绝分支

### 2. 并行分支 (Parallel Branch)
```
    [TaskTool调用]
          ↓
    ╔═════╬═════╗
    ↓     ↓     ↓
 [SubAgent1] [SubAgent2] [SubAgent3]
    ↓     ↓     ↓
    ╚═════╬═════╝
          ↓
     [结果汇总]
```

触发条件：
- `TaskTool` / `QuickTeam` / `Orchestrate` → 创建多个SubAgent
- 同时执行多个工具

### 3. 循环分支 (Loop Branch)
```
    ┌───────────────┐
    ↓               │
[Thinking] → [Tool] ┘ (迭代 1/25)
    ↓
[完成判断]
  /     \
继续    结束
```

触发条件：
- ReAct循环（最大25次迭代）
- 每次工具执行后判断是否继续

### 4. 异常分支 (Error Branch)
```
    [Tool执行]
    /       \
  成功      失败
   ↓         ↓
[继续]    [错误处理]
           /      \
         重试    终止
```

触发条件：
- 工具执行失败（isError=true）
- 权限拒绝
- 超时/超出限制

---

## 可视化布局

### 布局算法：Layered Graph (分层图)

```
Layer 0:  [用户输入]
           ↓
Layer 1:  [Skill匹配] → [记忆检索]
           ↓
Layer 2:  [Thinking 1]
           ↓
Layer 3:  [决策: Plan模式?]
          /              \
Layer 4: [EnterPlanMode]  [Read工具]
          ↓               ↓
Layer 5: [Write计划]      [Thinking 2]
          ↓               ↓
Layer 6: [ExitPlanMode]   [Glob工具]
           ↓               ↓
Layer 7:  [并行执行]
          ╔═══╬═══╗
          ↓   ↓   ↓
Layer 8: [SA1][SA2][SA3]
          ╚═══╬═══╝
          ↓
Layer 9: [输出结果]
```

### 节点定位规则

```typescript
// X坐标：根据分支索引
node.x = parentX + (branchIndex - totalBranches/2) * BRANCH_SPACING

// Y坐标：根据层级
node.y = layer * LAYER_HEIGHT

// 常量
const BRANCH_SPACING = 200;  // 分支间距
const LAYER_HEIGHT = 100;    // 层高
```

### 连线类型

1. **主流程连线**：实线，蓝色
2. **分支连线**：虚线，带分支标签（"Yes"/"No"/"选项A"）
3. **并行连线**：粗线，表示同时执行
4. **循环连线**：弯曲箭头，返回上层
5. **异常连线**：红色虚线

---

## 数据结构设计

### 节点树结构

```typescript
interface ExecutionNode {
  // 基本信息
  id: string;
  type: NodeType;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

  // 时间信息
  startTime: number;
  endTime?: number;

  // 布局信息
  x: number;
  y: number;
  layer: number;

  // 树状结构
  parent?: string;
  children: ExecutionNode[];
  branchType?: 'sequence' | 'parallel' | 'conditional' | 'loop';
  branchLabel?: string; // "Yes"/"No"/"选项1"/"重试1"

  // 元数据
  metadata?: any;
  color: string;
}

type NodeType =
  | 'start'        // 起始节点
  | 'thinking'     // LLM思考
  | 'decision'     // 决策点（菱形）
  | 'tool'         // 工具执行（矩形）
  | 'permission'   // 权限检查（盾牌）
  | 'parallel'     // 并行执行（分叉点）
  | 'merge'        // 并行合并（汇总点）
  | 'loop'         // 循环标记
  | 'subagent'     // SubAgent
  | 'error'        // 错误处理
  | 'output';      // 输出结果
```

### 分支检测逻辑

```typescript
// 1. 检测Plan模式分支
if (tool.name === 'enter_plan_mode') {
  createDecisionNode({
    label: '进入Plan模式?',
    branches: [
      { label: 'Yes', path: [planModeNodes...] },
      { label: 'No (跳过)', path: [], skipped: true },
    ],
  });
}

// 2. 检测并行执行分支
if (tool.name === 'task' || tool.name === 'quick_team') {
  createParallelNode({
    label: '并行执行SubAgent',
    branches: subAgents.map(sa => ({
      label: sa.name,
      path: [subAgentExecutionTree],
    })),
  });
}

// 3. 检测循环分支
if (agentLoop.currentIteration > 1) {
  createLoopNode({
    label: `ReAct循环 (${currentIteration}/25)`,
    loopBack: thinkingNodeId,
  });
}

// 4. 检测权限分支
if (permissionRequest) {
  createDecisionNode({
    label: '权限请求',
    branches: [
      { label: '批准', path: [continueExecution...] },
      { label: '拒绝', path: [terminateExecution...] },
    ],
  });
}

// 5. 检测异常分支
if (tool.isError) {
  createDecisionNode({
    label: '工具执行失败',
    branches: [
      { label: '重试', path: [retryExecution...] },
      { label: '终止', path: [errorHandling...] },
    ],
  });
}
```

---

## 实现策略

### Phase 1: 树状布局基础

1. **数据结构**：从线性节点数组改为树状结构
2. **布局算法**：实现分层布局（Sugiyama算法简化版）
3. **连线绘制**：支持多种连线类型（直线/曲线/循环）

### Phase 2: 分支检测

1. **决策分支**：检测EnterPlanMode、AskUser等工具
2. **并行分支**：检测TaskTool、rootAgent.children
3. **循环分支**：检测currentIteration变化
4. **异常分支**：检测isError标志

### Phase 3: 动态构建

1. **实时构建**：根据IPC事件动态添加节点到树
2. **分支预测**：预先展示可能的分支（灰色虚线）
3. **分支激活**：执行到该分支时高亮显示

### Phase 4: 交互增强

1. **节点点击**：展开/折叠分支
2. **路径高亮**：高亮当前执行路径
3. **分支过滤**：隐藏未执行的分支
4. **时间回放**：回放执行过程

---

## 示例：完整执行树

### 场景：用户请求"帮我实现登录功能"

```
[用户输入: "帮我实现登录功能"]
   ↓
[Skill匹配: code-assistant] ─→ [记忆检索: 3条]
   ↓
[Thinking 1: 分析需求]
   ↓
[决策: 是否需要Plan模式?]
  ├─ Yes ━━━━━━━━━━━━━━━━━━━━━━━┐
  │   ↓                           │
  │  [EnterPlanMode]              │
  │   ↓                           │
  │  [Thinking: 设计方案]          │
  │   ↓                           │
  │  [Write: plan.md]             │
  │   ↓                           │
  │  [权限请求: 写入plan.md]       │
  │   ├─ 批准 ─→ [Write完成]      │
  │   └─ 拒绝 ─→ [终止执行]       │
  │   ↓                           │
  │  [PlanReview请求]             │
  │   ├─ 批准 ─→ [继续]           │
  │   └─ 补充 ─→ [回到Thinking]   │
  │   ↓                           │
  │  [ExitPlanMode]               │
  │   ↓                           │
  └─> [并行执行SubAgent] <─────────┘
       ╔═══╬═══╬═══╗
       ↓   ↓   ↓   ↓
      [SA1] [SA2] [SA3] [SA4]
       │   │   │   │
  后端API 前端 测试 文档
       │   │   │   │
       ↓   ↓   ↓   ↓
     [Write] [Write] [Write] [Write]
       │   │   │   │
       ╚═══╬═══╬═══╝
           ↓
      [结果汇总]
           ↓
      [TODO创建: 人工测试]
           ↓
      [输出结果]
```

### 节点总数：24个
- 决策节点：3个（Plan模式、权限批准、PlanReview）
- 并行节点：1个（4个SubAgent）
- 工具节点：8个（Write×5, EnterPlanMode×1, ExitPlanMode×1, 其他×1）
- 其他节点：12个

---

## Canvas绘制优化

### 1. 节点形状差异化

```typescript
// 不同类型节点使用不同形状
switch (node.type) {
  case 'decision':
    drawDiamond(ctx, x, y, size);  // 菱形
    break;
  case 'parallel':
    drawParallelBars(ctx, x, y);   // 双竖线
    break;
  case 'loop':
    drawCircularArrow(ctx, x, y);  // 循环箭头
    break;
  case 'tool':
    drawRoundRect(ctx, x, y, w, h); // 圆角矩形
    break;
  default:
    drawRect(ctx, x, y, w, h);      // 普通矩形
}
```

### 2. 连线样式差异化

```typescript
// 根据分支类型绘制不同样式连线
switch (branchType) {
  case 'conditional':
    ctx.setLineDash([5, 5]);         // 虚线
    drawBezierCurve(ctx, from, to);  // 曲线
    break;
  case 'parallel':
    ctx.lineWidth = 3;               // 粗线
    drawStraightLine(ctx, from, to);
    break;
  case 'loop':
    ctx.strokeStyle = '#8B5CF6';     // 紫色
    drawLoopArrow(ctx, from, to);
    break;
  default:
    drawStraightLine(ctx, from, to); // 直线
}
```

### 3. 分支标签

```typescript
// 在连线上绘制分支标签
ctx.fillStyle = '#9CA3AF';
ctx.font = '11px sans-serif';
ctx.textAlign = 'center';
ctx.fillText(branchLabel, midX, midY - 5); // "Yes"/"No"等
```

---

## 性能优化

### 1. 虚拟化渲染
- 只绘制可视区域内的节点
- 使用Canvas分层（静态层 + 动画层）

### 2. 节点折叠
- 默认折叠未执行的分支
- 点击展开/折叠

### 3. 增量更新
- 只重绘变化的节点
- 使用脏矩形标记

---

## 下一步实现

1. **重构数据结构**：从数组改为树
2. **实现布局算法**：分层自动布局
3. **绘制不同节点形状**：菱形、双竖线等
4. **检测分支逻辑**：Plan模式、并行执行等
5. **实时构建树**：根据IPC事件动态添加

预计工作量：2-3小时完整实现
