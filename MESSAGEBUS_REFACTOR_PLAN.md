# MessageBus 重构计划

## 阶段一：准备工作（1-2天）

### 1.1 创建重构分支
```bash
git checkout -b refactor/messagebus-unification
```

### 1.2 分析现有事件类型
- [ ] 列出所有通过 `channel.send` 发送的事件
- [ ] 列出所有通过 `window.electron.on` 监听的事件
- [ ] 列出所有在 `forwardTypes` 中的事件
- [ ] 创建完整的事件清单文档

### 1.3 设计统一的事件接口
```typescript
// desktop/main/ipc/EventTypes.ts
export interface AgentEvent {
  type: string;
  data: any;
  timestamp: number;
  source?: 'main' | 'child' | 'renderer';
}

export type AgentEventType = 
  | 'agent:text'
  | 'agent:thinking'
  | 'agent:tool-start'
  | 'agent:tool-end'
  | 'agent:subagent-start'
  | 'agent:subagent-end'
  | 'agent:team-start'
  | 'agent:team-member-start'
  | 'agent:team-member-end'
  // ... 其他事件类型
  ;
```

---

## 阶段二：增强MessageBus（2-3天）

### 2.1 扩展主进程MessageBus
**文件**: `desktop/main/ipc/MessageBus.ts`

- [ ] 添加事件订阅机制
```typescript
class MessageBus {
  private eventHandlers = new Map<string, Set<(data: any) => void>>();
  
  // 订阅事件
  subscribe(eventType: string, handler: (data: any) => void): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
    
    // 返回取消订阅函数
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }
  
  // 发布事件
  publish(eventType: string, data: any): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }
}
```

- [ ] 添加自动转发到renderer的机制
```typescript
class MessageBus {
  private autoForwardToRenderer = true;
  
  // 发送消息时自动转发到renderer
  send(type: string, data: any): void {
    // 发送到子进程
    super.send(type, data);
    
    // 自动转发到renderer
    if (this.autoForwardToRenderer && this.mainWindow) {
      this.mainWindow.webContents.send(type, data);
    }
  }
}
```

### 2.2 创建renderer端MessageBus
**文件**: `desktop/renderer/utils/MessageBus.ts`

```typescript
class RendererMessageBus {
  private handlers = new Map<string, Set<(data: any) => void>>();
  
  constructor() {
    // 监听所有来自主进程的消息
    this.setupIpcListener();
  }
  
  private setupIpcListener() {
    // 通过preload暴露的通用监听器
    window.electron.onMessage((type: string, data: any) => {
      this.dispatch(type, data);
    });
  }
  
  // 订阅事件
  on(eventType: string, handler: (data: any) => void): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }
  
  // 分发事件
  private dispatch(eventType: string, data: any): void {
    console.log('[RendererMessageBus] 分发事件:', eventType, data);
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error('[RendererMessageBus] 事件处理器错误:', err);
        }
      });
    }
  }
  
  // 发送消息到主进程
  send(type: string, data: any): Promise<any> {
    return window.electron.sendMessage(type, data);
  }
}

export const messageBus = new RendererMessageBus();
```

### 2.3 更新preload.ts
**文件**: `desktop/main/preload.ts`

- [ ] 添加通用消息监听器
```typescript
contextBridge.exposeInMainWorld('electron', {
  // ... 现有方法
  
  // 通用消息监听（替代所有 on 方法）
  onMessage: (callback: (type: string, data: any) => void) => {
    const handler = (_event: any, type: string, data: any) => {
      callback(type, data);
    };
    ipcRenderer.on('message', handler);
    return () => ipcRenderer.removeListener('message', handler);
  },
  
  // 发送消息到主进程
  sendMessage: (type: string, data: any) => {
    return ipcRenderer.invoke('message', { type, data });
  },
});
```

---

## 阶段三：迁移agent-bridge.ts（2-3天）

### 3.1 替换safeSend
**文件**: `desktop/main/agent-bridge.ts`

**当前代码**：
```typescript
function safeSend(message: { type: string; data?: any }) {
  channel.send(message.type, message.data);
}
```

**修改为**：
```typescript
function safeSend(message: { type: string; data?: any }) {
  // 使用MessageBus发送，会自动转发到renderer
  messageBus.send(message.type, message.data);
}
```

### 3.2 迁移所有Hook监听器
- [ ] SubAgentStart
- [ ] SubAgentEnd
- [ ] TeamStart
- [ ] TeamMemberStart
- [ ] TeamMemberEnd
- [ ] ModelClassifierStart
- [ ] ModelClassifierEnd
- [ ] 其他所有Hook

**示例**：
```typescript
hookRegistry.addListener('SubAgentStart', async (ctx: any) => {
  messageBus.send('agent:subagent-start', {
    subAgentId: ctx.subAgentId,
    name: ctx.data?.name,
    role: ctx.data?.role,
    task: ctx.data?.task,
    agentType: ctx.data?.agentType,
    parentId: ctx.data?.parentAgentId,
  });
  return { success: true };
});
```

---

## 阶段四：迁移renderer端监听器（3-4天）

### 4.1 迁移chatStore.ts
**文件**: `desktop/renderer/stores/chatStore.ts`

**当前代码**：
```typescript
window.electron.on('agent:subagent-start', (data) => {
  // 处理逻辑
});
```

**修改为**：
```typescript
import { messageBus } from '@/utils/MessageBus';

messageBus.on('agent:subagent-start', (data) => {
  // 处理逻辑
});
```

### 4.2 迁移所有事件监听器
- [ ] agent:text
- [ ] agent:thinking
- [ ] agent:tool-start
- [ ] agent:tool-end
- [ ] agent:subagent-start
- [ ] agent:subagent-end
- [ ] agent:team-start
- [ ] agent:team-member-start
- [ ] agent:team-member-end
- [ ] agent:file-changes
- [ ] agent:usage
- [ ] agent:error
- [ ] agent:end
- [ ] workspace:* 事件
- [ ] permission:request
- [ ] plan-review:request
- [ ] ask-user:request
- [ ] 其他所有事件

### 4.3 清理旧的监听器注册代码
- [ ] 删除 `removeAllListeners` 调用
- [ ] 删除 `window.electron.on` 调用
- [ ] 删除 `window.electron.onAgentText` 等专用方法调用

---

## 阶段五：清理agent/index.ts（1天）

### 5.1 删除手动转发逻辑
**文件**: `desktop/main/agent/index.ts`

- [ ] 删除 `forwardTypes` 列表
- [ ] 删除 `forwardToRenderer` 函数
- [ ] 删除所有 `forwardTypes.forEach(forwardToRenderer)` 调用

**原因**：MessageBus会自动转发所有消息到renderer

### 5.2 简化初始化逻辑
```typescript
// 简化后的代码
export async function initChatSession(userId: string): Promise<void> {
  // 创建MessageBus连接到子进程
  const agentChannel = new ChildMessageChannel({
    name: 'agent-child',
    enableLogging: true,
  });
  
  // 发送初始化消息
  agentChannel.send('init', { userId });
  
  // 等待子进程就绪
  await waitForChildReady(agentChannel);
}
```

---

## 阶段六：测试与验证（2-3天）

### 6.1 单元测试
- [ ] MessageBus订阅/发布机制
- [ ] 事件自动转发
- [ ] 错误处理

### 6.2 集成测试
- [ ] task工具调用子agent
- [ ] agent_team工具调用团队成员
- [ ] 所有workspace事件
- [ ] 权限请求事件
- [ ] 文件变更事件

### 6.3 手动测试清单
- [ ] 主agent执行工具
- [ ] task创建子agent
- [ ] agent_team创建团队
- [ ] WorkspaceMonitor显示正确
- [ ] 意图分析显示正确
- [ ] 模型分类显示正确
- [ ] 权限请求正常工作
- [ ] 文件变更通知正常
- [ ] 错误处理正常

### 6.4 性能测试
- [ ] 消息延迟测试
- [ ] 大量事件并发测试
- [ ] 内存泄漏检查

---

## 阶段七：文档与清理（1天）

### 7.1 更新文档
- [ ] 更新架构文档
- [ ] 更新事件列表文档
- [ ] 添加MessageBus使用指南
- [ ] 更新开发者文档

### 7.2 代码清理
- [ ] 删除废弃的IPC方法
- [ ] 删除废弃的preload方法
- [ ] 统一日志格式
- [ ] 添加类型定义

### 7.3 性能优化
- [ ] 事件批处理
- [ ] 消息去重
- [ ] 订阅管理优化

---

## 风险评估与应对

### 风险1：事件丢失
**风险等级**：高
**应对措施**：
- 在MessageBus中添加事件队列
- 添加重试机制
- 添加详细的日志记录

### 风险2：性能下降
**风险等级**：中
**应对措施**：
- 性能基准测试
- 事件批处理
- 异步处理优化

### 风险3：兼容性问题
**风险等级**：中
**应对措施**：
- 保留旧的IPC方法作为fallback
- 渐进式迁移
- 充分的测试覆盖

### 风险4：调试困难
**风险等级**：低
**应对措施**：
- 添加详细的日志
- 开发调试工具
- 事件追踪机制

---

## 回滚计划

如果重构出现严重问题，可以快速回滚：

1. **保留旧代码**：在删除前先注释，不要直接删除
2. **功能开关**：添加配置项控制是否使用新的MessageBus
3. **分支管理**：保持master分支稳定，在feature分支开发
4. **备份测试**：重构前创建完整的测试用例

---

## 时间估算

| 阶段 | 预计时间 | 依赖 |
|------|---------|------|
| 阶段一：准备工作 | 1-2天 | - |
| 阶段二：增强MessageBus | 2-3天 | 阶段一 |
| 阶段三：迁移agent-bridge | 2-3天 | 阶段二 |
| 阶段四：迁移renderer | 3-4天 | 阶段二 |
| 阶段五：清理agent/index | 1天 | 阶段三、四 |
| 阶段六：测试验证 | 2-3天 | 阶段五 |
| 阶段七：文档清理 | 1天 | 阶段六 |
| **总计** | **12-17天** | |

---

## 成功标准

重构完成后应达到以下标准：

1. ✅ 所有事件通过MessageBus传递
2. ✅ 不再需要手动维护forwardTypes列表
3. ✅ 所有功能正常工作
4. ✅ 性能不低于重构前
5. ✅ 代码更简洁、可维护性更高
6. ✅ 完整的测试覆盖
7. ✅ 完善的文档

---

## 下一步行动

1. **Review这个计划**：确认是否有遗漏或需要调整的地方
2. **创建重构分支**：`git checkout -b refactor/messagebus-unification`
3. **开始阶段一**：分析现有事件类型，创建事件清单
4. **每日同步**：每天结束时同步进度和遇到的问题

准备好开始了吗？
