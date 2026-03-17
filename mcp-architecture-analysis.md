# MCP (Model Context Protocol) 架构分析报告

## 📋 目录概览

```
src/mcp/
├── types.ts                    # 核心类型定义（JSON-RPC、MCP 协议）
├── MCPClient.ts                # Stdio 客户端（子进程通信）
├── HttpMCPClient.ts            # HTTP 客户端（远程服务器）
├── MCPSSEClient.ts             # SSE 客户端（Server-Sent Events）
├── MCPManager.ts               # 多服务器管理器（单例）
├── MCPToolAdapter.ts           # 工具适配器（桥接 BaseTool）
├── ResourceDiscovery.ts        # 资源发现与读取
├── cache.ts                    # 内存缓存（TTL + LRU）
├── transports/
│   ├── HttpTransport.ts        # HTTP/SSE 传输层抽象
│   └── index.ts
├── search/                     # Web 搜索工具集成
│   ├── EnhancedWebSearchTool.ts
│   ├── RateLimiter.ts
│   ├── adapters/               # 多搜索引擎适配器
│   └── types.ts
└── tools/
    └── WebSearchTool.ts        # MCP 封装的搜索工具
```

---

## 🏗️ 核心架构设计

### 1. 类型系统 (types.ts)

#### 分层设计
```
JSON-RPC 2.0 Layer
    ↓
MCP Protocol Layer (Tools, Resources, Prompts)
    ↓
Configuration & Runtime Layer
```

#### 关键接口

**IMCPClient 接口**（统一抽象）
```typescript
interface IMCPClient {
  // 生命周期
  start(): Promise<void>
  close(): Promise<void>
  getState(): MCPServerState
  
  // 核心操作
  listTools(): Promise<MCPTool[]>
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>
  listResources(): Promise<MCPResource[]>
  readResource(uri: string): Promise<ResourceContent[]>
  listPrompts(): Promise<MCPPrompt[]>
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>
  
  // 缓存管理
  invalidateToolsCache(): void
  invalidateResourcesCache(): void
  
  // 事件监听
  on(event: string, listener: (...args: any[]) => void): this
}
```

**JSON-RPC 2.0 实现**
- 严格类型守卫：`isJSONRPCError()` 类型收窄
- 泛型响应：`JSONRPCResponse<T>` 支持类型推导
- 错误传播：统一错误码和消息格式

---

### 2. 客户端继承体系

#### 继承关系图
```
EventEmitter (Node.js)
    ↓
┌───────────────┬──────────────────┬──────────────────┐
│               │                  │                  │
MCPClient      MCPSSEClient     HttpMCPClient     (IMCPClient)
(stdio)        (SSE)            (HTTP)
```

#### 传输层对比

| 特性             | MCPClient       | MCPSSEClient    | HttpMCPClient   |
|------------------|-----------------|-----------------|-----------------|
| **传输方式**     | stdio (管道)    | HTTP POST + SSE | HTTP (同步)     |
| **进程管理**     | spawn 子进程    | 无              | 无              |
| **双工通信**     | 全双工          | 半双工 (POST→SSE)| 请求/响应       |
| **重连策略**     | 自动重连        | 自动重连        | 委托 Transport  |
| **适用场景**     | 本地服务        | 远程服务 (实时) | 远程服务 (HTTP) |

#### 共同设计模式

**1. 懒加载启动**
```typescript
async start(): Promise<void> {
  if (this.state === 'ready') return; // 幂等性
  if (this.state === 'starting') {
    return this.startPromise; // 并发安全
  }
  this.startPromise = this._startInternal();
  // ...
}
```

**2. 缓存 + 失效机制**
```typescript
async listTools(): Promise<MCPTool[]> {
  if (this.toolsCache) return this.toolsCache; // 缓存命中
  const result = await this.call<ListToolsResult>('tools/list');
  this.toolsCache = result.tools;
  return this.toolsCache;
}

invalidateToolsCache(): void {
  this.toolsCache = undefined; // 重连后失效
}
```

**3. 自动重连（指数退避）**
```typescript
private async reconnect(): Promise<void> {
  const delay = Math.min(
    1000 * Math.pow(2, this.reconnectAttempts - 1), // 2^n * 1s
    MAX_RECONNECT_DELAY // 最大 30s
  );
  
  await sleep(delay);
  
  if (!this.intentionalClose) { // 非主动关闭才重连
    await this.start();
    this.emit('reconnected', this.config.name);
  }
}
```

**4. MCP 协议握手**
```typescript
private async performInitialize(): Promise<void> {
  const result = await this.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: { tools: { listChanged: true }, resources: { subscribe: true } },
    clientInfo: { name: 'xuanji', version: '0.9.0' }
  });
  
  this.serverCapabilities = result.capabilities; // 保存服务器能力
  this.sendNotification('notifications/initialized'); // 发送初始化完成通知
  this.state = 'ready';
}
```

---

### 3. MCPManager 管理模式

#### 单例 + 工厂模式
```typescript
class MCPManager {
  private static instance?: MCPManager;
  
  static getInstance(): MCPManager {
    if (!MCPManager.instance) {
      MCPManager.instance = new MCPManager();
    }
    return MCPManager.instance;
  }
  
  private constructor() {} // 私有构造，禁止外部实例化
}
```

#### 多态客户端创建
```typescript
async initialize(config: MCPConfig): Promise<void> {
  for (const serverConfig of config.servers) {
    let client: IMCPClient;
    
    switch (serverConfig.transport ?? 'stdio') {
      case 'sse':
        client = new MCPSSEClient({ config: serverConfig, ... });
        break;
      case 'http':
        client = new HttpMCPClient({ config: serverConfig, ... });
        break;
      default:
        client = new MCPClient({ config: serverConfig, ... });
    }
    
    this.clients.set(serverConfig.name, client);
  }
}
```

#### 事件驱动架构
```typescript
// 监听重连失败 → 移除不可用服务器
client.on('reconnect_failed', (name) => {
  this.clients.delete(name);
});

// 监听重连成功 → 刷新工具列表
client.on('reconnected', (name) => {
  this.refreshServerTools(name).catch(...);
});

// 通知上层应用
private async refreshServerTools(serverName: string): Promise<void> {
  client.invalidateToolsCache();
  await client.listTools();
  this.onToolsChanged?.(serverName); // 回调通知
}
```

#### 并发安全设计
```typescript
private initPromise?: Promise<void>; // 初始化锁

async initialize(config: MCPConfig): Promise<void> {
  if (this.initPromise) {
    return this.initPromise; // 等待已有初始化完成
  }
  
  this.initPromise = this._doInitialize(config);
  try {
    await this.initPromise;
  } finally {
    this.initPromise = undefined; // 释放锁
  }
}
```

---

### 4. ResourceDiscovery 机制

#### 架构层次
```
Application Layer (Agent)
    ↓
ResourceDiscovery (with MemoryCache)
    ↓
MCPManager (Multi-Server)
    ↓
IMCPClient (Individual Server)
```

#### 缓存策略
```typescript
class ResourceDiscovery {
  private cache: MemoryCache<MCPResource[]>; // TTL = 5分钟
  
  async listServerResources(serverId: string): Promise<MCPResource[]> {
    const cached = this.cache.get(serverId);
    if (cached) return cached; // L1 缓存命中
    
    const resources = await client.listResources(); // L2 客户端缓存
    this.cache.set(serverId, resources);
    return resources;
  }
}
```

#### 资源定位算法
```typescript
async readResource(uri: string): Promise<SimpleResourceContent> {
  // 1. 查找资源所属服务器
  const allResources = await this.listAllResources();
  const resource = allResources.find(r => r.uri === uri);
  
  // 2. 推断服务器名称（遍历缓存）
  const serverId = this.findServerByResource(uri);
  
  // 3. 通过客户端读取（带重试）
  const contents = await this.readResourceWithRetry(client, uri);
  
  return {
    uri: contents[0].uri,
    content: contents[0].text ?? contents[0].blob ?? '',
    mimeType: contents[0].mimeType
  };
}
```

#### 重试策略（指数退避）
```typescript
private async readResourceWithRetry(
  client: IMCPClient,
  uri: string,
  maxRetries = 3
): Promise<ResourceContent[]> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.readResource(uri);
    } catch (error) {
      if (i < maxRetries - 1) {
        await this.sleep(Math.pow(2, i) * 1000); // 1s, 2s, 4s
      }
    }
  }
  throw new Error('Read resource failed after retries');
}
```

---

### 5. 缓存系统 (cache.ts)

#### 特性
- **TTL 过期**：每个条目独立过期时间
- **LRU 淘汰**：容量满时删除最旧条目
- **自动清理**：定时器扫描过期条目
- **延迟删除**：读取时检查过期 + 定时清理

#### 实现细节
```typescript
class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private cleanupTimer?: NodeJS.Timeout;
  
  constructor(options: CacheOptions = {}) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref(); // 不阻止进程退出
  }
  
  set(key: string, value: T, ttl?: number): void {
    // LRU 淘汰
    if (this.maxSize > 0 && this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this.defaultTTL)
    });
  }
  
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt < Date.now()) {
      this.cache.delete(key); // 延迟删除
      return undefined;
    }
    return entry?.value;
  }
}
```

---

### 6. HttpTransport 传输层

#### 双模式设计
```typescript
class HttpTransport extends EventEmitter {
  // 模式 1: 纯 HTTP（同步请求/响应）
  async request(method: string, params?: unknown): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(request)
    });
    return response.json();
  }
  
  // 模式 2: HTTP + SSE（异步事件流）
  private async connectSSE(): Promise<void> {
    const response = await fetch(sseUrl, { headers: { Accept: 'text/event-stream' } });
    this.readSSEStream(response.body);
  }
  
  private async readSSEStream(body: ReadableStream): Promise<void> {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      // 解析 SSE 事件（data: {...}\n\n）
      const events = buffer.split('\n\n');
      for (const event of events) {
        this.handleSSEEvent(event);
      }
    }
  }
}
```

#### 心跳检测
```typescript
private startHeartbeat(): void {
  this.heartbeatTimer = setInterval(() => {
    const elapsed = Date.now() - this.lastMessageTime;
    if (elapsed > HEARTBEAT_TIMEOUT) {
      this.log('SSE heartbeat timeout, reconnecting...', 'warn');
      this.reconnect();
    }
  }, HEARTBEAT_INTERVAL);
}
```

---

### 7. MCPToolAdapter 适配器模式

#### 桥接设计
```
MCP Tool (external) → MCPToolAdapter → BaseTool (xuanji internal)
```

#### 实现
```typescript
class MCPToolAdapter extends BaseTool {
  readonly name: string; // serverName:toolName
  readonly input_schema: JSONSchema; // MCP inputSchema → JSONSchema
  readonly readonly: boolean = true; // 并行执行优化
  
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const manager = getMCPManager();
    const result = await manager.callTool(this.serverName, this.mcpTool.name, input);
    
    // MCP Content → ToolResult 转换
    const textContents = result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    
    return result.isError
      ? this.error(textContents)
      : this.success(textContents);
  }
}
```

---

## 🎨 设计模式总结

### 1. **接口抽象模式**
- **IMCPClient 接口**：统一 stdio/SSE/HTTP 三种传输层
- **多态工厂**：MCPManager 根据 `transport` 类型创建不同客户端
- **依赖倒置**：上层依赖接口，不依赖具体实现

### 2. **单例模式**
- **MCPManager**：全局唯一，避免重复初始化
- **延迟初始化**：getInstance() 时创建实例
- **测试友好**：提供 `resetInstance()` 用于单元测试

### 3. **适配器模式**
- **MCPToolAdapter**：将 MCP 工具适配为 BaseTool
- **ResourceDiscovery**：简化 ResourceContent 为 SimpleResourceContent
- **传输层适配**：HttpTransport 封装 HTTP/SSE 细节

### 4. **观察者模式**
- **EventEmitter 继承**：所有客户端继承 Node.js EventEmitter
- **事件驱动**：reconnect_failed, reconnected, reconnecting 事件
- **回调通知**：`onToolsChanged` 回调通知上层应用

### 5. **策略模式**
- **重连策略**：指数退避 (1s, 2s, 4s, ...)
- **缓存策略**：LRU + TTL 混合淘汰
- **重试策略**：资源读取失败自动重试 3 次

### 6. **装饰器模式**
- **缓存装饰**：listTools/listResources 自动缓存结果
- **懒加载装饰**：start() 幂等性保证，自动启动未就绪的客户端

### 7. **责任链模式**
- **错误传播**：Client → Manager → Adapter → Agent
- **资源查找**：遍历所有服务器直到找到匹配的资源

---

## 🛡️ 错误处理机制

### 1. **分层错误处理**

```
Application Layer
    ↓ try-catch
MCPManager (aggregate errors from all servers)
    ↓ log warn & continue
MCPClient/SSEClient/HttpClient (retry with backoff)
    ↓ throw on exhaustion
Transport Layer (JSON-RPC error codes)
```

### 2. **错误恢复策略**

| 错误类型           | 策略                          | 实现位置            |
|--------------------|-------------------------------|---------------------|
| **网络超时**       | 自动重试 (3次 + 指数退避)    | ResourceDiscovery   |
| **连接断开**       | 自动重连 (10次 + 指数退避)   | MCPClient/SSEClient |
| **工具调用失败**   | 返回错误结果，继续执行        | MCPToolAdapter      |
| **服务器不可用**   | 从工具列表移除，日志警告      | MCPManager          |
| **初始化失败**     | 跳过该服务器，继续加载其他    | MCPManager          |

### 3. **类型守卫**
```typescript
function isJSONRPCError(response: JSONRPCResponse): response is JSONRPCErrorResponse {
  return 'error' in response;
}

if (isJSONRPCError(response)) {
  // TypeScript 自动收窄类型为 JSONRPCErrorResponse
  pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
}
```

---

## 🚀 性能优化要点

### 1. **多级缓存**
```
L1: ResourceDiscovery.cache (5分钟 TTL)
    ↓
L2: MCPClient.toolsCache/resourcesCache (进程内缓存)
    ↓
L3: MCP Server (服务器侧缓存)
```

### 2. **懒加载 + 并发控制**
```typescript
// 懒加载：仅在第一次调用时启动
async callTool(...): Promise<CallToolResult> {
  if (this.state !== 'ready') {
    await this.start(); // 自动启动
  }
  // ...
}

// 并发安全：多个调用共享同一个启动过程
if (this.startPromise) {
  return this.startPromise; // 等待已有启动完成
}
```

### 3. **流式处理**
```typescript
// stdio 输出缓冲区（避免 JSON 截断）
private handleOutput(chunk: string): void {
  this.outputBuffer += chunk;
  const lines = this.outputBuffer.split('\n');
  this.outputBuffer = lines.pop() ?? ''; // 保留未完成的行
  
  for (const line of lines) {
    const response = JSON.parse(line);
    this.handleResponse(response);
  }
}
```

### 4. **资源清理**
```typescript
async close(): Promise<void> {
  // 1. 拒绝所有待处理请求
  this.rejectAllPending(new Error('Client is closing'));
  
  // 2. 清理事件监听器（防止内存泄漏）
  proc.stdout?.removeAllListeners();
  proc.removeAllListeners();
  
  // 3. 优雅关闭（SIGTERM → 5s → SIGKILL）
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    proc.kill('SIGTERM');
  });
}
```

---

## 📊 架构优势

### ✅ 扩展性
- **传输层抽象**：新增传输方式只需实现 IMCPClient 接口
- **插件化设计**：MCP 工具通过适配器无缝集成到璇玑工具系统
- **多服务器支持**：MCPManager 管理任意数量的 MCP 服务器

### ✅ 可靠性
- **自动重连**：网络抖动时自动恢复，无需用户干预
- **降级处理**：单个服务器失败不影响其他服务器
- **错误隔离**：工具调用失败仅影响当前调用，不影响后续请求

### ✅ 性能
- **多级缓存**：减少重复请求，降低延迟
- **并行执行**：只读工具标记为 `readonly=true`，支持并行调用
- **懒加载**：未使用的服务器不会启动，节省资源

### ✅ 可维护性
- **类型安全**：完整的 TypeScript 类型定义，编译时错误检查
- **模块化**：每个模块职责单一，便于测试和替换
- **日志系统**：分层日志（debug/info/warn/error），便于问题排查

---

## 🔍 待改进点

### 1. **资源定位优化**
当前实现通过遍历所有服务器缓存查找资源，复杂度 O(n)。
建议：
- 维护全局 `URI → ServerName` 映射表
- 使用 URI 前缀路由（如 `server1://...` → server1）

### 2. **缓存一致性**
多级缓存可能导致数据不一致，建议：
- 实现缓存失效事件广播
- 使用版本号或 ETag 机制

### 3. **错误分类**
当前错误处理较粗粒度，建议：
- 定义 MCP 错误码枚举
- 根据错误类型选择不同策略（重试 vs 放弃）

### 4. **监控指标**
建议暴露以下指标：
- 工具调用成功率/延迟
- 重连次数/频率
- 缓存命中率

---

## 📚 总结

Xuanji 的 MCP 实现展示了优秀的架构设计：

1. **清晰的分层**：传输层 → 客户端层 → 管理层 → 适配器层
2. **接口抽象**：IMCPClient 统一多种传输方式
3. **容错设计**：自动重连、降级处理、错误隔离
4. **性能优化**：多级缓存、懒加载、并行执行
5. **可扩展性**：插件化、工厂模式、事件驱动

这套架构可以作为实现 MCP 客户端的最佳实践参考。

---

**分析完成时间**: 2025-01-XX  
**分析工具版本**: Xuanji v0.9.0  
**MCP 协议版本**: 2024-11-05
