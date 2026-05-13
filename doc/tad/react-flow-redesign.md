# React Flow 执行流程图 — 整体重构设计方案

## 一、现状分析

### 当前实现的问题

| 问题 | 描述 |
|------|------|
| **两层布局不一致** | `ActiveAgentView` 用树形卡片 + `ExecutionFlow` 用 Dagre 流程图，两套可视化各自维护 |
| **节点生命周期不精确** | `team-end` 时手动遍历后代逐个 `CLEANUP`，而非状态机自动推导 |
| **Team 节点尺寸后算** | TeamNode 的宽高在 Dagre 布局之后才根据成员位置反算，且每次 data 更新都重算 |
| **引用稳定性的 hack** | `hasNodeDataChanged` 跳过 `thinkingText`/`currentTask`，AgentNode 需要单独订阅 store 获取实时值，数据流不统一 |
| **拖拽逻辑脆弱** | 只允许拖动 `team-*` 节点，成员位置通过 `teamDragOffsets` 累积偏移量同步，非 team 节点的拖拽被过滤 |
| **边类型混乱** | 透明边用于 dagre 布局但不渲染，最终渲染时需过滤"直接 agent→team-member"边 |
| **布局策略单一** | 所有场景用同一套 TB Dagre 布局，无法区分 sequential/pipeline/debate 等不同执行模式的视觉语义 |

### 当前节点数据流

```
IPC → MessageBus → EventAdapter → AgentStateMachine.transition()
                                      │
                                      ▼
                              agentMap: Record<string, AgentState>
                                      │
                                      ▼
                              ExecutionFlow.buildFlowFromAgentMap()
                                      │
                              ┌───────┴───────┐
                              │  nodes         │  edges
                              │  - agent       │  - parent→child
                              │  - team        │  - parent→team
                              │                │  - team→member (透明)
                              ▼                ▼
                              Dagre layout → setNodes / setEdges
```

---

## 二、重构目标

1. **单一数据源**：`AgentStateMachine.agentMap` 是唯一真相源，React Flow 只做纯渲染
2. **声明式生命周期**：节点何时出现/消失，由状态机状态决定，不在渲染层做二次判断
3. **策略感知布局**：sequential / parallel / hierarchical / debate / pipeline 五种团队策略有独立的子布局
4. **统一数据流**：所有实时数据（thinkingText、工具耗时）通过 store 订阅流入节点，不做引用稳定性 hack
5. **简化的交互**：整体画布可平移缩放，单个节点不拖拽（布局完全由策略决定）

---

## 三、节点类型定义

### 3.1 五种节点类型

```
┌──────────────────────────────────────────────────────────────────┐
│  类型           React Flow type    视觉形态        生命周期       │
├──────────────────────────────────────────────────────────────────┤
│  foreground     'foreground'       大圆形头像       整个会话期间   │
│  subagent      'subagent'         小圆形头像       创建→清除      │
│  team          'team'             虚线边界框       创建→清除      │
│  team-member   'team-member'      小圆形头像+角色   创建→清除      │
│  user-input    'user-input'       消息气泡         单次输入期间   │
└──────────────────────────────────────────────────────────────────┘
```

**与旧实现的区别**：
- 去掉了模糊的 `'agent'` 类型，拆分为 `foreground` / `subagent` / `team-member`，每种有明确的视觉和生命周期语义
- 新增 `user-input` 节点，展示触发本轮执行的用户输入（在 agent 开始输出后淡出）
- `team` 节点保持为边界框，但尺寸在布局阶段预先计算，不再事后反算

### 3.2 节点数据结构

```typescript
// 基础节点 data（所有类型共享）
interface BaseNodeData {
  agentId: string;
  name: string;
  status: AgentStatus;          // pending | thinking | executing | writing | reporting | success | failed | cancelled | cleared
  statusSince: number;          // 进入当前状态的时间戳
  parentId: string | null;
}

// 前台 Agent 节点
interface ForegroundNodeData extends BaseNodeData {
  nodeType: 'foreground';
  scene?: string;               // 当前场景 (coding, debugging, etc.)
  complexity?: string;          // simple | complex
  model?: string;               // 当前使用的模型
  iterationCount: number;       // 当前迭代次数
}

// 后台子 Agent 节点（task 工具创建）
interface SubagentNodeData extends BaseNodeData {
  nodeType: 'subagent';
  taskDescription: string;      // 任务描述（截断 100 字符）
  executionMode: 'acp' | 'in-process';
}

// Team 边界框节点
interface TeamNodeData extends BaseNodeData {
  nodeType: 'team';
  teamName: string;
  strategy: TeamStrategy;       // sequential | parallel | hierarchical | debate | pipeline
  memberCount: number;
  currentRound?: number;        // debate 策略
  maxRounds?: number;           // debate 策略
  goal: string;                 // 团队目标（截断 80 字符）
}

// Team 成员节点
interface TeamMemberNodeData extends BaseNodeData {
  nodeType: 'team-member';
  teamId: string;               // 所属 team 的 agentId
  memberRole: string;           // agent role (coder, reviewer, etc.)
  debateRole?: 'affirmative' | 'negative' | 'judge';
  stepIndex?: number;           // sequential/pipeline 中的序号
  taskDescription: string;
}

// 用户输入节点（轻量、临时）
interface UserInputNodeData {
  nodeType: 'user-input';
  messageId: string;
  content: string;              // 截断 120 字符
}
```

---

## 四、节点生命周期：何时出现、何时消失

### 4.1 核心原则

```
规则 1（出现）：节点在对应 IPC 事件首次到达时创建，状态为 'pending'
规则 2（更新）：节点在生命周期内只更新 data 字段，不重新创建
规则 3（消失）：节点在 status 变为 'cleared' 后从 flow 中移除（带动画）
规则 4（终态保持）：success/failed 节点保留在 flow 中（灰显），直到被清理
规则 5（清理触发）：清理由后台异步任务的 auto-summarize 或 team-end 触发
```

### 4.2 各节点类型的生命周期表

#### Foreground Agent（前台 Agent）

```
事件序列                          状态变化               React Flow 行为
──────────────────────────────────────────────────────────────────────────
agent:switch-foreground          → pending              创建节点，主视觉
agent:started                    → thinking             蓝色发光，旋转动画
agent:thinking (首次)            → thinking             更新 thinking 文本气泡
agent:tool-start (首次)          → executing            工具列表面板展开
agent:text (首次)                → writing              逐字输出
agent:end (本轮完成)             → success (绿灯)        保持显示，灰显
  有排队消息 → 新一轮            → pending              重新激活
  无排队 → idle                  → (保持 success)       等待下一轮
agent:switch-foreground (新agent)→ pending              旧 agent 保持 success 灰显
                                                        新 agent 创建节点
session:reset / 显式关闭          → cleared              节点移除（fadeOut 动画）

⏱ 持续时间: 整个会话生命周期
❌ 消失条件: session reset / 显式关闭会话
```

#### Subagent（后台 task 子 Agent）

```
事件序列                          状态变化               React Flow 行为
──────────────────────────────────────────────────────────────────────────
agent:subagent-start             → pending              创建节点，淡入动画
                                  → thinking/executing   正常状态流转
                                  → writing              
agent:subagent-end (success)     → reporting            绿色，等待汇总
agent:subagent-end (failure)     → failed               红色虚线
agent:auto-summarize-start       → cleared              fadeOut 动画后移除
(或 agent:end 中的批量清理)       → cleared              同上

⏱ 持续时间: 从创建到 auto-summarize 完成（通常数秒到数分钟）
❌ 消失条件: auto-summarize 或 CLEANUP_COMPLETED_TASKS 将 status 设为 cleared
⚠️ 特殊情况: 失败后保留 failed 状态 5 秒，然后自动清理
```

#### Team（团队边界框）

```
事件序列                          状态变化               React Flow 行为
──────────────────────────────────────────────────────────────────────────
agent:team-start                 → pending              创建虚线框 + 标题栏
团队首个 member-start            → running              框体完整显示
所有 member 完成 + team-end      → success / failed     根据结果绿色/红色
agent:team-end 中的批量 CLEANUP  → cleared              fadeOut 动画后移除
  同时所有成员也被 CLEANUP

⏱ 持续时间: 从 team-start 到 team-end（取决于策略，通常 30s-30min）
❌ 消失条件: team-end 触发的批量 CLEANUP
⚠️ 级联清理: team 消失时，其下所有 team-member 同步消失
```

#### Team Member（团队成员）

```
事件序列                          状态变化               React Flow 行为
──────────────────────────────────────────────────────────────────────────
agent:team-member-start          → pending              在 team 框内创建节点
                                  → thinking/executing   正常状态流转
agent:team-member-end (success)  → reporting            绿色，等待汇总
agent:team-member-end (failure)  → failed               红色
所有 member 完成 → team-end      → cleared              fadeOut 动画后移除
(或 auto-summarize)               → cleared              同上

⏱ 持续时间: 从 member-start 到 team-end（取决于成员任务复杂度）
❌ 消失条件: 父 team 的 CLEANUP 或 auto-summarize
```

#### User Input（用户输入气泡）

```
事件序列                          状态变化               React Flow 行为
──────────────────────────────────────────────────────────────────────────
agent:intent-route                → 创建节点            淡入，显示用户消息摘要
agent:started (agent 开始输出)    → 半透明               逐渐淡出
agent:text (首次输出文本)          → 移除                从 flow 中删除

⏱ 持续时间: 从路由完成到 agent 首次输出文本（通常 1-3 秒）
❌ 消失条件: agent 开始输出文本后自动移除
🎨 动画: 1s 内 opacity 0.6→0，然后 remove
```

### 4.3 生命周期状态机图

```
                    ┌─────────────┐
                    │   pending   │ ← 节点创建
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ thinking │ │executing │ │ writing  │ ← 活跃态（发光+动画）
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │            │
             └─────────────┼────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ success  │ │ failed   │ │cancelled │ ← 终态（灰显，保留）
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │            │
             └─────────────┼────────────┘
                           │ (auto-summarize / cleanup)
                           ▼
                    ┌─────────────┐
                    │   cleared   │ ← 从 flow 中移除（带动画）
                    └─────────────┘
```

### 4.4 特殊场景的生命周期

```
场景 A: 用户中途输入（Agent 正在 thinking/executing）
  → 不创建新节点，当前 foreground agent 继续保持
  → pendingMessages 排队，agent 本轮结束后自动处理
  → 排队消息数量通过 queuedMessageCount 在 UI 上显示

场景 B: 用户中途输入（Agent 正在 outputting）
  → abort 标记设置，agent 停止输出
  → 本轮结束后合并排队消息，重新 RUN_AGENT
  → foreground agent 从 writing → success → pending（新一轮）

场景 C: 用户切换 Agent（通过 IntentRouter 路由到不同 agent）
  → 旧 foreground agent: 保持 success 灰显
  → 新 foreground agent: 创建新节点，pending → 正常流转
  → 旧 agent 在下次 session reset 或手动清理时移除

场景 D: Agent 崩溃（uncaughtException）
  → 当前 agent: → failed（红色虚线）
  → 发送 agent:error + agent:end IPC
  → 前端恢复 idle 状态
  → failed 节点保留，用户可手动关闭

场景 E: 团队执行中用户输入
  → 如果主 agent 在 waiting_async 状态 → 立即 RUN_AGENT
  → team 节点继续显示（后台运行）
  → 主 agent 处理新输入，可能创建新的 task/team

场景 F: Checkpoint 恢复（团队重试）
  → team-start 时加载历史 checkpoint
  → 已完成的 member 直接显示 success（绿色）
  → 新执行的 member 从 pending 开始
  → 全部完成后统一清理
```

---

## 五、布局策略

### 5.1 总体布局方案

使用 **LR（左→右）** 为主方向，比当前 TB（上→下）更适合：
- 团队内部子布局灵活（并行可横向展开、串行可纵向排列在 LR 流中）
- 时间线语义更自然（左=先发生，右=后发生）
- 避免 TB 下 team 框高度无法预计算的问题

```
整体流向: 左 ──────────────────────────────► 右

user-input → foreground agent → subagent / team → (更多层级)
```

### 5.2 各策略的团队内部布局

#### Sequential（串行）
```
┌──────── Team Box ────────────────────────┐
│  标题栏: sequential · N 步               │
│                                          │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐│
│  │ Member1 │──►│ Member2 │──►│ Member3 ││
│  │  ① 完成 │   │  ② 执行 │   │  ③ 等待 ││
│  └─────────┘   └─────────┘   └─────────┘│
│                                          │
└──────────────────────────────────────────┘
方向: LR，成员水平排列，带箭头连接
序号: 圆形序号徽章 ①②③
```

#### Parallel（并行）
```
┌──────── Team Box ────────────────────────┐
│  标题栏: parallel · N 名成员             │
│                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │ Member1 │ │ Member2 │ │ Member3 │    │
│  │  执行中  │ │  执行中  │ │  等待   │    │
│  └─────────┘ └─────────┘ └─────────┘    │
│                                          │
└──────────────────────────────────────────┘
方向: 水平并排，无连接线
并发: 最多同时 3 个活跃（亮色），其余等待（暗色）
```

#### Hierarchical（层级）
```
┌──────── Team Box ────────────────────────┐
│  标题栏: hierarchical · 1 Leader + 2 Worker│
│                                          │
│              ┌─────────┐                 │
│              │ Leader  │                 │
│              │  规划中  │                 │
│              └────┬────┘                 │
│                  │ 分配任务               │
│       ┌──────────┼──────────┐            │
│       ▼          ▼          ▼            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │ Worker1 │ │ Worker2 │ │ Worker3 │    │
│  │  执行中  │ │  等待   │ │  等待   │    │
│  └─────────┘ └─────────┘ └─────────┘    │
│                                          │
└──────────────────────────────────────────┘
方向: TB，Leader 居中上方，Workers 下方水平排列
```

#### Debate（辩论）
```
┌──────── Team Box ───────────────────────────────┐
│  标题栏: debate · Round 2/3                     │
│                                                  │
│           ┌─────────────┐                        │
│           │    Judge     │  ← 事实摘要 + 最终裁决  │
│           │   评估中      │                        │
│           └──────┬──────┘                        │
│                  │ 事实摘要                       │
│     ┌────────────┼────────────┐                  │
│     ▼            ▼            ▼                  │
│  ┌──────┐   ┌──────┐                            │
│  │正方  │   │反方  │   ← 第2轮辩论中              │
│  │执行中│   │等待中│                            │
│  └──────┘   └──────┘                            │
│                                                  │
└──────────────────────────────────────────────────┘
方向: TB，Judge 顶部，正反方并排下方
轮次: 顶部标题栏动态显示 R{n}/{max}
```

#### Pipeline（流水线）
```
┌──────── Team Box ────────────────────────────────────┐
│  标题栏: pipeline · N 阶段                           │
│                                                      │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐           │
│  │ Stage1  │───►│ Stage2  │───►│ Stage3  │           │
│  │ 数据采集 │    │ 数据处理 │    │ 报告生成 │           │
│  │  完成    │    │  执行中  │    │  等待   │           │
│  └─────────┘    └─────────┘    └─────────┘           │
│                                                      │
│  文件传递: stage_0_member1.txt → stage_1_member2.txt │
└──────────────────────────────────────────────────────┘
方向: LR，阶段水平排列，粗箭头连接
数据流: 底部显示文件传递路径
```

### 5.3 整体布局算法

```
算法: buildLayout(agentMap, mainAgentId)
──────────────────────────────────────────

1. 构建树: 根据 parentId 将 agentMap 构建为树结构

2. 识别节点类型:
   - mainAgent → foreground node
   - taskType='task' 的顶层节点 → subagent node  
   - taskType='team' 的顶层节点 → team node (容器)
   - team 的 children → team-member node
   - 其余 → subagent node

3. 递归布局:
   function layoutSubtree(root, direction):
     if root 是 team:
       // 策略感知子布局
       switch root.strategy:
         case 'sequential':  layoutSequential(members)
         case 'parallel':    layoutParallel(members)
         case 'hierarchical': layoutHierarchical(members)
         case 'debate':      layoutDebate(members)
         case 'pipeline':    layoutPipeline(members)
       // team 框尺寸 = 子布局边界 + padding
     else:
       // 普通 agent，子节点在右侧垂直排列
       children on right, stacked vertically

4. Dagre 全局布局:
   - 仅用于 team 框之间 + 非 team 节点之间的宏观布局
   - rankdir: 'LR'
   - team 内部使用自定义布局，Dagre 不介入

5. 边路由:
   - parent → child: smoothstep
   - team → member: 不可见（仅用于 Dagre 位置约束）
   - sequential/pipeline: 成员之间的粗箭头边（自定义 edge 类型）
```

---

## 六、数据流架构

### 6.1 新架构

```
IPC 事件
  │
  ▼
EventAdapter (无变化)
  │
  ▼
AgentStateMachine (增强)
  │  agentMap: Record<string, AgentState>
  │  + getNodeLifecycle(agentId): NodeLifecycle  ← 新增
  │  + getTeamLayout(teamId): TeamLayout        ← 新增
  │
  ├──► useFlowNodes(agentMap)      ← 自定义 hook
  │      │
  │      ├── filter: status !== 'cleared'
  │      ├── classify: foreground | subagent | team | team-member
  │      ├── buildFlowNodes()
  │      └── buildFlowEdges()
  │
  ├──► useFlowLayout(nodes, edges) ← 自定义 hook
  │      │
  │      ├── 策略感知子布局
  │      └── Dagre 全局布局
  │
  └──► ReactFlow 渲染
         │
         ├── ForegroundNode (大圆形 + 场景标签)
         ├── SubagentNode (小圆形 + 任务描述)
         ├── TeamNode (虚线框 + 标题栏)
         ├── TeamMemberNode (小圆形 + 角色)
         └── UserInputNode (气泡 + 自动消失)
```

### 6.2 核心 Hook 设计

```typescript
// useFlowNodes: 从 agentMap 构建 React Flow nodes/edges
function useFlowNodes(): { nodes: Node[]; edges: Edge[] } {
  const agentMap = useAgentStateMachine(s => s.agentMap);
  const mainAgentId = useAgentStateMachine(s => s.mainAgent);

  return useMemo(() => {
    const activeAgents = Object.values(agentMap)
      .filter(a => a.status !== 'cleared');  // ← 唯一的过滤条件

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // 1. 分类 + 构建节点
    for (const agent of activeAgents) {
      const classified = classifyAgent(agent, mainAgentId);
      nodes.push(buildNode(classified));
    }

    // 2. 构建边
    for (const agent of activeAgents) {
      if (agent.parentId && agentMap[agent.parentId]) {
        edges.push(buildEdge(agent.parentId, agent.id, agent.status));
      }
    }

    return { nodes, edges };
  }, [agentMap, mainAgentId]);
}

// useFlowLayout: 策略感知布局
function useFlowLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  return useMemo(() => {
    // 1. 分离 team 节点和非 team 节点
    // 2. 对每个 team，执行策略感知子布局
    // 3. 对非 team 节点，执行 Dagre LR 布局
    // 4. 合并结果
    return applyLayout(nodes, edges);
  }, [nodes, edges]);
}
```

---

## 七、视觉效果规范

### 7.1 状态视觉映射

| 状态 | 颜色 | 动画 | 边框 |
|------|------|------|------|
| `pending` | 灰蓝 `#94a3b8` | 无 | 细虚线 |
| `thinking` | 紫色 `#8b5cf6` | 脉冲光晕 + 旋转虚线环 | 中等实线 |
| `executing` | 蓝色 `#3b82f6` | 脉冲光晕 + 工具图标跳动 | 粗实线 |
| `writing` | 青色 `#06b6d4` | 逐字输出闪烁 | 粗实线 |
| `reporting` | 黄色 `#eab308` | 呼吸光晕 | 中等实线 |
| `success` | 绿色 `#22c55e` | 无（静止） | 细实线，40% 透明度 |
| `failed` | 红色 `#ef4444` | 无（静止） | 虚线，闪烁一次后静止 |
| `cancelled` | 灰色 `#6b7280` | 无 | 虚线 |
| `cleared` | — | fadeOut (500ms) | — |

### 7.2 节点尺寸

| 节点类型 | 宽度 | 高度 | 备注 |
|---------|------|------|------|
| foreground | 180px | 200px | 大头像 + 名称 + 场景标签 |
| subagent | 140px | 160px | 小头像 + 名称 + 任务摘要 |
| team | 动态 | 动态 | 根据内部成员布局 + padding 24px |
| team-member | 120px | 140px | 小头像 + 角色标签 |
| user-input | 200px | 60px | 气泡形状 |

### 7.3 边样式

| 边类型 | 样式 | 动画 |
|--------|------|------|
| parent → child (活跃) | `stroke: primary/0.35, width: 2` | 流动虚线 |
| parent → child (非活跃) | `stroke: white/0.08, width: 1` | 无 |
| sequential/pipeline 阶段间 | `stroke: primary/0.5, width: 3` | 流动实线 |
| team → member | `stroke: transparent` (仅供布局) | 无 |

### 7.4 动画时序

| 动画 | 持续时间 | 缓动 | 触发条件 |
|------|---------|------|---------|
| 节点出现 (fadeIn) | 300ms | ease-out | 节点创建 |
| 节点消失 (fadeOut) | 500ms | ease-in | status → cleared |
| 状态切换光晕 | 400ms | ease-in-out | 状态变化 |
| 工具执行脉冲 | 800ms loop | linear | status=executing |
| thinking 虚线旋转 | 2s loop | linear | status=thinking |
| user-input 淡出 | 1s | ease-in | agent 开始输出文本 |

---

## 八、实现计划

### Phase 1: 类型与数据层 (不破坏现有 UI)

1. 在 `AgentStateMachine.ts` 中新增 `getNodeLifecycle(agentId)` 方法
2. 定义 5 种节点 data 类型（`FlowNodeTypes.ts`）
3. 新增 `useFlowNodes` hook，在现有 `ExecutionFlow` 旁并行运行

### Phase 2: 新节点组件

1. `ForegroundNode.tsx` — 前台 Agent 节点
2. `SubagentNode.tsx` — 后台子 Agent 节点
3. `TeamNode.tsx` — 团队边界框（基于现有实现重构）
4. `TeamMemberNode.tsx` — 团队成员节点
5. `UserInputNode.tsx` — 用户输入气泡

### Phase 3: 布局引擎

1. `layout/sequential.ts` — 串行布局
2. `layout/parallel.ts` — 并行布局
3. `layout/hierarchical.ts` — 层级布局
4. `layout/debate.ts` — 辩论布局
5. `layout/pipeline.ts` — 流水线布局
6. `layout/engine.ts` — 全局编排器

### Phase 4: 整合与切换

1. 新 `ExecutionFlowV2` 组件，通过 feature flag 与旧版共存
2. 灰度验证后替换旧版
3. 移除 `ActiveAgentView`（卡片视图不再需要，React Flow 是唯一可视化）

---

## 九、关键设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 布局方向 | LR (左→右) | 团队内部子布局更灵活；时间线语义清晰 |
| 节点是否可拖拽 | 不可拖拽 | 布局完全由策略+状态决定，拖拽会破坏语义 |
| 终态节点是否保留 | 保留（灰显） | 让用户看到完整执行历史；下次 reset 时清除 |
| user-input 节点 | 自动消失 | 轻量临时节点，不干扰执行流程主体 |
| 两套可视化共存 | 旧版 feature flag 共存 → 验证后移除 | 降低风险 |
| team 内部布局 | 自定义布局，不用 Dagre | Dagre 适合树形层级，不适合 team 内部语义布局 |
