# Moment 状态切换完整方案

## 问题分析

### 原始问题
子 agent 只显示"思考中"状态，没有显示"编写"和"汇报"状态。

### 根本原因
1. **立即设置为 done**：在 `agent:subagent-end` 时立即设置状态为 `done`，导致节点被 CanvasRenderer 过滤掉，moment 还没来得及显示就消失了
2. **立即清除 moment**：设置 moment 后立即调用 `finishAgentMoment` 清除，用户看不到

## 完整的状态流转

### 场景1：streamToUser=true（直接输出到对话框）

```
时间轴：
0s                    5s                    6.5s
|---------------------|---------------------|
🤔 思考中              ✍️ 编写完成            消失
                      ↑                     ↑
                      agent:subagent-end    延迟1.5s后
                                           setStatus('done')
```

**详细流程**：
1. `agent:subagent-start` → 状态：`thinking`，moment：🤔 思考中
2. 子 agent 执行，流式输出文本到对话框
3. `agent:subagent-end` → 切换 moment：✍️ 编写完成，**不设置状态为 done**
4. 1.5 秒后 → 设置状态为 `done`，清除 moment
5. CanvasRenderer 过滤掉 `done` 状态的 agent → 节点消失

### 场景2：streamToUser=false（返回给主 agent）

```
时间轴：
0s                    5s                    6.5s
|---------------------|---------------------|
🤔 思考中              📋 汇报                消失
                      ↑                     ↑
                      agent:subagent-end    延迟1.5s后
                                           setStatus('done')
```

**详细流程**：
1. `agent:subagent-start` → 状态：`thinking`，moment：🤔 思考中
2. 子 agent 执行，结果保存在内部
3. `agent:subagent-end` → 切换 moment：📋 汇报，**不设置状态为 done**
4. 1.5 秒后 → 设置状态为 `done`，清除 moment
5. CanvasRenderer 过滤掉 `done` 状态的 agent → 节点消失

## 关键代码

### agent:subagent-end 事件处理

```typescript
messageBus.on('agent:subagent-end', (data: {
  subAgentId: string;
  success: boolean;
  duration?: number;
}) => {
  // ❌ 不要立即设置状态为 done！
  // activeAgentStore.setAgentStatus(data.subAgentId, 'done');

  const runtimeStore = useRuntimeStore.getState();
  const subAgent = findAgentById(activeAgentStore.mainAgent, data.subAgentId);

  if (subAgent) {
    if (subAgent.streamToUser) {
      // 显示"编写完成"
      runtimeStore.setAgentMoment(data.subAgentId, {
        type: 'writing',
        icon: '✍️',
        label: '编写完成',
        durationMs: data.duration || 0,
        status: 'success',
      });
    } else {
      // 显示"汇报"
      runtimeStore.setAgentMoment(data.subAgentId, {
        type: 'reporting',
        icon: '📋',
        label: '汇报',
        durationMs: data.duration || 0,
        status: 'success',
      });
    }

    // ✅ 延迟设置状态为 done（1.5秒后）
    setTimeout(() => {
      activeAgentStore.setAgentStatus(data.subAgentId, 'done');
      runtimeStore.finishAgentMoment(data.subAgentId);
    }, 1500);
  }
});
```

## 为什么要延迟设置 done？

### 问题：立即设置 done 会导致节点消失

CanvasRenderer 的过滤逻辑：
```typescript
const visibleAgents = this.state.subAgents.filter(
  agent => agent.status !== 'success' && agent.status !== 'error' && agent.status !== 'done'
);
```

**如果立即设置 done**：
```
agent:subagent-end 触发
  ↓
setStatus('done')  ← 立即设置
  ↓
setAgentMoment({ type: 'reporting' })  ← 设置 moment
  ↓
CanvasRenderer 渲染
  ↓
过滤掉 status='done' 的 agent  ← 节点消失！
  ↓
moment 没有被渲染 ❌
```

**延迟设置 done**：
```
agent:subagent-end 触发
  ↓
setAgentMoment({ type: 'reporting' })  ← 先设置 moment
  ↓
CanvasRenderer 渲染
  ↓
status 还是 'thinking'，不会被过滤  ← 节点可见！
  ↓
渲染 moment ✅
  ↓
用户看到 📋 汇报（1.5秒）
  ↓
setTimeout 触发
  ↓
setStatus('done')  ← 延迟设置
  ↓
CanvasRenderer 渲染
  ↓
过滤掉 status='done' 的 agent  ← 节点消失
```

## 状态对照表

| 时间点 | 状态 | moment | 是否可见 | 用户看到 |
|--------|------|--------|----------|----------|
| 启动 | `thinking` | 🤔 思考中 | ✅ | 🤔 思考中 |
| 执行中 | `thinking` | 🤔 思考中 | ✅ | 🤔 思考中 |
| 完成（立即） | `thinking` | ✍️ 编写完成 / 📋 汇报 | ✅ | ✍️ 编写完成 / 📋 汇报 |
| 完成（1.5s后） | `done` | - | ❌ | 节点消失 |

## 为什么不在流式输出时切换 moment？

### 原始方案（废弃）
在 `agent:subagent-text` 事件中切换到"编写"状态：

**问题**：
1. `agent:subagent-text` 可能不会触发（如果没有文本输出）
2. 需要额外的状态管理（`writingAgents` Set）
3. 依赖事件触发顺序，不可靠

### 当前方案（推荐）
在 `agent:subagent-end` 时根据 `streamToUser` 决定显示哪个状态：

**优点**：
1. 逻辑简单，只在一个地方处理
2. 不依赖 `agent:subagent-text` 事件
3. 状态切换可靠

## 用户体验

### 之前（问题）
```
🤔 思考中 → 消失（看不到最终状态）
```

### 现在（修复后）
```
🤔 思考中 → ✍️ 编写完成（1.5秒） → 消失
或
🤔 思考中 → 📋 汇报（1.5秒） → 消失
```

用户可以清楚地看到：
1. 子 agent 正在执行（思考中）
2. 子 agent 完成了什么（编写完成/汇报）
3. 然后节点消失

## 相关文件

- `desktop/renderer/stores/chatStore.ts` - 主要修复文件
  - `agent:subagent-end` 事件处理
  - 延迟设置状态为 done
- `desktop/renderer/components/WorkspaceMonitor/CanvasRenderer.ts` - 过滤逻辑
  - 过滤掉 `done` 状态的 agent

## 总结

关键点：
1. ✅ **不要立即设置状态为 done**
2. ✅ **先设置最终的 moment**
3. ✅ **延迟 1.5 秒后再设置为 done**
4. ✅ **让用户看到最终状态后再消失**

这样既能显示最终状态，又能在适当的时候让节点消失。
