# Handler 函数重构模板

所有 handler 函数需要遵循以下模式：

## 旧模式（使用 safeSend）

```typescript
async function handleXxx(requestId: string, data?: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  
  try {
    const result = await doSomething(data);
    safeSend({ requestId, data: { success: true, result } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err.message } });
  }
}
```

## 新模式（直接返回）

```typescript
async function handleXxx(data?: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  
  try {
    const result = await doSomething(data);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

## 特殊情况

### 1. 需要发送事件通知的函数

某些函数除了返回结果，还需要发送事件通知（如 handleSendMessage）：

```typescript
async function handleSendMessage(data: any) {
  if (!session) {
    // 发送事件
    safeSend({ type: 'send-result', data: { success: false, error: '会话未初始化' } });
    // 返回结果
    return { success: false, error: '会话未初始化' };
  }
  
  try {
    await session.run(data.message);
    // 发送事件
    safeSend({ type: 'send-result', data: { success: true } });
    // 返回结果
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // 发送事件
    safeSend({ type: 'send-result', data: { success: false, error } });
    // 返回结果
    return { success: false, error };
  }
}
```

### 2. 不需要返回值的函数

某些函数只需要执行操作，不需要返回值（如 handleInterrupt）：

```typescript
function handleInterrupt(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  
  const agentLoop = session.getAgentLoop();
  if (data.message) {
    agentLoop.interrupt(data.message);
  } else {
    agentLoop.stop();
  }
  
  return { success: true };
}
```

## 批量修改步骤

1. 修改函数签名：移除 `requestId` 参数
2. 将所有 `safeSend({ requestId, data: {...} })` 改为 `return {...}`
3. 确保所有分支都有返回值
4. 保留必要的事件通知（使用 safeSend 发送事件）
