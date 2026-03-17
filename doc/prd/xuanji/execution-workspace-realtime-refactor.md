# ExecutionWorkspace 重构 - 实时执行状态监视器

## 需求变更

### 原设计（已废弃）
- 累积式拓扑结构，显示所有执行过的节点
- 螺旋布局，节点永久保留
- 类似执行历史记录

### 新设计（当前）
- **实时状态监视器**，只显示当前正在运行的内容
- **运行结束后消失**，不保留历史节点
- **层级展示**：用户输入 → Agent → 工具调用
- 类似于操作系统的进程监视器

## 核心理念

> **"只显示此刻正在发生的事情"**

用户输入一个任务后：
1. 显示用户输入（作为上下文）
2. 显示正在工作的 Agent（Main Agent / Sub Agent）
3. 显示 Agent 正在调用的工具
4. 工具执行完成后立即消失
5. Agent 完成后立即消失
6. 等待下一个任务

## 数据源逻辑

### 活跃节点过滤

```typescript
// Layer 1: 用户输入（仅在 Agent 运行时显示）
if (rootAgent?.status === 'running' && lastUserMessage) {
  // 显示最后一条用户消息（截断到 50 字符）
}

// Layer 2: 活跃的 Agent
if (rootAgent?.status === 'running') {
  // 显示 Main Agent
}

// 递归查找所有运行中的 Sub Agents
const findActiveSubAgents = (agent) => {
  agent.children.forEach(child => {
    if (child.status === 'running') {
      // 显示 Sub Agent
    }
  });
};

// Layer 3: 活跃的工具
const activeTools = toolExecutions.filter(t => t.status === 'running');
```

### 关键变化

| 对比项 | 旧设计 | 新设计 |
|--------|--------|--------|
| 数据源 | 所有 toolExecutions | `toolExecutions.filter(t => t.status === 'running')` |
| 节点生命周期 | 永久保留 | 运行结束后消失 |
| 布局算法 | 螺旋布局（黄金角） | 垂直层级布局 |
| 显示内容 | 执行历史 | 当前状态 |

## 布局设计

### 垂直层级布局

```
┌─────────────────────────────────────┐
│  Layer 1: 用户输入                   │
│     👤 "帮我实现登录功能"            │
│         ↓                            │
│  Layer 2: 活跃的 Agent               │
│     🤖 Main Agent (运行中)           │
│    ┌────┴────┐                       │
│   🤖        🤖                        │
│  SubAgent1 SubAgent2                 │
│    ↓   ↓   ↓                         │
│  Layer 3: 活跃的工具                 │
│  🔧 Read  🔧 Write  🔧 Bash          │
└─────────────────────────────────────┘
```

### 坐标计算

```typescript
const centerX = 400; // 画布中心 X
let currentY = 80;   // 起始 Y 坐标

// Layer 1: 用户输入
if (hasUserInput) {
  y = currentY;
  currentY += 120; // 层间距
}

// Layer 2: Main Agent
if (hasMainAgent) {
  y = currentY;
  currentY += 120;
}

// Sub Agents（水平排列）
const offsetX = (index - (totalSubAgents - 1) / 2) * 150;

// Layer 3: 工具（水平排列）
const spacing = Math.min(120, 600 / totalTools);
const offsetX = (index - (totalTools - 1) / 2) * spacing;
```

## 视觉效果

### 1. 节点动画

**呼吸效果**（运行中的节点）：
```typescript
const breathe = node.status === 'running' ? Math.sin(time / 400) * 4 : 0;
const currentSize = node.size + breathe;
```

**光晕效果**：
- 外圈：径向渐变，从 30% 透明到完全透明
- 内圈：从节点颜色 100% 到 66% 透明

**旋转 Loading 指示器**：
- 位置：节点右上角
- 动画：360° 旋转，周期 200ms
- 样式：3/4 圆弧

### 2. 连线动画

**粒子流动**：
```typescript
const t = (time % 1.5) / 1.5; // 1.5 秒一个周期
const particleX = from.x + (to.x - from.x) * t;
const particleY = from.y + (to.y - from.y) * t;

// 绘制带光晕的粒子
ctx.shadowBlur = 8;
ctx.arc(particleX, particleY, 3, 0, Math.PI * 2);
```

**渐变连线**：
- 起点颜色：from.color（40% 透明）
- 终点颜色：to.color（40% 透明）

### 3. 背景网格

**动态网格点**：
```typescript
for (let x = 0; x < width; x += 40) {
  for (let y = 0; y < height; y += 40) {
    const offset = Math.sin(time + x * 0.01 + y * 0.01) * 1;
    ctx.arc(x, y + offset, 0.8, 0, Math.PI * 2);
  }
}
```

## UI 组件

### 顶部状态栏

**左侧**：
- 标题："实时执行状态"
- 活跃节点统计："活跃节点: 5 | 2 Agent, 3 工具"

**右侧**：
- 迭代次数（带脉冲点）
- Token 使用量
- 成本统计

### 空状态

当没有任务运行时：
```tsx
<div className="text-center">
  <Activity size={64} className="animate-pulse" />
  <div>等待执行任务...</div>
  <div>发送消息后将实时显示执行流程</div>
</div>
```

### 图例

仅在有活跃节点时显示：
- 用户输入（灰色）
- 主 Agent（蓝色）
- 子 Agent（紫色）
- 文件工具（青色）
- Shell 工具（绿色）

### 底部提示

**左侧**：
- 正在执行：`<Loader2 /> 正在执行...`
- 待命：`待命`

**右侧**：
- `仅显示运行中的节点 · 完成后自动消失`

## 节点类型

### 1. 用户输入节点

```typescript
{
  type: 'user-input',
  label: "帮我实现登录功能...",
  status: 'completed',
  size: 40,
  color: '#9CA3AF', // 灰色
  icon: '👤',
}
```

### 2. Agent 节点

**Main Agent**：
```typescript
{
  type: 'agent',
  label: 'Xuanji Assistant',
  status: 'running',
  size: 60,
  color: '#3B82F6', // 蓝色
  icon: '🤖',
}
```

**Sub Agent**：
```typescript
{
  type: 'agent',
  label: 'Code Writer',
  status: 'running',
  size: 50,
  color: '#8B5CF6', // 紫色
  icon: '🤖',
}
```

### 3. 工具节点

```typescript
{
  type: 'tool',
  label: 'Read',
  status: 'running',
  size: 40,
  color: '#06B6D4', // 青色（文件工具）
  icon: '🔧',
}
```

**颜色规则**：
- 文件工具（Read/Write/Edit/Glob/Grep）：`#06B6D4` 青色
- Shell 工具（Bash/TaskOutput）：`#10B981` 绿色
- 记忆工具（MemoryStore/MemorySearch）：`#8B5CF6` 紫色
- 编排工具（QuickTeam/Orchestrate）：`#F59E0B` 橙色
- 其他工具：`#6B7280` 灰色

## 性能优化

### 1. 节点数量控制

由于只显示运行中的节点，节点数量天然受限：
- 最多 1 个 Main Agent
- Sub Agent 数量取决于并发限制（通常 ≤ 3）
- 工具数量取决于当前执行（通常 ≤ 5）

**总节点数通常 ≤ 10**，无需虚拟化渲染。

### 2. 动画循环优化

```typescript
// 只在有活跃节点时运行动画
useEffect(() => {
  if (activeNodes.length === 0) {
    // 无活跃节点，不启动动画循环
    return;
  }

  const animate = () => {
    // 绘制逻辑
    animationId = requestAnimationFrame(animate);
  };

  animate();
  return () => cancelAnimationFrame(animationId);
}, [activeNodes]);
```

### 3. Canvas 分辨率

```typescript
const dpr = window.devicePixelRatio || 1;
canvas.width = rect.width * dpr;
canvas.height = rect.height * dpr;
ctx.scale(dpr, dpr);
```

确保在高 DPI 屏幕上清晰显示。

## 数据流动

```
executionStore (Zustand)
    ↓
useExecutionStore hooks
    ↓
activeNodes 过滤逻辑
    ↓
Canvas 绘制
    ↓
用户界面
```

**关键逻辑**：
```typescript
// 只保留运行中的工具
const activeTools = toolExecutions.filter(t => t.status === 'running');

// 递归查找运行中的 Sub Agents
const findActiveSubAgents = (agent) => {
  // 深度优先遍历，找到所有 status === 'running' 的子节点
};
```

## 测试场景

### 场景 1：简单工具调用

```
用户输入: "读取 README.md"
    ↓
Main Agent 出现
    ↓
Read 工具出现（带动画）
    ↓
Read 工具完成，消失
    ↓
Main Agent 完成，消失
    ↓
回到空状态
```

### 场景 2：并行 Sub Agent

```
用户输入: "帮我实现登录功能"
    ↓
Main Agent 出现
    ↓
EnterPlanMode 工具出现 → 消失
    ↓
3 个 Sub Agent 同时出现
    ├─ Backend Agent → Write 工具
    ├─ Frontend Agent → Write 工具
    └─ Test Agent → Bash 工具
    ↓
工具逐个完成并消失
    ↓
Sub Agents 逐个完成并消失
    ↓
Main Agent 完成，消失
```

### 场景 3：嵌套 Sub Agent

```
Main Agent
    ↓
Sub Agent 1
    ↓
Sub Agent 1.1 (嵌套)
    ↓
工具
```

**显示效果**：
- Layer 2: Main Agent (中间)
- Layer 3: Sub Agent 1 (稍偏左)
- Layer 4: Sub Agent 1.1 (更偏左)
- Layer 5: 工具

## 未来扩展

### 1. 淡入淡出动画

```typescript
// 节点出现时淡入
node.opacity = 0 → 1 (300ms)

// 节点消失时淡出
node.opacity = 1 → 0 (300ms)
```

### 2. 节点位置平滑过渡

当节点数量变化时，使用 Spring 动画平滑移动到新位置。

### 3. 历史回放

添加一个"历史"按钮，点击后切换到累积模式，显示完整执行历史。

### 4. 性能指标

在节点上显示：
- CPU 使用率
- 内存占用
- 执行时长

## 总结

**核心变化**：
- ❌ 累积式拓扑结构
- ✅ 实时状态监视器

**实现要点**：
1. 过滤 `status === 'running'` 的节点
2. 垂直层级布局（用户输入 → Agent → 工具）
3. 节点完成后自动消失
4. 动画效果：呼吸、光晕、粒子流

**用户体验**：
- 清晰展示"当前正在发生什么"
- 无历史累积，专注当下
- 类似操作系统进程监视器的实时感
- 动画流畅，视觉反馈明确
