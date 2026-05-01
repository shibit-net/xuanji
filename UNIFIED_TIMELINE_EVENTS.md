# 统一使用timelineEvents展示工具调用和状态

## 修改目标

统一使用`timelineEvents`来展示所有工具调用和有意义的操作，避免`currentMoment`和`timelineEvents`重复展示同一个操作。

## 修改策略

### 1. timelineEvents（工具调用堆栈）

**用途**：展示所有工具调用和有意义的操作（最近5个）

**包含的操作**：
- ✅ **工具调用**（read_file、write_file、bash、task等）
- ✅ **Skill执行**（✨）
- ✅ **记忆操作**（📖 memory-read、💾 memory-write）

**特点**：
- 显示在agent右侧
- 垂直堆栈，最多显示4个
- 显示实时耗时
- 蓝色背景（running）、绿色背景（success）、红色背景（error）
- 完成后保留3秒自动消失

### 2. currentMoment（瞬时动作标签）

**用途**：展示后台操作

**包含的操作**：
- ✅ **压缩上下文**（🗜️ compress）

**特点**：
- 显示在agent右侧（可以和timelineEvents同时展示）
- 单个标签
- 灰色背景
- 用于后台操作

**注意**：
- ❌ **思考状态**（💭 thinking）不再使用currentMoment，只展示在思考气泡中
- ❌ **工具调用**不再使用currentMoment，只展示在timelineEvents中

## 修改内容

### 1. 移除工具调用的currentMoment设置

**文件**：`desktop/renderer/stores/chatStore.ts`

**修改位置**：`_handleAgentToolStart`

```typescript
// ❌ 删除
actStore.setAgentMoment(currentAgentId, {
  type: momentType.type,
  icon: momentType.icon,
  label: data.name.slice(0, 20),
  durationMs: 0,
  status: 'running',
});

// ✅ 只保留
actStore.addTimelineEvent(currentAgentId, {
  id: data.id,
  icon: momentType.icon,
  label: data.name.slice(0, 12),
  status: 'running',
  startTime: Date.now(),
});
```

### 2. 移除工具调用的finishAgentMoment

**文件**：`desktop/renderer/stores/chatStore.ts`

**修改位置**：`_handleAgentToolEnd`

```typescript
// ❌ 删除
actStore.finishAgentMoment(currentAgentId, status);

// ✅ 只保留
actStore.finishTimelineEvent(currentAgentId, data.id, toolCallDuration ?? 0, status);
```

### 3. 移除Skill的currentMoment设置

**文件**：`desktop/renderer/stores/chatStore.ts`

**修改位置**：`agent:skill-start`事件监听

```typescript
// ❌ 删除
store.setAgentMoment(data.agentId, {
  type: 'skill',
  icon: '✨',
  label: data.skillName.slice(0, 20),
  durationMs: 0,
  status: 'running',
});

// ✅ 只保留
store.addTimelineEvent(data.agentId, {
  id,
  icon: '✨',
  label: data.skillName.slice(0, 12),
  status: 'running',
  startTime: Date.now(),
});
```

### 4. 移除Skill的finishAgentMoment

**文件**：`desktop/renderer/stores/chatStore.ts`

**修改位置**：`agent:skill-end`事件监听

```typescript
// ❌ 删除
const store = useRuntimeStore.getState();
const status = data.success !== false ? 'success' : 'error';
store.finishAgentMoment(data.agentId, status);

// ✅ 改为空实现（skill完成时只需要更新timelineEvent）
window.electron.on('agent:skill-end', (data: { agentId: string; skillName: string; duration?: number; success?: boolean }) => {
  // Skill 完成时，只需要更新 timelineEvent，不需要 finishAgentMoment
});
```

### 5. 移除记忆操作的currentMoment设置

**文件**：`desktop/renderer/stores/chatStore.ts`

**修改位置**：`agent:memory-read`和`agent:memory-write`事件监听

```typescript
// ❌ 删除 memory-read 的 setAgentMoment
store.setAgentMoment(data.agentId, {
  type: 'memory_read',
  icon: '📖',
  label: `检索${data.hitCount ?? 0}条记忆`,
  durationMs: 0,
  status: 'running',
});

// ✅ 只保留 addTimelineEvent
store.addTimelineEvent(data.agentId, {
  id: eventId,
  icon: '📖',
  label: `回忆${data.hitCount ?? 0}条`,
  status: 'running',
  startTime: Date.now(),
});

// ❌ 删除 memory-write 的 setAgentMoment
store.setAgentMoment(data.agentId, {
  type: 'memory_write',
  icon: '💾',
  label: (data.summary || '写入记忆').slice(0, 20),
  durationMs: 0,
  status: 'running',
});

// ✅ 只保留 addTimelineEvent
store.addTimelineEvent(data.agentId, {
  id: eventId,
  icon: '💾',
  label: (data.summary || '写入记忆').slice(0, 12),
  status: 'running',
  startTime: Date.now(),
});
```

### 6. 保留压缩上下文的currentMoment

**文件**：`desktop/renderer/stores/chatStore.ts`

**修改位置**：`agent:compress-start`事件监听

```typescript
// ✅ 保留（压缩是后台操作，使用currentMoment展示）
store.setAgentMoment(data.agentId, {
  type: 'thinking',
  icon: '🗜️',
  label: '压缩上下文中...',
  durationMs: 0,
  status: 'running',
});
```

### 7. 移除思考的currentMoment

**文件**：`desktop/renderer/stores/chatStore.ts`

**修改位置**：`agent:thinking-start`事件监听

```typescript
// ❌ 删除（思考只展示在思考气泡中，不需要currentMoment）
const store = useRuntimeStore.getState();
store.setAgentMoment(data.agentId, {
  type: 'thinking',
  icon: '💭',
  label: data.content.slice(0, 20),
  durationMs: 0,
  status: 'running',
});

// ✅ 只保留（思考只展示在思考气泡中）
const activeAgentStore = useActiveAgentStore.getState();
if (data.agentId && data.content) {
  activeAgentStore.setAgentThought(data.agentId, data.content);
}
```

### 8. 简化CanvasRenderer的绘制逻辑

**文件**：`desktop/renderer/components/WorkspaceMonitor/CanvasRenderer.ts`

**修改位置**：`drawMainAgent`方法

```typescript
// 区域3：右侧工具调用堆栈
if (agent.timelineEvents && agent.timelineEvents.length > 0) {
  const recent5 = agent.timelineEvents.slice(-5);
  this.drawToolCallStack(pos, radius, recent5);
}

// currentMoment 现在只用于后台操作（如compress），可以和 timelineEvents 同时展示
if (agent.currentMoment) {
  this.drawMomentTag(pos, radius, agent.currentMoment);
}
```

**说明**：
- timelineEvents 和 currentMoment 可以同时展示
- currentMoment 使用 LayoutEngine 做碰撞避让，不会和 timelineEvents 重叠

## 展示效果

### 有工具调用时

```
┌─────────────────┐
│                 │
│   🤖 Xuanji    │  ← 主agent
│                 │
└─────────────────┘
         │
         └─→ 🗂 read_file  2.3s  ← timelineEvents（蓝色，running）
             🤖 task      19.2s
             📖 回忆3条    0.3s
```

### 无工具调用时（思考中）

```
┌─────────────────┐
│                 │
│   🤖 Xuanji    │  ← 主agent
│                 │
└─────────────────┘
    💭 分析用户需求...  ← 思考气泡（上方）
```

### 压缩上下文时（有工具调用）

```
┌─────────────────┐
│                 │
│   🤖 Xuanji    │  ← 主agent
│                 │
└─────────────────┘
         │
         ├─→ 🗂 read_file  2.3s  ← timelineEvents（蓝色）
         ├─→ 🤖 task      19.2s
         └─→ 🗜️ 压缩上下文中...  ← currentMoment（灰色，碰撞避让）
```

## 优势

1. **避免重复展示**：同一个操作不会同时出现在多个地方
2. **逻辑清晰**：
   - **思考气泡** = 思考内容（上方）
   - **timelineEvents** = 工具调用和有意义的操作（右侧堆栈）
   - **currentMoment** = 后台操作（右侧单个标签，碰撞避让）
3. **用户体验更好**：
   - 工具调用显示实时耗时
   - 完成后保留3秒自动消失
   - 思考内容展示在气泡中，更直观
   - 后台操作（compress）不会干扰工具堆栈
4. **可以同时展示**：
   - 思考气泡 + 工具堆栈
   - 工具堆栈 + 后台操作标签

## 验证清单

- [x] 工具调用只在timelineEvents中展示
- [x] Skill执行只在timelineEvents中展示
- [x] 记忆操作只在timelineEvents中展示
- [x] 思考状态只在思考气泡中展示（不使用currentMoment）
- [x] 压缩上下文只在currentMoment中展示
- [x] 不会出现重复展示
- [x] 工具堆栈显示实时耗时
- [x] 完成的工具3秒后自动消失
- [x] timelineEvents 和 currentMoment 可以同时展示
- [x] currentMoment 使用碰撞避让，不会和 timelineEvents 重叠
