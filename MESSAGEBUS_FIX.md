# MessageBus自动转发修复

## 问题

发送消息后没有响应，WorkspaceMonitor也不显示。

## 原因分析

EnhancedMessageBus的自动转发功能有问题：

1. **原设计**：在`send`方法中转发消息到renderer
2. **实际情况**：从子进程（agent-bridge.ts）收到的消息是通过`handleMessage`处理的，不会触发`send`方法
3. **结果**：子进程发送的所有事件（agent:text, agent:thinking等）都没有转发到前端

## 解决方案

在EnhancedMessageBus的构造函数中监听`message`事件，自动转发所有从子进程收到的消息：

```typescript
constructor(options: EnhancedChannelOptions = {}) {
  super(options);
  this.autoForwardToRenderer = options.autoForwardToRenderer !== false;
  this.mainWindow = options.mainWindow || null;

  // 🔧 监听所有从子进程收到的消息，自动转发到renderer
  if (this.autoForwardToRenderer) {
    this.on('message', (msg: any) => {
      // 转发到renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        try {
          this.mainWindow.webContents.send(msg.type, msg.data);
          console.log(`[EnhancedMessageBus] 自动转发消息到renderer: ${msg.type}`);
        } catch (err) {
          console.error(`[EnhancedMessageBus] 转发到renderer失败 (${msg.type}):`, err);
        }
      }
    });
  }
}
```

## 消息流程

### 修复前 ❌
```
agent-bridge.ts (子进程)
  ↓ channel.send('agent:text', data)
MessageChannel.handleMessage (主进程)
  ↓ emit('message', msg)
  ↓ emit('agent:text', data)
EnhancedMessageBus
  ✗ 没有转发到renderer
```

### 修复后 ✅
```
agent-bridge.ts (子进程)
  ↓ channel.send('agent:text', data)
MessageChannel.handleMessage (主进程)
  ↓ emit('message', msg)
EnhancedMessageBus监听'message'事件
  ↓ mainWindow.webContents.send('agent:text', data)
RendererMessageBus (前端)
  ↓ window.electron.on('agent:text', ...)
chatStore.ts
  ↓ messageBus.on('agent:text', ...)
  ✓ 处理消息
```

## 测试验证

### 预期行为
1. 发送消息后，应该看到agent的响应
2. WorkspaceMonitor应该显示agent的状态
3. 控制台应该看到转发日志：
   ```
   [EnhancedMessageBus] 自动转发消息到renderer: agent:text
   [EnhancedMessageBus] 自动转发消息到renderer: agent:thinking
   [EnhancedMessageBus] 自动转发消息到renderer: agent:tool-start
   ...
   ```

### 测试步骤
1. 启动应用
2. 发送一条消息
3. 观察：
   - 是否有agent响应
   - WorkspaceMonitor是否显示
   - 控制台是否有转发日志

## 提交记录

```
74c385f fix: 修复EnhancedMessageBus自动转发功能
```

## 状态

✅ 已修复
🧪 待测试

---

修复时间：2026-04-24
状态：✅ 已完成
