// ============================================================
// 天工坊本地安装命令（私有 MCP 服务直接安装）
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TiangongInstallLocal' });

interface ParsedArgs {
  name?: string;
  transport?: 'stdio' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  env: Record<string, string>;
}

function parseArgs(input: string): ParsedArgs {
  const result: ParsedArgs = { env: {} };
  const tokens = input.trim().split(/\s+/);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const match = token.match(/^--([^=]+)(?:=(.+))?$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2] ?? tokens[++i];
    if (!value) continue;

    switch (key) {
      case 'name':
        result.name = value;
        break;
      case 'transport':
        result.transport = value as 'stdio' | 'sse';
        break;
      case 'url':
        result.url = value;
        break;
      case 'command':
        result.command = value;
        break;
      case 'args':
        result.args = value.split(',');
        break;
      case 'env': {
        const eqIdx = value.indexOf('=');
        if (eqIdx > 0) {
          result.env[value.substring(0, eqIdx)] = value.substring(eqIdx + 1);
        }
        break;
      }
    }
  }
  return result;
}

export async function handleInstallLocal(args: string): Promise<string> {
  if (!args.trim()) {
    return [
      '用法: /tiangong install-local --name <名称> [选项]',
      '',
      'SSE 模式:',
      '  /tiangong install-local --name my-mcp --transport sse --url https://example.com/sse --env API_KEY=xxx',
      '',
      'Stdio 模式:',
      '  /tiangong install-local --name my-mcp --transport stdio --command npx --args -y,@example/mcp-server',
      '',
      '选项:',
      '  --name       服务名称（必填）',
      '  --transport  传输方式: sse 或 stdio（默认 stdio）',
      '  --url        SSE 模式的服务 URL',
      '  --command    Stdio 模式的命令',
      '  --args       Stdio 模式的命令参数（逗号分隔）',
      '  --env        环境变量（可多次指定，格式: KEY=VALUE）',
    ].join('\n');
  }

  const parsed = parseArgs(args);

  if (!parsed.name) {
    return '缺少必填参数 --name';
  }

  // 确定 transport
  const transport = parsed.transport ?? (parsed.url ? 'sse' : 'stdio');

  if (transport === 'sse' && !parsed.url) {
    return 'SSE 模式需要指定 --url';
  }
  if (transport === 'stdio' && !parsed.command) {
    return 'Stdio 模式需要指定 --command';
  }

  // 构建 MCP Server 配置
  const serverConfig: Record<string, unknown> = {
    name: parsed.name,
    transport,
  };

  if (transport === 'sse') {
    serverConfig.sseUrl = parsed.url;
    // 推测 httpUrl
    if (parsed.url!.endsWith('/sse')) {
      serverConfig.httpUrl = parsed.url!.replace(/\/sse$/, '/message');
    }
  } else {
    serverConfig.command = parsed.command;
    if (parsed.args) {
      serverConfig.args = parsed.args;
    }
  }

  if (Object.keys(parsed.env).length > 0) {
    serverConfig.env = parsed.env;
  }

  // 写入 mcp.json
  const mcpConfigPath = path.join(os.homedir(), '.xuanji', 'mcp.json');
  let mcpConfig: any = { servers: [] };

  if (fs.existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      if (!mcpConfig.servers) {
        mcpConfig.servers = [];
      }
    } catch {
      mcpConfig = { servers: [] };
    }
  }

  // 检查是否已存在
  const existingIndex = mcpConfig.servers.findIndex(
    (s: any) => s.name === parsed.name
  );
  if (existingIndex !== -1) {
    mcpConfig.servers[existingIndex] = serverConfig;
    log.info(`Updated existing MCP Server: ${parsed.name}`);
  } else {
    mcpConfig.servers.push(serverConfig);
    log.info(`Added new MCP Server: ${parsed.name}`);
  }

  fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  const lines = [
    `MCP Server "${parsed.name}" 安装成功`,
    `  传输: ${transport}`,
  ];
  if (transport === 'sse') {
    lines.push(`  URL: ${parsed.url}`);
  } else {
    lines.push(`  命令: ${parsed.command}${parsed.args ? ' ' + parsed.args.join(' ') : ''}`);
  }
  if (Object.keys(parsed.env).length > 0) {
    const envKeys = Object.keys(parsed.env).join(', ');
    lines.push(`  环境变量: ${envKeys}`);
  }
  lines.push(`  配置: ${mcpConfigPath}`);
  lines.push(`\n重启 xuanji 以加载新服务`);

  return lines.join('\n');
}
