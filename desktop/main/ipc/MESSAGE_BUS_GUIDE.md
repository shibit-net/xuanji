# MessageBus 消息总线系统

## 概述

MessageBus 是一个完整的主子进程消息管理系统，参考了 Electron IPC、gRPC 和 EventEmitter 的设计理念，提供：

- ✅ 双向通信（主进程 ↔ 子进程）
- ✅ 请求响应模式（RPC）
- ✅ 事件发布订阅模式
- ✅ 消息处理器注册
- ✅ 自动重试机制
- ✅ 超时控制
- ✅ 多通道管理
- ✅ 完整的日志系统

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                        MessageBus                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Channel 1  │  │   Channel 2  │  │   Channel N  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ↓                    ↓                    ↓
    ChildProcess 1      ChildProcess 2      ChildProcess N
         │                    │                    │
         ↓                    ↓                    ↓
┌─────────────────────────────────────────────────────────────┐
│              ChildMessageChannel (子进程端)                  │
└─────────────────────────────────────────────────────────────┘
```

## 核心概念

### 1. MessageChannel（主进程端）

主进程端的消息通道，用于与子进程通信。

**特性：**
- 绑定子进程
- 发送消息/请求
- 注册消息处理器
- 自动重试
- 超时控制

### 2. ChildMessageChannel（子进程端）

子进程端的消息通道，用于与主进程通信。

**特性：**
- 接收消息
- 发送响应
- 注册消息处理器
- 事件触发

### 3. MessageBus（消息总线）

管理多个消息通道的总线系统。

**特性：**
- 创建/删除通道
- 通道隔离
- 统一管理

## 使用指南

### 主进程端

#### 1. 基本使用（单通道）

```typescript
import { messageChannel } from './ipc/MessageBus';

// 绑定子进程
const childProcess = spawn('node', ['child.js']);
messageChannel.attach(childProcess);

// 发送消息（不等待响应）
messageChannel.send('hello', { message: 'Hello World' });

// 发送请求（等待响应）
const result = await messageChannel.request('get-data', { id: 123 });
console.log('收到响应:', result);

// 监听事件
messageChannel.on('child-ready', (data) => {
  console.log('子进程已就绪:', data);
});

// 注册消息处理器
messageChannel.handle('ping', async (data) => {
  console.log('收到 ping:', data);
  return { pong: true };
});
```

#### 2. 多通道管理

```typescript
import { messageBus } from './ipc/MessageBus';

// 创建多个通道
const agentChannel = messageBus.createChannel('agent', {
  timeout: 30000,
  maxRetries: 3,
});

const workerChannel = messageBus.createChannel('worker', {
  timeout: 10000,
  maxRetries: 1,
});

// 绑定不同的子进程
agentChannel.attach(agentProcess);
workerChannel.attach(workerProcess);

// 使用不同的通道
const agentData = await agentChannel.request('agent-list');
const workerData = await workerChannel.request('process-task', { task: 'build' });

// 获取通道
const channel = messageBus.getChannel('agent');

// 删除通道
messageBus.deleteChannel('worker');
```

#### 3. 高级功能

```typescript
// 自定义超时和重试
const result = await messageChannel.request(
  'heavy-task',
  { data: 'large' },
  60000,  // 60秒超时
  5       // 最多重试5次
);

// 取消请求
const requestId = 'req_123';
messageChannel.cancelRequest(requestId);

// 取消所有请求
messageChannel.cancelAllRequests();

// 查看待处理请求
const pending = messageChannel.getPendingRequests();
console.log('待处理请求:', pending);

// 检查连接状态
if (messageChannel.isConnected()) {
  console.log('子进程已连接');
}
```

### 子进程端

#### 1. 基本使用

```typescript
import { childMessageChannel } from './ipc/MessageBus';

// 发送消息
childMessageChannel.send('child-ready', { pid: process.pid });

// 注册消息处理器
childMessageChannel.handle('get-data', async (data) => {
  const result = await fetchData(data.id);
  return { success: true, data: result };
});

// 监听事件（兼容旧代码）
childMessageChannel.on('shutdown', () => {
  console.log('收到关闭信号');
  process.exit(0);
});
```

#### 2. 处理请求

```typescript
// 同步处理器
childMessageChannel.handle('ping', (data) => {
  return { pong: true, timestamp: Date.now() };
});

// 异步处理器
childMessageChannel.handle('agent-list', async (data) => {
  const agents = await getAgentList();
  return { success: true, agents };
});

// 错误处理（自动返回错误响应）
childMessageChannel.handle('risky-operation', async (data) => {
  if (!data.authorized) {
    throw new Error('未授权');
  }
  return { success: true };
});
```

## 消息模式

### 1. 单向消息（Fire and Forget）

```typescript
// 主进程
messageChannel.send('log', { level: 'info', message: 'Hello' });

// 子进程
childMessageChannel.on('log', (data) => {
  console.log(`[${data.level}] ${data.message}`);
});
```

### 2. 请求响应（Request-Response / RPC）

```typescript
// 主进程
const result = await messageChannel.request('calculate', { a: 1, b: 2 });
console.log('结果:', result); // { sum: 3 }

// 子进程
childMessageChannel.handle('calculate', (data) => {
  return { sum: data.a + data.b };
});
```

### 3. 事件发布订阅（Pub-Sub）

```typescript
// 主进程（订阅）
messageChannel.on('progress', (data) => {
  console.log(`进度: ${data.percent}%`);
});

// 子进程（发布）
for (let i = 0; i <= 100; i += 10) {
  childMessageChannel.send('progress', { percent: i });
  await sleep(100);
}
```

## 最佳实践

### 1. 通道命名

```typescript
// ✅ 好的命名
const agentChannel = messageBus.createChannel('agent');
const workerChannel = messageBus.createChannel('worker');
const dbChannel = messageBus.createChannel('database');

// ❌ 不好的命名
const channel1 = messageBus.createChannel('ch1');
const temp = messageBus.createChannel('temp');
```

### 2. 错误处理

```typescript
// ✅ 使用 try-catch
try {
  const result = await messageChannel.request('risky-operation');
} catch (err) {
  console.error('操作失败:', err.message);
}

// ✅ 处理器中抛出错误
childMessageChannel.handle('validate', (data) => {
  if (!data.valid) {
    throw new Error('验证失败');
  }
  return { success: true };
});
```

### 3. 超时设置

```typescript
// ✅ 根据操作类型设置合理的超时
const quickResult = await messageChannel.request('ping', {}, 5000);
const slowResult = await messageChannel.request('build', {}, 300000);

// ✅ 创建通道时设置默认超时
const fastChannel = messageBus.createChannel('fast', { timeout: 5000 });
const slowChannel = messageBus.createChannel('slow', { timeout: 60000 });
```

### 4. 资源清理

```typescript
// ✅ 应用退出时清理
process.on('exit', () => {
  messageBus.cleanup();
});

// ✅ 不再使用时解绑
messageChannel.detach();
```

## 迁移指南

### 从旧的消息系统迁移

#### 旧代码：
```typescript
// 发送消息
process.send({ type: 'hello', data: { message: 'Hi' } });

// 监听消息
process.on('message', (msg) => {
  if (msg.type === 'hello') {
    console.log(msg.data);
  }
});
```

#### 新代码：
```typescript
// 发送消息
childMessageChannel.send('hello', { message: 'Hi' });

// 注册处理器
childMessageChannel.handle('hello', (data) => {
  console.log(data);
});
```

## 调试

### 启用日志

```typescript
// 创建通道时启用日志
const channel = messageBus.createChannel('debug', {
  enableLogging: true,
});

// 日志输出示例：
// [debug] 发送消息: hello { message: 'Hi' }
// [debug] 收到消息: world { response: 'Hello' }
// [debug] 请求超时，重试 1/3: get-data
```

### 查看待处理请求

```typescript
const pending = messageChannel.getPendingRequests();
console.log('待处理请求:', pending);
// [
//   { requestId: 'req_123', type: 'get-data', retryCount: 1, age: 5000 },
//   { requestId: 'req_124', type: 'process', retryCount: 0, age: 1000 }
// ]
```

## 性能优化

1. **批量消息**：合并多个小消息为一个大消息
2. **通道隔离**：不同类型的任务使用不同的通道
3. **合理的超时**：避免过长或过短的超时时间
4. **限制重试**：对于不重要的操作，设置较少的重试次数

## 常见问题

### Q: 如何处理子进程崩溃？

```typescript
messageChannel.on('process-exit', ({ code, signal }) => {
  console.error('子进程退出:', code, signal);
  // 重启子进程
  restartChildProcess();
});
```

### Q: 如何实现双向 RPC？

```typescript
// 主进程可以调用子进程
const result1 = await messageChannel.request('child-method', data);

// 子进程也可以调用主进程（需要主进程注册处理器）
messageChannel.handle('parent-method', async (data) => {
  return { result: 'from parent' };
});
```

### Q: 如何处理大数据传输？

```typescript
// 使用流式传输或分块传输
for (const chunk of largeData) {
  messageChannel.send('data-chunk', { chunk, index: i });
}
messageChannel.send('data-complete');
```

## 总结

MessageBus 提供了一个完整、成熟的消息管理系统，支持：

- ✅ 多种消息模式（单向、请求响应、发布订阅）
- ✅ 自动重试和超时控制
- ✅ 多通道管理和隔离
- ✅ 完整的错误处理
- ✅ 易于调试和监控
- ✅ 向后兼容

使用 MessageBus 可以大大简化主子进程通信的复杂度，提高代码的可维护性和可靠性。
