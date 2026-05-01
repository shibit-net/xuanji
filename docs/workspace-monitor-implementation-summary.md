# WorkspaceMonitor 事件系统实现总结

## 已完成的工作

### 1. 定义新的 Hook 事件类型

**文件**: `src/hooks/types.ts`

新增事件：
- `IntentAnalysisStart` / `IntentAnalysisEnd` - 意图分析
- `TaskPlanningStart` / `TaskPlanningEnd` - 任务规划
- `TaskExecutionStart` / `TaskExecutionEnd` - 任务执行
- `ResultAggregationStart` / `ResultAggregationEnd` - 结果汇总
- `PromptBuildStart` / `PromptBuildEnd` - Prompt 构建（预留）
- `AgentSelectionStart` / `AgentSelectionEnd` - Agent 选择（预留）

### 2. 修改 MainAgent 发射事件

**文件**: `src/core/agent/dispatch/MainAgent.ts`

**修改内容**：
- 注入 `HookRegistry`
- 在各个阶段发射事件：
  - 意图分析开始/结束
  - 任务规划开始/结束
  - 任务执行开始/结束
  - 结果汇总开始/结束

**事件数据**：
- `sessionId`: 会话 ID
- `userInput`: 用户输入
- `scene`: 识别的场景
- `complexity`: 复杂度
- `strategy`: 执行策略
- `tasks`: 任务列表
- `duration`: 执行时长
- `success`: 是否成功

### 3. 修改 SessionFactory 注入依赖

**文件**: `src/core/chat/SessionFactory.ts`

将 `HookRegistry` 注入到 `MainAgent` 构造函数。

### 4. Desktop App 监听事件

**文件**: `desktop/main/agent-bridge.ts`

在 `registerHookListeners()` 中添加新的事件监听器：
- `IntentAnalysisStart` → `workspace:intent-analysis-start`
- `IntentAnalysisEnd` → `workspace:intent-analysis-end`
- `TaskPlanningStart` → `workspace:task-planning-start`
- `TaskPlanningEnd` → `workspace:task-planning-end`
- `TaskExecutionStart` → `workspace:task-execution-start`
- `TaskExecutionEnd` → `workspace:task-execution-end`
- `ResultAggregationStart` → `workspace:result-aggregation-start`
- `ResultAggregationEnd` → `workspace:result-aggregation-end`

### 5. 创建 WorkspaceStore

**文件**: `desktop/renderer/stores/workspaceStore.ts`

**功能**：
- 管理所有 workspace 事件
- 维护阶段状态（pending / running / completed / error）
- 提供订阅机制
- 提供查询接口（getEvents / getPhases / getCurrentPhase）

**阶段管理**：
- 意图分析
- 任务规划
- 任务执行
- 结果汇总

### 6. 创建主流程可视化组件

**文件**: `desktop/renderer/components/WorkspaceMonitor/MainFlowVisualization.tsx`

**功能**：
- 显示所有阶段的状态
- 显示当前正在执行的阶段
- 显示阶段详情（场景、复杂度、任务列表等）
- 支持选择不同阶段查看详情

**UI 元素**：
- 流程阶段卡片（带状态指示）
- 箭头连接
- 当前阶段高亮
- 阶段详情面板

### 7. 创建样式文件

**文件**: `desktop/renderer/components/WorkspaceMonitor/MainFlowVisualization.css`

**样式特性**：
- 深色主题
- 状态颜色区分（pending / running / completed / error）
- 动画效果（running 状态脉冲动画）
- 响应式布局

---

## 事件流转链路

```
MainAgent 执行
  ↓
发射 Hook 事件
  ↓
HookRegistry 分发
  ↓
agent-bridge.ts 监听
  ↓
通过 IPC 发送到 Renderer
  ↓
WorkspaceStore 接收
  ↓
更新阶段状态
  ↓
通知订阅者
  ↓
MainFlowVisualization 重新渲染
```

---

## 使用方法

### 1. 在 WorkspaceMonitor 中集成

```tsx
// desktop/renderer/components/WorkspaceMonitor/index.tsx

import { MainFlowVisualization } from './MainFlowVisualization';

export function WorkspaceMonitor() {
  return (
    <div className="workspace-monitor">
      {/* 🆕 主流程可视化 */}
      <MainFlowVisualization />

      {/* 原有的子 Agent 树 */}
      <SubAgentTree />

      {/* 原有的时间线 */}
      <Timeline />
    </div>
  );
}
```

### 2. 重置状态

```typescript
// 新会话开始时重置
workspaceStore.reset();
```

### 3. 查询状态

```typescript
// 获取所有事件
const events = workspaceStore.getEvents();

// 获取所有阶段
const phases = workspaceStore.getPhases();

// 获取当前阶段
const currentPhase = workspaceStore.getCurrentPhase();

// 获取时间线
const timeline = workspaceStore.getTimeline();
```

---

## 可视化效果

### 主流程显示

```
┌─────────────────────────────────────────────────────────┐
│ 主流程                                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [1] 意图分析  →  [2] 任务规划  →  [3] 任务执行       │
│      ✓ 完成          ✓ 完成          🔄 进行中         │
│      23ms            156ms           2.3s              │
│                                                         │
│  当前阶段: 任务执行                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 阶段详情

```
┌─────────────────────────────────────────────────────────┐
│ 阶段详情                          [选择阶段 ▼]          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 📊 意图分析                                             │
│   场景:      write_code                                 │
│   复杂度:    standard                                   │
│   匹配方式:  keyword                                    │
│   置信度:    95.0%                                      │
│                                                         │
│ 📋 任务规划                                             │
│   策略:      single                                     │
│   任务列表:                                             │
│   [1] Agent: coder                                      │
│       Scene: write_code                                 │
│       描述: 写一个用户登录接口                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 扩展点

### 1. 添加更多事件

在 `src/hooks/types.ts` 中添加新事件：

```typescript
export type HookEvent =
  // ...
  | 'PromptBuildStart'
  | 'PromptBuildEnd'
  | 'AgentSelectionStart'
  | 'AgentSelectionEnd';
```

在对应的组件中发射事件：

```typescript
await this.hookRegistry?.emit('PromptBuildStart', {
  scene,
  agentId,
});
```

### 2. 添加更多阶段

在 `WorkspaceStore.initPhases()` 中添加：

```typescript
this.phases.set('prompt-build', {
  name: 'Prompt 构建',
  status: 'pending',
});
```

### 3. 自定义可视化

创建新的可视化组件：

```tsx
// TimelineView.tsx
export function TimelineView() {
  const timeline = workspaceStore.getTimeline();
  // 渲染时间线
}

// PhaseDetailsPanel.tsx
export function PhaseDetailsPanel() {
  const phases = workspaceStore.getPhases();
  // 渲染详细信息
}
```

---

## 性能考虑

### 1. 事件频率

- 事件异步发射，不阻塞主流程
- 使用 `emit()` 而不是 `emitSync()`

### 2. 状态更新

- 使用订阅模式，避免轮询
- 只在状态变化时通知

### 3. 渲染优化

- 使用 React.memo 避免不必要的重渲染
- 虚拟滚动处理大量事件

---

## 测试建议

### 1. 单元测试

```typescript
describe('WorkspaceStore', () => {
  test('应该正确处理事件', () => {
    const store = new WorkspaceStore();
    // 模拟事件
    // 验证状态
  });
});
```

### 2. 集成测试

```typescript
describe('MainAgent 事件发射', () => {
  test('应该发射所有阶段事件', async () => {
    const events: string[] = [];
    hookRegistry.on('IntentAnalysisStart', () => {
      events.push('IntentAnalysisStart');
    });
    // ...
    await mainAgent.execute('test');
    expect(events).toContain('IntentAnalysisStart');
  });
});
```

### 3. E2E 测试

```typescript
describe('WorkspaceMonitor 可视化', () => {
  test('应该显示主流程', async () => {
    // 发送消息
    // 等待渲染
    // 验证 UI
  });
});
```

---

## 总结

**已实现的功能**：
- ✅ 定义新的 Hook 事件类型
- ✅ MainAgent 发射事件
- ✅ Desktop App 监听和转发事件
- ✅ WorkspaceStore 管理状态
- ✅ MainFlowVisualization 可视化组件
- ✅ 样式和动画

**核心优势**：
- ✅ 完整的可观测性
- ✅ 解耦设计（通过 Hook 系统）
- ✅ 实时更新
- ✅ 易于扩展

**下一步**：
- 集成到 WorkspaceMonitor 主组件
- 添加更多可视化视图（时间线、详情面板）
- 添加交互功能（点击查看详情、过滤事件）
- 性能优化和测试
