# Workspace 拓扑图重设计：日志融合方案

## 背景

现有 WorkspaceMonitor 使用 Canvas 渲染一个简单的主节点 + 子节点拓扑图，仅展示 Agent 名称、状态颜色和粒子流动动画。日志信息（工具调用、思考内容、Skill/MCP 调用、记忆读写）没有可视化入口。

本方案将所有运行时信息**融入拓扑图本身**，不另开日志面板，让拓扑图既是结构图也是实时日志。

---

## 设计理念

将多 Agent 协作类比为**一个工作小队**：

- 主 Agent（璇玑）= 项目负责人，接受任务、分配工作、综合结论
- 子 Agent（coder/explore/plan 等）= 专职成员，各司其职
- 工具调用 = 成员正在使用的具体工具（"正在查资料"、"正在写代码"）
- Skill/MCP = 成员调用的外部服务
- 记忆读写 = 成员翻阅笔记 / 记下心得
- 思考（Thinking）= 成员的内心独白，以气泡展示

---

## 节点五区域设计

每个 Agent 节点承载 5 个信息区，全部在 Canvas 内绘制：

```
              ┌─────────────────────────┐
              │     [区域2：思考气泡]     │  节点正上方，淡紫色圆角矩形
              │   💭 "需要先读架构…"     │  最多2行，超出省略
              └────────────┬────────────┘
                           │ 尾巴连线
         ┌─────────────────▼─────────────────┐
[区域4]  │                                   │  [区域3]
●●●○   ←│    🤖  璇玑   (thinking)           │→  📖 查阅3条记忆  0.1s ✓
历史点阵  │    ─────────────────────           │   右侧动作标签（胶囊）
         └─────────────────┬─────────────────┘
                           │
         ──────────────────────────────────────
         [区域5：时间条]
         🔍读文件 ✓0.3s  💭思考  🔨写文件 ↻...
         ──────────────────────────────────────
```

### 区域1：节点核心圆（现有，微调）
- 圆心图标：按 Agent 角色显示 emoji（璇玑=🤖、coder=🔨、explore=🔍、plan=📐、test-writer=🧪）
- 状态颜色和动画保持现有逻辑

### 区域2：正上方思考气泡（新增）
- 仅在 `thinking` 状态且有 `currentThought` 时显示
- 淡紫色背景 `rgba(124,140,245,0.15)`，紫色边框 `rgba(124,140,245,0.6)`
- 最多 2 行，超出省略为 `…`
- 气泡底部有小三角尾巴指向节点
- 出现/消失：opacity 淡入淡出（0.3s）

### 区域3：右侧动作标签（新增，替换现有 currentTool tooltip）
- 紧贴节点右侧圆弧，胶囊形状
- 按事件类型显示不同颜色和图标：

| 类型 | 图标 | 背景色 |
|------|------|--------|
| file (Read/Write/Edit/Glob/Grep) | 🗂 | `rgba(59,130,246,0.8)` 蓝 |
| bash | ⚡ | `rgba(75,85,99,0.9)` 深灰 |
| skill | ✨ | `rgba(139,92,246,0.8)` 紫 |
| mcp | 🔗 | `rgba(234,88,12,0.8)` 橙 |
| memory_read | 📖 | `rgba(16,185,129,0.8)` 绿 |
| memory_write | 💾 | `rgba(16,185,129,0.8)` 绿 |
| thinking | 💭 | `rgba(124,140,245,0.6)` 淡紫 |

- 右下角小字显示持续时间（运行中显示 `↻`，完成显示 `✓Xs`）

### 区域4：左侧历史点阵（新增）
- 最近 8 次操作，竖向排列在节点左侧
- ● 绿色实心 = 成功，● 红色实心 = 失败，○ 灰色空心 = 进行中
- 悬停时展开气泡显示详情（工具名、耗时、结果摘要）

### 区域5：正下方时间条（新增）
- 横向时间轴，宽度 = 节点直径 × 3，高度 40px
- 从左到右排列最近 5 个事件，每个事件是小胶囊：`[图标 + 短文字 + 耗时]`
- 正在进行的事件右端有加载动画（旋转点）
- 最新事件在最右侧，超出向左滚动

---

## 连线升级

### 连线颜色语义

| 状态 | 颜色 | 粒子 |
|------|------|------|
| 任务分配（主→子） | `#7C8CF5` 蓝紫 | →→→ 流向子节点 |
| 结果返回（子→主） | `#34D399` 绿 | →→→ 流向主节点 |
| 等待中 | `#3A3A3A` 深灰 | 无粒子 |
| 失败 | `#EF4444` 红 | 闪烁 |

### 连线中点任务标签（新增）
- 连线中间位置显示小标签气泡
- 主→子方向：任务简述（最多 16 字）
- 子→主方向：结果简述（最多 16 字，加 ✓ 或 ✗）
- 随粒子流速淡入淡出

---

## 全局叠加层

### 顶部状态栏（替换现有标题栏）
```
┌──────────────────────────────────────────────────┐
│  🤖 璇玑团队  │  已运行 2m30s  │  5.2k tokens  │  3轮 │
└──────────────────────────────────────────────────┘
```

### 左下角事件流（替换现有 token 统计面板）
- 最近 5 条事件的滚动列表
- 格式：`[时间] [Agent名] [动作描述]`
- 最新事件从下方进入，旧事件向上淡出

---

## 交互设计

| 操作 | 效果 |
|------|------|
| 点击节点 | 展开该节点完整历史（节点放大 + 详情卡片） |
| 点击思考气泡 | 展开完整思考内容（多行滚动） |
| 悬停连线标签 | 显示完整任务/结果描述 |
| 悬停历史点 | 气泡显示该操作详情 |
| 点击左下角事件 | 高亮对应节点 |

---

## 数据类型扩展

### 新增类型（WorkspaceMonitor/types.ts）

```typescript
// 动作类型
export type MomentType =
  | 'thinking' | 'file' | 'bash' | 'skill' | 'mcp'
  | 'memory_read' | 'memory_write' | 'idle';

// 当前动作（区域3）
export interface AgentMoment {
  type: MomentType;
  icon: string;
  label: string;        // 最多 20 字符
  durationMs: number;
  status: 'running' | 'success' | 'error';
}

// 时间条事件（区域5）
export interface TimelineEvent {
  id: string;
  icon: string;
  label: string;        // 最多 12 字符
  duration?: number;    // ms，完成后填入
  status: 'running' | 'success' | 'error';
}

// 历史点（区域4）
export interface HistoryDot {
  id: string;
  status: 'success' | 'error' | 'running';
  tooltip: string;      // 悬停详情
}

// 连线标签
export interface CollaborationLabel {
  text: string;         // 最多 16 字符
  direction: 'forward' | 'backward';
  opacity: number;      // 0-1，随粒子流淡入淡出
}
```

### SubAgentData 扩展

```typescript
export interface SubAgentData {
  // ...现有字段...
  roleIcon: string;               // 角色 emoji
  currentMoment?: AgentMoment;    // 区域3：右侧动作标签
  momentHistory: HistoryDot[];    // 区域4：左侧历史点阵（最多8条）
  timelineEvents: TimelineEvent[]; // 区域5：下方时间条（最多5条）
  thinkingText?: string;          // 区域2：上方思考气泡
}
```

### MainAgentData 扩展

```typescript
export interface MainAgentData {
  // ...现有字段...
  roleIcon: string;
  currentMoment?: AgentMoment;
  momentHistory: HistoryDot[];
  timelineEvents: TimelineEvent[];
}
```

### Collaboration 扩展

```typescript
export interface Collaboration {
  // ...现有字段...
  label?: CollaborationLabel;     // 连线中点标签
}
```

---

## 新增 Hook 事件（src/hooks/types.ts）

```typescript
// 新增 7 个事件
| 'AgentThinking'     // Agent 进入 Extended Thinking
| 'SkillStart'        // Skill 开始执行
| 'SkillEnd'          // Skill 执行完成
| 'McpToolStart'      // MCP 工具调用开始
| 'McpToolEnd'        // MCP 工具调用结束
| 'MemoryRead'        // 记忆检索（buildDecisionContext）
| 'MemoryWrite'       // 记忆写入
```

---

## IPC 新增事件（agent-bridge.ts → renderer）

| IPC 事件 | 来源 Hook | 数据 |
|---------|----------|------|
| `agent:skill-start` | SkillStart | `{ skillName, input }` |
| `agent:skill-end` | SkillEnd | `{ skillName, duration, success }` |
| `agent:mcp-start` | McpToolStart | `{ serverName, toolName, input }` |
| `agent:mcp-end` | McpToolEnd | `{ serverName, toolName, duration, isError }` |
| `agent:memory-read` | MemoryRead | `{ hitCount, layersSearched }` |
| `agent:memory-write` | MemoryWrite | `{ scope, summary }` |

---

## 实施阶段

| 阶段 | 文件 | 内容 |
|------|------|------|
| 1 | `WorkspaceMonitor/types.ts` | 新增 AgentMoment、TimelineEvent、HistoryDot、CollaborationLabel 类型；扩展 SubAgentData、MainAgentData、Collaboration |
| 2 | `WorkspaceMonitor/LayoutEngine.ts` | 新增 getThinkingBubblePosition、getMomentTagPosition、getTimelineOrigin、getHistoryDotsOrigin、getConnectionLabelPosition |
| 3 | `WorkspaceMonitor/CanvasRenderer.ts` | 新增 drawThinkingBubble、drawMomentTag、drawHistoryDots、drawTimelineStrip、drawConnectionLabel、drawEventFeed；调整 drawMainAgent/drawSubAgents 调用新方法 |
| 4 | `desktop/renderer/stores/runtimeStore.ts` + `WorkspaceMonitor/index.tsx` | 新增 activityEvents 状态；监听新 IPC 事件；映射 AgentMoment/TimelineEvent/HistoryDot |
| 5 | `src/hooks/types.ts` + `desktop/main/agent-bridge.ts` | 新增 7 个 Hook 事件；补充 IPC 转发 |
