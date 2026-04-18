# 公共模块抽象方案

## 一、重复代码分析

### 1. 消息管理（3 处重复）

```typescript
// AgentLoop.MessageManager
class MessageManager {
  private messages: Message[] = [];
  addUserMessage(content: string): void;
  addAssistantMessage(content: string): void;
  getMessages(): Message[];
}

// SessionManager
class SessionManager {
  saveMessages(messages: Message[]): Promise<void>;
  loadMessages(sessionId: string): Promise<Message[]>;
}

// ShortTermMemory
class ShortTermMemory {
  private messages: Message[] = [];
  addMessage(message: Message): void;
  getRecentMessages(count: number): Message[];
}
```

**问题**：三处都在管理消息，但职责不同，应该统一抽象。

---

### 2. 权限检查（多处重复）

```typescript
// ToolRegistry.execute()
if (this.permissionController) {
  const result = await this.permissionController.check(...);
  if (!result.allowed) return { error: '...' };
}

// BashTool.execute()
if (this.permissionController) {
  const result = await this.permissionController.check(...);
  if (!result.allowed) return { error: '...' };
}

// WriteTool.execute()
if (this.permissionController) {
  const result = await this.permissionController.check(...);
  if (!result.allowed) return { error: '...' };
}
```

**问题**：权限检查逻辑在每个工具中重复，应该通过中间件统一处理。

---

### 3. 错误处理（多处重复）

```typescript
// AgentLoop
try {
  await this.execute();
} catch (error) {
  this.log.error('Execution failed:', error);
  this.callbacks.onError?.(error);
  throw error;
}

// ToolRegistry
try {
  const result = await tool.execute(input);
} catch (error) {
  this.log.error(`Tool ${name} failed:`, error);
  return { error: error.message };
}

// SessionManager
try {
  await this.storage.save(snapshot);
} catch (error) {
  this.log.error('Save failed:', error);
  throw error;
}
```

**问题**：错误处理模式重复，应该统一抽象。

---

## 二、重构目标

### 1. 统一消息总线

```typescript
// 消息总线接口
interface IMessageBus {
  publish(message: Message): void;
  subscribe(handler: MessageHandler): () => void;
  getHistory(filter?: MessageFilter): Message[];
}

// 消息处理器
type MessageHandler = (message: Message) => void | Promise<void>;

// 消息过滤器
interface MessageFilter {
  role?: 'user' | 'assistant' | 'system';
  after?: Date;
  limit?: number;
}

// 实现
class MessageBus implements IMessageBus {
  private messages: Message[] = [];
  private handlers = new Set<MessageHandler>();
  
  publish(message: Message): void {
    this.messages.push(message);
    
    // 通知所有订阅者
    for (const handler of this.handlers) {
      try {
        handler(message);
      } catch (error) {
        console.error('Message handler error:', error);
      }
    }
  }
  
  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  
  getHistory(filter?: MessageFilter): Message[] {
    let results = [...this.messages];
    
    if (filter?.role) {
      results = results.filter(m => m.role === filter.role);
    }
    if (filter?.after) {
      results = results.filter(m => new Date(m.timestamp) > filter.after!);
    }
    if (filter?.limit) {
      results = results.slice(-filter.limit);
    }
    
    return results;
  }
}

// 使用示例
class AgentLoop {
  constructor(private messageBus: IMessageBus) {
    // 订阅消息用于日志
    this.messageBus.subscribe((msg) => {
      this.log.debug('Message:', msg);
    });
  }
  
  async run(input: string): Promise<void> {
    // 发布用户消息
    this.messageBus.publish({
      role: 'user',
      content: input,
      timestamp: Date.now()
    });
    
    // ... 执行逻辑
    
    // 发布助手消息
    this.messageBus.publish({
      role: 'assistant',
      content: response,
      timestamp: Date.now()
    });
  }
}

class SessionManager {
  constructor(private messageBus: IMessageBus) {
    // 订阅消息用于持久化
    this.messageBus.subscribe(async (msg) => {
      await this.saveMessage(msg);
    });
  }
}

class ShortTermMemory {
  constructor(private messageBus: IMessageBus) {}
  
  getRecentMessages(count: number): Message[] {
    return this.messageBus.getHistory({ limit: count });
  }
}
```

---

### 2. 权限中间件

```typescript
// 中间件接口
interface IMiddleware<TInput, TOutput> {
  execute(input: TInput, next: () => Promise<TOutput>): Promise<TOutput>;
}

// 权限中间件
class PermissionMiddleware implements IMiddleware<ToolInput, ToolResult> {
  constructor(private controller: IPermissionController) {}
  
  async execute(input: ToolInput, next: () => Promise<ToolResult>): Promise<ToolResult> {
    // 权限检查
    const result = await this.controller.check({
      tool: input.toolName,
      input: input.params
    });
    
    if (!result.allowed) {
      return {
        error: `Permission denied: ${result.reason}`
      };
    }
    
    // 继续执行
    return await next();
  }
}

// 日志中间件
class LoggingMiddleware implements IMiddleware<ToolInput, ToolResult> {
  constructor(private logger: Logger) {}
  
  async execute(input: ToolInput, next: () => Promise<ToolResult>): Promise<ToolResult> {
    this.logger.debug(`Tool ${input.toolName} started`);
    const startTime = Date.now();
    
    try {
      const result = await next();
      const duration = Date.now() - startTime;
      this.logger.debug(`Tool ${input.toolName} completed in ${duration}ms`);
      return result;
    } catch (error) {
      this.logger.error(`Tool ${input.toolName} failed:`, error);
      throw error;
    }
  }
}

// 中间件管道
class MiddlewarePipeline<TInput, TOutput> {
  private middlewares: IMiddleware<TInput, TOutput>[] = [];
  
  use(middleware: IMiddleware<TInput, TOutput>): this {
    this.middlewares.push(middleware);
    return this;
  }
  
  async execute(input: TInput, handler: () => Promise<TOutput>): Promise<TOutput> {
    let index = 0;
    
    const next = async (): Promise<TOutput> => {
      if (index >= this.middlewares.length) {
        return await handler();
      }
      
      const middleware = this.middlewares[index++];
      return await middleware.execute(input, next);
    };
    
    return await next();
  }
}

// 使用示例
class ToolRegistry {
  private pipeline = new MiddlewarePipeline<ToolInput, ToolResult>();
  
  constructor(permissionController: IPermissionController) {
    // 注册中间件
    this.pipeline
      .use(new LoggingMiddleware(logger))
      .use(new PermissionMiddleware(permissionController))
      .use(new ValidationMiddleware())
      .use(new RetryMiddleware({ maxRetries: 3 }));
  }
  
  async execute(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { error: `Tool not found: ${name}` };
    }
    
    // 通过中间件管道执行
    return await this.pipeline.execute(
      { toolName: name, params: input },
      () => tool.execute(input)
    );
  }
}
```

---

### 3. 统一错误处理

```typescript
// 错误处理器接口
interface IErrorHandler {
  handle(error: Error, context: ErrorContext): ErrorResult;
}

// 错误上下文
interface ErrorContext {
  operation: string;
  metadata?: Record<string, any>;
}

// 错误结果
interface ErrorResult {
  handled: boolean;
  retry?: boolean;
  fallback?: any;
}

// 错误处理器实现
class ErrorHandler implements IErrorHandler {
  private handlers = new Map<string, (error: Error) => ErrorResult>();
  
  register(errorType: string, handler: (error: Error) => ErrorResult): void {
    this.handlers.set(errorType, handler);
  }
  
  handle(error: Error, context: ErrorContext): ErrorResult {
    // 1. 查找特定错误处理器
    const handler = this.handlers.get(error.constructor.name);
    if (handler) {
      return handler(error);
    }
    
    // 2. 默认处理
    logger.error(`Error in ${context.operation}:`, error);
    return { handled: false };
  }
}

// 全局错误处理器
const globalErrorHandler = new ErrorHandler();

// 注册常见错误处理
globalErrorHandler.register('NetworkError', (error) => {
  return { handled: true, retry: true };
});

globalErrorHandler.register('PermissionError', (error) => {
  return { handled: true, retry: false };
});

// 错误处理装饰器
function handleErrors(handler: IErrorHandler) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        const result = handler.handle(error as Error, {
          operation: `${target.constructor.name}.${propertyKey}`,
          metadata: { args }
        });
        
        if (result.retry) {
          return await originalMethod.apply(this, args);
        }
        
        if (result.fallback !== undefined) {
          return result.fallback;
        }
        
        throw error;
      }
    };
    
    return descriptor;
  };
}

// 使用示例
class AgentLoop {
  @handleErrors(globalErrorHandler)
  async run(input: string): Promise<void> {
    // 执行逻辑
    // 错误会被自动处理
  }
}
```

---

### 4. 事件总线

```typescript
// 事件总线接口
interface IEventBus {
  emit(event: string, data?: any): void;
  on(event: string, handler: EventHandler): () => void;
  once(event: string, handler: EventHandler): () => void;
}

type EventHandler = (data: any) => void | Promise<void>;

// 事件总线实现
class EventBus implements IEventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  
  emit(event: string, data?: any): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Event handler error for ${event}:`, error);
      }
    }
  }
  
  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    
    return () => this.handlers.get(event)?.delete(handler);
  }
  
  once(event: string, handler: EventHandler): () => void {
    const wrappedHandler = (data: any) => {
      handler(data);
      this.handlers.get(event)?.delete(wrappedHandler);
    };
    
    return this.on(event, wrappedHandler);
  }
}

// 使用示例
const eventBus = new EventBus();

// 发布事件
class AgentLoop {
  async run(input: string): Promise<void> {
    eventBus.emit('agent:start', { input });
    
    // ... 执行逻辑
    
    eventBus.emit('agent:complete', { output: response });
  }
}

// 订阅事件
class MemoryManager {
  constructor() {
    eventBus.on('agent:complete', async (data) => {
      await this.extractMemories(data.output);
    });
  }
}

class SessionManager {
  constructor() {
    eventBus.on('agent:complete', async (data) => {
      await this.saveSession();
    });
  }
}
```

---

## 三、实施步骤

### Step 1: 实现基础设施（Day 1）
- MessageBus
- MiddlewarePipeline
- ErrorHandler
- EventBus

### Step 2: 迁移消息管理（Day 2）
- AgentLoop 使用 MessageBus
- SessionManager 订阅 MessageBus
- ShortTermMemory 使用 MessageBus

### Step 3: 迁移权限检查（Day 3）
- 实现 PermissionMiddleware
- ToolRegistry 使用中间件管道
- 移除各工具中的权限检查代码

### Step 4: 统一错误处理（Day 4）
- 注册常见错误处理器
- 使用 @handleErrors 装饰器
- 移除重复的 try-catch

### Step 5: 引入事件总线（Day 5）
- 定义核心事件
- 各模块发布/订阅事件
- 移除直接依赖

---

## 四、收益评估

| 指标 | 当前 | 目标 | 提升 |
|------|------|------|------|
| 消息管理代码 | 300 行 | 150 行 | -50% |
| 权限检查代码 | 200 行 | 50 行 | -75% |
| 错误处理代码 | 400 行 | 150 行 | -62% |
| 模块耦合度 | 高 | 低 | -70% |
| 代码复用率 | 60% | 90% | +50% |

---

## 五、注意事项

1. **性能影响**：中间件和事件总线会增加少量开销，需要性能测试
2. **调试难度**：事件驱动架构调试较困难，需要完善日志
3. **学习成本**：团队需要学习新的抽象模式
4. **渐进迁移**：不要一次性全部重构，逐步迁移
