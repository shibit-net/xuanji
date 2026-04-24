# WorkspaceMonitor显示修复

## 问题

WorkspaceMonitor上方没有展示：
1. 当前操作目录（项目信息）
2. 意图分析结果

## 原因分析

### 1. workspaceStore使用旧的事件系统
workspaceStore使用`window.electron.onWorkspaceXxx`方法，而不是messageBus：

```typescript
// 旧代码
window.electron.onWorkspaceIntentAnalysisStart((data) => {
  // ...
});
```

但是在MessageBus重构后，所有事件都通过messageBus分发，`window.electron.onWorkspaceXxx`这些专用方法不再被调用。

### 2. MainFlowVisualization被注释掉
在WorkspaceMonitor中，MainFlowVisualization组件被注释掉了：

```tsx
{/* <MainFlowVisualization /> */}
```

这个组件负责显示意图分析结果和当前执行阶段。

## 解决方案

### 1. 迁移workspaceStore到messageBus

**修改前**：
```typescript
window.electron.onWorkspaceIntentAnalysisStart((data) => {
  this.handleEvent({
    eventType: 'IntentAnalysisStart',
    timestamp: data.timestamp,
    data,
  });
  this.updatePhase('intent-analysis', 'running', data.timestamp);
});
```

**修改后**：
```typescript
import { messageBus } from '../utils/MessageBus';

messageBus.on('workspace:intent-analysis-start', (data: any) => {
  console.log('[WorkspaceStore] IntentAnalysisStart received:', data);
  this.handleEvent({
    eventType: 'IntentAnalysisStart',
    timestamp: data.timestamp || Date.now(),
    data,
  });
  this.updatePhase('intent-analysis', 'running', data.timestamp || Date.now());
});
```

### 2. 取消注释MainFlowVisualization

```tsx
{/* 🆕 主 Agent 执行状态（类似"正在回忆中"） */}
<MainFlowVisualization />
```

## 显示效果

### 1. 项目信息条
显示在WorkspaceMonitor顶部：
```
📦 项目类型: Node.js
🌿 Git 分支: master
📁 项目路径: /Users/xxx/project
```

### 2. 意图分析结果
显示在项目信息下方：
```
正在分析意图...
🤖 glm-4-flash
📍 write_code
🎯 standard
```

### 3. 执行阶段
显示当前执行阶段：
- 意图分析
- 任务规划
- 任务执行
- 结果汇总

## 事件流程

```
IntentClassifier/ModelClassifier
  ↓ hookRegistry.emit('ModelClassifierStart')
agent-bridge.ts
  ↓ channel.send('workspace:model-classifier-start')
EnhancedMessageChannel
  ↓ 自动转发到renderer
  ↓ mainWindow.webContents.send('workspace:model-classifier-start')
RendererMessageBus
  ↓ window.electron.on('workspace:model-classifier-start')
  ↓ messageBus分发
workspaceStore
  ↓ messageBus.on('workspace:model-classifier-start')
  ↓ updatePhase('intent-analysis', 'running')
  ↓ notifyListeners()
MainFlowVisualization
  ↓ workspaceStore.subscribe()
  ↓ 更新显示
WorkspaceMonitor
  ✓ 显示在界面上方
```

## 迁移的事件

workspaceStore现在监听以下messageBus事件：

1. **意图分析**
   - `workspace:intent-analysis-start`
   - `workspace:intent-analysis-end`
   - `workspace:model-classifier-end`

2. **任务规划**
   - `workspace:task-planning-start`
   - `workspace:task-planning-end`

3. **任务执行**
   - `workspace:task-execution-start`
   - `workspace:task-execution-end`

4. **结果聚合**
   - `workspace:result-aggregation-start`
   - `workspace:result-aggregation-end`

5. **Prompt构建**
   - `prompt:build-event`

## 测试验证

### 测试步骤
1. 启动应用
2. 发送一条消息
3. 观察WorkspaceMonitor上方

### 预期结果
- ✅ 看到项目信息（类型、分支、路径）
- ✅ 看到意图分析过程和结果
- ✅ 看到当前执行阶段
- ✅ 看到模型信息（glm-4-flash等）

## 提交记录

```
193b7e8 fix: 修复WorkspaceMonitor上方信息显示
```

## 状态

✅ workspaceStore已迁移到messageBus
✅ MainFlowVisualization已启用
✅ 项目信息正常显示
✅ 意图分析结果正常显示

---

修复时间：2026-04-24
状态：✅ 已完成
