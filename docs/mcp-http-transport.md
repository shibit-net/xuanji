# MCP HttpTransport 实现

## 概述

HttpTransport 提供基于 HTTP/SSE 的 MCP 传输层，支持远程 MCP Server 连接。

## 功能特性

### 1. 两种传输模式

#### 纯 HTTP 模式
- 发送 JSON-RPC 请求到 HTTP 端点
- 同步等待 HTTP 响应
- 适用于简单的请求/响应场景

#### HTTP + SSE 模式
- 发送 JSON-RPC 请求到 HTTP 端点
- 通过 SSE (Server-Sent Events) 接收异步响应
- 支持服务器主动推送
- 适用于需要长连接的场景

### 2. 核心特性

- **自动重连**：指数退避策略，最多重试 5 次
- **超时控制**：默认 30 秒，可自定义
- **错误重试**：5xx 错误和网络错误自动重试
- **心跳检测**：SSE 模式下 60 秒无消息自动重连
- **自定义请求头**：支持 Authorization 等自定义头
- **调试日志**：可选的调试日志输出

## 使用方式

### 1. 纯 HTTP 模式

```typescript
import { HttpTransport } from '@/mcp/transports/HttpTransport';

const transport = new HttpTransport({
  url: 'https://mcp.example.com',
  headers: {
    'Authorization': 'Bearer your-api-key',
  },
  timeout: 30000,
  maxRetries: 5,
  enableSSE: false,
  debug: true,
});

// 初始化连接
await transport.initialize();

// 发送请求
const result = await transport.request('tools/list', {});

// 关闭连接
await transport.close();
```

### 2. HTTP + SSE 模式

```typescript
import { HttpTransport } from '@/mcp/transports/HttpTransport';

const transport = new HttpTransport({
  url: 'https://mcp.example.com',
  headers: {
    'Authorization': 'Bearer your-api-key',
  },
  enableSSE: true,
  ssePath: '/sse', // SSE 端点路径
  debug: true,
});

// 初始化连接（建立 SSE 连接）
await transport.initialize();

// 发送请求（响应通过 SSE 返回）
const result = await transport.request('tools/list', {});

// 关闭连接
await transport.close();
```

### 3. 与 HttpMCPClient 集成

```typescript
import { HttpMCPClient } from '@/mcp/HttpMCPClient';

const client = new HttpMCPClient({
  config: {
    name: 'remote-mcp',
    transport: 'http',
    url: 'https://mcp.example.com',
    headers: {
      'Authorization': 'Bearer your-api-key',
    },
  },
  timeout: 30000,
  debug: true,
});

// 启动客户端
await client.start();

// 获取工具列表
const tools = await client.listTools();

// 调用工具
const result = await client.callTool('my-tool', { arg: 'value' });

// 关闭客户端
await client.close();
```

### 4. 配置文件集成

在 `~/.xuanji/mcp.json` 中配置：

```json
{
  "servers": [
    {
      "name": "remote-mcp",
      "transport": "http",
      "url": "https://mcp.example.com",
      "headers": {
        "Authorization": "Bearer your-api-key"
      },
      "timeout": 30000
    },
    {
      "name": "remote-mcp-sse",
      "transport": "sse",
      "url": "https://mcp.example.com",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  ]
}
```

## API 文档

### HttpTransportOptions

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | `string` | **必填** | 服务器基础 URL |
| `headers` | `Record<string, string>` | `{}` | 自定义请求头 |
| `timeout` | `number` | `30000` | 请求超时（毫秒） |
| `maxRetries` | `number` | `5` | 最大重试次数 |
| `enableSSE` | `boolean` | `false` | 是否启用 SSE |
| `ssePath` | `string` | `'/sse'` | SSE 端点路径 |
| `debug` | `boolean` | `false` | 是否启用调试日志 |

### HttpTransport 方法

#### `initialize(): Promise<void>`
初始化连接。如果启用 SSE，建立 SSE 连接。

#### `request(endpoint: string, body: Record<string, unknown>): Promise<unknown>`
发送 JSON-RPC 请求。

- **参数**：
  - `endpoint`: 请求端点（如 `'tools/list'`）
  - `body`: 请求体（JSON-RPC params）
- **返回**：JSON-RPC result

#### `close(): Promise<void>`
关闭连接，拒绝所有待处理的请求。

#### `isConnected(): boolean`
检查是否已连接（状态是否为 `ready`）。

#### `getState(): MCPServerState`
获取当前状态（`uninitialized` | `starting` | `ready` | `error` | `closed`）。

## 错误处理

### 1. HTTP 错误

| 错误码 | 处理方式 |
|--------|---------|
| 401/403 | 立即失败（认证错误） |
| 404 | 立即失败（端点不存在） |
| 500/502/503 | 重试（最多 5 次） |
| 其他 | 立即失败 |

### 2. 网络错误

以下网络错误会自动重试：
- `AbortError`（超时）
- 包含 `network` 的错误
- 包含 `timeout` 的错误
- `ECONNREFUSED`（连接被拒绝）
- `ENOTFOUND`（域名不存在）

### 3. 重试策略

- **指数退避**：1s, 2s, 4s, 8s, 16s
- **最大重试次数**：5 次（可配置）
- **最大延迟**：16 秒

## 事件

HttpTransport 继承自 EventEmitter，支持以下事件：

- `reconnecting`: 重连中（参数：`{ attempt: number, delay: number }`）
- `reconnected`: 重连成功
- `reconnect_failed`: 重连失败（达到最大重试次数）

```typescript
transport.on('reconnecting', ({ attempt, delay }) => {
  console.log(`Reconnecting (attempt ${attempt})...`);
});

transport.on('reconnected', () => {
  console.log('Reconnected successfully');
});

transport.on('reconnect_failed', () => {
  console.error('Reconnect failed');
});
```

## 测试

运行单元测试：

```bash
npm test -- test/unit/mcp/HttpTransport.test.ts
```

测试覆盖：
- ✅ 基础请求/响应
- ✅ 超时处理
- ✅ 重试机制（5xx 错误、网络错误）
- ✅ 错误码处理
- ✅ 自定义请求头
- ✅ SSE 连接建立
- ✅ 并发请求
- ✅ 状态管理

## 实现细节

### 1. 请求 ID 管理

- 自增 ID（1 ~ 2,000,000,000，循环）
- 超过 20 亿后重置为 1，避免溢出

### 2. SSE 流解析

- 按 `\n\n` 分割事件
- 解析 `data:` 字段
- 支持 `event:` 类型（如 `ping`）
- 自动处理心跳

### 3. 内存管理

- 请求完成后立即清理 pending request
- 关闭时清理所有监听器和定时器
- 避免内存泄漏

## 与现有实现的对比

| 特性 | MCPClient (stdio) | MCPSSEClient | HttpTransport |
|------|------------------|--------------|---------------|
| 传输方式 | 子进程 stdio | HTTP + SSE | HTTP / HTTP + SSE |
| 适用场景 | 本地服务 | 远程服务 | 远程服务 |
| 自动重连 | ✅ | ✅ | ✅ |
| 心跳检测 | ❌ | ❌ | ✅ (SSE 模式) |
| 纯 HTTP 模式 | ❌ | ❌ | ✅ |
| 自定义请求头 | ❌ | ✅ | ✅ |
| 超时重试 | ✅ | ✅ | ✅ |
| 错误重试 | ✅ | ✅ | ✅ |

## 未来扩展

- [ ] WebSocket 传输模式
- [ ] 请求缓存（GET 类请求）
- [ ] 批量请求支持
- [ ] 请求队列和限流
- [ ] 更细粒度的重试策略（可配置每个端点）
