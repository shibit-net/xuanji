# Moment 状态切换最终方案

## 问题根源

**为什么"思考中"可以显示，但"编写"和"汇报"不能显示？**

### 根本原因：findAgentById 找不到子 agent

在 `agent:subagent-end` 事件处理中，代码使用 `findAgentById` 查找子 agent：

```typescript
const subAgent = findAgentById(activeAgentStore.mainAgent, data.subAgentId);

if (subAgent) {
  // 设置 moment
} else {
  // 找不到！立即设置为 done 并清除 moment
  activeAgentStore.setAgentStatus(data.subAgentId, 'done');
  runtimeStore.finishAgentMoment(data.subAgentId);
}
```

**如果 `findAgentById` 找不到子 agent**（返回 `null`），就会走到 `else` 分支，**立即设置状态为 done 并清除 moment**，导致 moment 还没来得及显示就被清除了！

### 为什么"思考中"可以显示？

因为"思考中" moment 是在 `agent:subagent-start` 中设置的，**不依赖 `findAgentById`**：

```typescript
messageBus.on('agent:subagent-start', (data) => {
  // 直接设置，不需要查找
  runtimeStore.setAgentMoment(data.subAgentId, {
    type: 'thinking',
    icon: '🤔',
    label: '思考中',
  });
});
```

### 为什么 findAgentById 会找不到？

可能的原因：
1. **时序问题**：`agent:subagent-end` 触发时，`activeAgentStore.mainAgent` 还没有更新
2. **ID 不匹配**：子 agent 的 ID 格式不一致
3. **树结构问题**：子 agent 没有被正确添加到树中

## 最终解决方案

**核心思想**：使用 `writingAgents` Set 作为单一数据源，不依赖 `findAgentById` 和 `streamToUser` 字段。

### 完整流程

```typescript
// 全局 Set，追踪"编写"模式的 agent
const writingAgents = new Set<string>();

// 1. agent:subagent-start - 设置"思考中"
messageBus.on('agent:subagent-start', (data) => {
  runtimeStore.setAgentMoment(data.subAgentId, {
    type: 'thinking',
    icon: '🤔',
    label: '思考中',
  });
});

// 2. agent:subagent-text - 切换到"编写"
messageBus.on('agent:subagent-text', (data) => {
  if (!writingAgents.has(data.subAgentId)) {
    writingAgents.add(data.subAgentId);  // ← 添加到 Set
    runtimeStore.setAgentMoment(data.subAgentId, {
      type: 'writing',
      icon: '✍️',
      label: '编写',
    });
  }
});

// 3. agent:subagent-end - 显示最终状态
messageBus.on('agent:subagent-end', (data) => {
  const wasWriting = writingAgents.has(data.subAgentId);
  writingAgents.delete(data.subAgentId);  // ← 清理 Set

  if (wasWriting) {
    // 在 Set 中 → 编写完成
    runtimeStore.setAgentMoment(data.subAgentId, {
      type: 'writing',
      icon: '✍️',
      label: '编写完成',
    });
  } else {
    // 不在 Set 中 → 汇报
    runtimeStore.setAgentMoment(data.subAgentId, {
      type: 'reporting',
      icon: '📋',
      label: '汇报',
    });
  }

  // 延迟设置为 done
  setTimeout(() => {
    activeAgentStore.setAgentStatus(data.subAgentId, 'done');
    runtimeStore.finishAgentMoment(data.subAgentId);
  }, 1500);
});
```

### 状态流转

#### streamToUser=true（编写模式）
```
agent:subagent-start
  ↓
🤔 思考中
  ↓
agent:subagent-text（第一次）
  ↓
添加到 writingAgents Set
  ↓
✍️ 编写
  ↓
agent:subagent-text（后续）
  ↓
✍️ 编写（不重复设置）
  ↓
agent:subagent-end
  ↓
检查 Set：在 Set 中
  ↓
✍️ 编写完成（1.5秒）
  ↓
设置为 done，清除 moment
  ↓
消失
```

#### streamToUser=false（汇报模式）
```
agent:subagent-start
  ↓
🤔 思考中
  ↓
（没有 subagent-text 事件）
  ↓
agent:subagent-end
  ↓
检查 Set：不在 Set 中
  ↓
📋 汇报（1.5秒）
  ↓
设置为 done，清除 moment
  ↓
消失
```

## 优势

### 1. 简洁优雅
- ✅ 不依赖 `findAgentById`
- ✅ 不依赖 `streamToUser` 字段
- ✅ 使用 Set 作为单一数据源
- ✅ 逻辑清晰，易于理解

### 2. 可靠性高
- ✅ 避免了"找不到子 agent"的问题
- ✅ 避免了字段值不正确的问题
- ✅ 不受树结构更新时序的影响

### 3. 性能好
- ✅ Set 操作 O(1) 时间复杂度
- ✅ 避免了递归查找树结构
- ✅ 避免了重复设置 moment

## 对比

### 之前的方案（有问题）

```typescript
// ❌ 依赖 findAgentById
const subAgent = findAgentById(activeAgentStore.mainAgent, data.subAgentId);

if (subAgent) {
  // 设置 moment
} else {
  // 找不到！立即清除
  runtimeStore.finishAgentMoment(data.subAgentId);
}
```

**问题**：
- 如果找不到子 agent，moment 立即被清除
- 依赖树结构的更新时序
- 逻辑复杂，容易出错

### 现在的方案（优雅）

```typescript
// ✅ 使用 Set
const wasWriting = writingAgents.has(data.subAgentId);

if (wasWriting) {
  // 编写完成
} else {
  // 汇报
}
```

**优势**：
- 不依赖树结构
- 逻辑简单清晰
- 可靠性高

## 总结

**关键洞察**：
1. "思考中"可以显示，是因为不依赖 `findAgentById`
2. "编写"和"汇报"不能显示，是因为 `findAgentById` 找不到子 agent，导致 moment 被立即清除
3. 解决方案：使用 `writingAgents` Set 作为单一数据源，完全避免 `findAgentById`

**最终方案**：
- ✅ 简洁优雅
- ✅ 可靠性高
- ✅ 性能好
- ✅ 易于维护

现在 moment 状态切换应该能完美工作了！🎉
