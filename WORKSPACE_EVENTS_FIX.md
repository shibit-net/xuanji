# Workspace事件显示修复

## 问题

意图分析结果没有展示在WorkspaceMonitor上方。

## 原因

chatStore只监听了`workspace:model-classifier`事件，但没有监听其他workspace事件：
- `workspace:intent-analysis-start/end`
- `workspace:task-planning-start/end`
- `workspace:task-execution-start/end`
- `workspace:result-aggregation-start/end`

## 解决方案

在chatStore中添加所有workspace事件的监听，使用`enqueueMoment`将事件显示在WorkspaceMonitor上方。

### 添加的事件监听

#### 1. 意图分析
```typescript
messageBus.on('workspace:intent-analysis-start', (data: any) => {
  enqueueMoment('main', {
    type: 'thinking',
    icon: '🎯',
    label: '分析意图',
    status: 'running',
  });
});

messageBus.on('workspace:intent-analysis-end', (data: any) => {
  enqueueMoment('main', {
    type: 'thinking',
    icon: '✅',
    label: `意图: ${data.intent || 'unknown'}`,
    status: 'success',
  });
});
```

#### 2. 任务规划
```typescript
messageBus.on('workspace:task-planning-start', (data: any) => {
  enqueueMoment('main', {
    type: 'thinking',
    icon: '📋',
    label: '规划任务',
    status: 'running',
  });
});

messageBus.on('workspace:task-planning-end', (data: any) => {
  enqueueMoment('main', {
    type: 'thinking',
    icon: '✅',
    label: '规划完成',
    status: 'success',
  });
});
```

#### 3. 任务执行
```typescript
messageBus.on('workspace:task-execution-start', (data: any) => {
  enqueueMoment('main', {
    type: 'thinking',
    icon: '⚙️',
    label: '执行任务',
    status: 'running',
  });
});

messageBus.on('workspace:task-execution-end', (data: any) => {
  enqueueMoment('main', {
    type: 'thinking',
    icon: '✅',
    label: '执行完成',
    status: 'success',
  });
});
```

#### 4. 结果聚合
```typescript
messageBus.on('workspace:result-aggregation-start', (data: any) => {
  enqueueMoment('main', {
    type: 'thinking',
    icon: '📊',
    label: '聚合结果',
    status: 'running',
  });
});

messageBus.on('workspace:result-aggregation-end', (data: any) => {
  enqueueMoment('main', {
    type: 'thinking',
    icon: '✅',
    label: '聚合完成',
    status: 'success',
  });
});
```

## 事件流程

```
IntentClassifier/ModelClassifier (src/core/agent/dispatch/)
  ↓ hookRegistry.emit('ModelClassifierStart', ...)
HookRegistry
  ↓ 触发监听器
agent-bridge.ts
  ↓ channel.send('workspace:model-classifier-start', ...)
EnhancedMessageChannel (主进程)
  ↓ 自动转发到renderer
  ↓ mainWindow.webContents.send('workspace:model-classifier-start', ...)
RendererMessageBus (前端)
  ↓ window.electron.on('workspace:model-classifier-start', ...)
  ↓ messageBus分发事件
chatStore.ts
  ↓ messageBus.on('workspace:model-classifier-start', ...)
  ↓ enqueueMoment('main', { ... })
runtimeStore
  ↓ 更新currentMoments
WorkspaceMonitor
  ✓ 显示在界面上方
```

## 显示效果

现在WorkspaceMonitor上方会显示：

1. **意图分析阶段**
   - 🎯 分析意图 → ✅ 意图: write_code

2. **任务规划阶段**
   - 📋 规划任务 → ✅ 规划完成

3. **任务执行阶段**
   - ⚙️ 执行任务 → ✅ 执行完成

4. **结果聚合阶段**
   - 📊 聚合结果 → ✅ 聚合完成

5. **模型分类阶段**
   - 🤖 glm-4-flash → ✅ write_code (standard)

## 测试验证

### 测试步骤
1. 启动应用
2. 发送一条消息
3. 观察WorkspaceMonitor上方的状态显示

### 预期结果
- ✅ 看到意图分析的图标和文字
- ✅ 看到任务规划的图标和文字
- ✅ 看到任务执行的图标和文字
- ✅ 看到结果聚合的图标和文字
- ✅ 看到模型分类的图标和文字

## 提交记录

```
50a9d5a fix: 添加所有workspace事件监听
```

## 状态

✅ 已修复
🧪 待测试

---

修复时间：2026-04-24
状态：✅ 已完成
