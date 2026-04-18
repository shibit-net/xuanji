# P2 集成示例 - 如何使用公共模块

本文档展示如何将 P2 阶段的公共模块（EventBus、MessageBus、MiddlewarePipeline）集成到现有代码中。

---

## 1. ToolRegistry 集成 MiddlewarePipeline

### 改造前
```typescript
// src/core/tools/ToolRegistry.ts
export class ToolRegistry {
  async executeTool(name: string, args: any): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`工具不存在: ${name}`);
    }
    
    // 权限检查
    const allowed = await this.permissionController.checkPermission({
      action: name,
      resource: args
    });
    if (!allowed) {
      throw new PermissionDeniedError(`权限被拒绝: ${name}`);
    }
    
    // 日志记录
    logger.info(`[${name}] 开始执行`, args);
    const start = Date.now();
    
    try {
      const result = await tool.execute(args);
      const duration = Date.now() - start;
      logger.info(`[${name}] 执行成功 (${duration}ms)`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error(`[${name}] 执行失败 (${duration}ms)`, error);
      throw error;
    }
  }
}
```

### 改造后
```typescript
// src/core/tools/ToolRegistry.ts
import { 
  MiddlewarePipeline, 
  PermissionMiddleware, 
  LoggingMiddleware,
  ErrorHandlingMiddleware,
  TimeoutMiddleware
} from '@/infrastructure/middleware';

export class ToolRegistry {
  private pipeline: MiddlewarePipeline<ToolContext, ToolResult>;
  
  constructor(
    private permissionController: IPermissionController,
    private config: ToolConfig
  ) {
    // 初始化中间件管道
    this.pipeline = new MiddlewarePipeline<ToolContext, ToolResult>();
    
    // 按顺序添加中间件
    this.pipeline
      .use(new ErrorHandlingMiddleware())           // 最外层：错误处理
      .use(new LoggingMiddleware())                 // 日志记录
      .use(new TimeoutMiddleware(config.timeout))   // 超时控制
      .use(new PermissionMiddleware(permissionController)); // 权限检查
  }
  
  async executeTool(name: string, args: any): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`工具不存在: ${name}`);
    }
    
    const context: ToolContext = {
      toolName: name,
      args,
      timestamp: new Date()
    };
    
    // 通过管道执行
    return this.pipeline.execute(context, async () => {
      return await tool.execute(args);
    });
  }
}
```

**优势**:
- 消除了 50+ 行重复代码
- 中间件可配置、可复用
- 易于添加新的横切关注点（缓存、重试等）

---

## 2. AgentLoop 集成 MessageBus

### 改造前
```typescript
// src/core/agent/AgentLoop.ts
export class AgentLoop {
  private messages: Message[] = [];
  
  async run(input: string): Promise<void> {
    // 添加用户消息
    this.messages.push({
      role: 'user',
      content: input,
      timestamp: new Date()
    });
    
    // 调用 LLM
    const response = await this.provider.chat(this.messages);
    
    // 添加助手消息
    this.messages.push({
      role: 'assistant',
      content: response.content,
      timestamp: new Date()
    });
    
    // 保存到会话
    await this.sessionManager.saveMessages(this.messages);
  }
  
  getHistory(): Message[] {
    return [...this.messages];
  }
  
  getRecent(count: number): Message[] {
    return this.messages.slice(-count);
  }
}
```

### 改造后
```typescript
// src/core/agent/AgentLoop.ts
import { MessageBus } from '@/infrastructure/messaging';

export class AgentLoop {
  private messageBus: MessageBus;
  
  constructor(
    private provider: ILLMProvider,
    private sessionManager: ISessionManager
  ) {
    this.messageBus = new MessageBus();
    
    // 订阅消息变化，自动保存
    this.messageBus.subscribe(async (message) => {
      await this.sessionManager.saveMessage(message);
    });
  }
  
  async run(input: string): Promise<void> {
    // 发布用户消息
    this.messageBus.publish({
      role: 'user',
      content: input,
      timestamp: new Date()
    });
    
    // 调用 LLM
    const response = await this.provider.chat(this.messageBus.getHistory());
    
    // 发布助手消息
    this.messageBus.publish({
      role: 'assistant',
      content: response.content,
      timestamp: new Date()
    });
  }
  
  getHistory(): Message[] {
    return this.messageBus.getHistory();
  }
  
  getRecent(count: number): Message[] {
    return this.messageBus.getRecent(count);
  }
}
```

**优势**:
- 消息管理逻辑统一
- 自动触发持久化
- 支持多个订阅者（日志、分析、UI 更新等）

---

## 3. PermissionController 集成 EventBus

### 改造前
```typescript
// src/permission/PermissionController.ts
export class PermissionController {
  async checkPermission(request: PermissionRequest): Promise<boolean> {
    const decision = await this.policy.evaluate(request);
    
    // 记录审计日志
    await this.audit.log({
      action: request.action,
      resource: request.resource,
      decision,
      timestamp: new Date()
    });
    
    // 如果需要确认
    if (decision === 'confirm') {
      const confirmed = await this.confirmation.confirm(request);
      
      // 再次记录
      await this.audit.log({
        action: request.action,
        resource: request.resource,
        decision: confirmed ? 'granted' : 'denied',
        timestamp: new Date()
      });
      
      return confirmed;
    }
    
    return decision === 'granted';
  }
}
```

### 改造后
```typescript
// src/permission/PermissionController.ts
import { EventBus } from '@/infrastructure/messaging';

export class PermissionController {
  private eventBus: EventBus;
  
  constructor(
    private policy: IPermissionPolicy,
    private audit: IPermissionAudit,
    private confirmation: IConfirmationService
  ) {
    this.eventBus = new EventBus();
    
    // 订阅权限事件，自动记录审计日志
    this.eventBus.on('permission:evaluated', async (event) => {
      await this.audit.log({
        action: event.request.action,
        resource: event.request.resource,
        decision: event.decision,
        timestamp: new Date()
      });
    });
    
    this.eventBus.on('permission:confirmed', async (event) => {
      await this.audit.log({
        action: event.request.action,
        resource: event.request.resource,
        decision: event.confirmed ? 'granted' : 'denied',
        timestamp: new Date()
      });
    });
  }
  
  async checkPermission(request: PermissionRequest): Promise<boolean> {
    const decision = await this.policy.evaluate(request);
    
    // 发布评估事件
    await this.eventBus.emit('permission:evaluated', { request, decision });
    
    if (decision === 'confirm') {
      const confirmed = await this.confirmation.confirm(request);
      
      // 发布确认事件
      await this.eventBus.emit('permission:confirmed', { request, confirmed });
      
      return confirmed;
    }
    
    return decision === 'granted';
  }
}
```

**优势**:
- 解耦审计逻辑
- 支持多个事件监听器（统计、通知、UI 更新等）
- 易于扩展新的事件处理器

---

## 4. ConfigService 集成 EventBus

### 改造前
```typescript
// src/infrastructure/config/ConfigService.ts
export class ConfigService {
  private watchers = new Map<string, ConfigWatcher[]>();
  
  set(key: string, value: any): void {
    const oldValue = this.get(key);
    this.runtimeSource.set(key, value);
    
    // 通知所有监听器
    const keyWatchers = this.watchers.get(key) || [];
    for (const watcher of keyWatchers) {
      watcher(value, oldValue);
    }
  }
  
  watch(key: string, callback: ConfigWatcher): () => void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, []);
    }
    this.watchers.get(key)!.push(callback);
    
    return () => {
      const watchers = this.watchers.get(key) || [];
      const index = watchers.indexOf(callback);
      if (index > -1) {
        watchers.splice(index, 1);
      }
    };
  }
}
```

### 改造后
```typescript
// src/infrastructure/config/ConfigService.ts
import { EventBus } from '@/infrastructure/messaging';

export class ConfigService {
  private eventBus: EventBus;
  
  constructor(sources: IConfigSource[]) {
    this.eventBus = new EventBus();
    this.sources = sources.sort((a, b) => b.priority - a.priority);
  }
  
  set(key: string, value: any): void {
    const oldValue = this.get(key);
    this.runtimeSource.set(key, value);
    
    // 发布配置变更事件
    this.eventBus.emit('config:changed', {
      key,
      value,
      oldValue,
      timestamp: new Date()
    });
  }
  
  watch(key: string, callback: ConfigWatcher): () => void {
    return this.eventBus.on('config:changed', (event) => {
      if (event.key === key) {
        callback(event.value, event.oldValue);
      }
    });
  }
  
  watchAll(callback: (event: ConfigChangeEvent) => void): () => void {
    return this.eventBus.on('config:changed', callback);
  }
}
```

**优势**:
- 统一事件机制
- 支持全局配置监听
- 易于添加配置变更日志、持久化等功能

---

## 5. SessionManager 集成 EventBus + MessageBus

### 改造前
```typescript
// src/session/SessionManager.ts
export class SessionManager {
  private messages: Message[] = [];
  private listeners: Array<(event: SessionEvent) => void> = [];
  
  async start(): Promise<void> {
    // 通知监听器
    for (const listener of this.listeners) {
      listener({ type: 'start', timestamp: new Date() });
    }
  }
  
  async addMessage(message: Message): Promise<void> {
    this.messages.push(message);
    await this.storage.save(this.sessionId, this.messages);
  }
  
  onEvent(listener: (event: SessionEvent) => void): void {
    this.listeners.push(listener);
  }
}
```

### 改造后
```typescript
// src/session/SessionManager.ts
import { EventBus, MessageBus } from '@/infrastructure/messaging';

export class SessionManager {
  private eventBus: EventBus;
  private messageBus: MessageBus;
  
  constructor(
    private sessionId: string,
    private storage: IStorage<Message[]>
  ) {
    this.eventBus = new EventBus();
    this.messageBus = new MessageBus();
    
    // 订阅消息变化，自动持久化
    this.messageBus.subscribe(async () => {
      await this.storage.save(this.sessionId, this.messageBus.getHistory());
    });
  }
  
  async start(): Promise<void> {
    await this.eventBus.emit('session:start', {
      sessionId: this.sessionId,
      timestamp: new Date()
    });
  }
  
  async addMessage(message: Message): Promise<void> {
    this.messageBus.publish(message);
  }
  
  onEvent(eventName: string, listener: (event: any) => void): () => void {
    return this.eventBus.on(eventName, listener);
  }
  
  getMessages(): Message[] {
    return this.messageBus.getHistory();
  }
}
```

**优势**:
- 消息管理和事件管理分离
- 自动持久化
- 类型安全的事件订阅

---

## 6. 完整示例：工具执行流程

展示如何组合使用所有 P2 组件：

```typescript
// src/core/tools/ToolExecutor.ts
import { 
  EventBus, 
  MessageBus, 
  MiddlewarePipeline,
  PermissionMiddleware,
  LoggingMiddleware,
  ErrorHandlingMiddleware,
  TimeoutMiddleware,
  RetryMiddleware,
  CacheMiddleware
} from '@/infrastructure';

export class ToolExecutor {
  private eventBus: EventBus;
  private messageBus: MessageBus;
  private pipeline: MiddlewarePipeline<ToolContext, ToolResult>;
  
  constructor(
    private registry: ToolRegistry,
    private permissionController: IPermissionController,
    private config: ToolConfig
  ) {
    // 初始化事件总线
    this.eventBus = new EventBus();
    
    // 初始化消息总线
    this.messageBus = new MessageBus();
    
    // 初始化中间件管道
    this.pipeline = new MiddlewarePipeline<ToolContext, ToolResult>();
    this.pipeline
      .use(new ErrorHandlingMiddleware())
      .use(new LoggingMiddleware())
      .use(new TimeoutMiddleware(config.timeout))
      .use(new RetryMiddleware(config.maxRetries))
      .use(new CacheMiddleware(config.cacheTTL))
      .use(new PermissionMiddleware(permissionController));
    
    // 订阅工具事件
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    // 工具执行前
    this.eventBus.on('tool:before', async (event) => {
      this.messageBus.publish({
        role: 'system',
        content: `执行工具: ${event.toolName}`,
        timestamp: new Date()
      });
    });
    
    // 工具执行后
    this.eventBus.on('tool:after', async (event) => {
      this.messageBus.publish({
        role: 'system',
        content: `工具执行完成: ${event.toolName}`,
        timestamp: new Date()
      });
    });
    
    // 工具执行失败
    this.eventBus.on('tool:error', async (event) => {
      this.messageBus.publish({
        role: 'system',
        content: `工具执行失败: ${event.toolName} - ${event.error.message}`,
        timestamp: new Date()
      });
    });
  }
  
  async execute(toolName: string, args: any): Promise<ToolResult> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      throw new Error(`工具不存在: ${toolName}`);
    }
    
    const context: ToolContext = {
      toolName,
      args,
      timestamp: new Date()
    };
    
    // 发布执行前事件
    await this.eventBus.emit('tool:before', { toolName, args });
    
    try {
      // 通过管道执行
      const result = await this.pipeline.execute(context, async () => {
        return await tool.execute(args);
      });
      
      // 发布执行后事件
      await this.eventBus.emit('tool:after', { toolName, result });
      
      return result;
    } catch (error) {
      // 发布错误事件
      await this.eventBus.emit('tool:error', { toolName, error });
      throw error;
    }
  }
  
  // 获取执行历史
  getHistory(): Message[] {
    return this.messageBus.getHistory();
  }
  
  // 订阅工具事件
  onToolEvent(eventName: string, handler: (event: any) => void): () => void {
    return this.eventBus.on(eventName, handler);
  }
}
```

**使用示例**:
```typescript
const executor = new ToolExecutor(registry, permissionController, config);

// 订阅工具事件
executor.onToolEvent('tool:before', (event) => {
  console.log('即将执行:', event.toolName);
});

executor.onToolEvent('tool:error', (event) => {
  console.error('执行失败:', event.error);
});

// 执行工具
const result = await executor.execute('read', { path: '/path/to/file' });

// 查看执行历史
const history = executor.getHistory();
```

---

## 7. 迁移检查清单

### 7.1 识别可迁移代码

- [ ] 查找重复的权限检查代码 → 使用 PermissionMiddleware
- [ ] 查找重复的日志记录代码 → 使用 LoggingMiddleware
- [ ] 查找重复的错误处理代码 → 使用 ErrorHandlingMiddleware
- [ ] 查找消息数组管理代码 → 使用 MessageBus
- [ ] 查找事件监听器管理代码 → 使用 EventBus

### 7.2 迁移步骤

1. **引入依赖**
   ```typescript
   import { EventBus, MessageBus, MiddlewarePipeline } from '@/infrastructure';
   ```

2. **初始化组件**
   ```typescript
   private eventBus = new EventBus();
   private messageBus = new MessageBus();
   private pipeline = new MiddlewarePipeline();
   ```

3. **替换重复代码**
   - 删除原有的权限检查、日志记录等代码
   - 使用中间件管道包装核心逻辑
   - 使用事件总线替代直接调用

4. **测试验证**
   - 确保功能行为一致
   - 验证事件正确触发
   - 检查日志输出

### 7.3 兼容性注意事项

- **MessageBus** 的 `getHistory()` 返回副本，不会影响内部状态
- **EventBus** 的事件处理器是异步的，注意错误处理
- **MiddlewarePipeline** 按添加顺序执行，注意中间件顺序

---

## 8. 性能优化建议

### 8.1 EventBus 优化
```typescript
// 使用优先级避免不必要的处理
eventBus.on('tool:after', handler, { priority: 100 }); // 高优先级

// 使用 once 避免内存泄漏
eventBus.once('session:end', cleanup);
```

### 8.2 MessageBus 优化
```typescript
// 定期清理历史消息
setInterval(() => {
  const old = messageBus.getHistory({ before: oneWeekAgo });
  // 归档或删除
}, 24 * 60 * 60 * 1000);
```

### 8.3 MiddlewarePipeline 优化
```typescript
// 缓存中间件实例
const pipeline = new MiddlewarePipeline()
  .use(cachedLoggingMiddleware)  // 复用实例
  .use(cachedPermissionMiddleware);

// 条件中间件
pipeline.use(async (context, next) => {
  if (context.needsCache) {
    return cacheMiddleware.execute(context, next);
  }
  return next();
});
```

---

## 总结

P2 阶段的公共模块提供了：

1. **EventBus** - 解耦事件发布和订阅
2. **MessageBus** - 统一消息管理
3. **MiddlewarePipeline** - 横切关注点复用

通过这些组件，可以：
- 消除 200+ 行重复代码
- 提升代码可维护性
- 增强系统扩展性
- 统一编程模型

建议优先迁移高频使用的模块（ToolRegistry、AgentLoop、PermissionController），逐步推广到整个项目。
