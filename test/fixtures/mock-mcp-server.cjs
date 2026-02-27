#!/usr/bin/env node
/**
 * Mock MCP Server for Testing
 *
 * 通过 stdio 进行 JSON-RPC 2.0 通信
 * 提供模拟的 tools 和 prompts
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

// 模拟工具列表
const tools = [
  {
    name: 'stock_price',
    description: 'Get current stock price',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock symbol' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'market_summary',
    description: 'Get market summary',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// 模拟 Prompt 列表
const prompts = [
  {
    name: 'trading_strategy',
    description: 'Trading strategy prompt',
    arguments: [
      { name: 'risk_level', description: 'Risk level (low/medium/high)', required: false },
    ],
  },
];

/**
 * 处理 JSON-RPC 请求
 */
function handleRequest(request) {
  const { id, method, params } = request;

  // 忽略通知（无 id 的消息）
  if (id === undefined || id === null) {
    return null; // 不响应通知
  }

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: true },
          },
          serverInfo: {
            name: 'mock-mcp-server',
            version: '1.0.0',
          },
        },
      };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools } };

    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts } };

    case 'tools/call': {
      const { name, arguments: args } = params || {};

      if (name === 'stock_price') {
        const symbol = args?.symbol || 'UNKNOWN';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  symbol,
                  price: 1888.88,
                  change: '+2.5%',
                  time: '2025-02-26 15:00:00',
                }),
              },
            ],
          },
        };
      }

      if (name === 'market_summary') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: 'Shanghai Composite: 3250.00 (+0.5%)',
              },
            ],
          },
        };
      }

      // 工具不存在
      if (name === 'error_tool') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'Something went wrong' }],
            isError: true,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Tool not found: ${name}` },
      };
    }

    case 'prompts/get': {
      const { name: promptName, arguments: promptArgs } = params || {};

      if (promptName === 'trading_strategy') {
        const riskLevel = promptArgs?.risk_level || 'medium';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Trading strategy prompt',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Use a ${riskLevel} risk trading strategy.`,
                },
              },
            ],
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Prompt not found: ${promptName}` },
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// 逐行读取 stdin
rl.on('line', (line) => {
  try {
    const request = JSON.parse(line.trim());
    const response = handleRequest(request);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (error) {
    // 解析失败，忽略
    process.stderr.write(`Parse error: ${error.message}\n`);
  }
});

// 通知 stderr 已启动
process.stderr.write('Mock MCP Server started\n');
