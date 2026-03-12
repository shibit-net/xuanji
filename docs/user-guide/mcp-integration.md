# MCP 集成指南

> 最后更新：2026-03-10

## 什么是 MCP

MCP (Model Context Protocol) 是一个开放协议，允许 AI 应用与外部工具、数据源集成。

**核心概念**：
- **Server**：提供工具和资源的服务进程
- **Client**：调用 MCP Server 的应用（Xuanji）
- **Transport**：通信方式（stdio / SSE / HTTP）
- **Tools**：Server 提供的可执行函数
- **Resources**：Server 提供的可读取数据（文件、URL 等）
- **Prompts**：Server 提供的预定义提示词模板

## 配置 MCP Server

### 全局配置

编辑 `~/.xuanji/mcp.json`：

```json
{
  "enabled": true,
  "servers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"]
    },
    {
      "name": "weather",
      "transport": "sse",
      "url": "http://localhost:3000/sse"
    },
    {
      "name": "database",
      "transport": "http",
      "url": "https://api.example.com/mcp"
    }
  ]
}
```

### 项目配置

在项目中创建 `.xuanji/mcp.json`（会与全局配置合并）：

```json
{
  "servers": [
    {
      "name": "project-tools",
      "transport": "stdio",
      "command": "./scripts/mcp-server.js"
    }
  ]
}
```

## 支持的 Transport

### stdio（标准输入输出）

适用于本地命令行工具。

```json
{
  "name": "my-tool",
  "transport": "stdio",
  "command": "node",
  "args": ["./server.js"],
  "env": {
    "API_KEY": "your-key"
  }
}
```

### SSE（Server-Sent Events）

适用于远程服务器，支持实时事件推送。

```json
{
  "name": "remote-service",
  "transport": "sse",
  "url": "https://example.com/mcp/sse",
  "headers": {
    "Authorization": "Bearer your-token"
  }
}
```

### HTTP（REST API）

适用于远程服务器，基于 JSON-RPC 2.0。

```json
{
  "name": "api-service",
  "transport": "http",
  "url": "https://example.com/mcp",
  "timeout": 60000
}
```

## 使用 MCP 工具

启动 Xuanji 后，MCP 工具会自动注册：

```bash
$ xuanji

# Agent 可以直接使用 MCP 工具
你: 读取 /path/to/file.txt 的内容

# Agent 会自动调用 filesystem Server 提供的 read_file 工具
```

查看可用的 MCP 工具：

```bash
/tools
```

## 使用 MCP Prompts

MCP Prompts 作为 Skill 注册到 Xuanji：

```bash
# 列出所有 Skills（包括 MCP Prompts）
/skills

# 激活 MCP Prompt
你: 使用 code-review prompt 检查这段代码
```

## 使用 MCP Resources

资源发现和读取：

```bash
# Agent 可以通过 MCP Resource 读取远程数据
你: 读取 database://users/table/schema

# Xuanji 会调用 database Server 的 resources/read
```

## 常见 MCP Server

### 官方 Server

```bash
# 文件系统
npx -y @modelcontextprotocol/server-filesystem /path/to/allowed

# Git
npx -y @modelcontextprotocol/server-git /path/to/repo

# GitHub
npx -y @modelcontextprotocol/server-github --token YOUR_TOKEN

# PostgreSQL
npx -y @modelcontextprotocol/server-postgres postgres://user:pass@host/db

# Google Drive
npx -y @modelcontextprotocol/server-gdrive --credentials /path/to/credentials.json

# Brave Search
npx -y @modelcontextprotocol/server-brave-search --api-key YOUR_KEY

# Slack
npx -y @modelcontextprotocol/server-slack --token YOUR_TOKEN
```

### 自定义 Server

创建自己的 MCP Server（Node.js 示例）：

```javascript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({
  name: 'my-server',
  version: '1.0.0',
});

// 注册工具
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'hello',
      description: 'Say hello',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet' },
        },
        required: ['name'],
      },
    },
  ],
}));

server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name === 'hello') {
    return {
      content: [
        { type: 'text', text: `Hello, ${request.params.arguments.name}!` },
      ],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

配置：

```json
{
  "name": "my-server",
  "transport": "stdio",
  "command": "node",
  "args": ["./my-server.js"]
}
```

## 安全建议

1. **权限限制**：只允许访问必要的文件/目录
2. **认证**：为远程 Server 配置 Token/API Key
3. **网络隔离**：生产环境使用 HTTPS
4. **审计日志**：检查 `~/.xuanji/logs/audit.log` 查看 MCP 调用记录
5. **最小权限原则**：只启用需要的 Server

## 故障排查

### Server 启动失败

```bash
# 检查 Server 进程是否启动
ps aux | grep mcp-server

# 查看 Xuanji 日志
tail -f ~/.xuanji/logs/error.log
```

### 工具调用失败

```bash
# 测试 Server 是否正常
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx -y @modelcontextprotocol/server-filesystem /path

# 查看审计日志
cat ~/.xuanji/logs/audit.log | grep mcp
```

### 连接超时

调整超时配置：

```json
{
  "name": "slow-server",
  "transport": "http",
  "url": "https://example.com/mcp",
  "timeout": 120000
}
```

## 相关文档

- [MCP 官方文档](https://modelcontextprotocol.io)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [配置参考](./configuration.md#mcp-配置)
