/**
 * ============================================================
 * MCP Client - stdio JSON-RPC Client
 * ============================================================
 * 通过 stdio 进行 JSON-RPC 2.0 通信的 MCP 客户端
 * 支持 MCP 协议 initialize 握手和自动重连
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { logger } from '@/infrastructure/logger';
import { crossPlatformKill, findNpmCliPath } from '@/shared/utils/crossPlatform';
import { sleep } from '@/shared/utils/sleep';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  MCPTool,
  MCPPrompt,
  MCPResource,
  ResourceContent,
  ListToolsResult,
  ListPromptsResult,
  ListResourcesResult,
  CallToolParams,
  CallToolResult,
  GetPromptParams,
  GetPromptResult,
  ReadResourceParams,
  ReadResourceResult,
  MCPServerConfig,
  MCPServerState,
} from './types';

/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 10;

/** 最大重连延迟（毫秒） */
const MAX_RECONNECT_DELAY = 30_000;

/** 输出缓冲区最大字节数，防止恶意服务器撑爆内存 */
const MAX_OUTPUT_BUFFER_SIZE = 1024 * 1024; // 1MB

/** MCP 协议版本 */
const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * 待处理的 RPC 请求
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * MCPClient 配置
 */
export interface MCPClientOptions {
  /** 服务器配置 */
  config: MCPServerConfig;
  /** 超时时间（毫秒，默认 30000） */
  timeout?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * MCP 客户端
 */
export class MCPClient extends EventEmitter {
  protected config: MCPServerConfig;
  protected timeout: number;
  protected debug: boolean;

  private process?: ChildProcess;
  private state: MCPServerState = 'uninitialized';
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();

  // 缓存的工具和 Prompt 列表
  private toolsCache?: MCPTool[];
  private promptsCache?: MCPPrompt[];
  private resourcesCache?: MCPResource[];

  // 输出缓冲区（处理不完整的 JSON）
  private outputBuffer = '';

  // 重连状态
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private reconnecting = false;

  // 服务器能力（initialize 握手后获取）
  private serverCapabilities?: Record<string, unknown>;
  private serverInfo?: { name: string; version: string };

  // 正在 start 时的 Promise（供并发调用者等待）
  private startPromise?: Promise<void>;

  constructor(options: MCPClientOptions) {
    super();
    this.config = options.config;
    this.timeout = options.timeout ?? 30_000;
    this.debug = options.debug ?? false;
  }

  /**
   * 启动 MCP 服务器
   */
  async start(): Promise<void> {
    if (this.state === 'ready') {
      return; // 已启动
    }

    if (this.state === 'starting') {
      // 等待正在进行的 start() 完成，而非抛异常（防止并发 call() 竞争）
      if (this.startPromise) {
        return this.startPromise;
      }
      throw new Error(`MCP server "${this.config.name}" is already starting`);
    }

    this.state = 'starting';
    this.intentionalClose = false;
    this.log('Starting MCP server...');

    this.startPromise = this._startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  /**
   * 解析 npx 命令为可执行文件路径
   *
   * 打包环境下优先使用 Electron 内置 Node 运行 npm-cli.js，
   * 避免 npx bash 脚本在 Windows 上无法执行的问题。
   */
  private resolveNpxCommand(): { command: string; extraArgs: string[] } {
    const { nodePath, npmCliPath } = findNpmCliPath();
    if (npmCliPath) {
      return { command: nodePath, extraArgs: [npmCliPath, 'exec', '--yes'] };
    }
    // 终极回退（npm-cli.js 不存在时不太可能到达）
    const npxName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    return { command: npxName, extraArgs: [] };
  }

  /**
   * 将 Node.js bin 目录注入 env.PATH，确保 MCP 子进程能找到 npx/node/npm
   *
   * 解决 macOS GUI 应用启动时 PATH 不包含 nvm/brew 等 Node.js 安装路径的问题。
   * 也兼容 Windows 下通过 nvm-windows 管理的 Node.js 场景。
   *
   * 策略（按优先级）:
   *   1. findNpmCliPath() → 获取 nodePath → 提取 bin 目录
   *   2. process.execPath → 提取 bin 目录
   *   3. 兜底: 不修改 PATH（由调用方处理）
   */
  private injectNodeBinToPath(env: Record<string, string | undefined>): void {
    try {
      // 从 findNpmCliPath 获取 node 路径，提取其 bin 目录
      const { nodePath } = findNpmCliPath();
      if (nodePath && nodePath !== 'node') {
        const nodeBinDir = path.dirname(nodePath);
        const existingPath = env.PATH || process.env.PATH || '';
        // 避免重复追加
        if (!existingPath.split(path.delimiter).includes(nodeBinDir)) {
          env.PATH = [nodeBinDir, existingPath].filter(Boolean).join(path.delimiter);
        }
        return;
      }
    } catch { /* 兜底 */ }

    // 兜底: 从 process.execPath 提取 bin 目录
    try {
      const execDir = path.dirname(process.execPath);
      if (path.basename(execDir) === 'bin') {
        const existingPath = env.PATH || process.env.PATH || '';
        if (!existingPath.split(path.delimiter).includes(execDir)) {
          env.PATH = [execDir, existingPath].filter(Boolean).join(path.delimiter);
        }
      }
    } catch { /* 最终兜底 */ }
  }

  /**
   * 内部启动逻辑
   */
  private async _startInternal(): Promise<void> {

    try {
      // 合并环境变量
      const env = {
        ...process.env,
        ...((process as any).resourcesPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        ...this.config.env,
      };

      // 增强 PATH：将 Node.js bin 目录注入环境变量，确保 MCP 子进程能找到 npx/node/npm
      // 解决 macOS GUI 应用启动时 PATH 不包含 nvm/brew 等路径的问题
      this.injectNodeBinToPath(env);

      // 解析命令：npx → Electron 内置 Node + npm-cli.js
      let { command, args } = { command: this.config.command, args: this.config.args ?? [] };
      if (command === 'npx' || command === 'npx.cmd') {
        const resolved = this.resolveNpxCommand();
        command = resolved.command;
        // 过滤掉与 npm exec --yes 重复的 -y/--yes
        const userArgs = args.filter(a => a !== '-y' && a !== '--yes');
        // 在包名之后插入 -- 分隔符，确保后续参数不被 npm 截断
        const pkgIdx = userArgs.findIndex(a => !a.startsWith('-'));
        if (pkgIdx >= 0) {
          const beforePkg = userArgs.slice(0, pkgIdx);
          const pkgAndAfter = userArgs.slice(pkgIdx);
          args = [...resolved.extraArgs, ...beforePkg, ...pkgAndAfter.slice(0, 1), '--', ...pkgAndAfter.slice(1)];
        } else {
          args = [...resolved.extraArgs, ...userArgs];
        }
      }

      // 启动子进程
      this.process = spawn(command, args, {
        cwd: this.config.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
        windowsHide: true,
      });

      // 监听输出
      this.process.stdout?.setEncoding('utf-8');
      this.process.stdout?.on('data', (chunk) => this.handleOutput(chunk));

      // 监听错误输出
      this.process.stderr?.setEncoding('utf-8');
      this.process.stderr?.on('data', (chunk) => {
        this.log(`[stderr] ${chunk}`, 'warn');
      });

      // 监听进程退出 — 触发自动重连
      this.process.on('exit', (code, signal) => {
        this.log(`Process exited with code ${code}, signal ${signal}`, 'warn');
        const prevState = this.state;
        this.state = 'closed';
        this.rejectAllPending(new Error(`MCP server process exited: ${code ?? signal}`));

        // 非主动关闭且之前是 ready 状态 → 尝试重连（捕获 unhandled rejection）
        if (!this.intentionalClose && prevState === 'ready') {
          this.reconnect().catch((err) => {
            this.log(`Reconnect unhandled error: ${err instanceof Error ? err.message : String(err)}`, 'error');
          });
        }
      });

      // 监听进程错误
      this.process.on('error', (error) => {
        this.log(`Process error: ${error.message}`, 'error');
        this.state = 'error';
        this.rejectAllPending(error);
      });

      // 发送 MCP initialize 握手
      await this.performInitialize();

      this.reconnectAttempts = 0; // 成功连接后重置重连计数
      this.log('MCP server started successfully');
    } catch (error) {
      this.state = 'error';
      this.log(`Failed to start: ${error}`, 'error');
      // 清理失败的进程，防止僵尸进程
      if (this.process) {
        try {
          this.process.stdout?.removeAllListeners();
          this.process.stderr?.removeAllListeners();
          this.process.removeAllListeners();
          crossPlatformKill(this.process, 'SIGKILL');
        } catch { /* 忽略关闭错误 */ }
        this.process = undefined;
      }
      throw error;
    }
  }

  /**
   * MCP 协议 initialize 握手
   */
  private async performInitialize(): Promise<void> {
    try {
      const result = await this.call<{
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        serverInfo: { name: string; version: string };
      }>('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true },
        },
        clientInfo: {
          name: 'xuanji',
          version: '0.9.0',
        },
      });

      this.serverCapabilities = result.capabilities;
      this.serverInfo = result.serverInfo;
      this.log(`Initialize successful: server=${result.serverInfo?.name ?? 'unknown'}, protocol=${result.protocolVersion}`);

      // 发送 initialized 通知
      this.sendNotification('notifications/initialized');

      this.state = 'ready';
    } catch (error) {
      // 如果服务器不支持 initialize（旧版 MCP），降级处理
      this.log(`Initialize failed (falling back to direct mode): ${error}`, 'warn');
      this.state = 'ready';
    }
  }

  /**
   * 发送 JSON-RPC 通知（无 id，不期望响应）
   */
  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };

    this.log(`-> notification: ${JSON.stringify(notification)}`);
    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  /**
   * 自动重连
   */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.intentionalClose) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.log(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached for "${this.config.name}"`, 'error');
      this.state = 'error';
      this.emit('reconnect_failed', this.config.name);
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), MAX_RECONNECT_DELAY);

    this.log(`Reconnecting "${this.config.name}" in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, 'warn');
    this.emit('reconnecting', { name: this.config.name, attempt: this.reconnectAttempts, delay });

    await sleep(delay);

    // 延迟后再次检查：close() 可能在等待期间被调用
    if (this.intentionalClose) {
      this.reconnecting = false;
      return;
    }

    // 清理旧进程（防止僵尸进程累积）
    if (this.process) {
      try {
        this.process.stdout?.removeAllListeners();
        this.process.stderr?.removeAllListeners();
        this.process.removeAllListeners();
        crossPlatformKill(this.process, 'SIGKILL');
      } catch { /* 忽略旧进程清理错误 */ }
      this.process = undefined;
    }

    // 清理状态
    this.state = 'uninitialized';
    this.outputBuffer = '';
    this.toolsCache = undefined;
    this.promptsCache = undefined;
    this.resourcesCache = undefined;

    try {
      await this.start();
      this.log(`Reconnected to "${this.config.name}" successfully`);
      this.emit('reconnected', this.config.name);
    } catch (error) {
      this.log(`Reconnect failed: ${error}`, 'error');
      // start() 内部会在 exit 时再次触发 reconnect
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * 获取工具列表
   */
  async listTools(): Promise<MCPTool[]> {
    if (this.toolsCache) {
      return this.toolsCache;
    }

    const result = await this.call<ListToolsResult>('tools/list');
    this.toolsCache = result.tools ?? [];
    return this.toolsCache;
  }

  /**
   * 获取 Prompt 列表
   */
  async listPrompts(): Promise<MCPPrompt[]> {
    if (this.promptsCache) {
      return this.promptsCache;
    }

    const result = await this.call<ListPromptsResult>('prompts/list');
    this.promptsCache = result.prompts ?? [];
    return this.promptsCache;
  }

  /**
   * 获取资源列表
   */
  async listResources(): Promise<MCPResource[]> {
    if (this.resourcesCache) {
      return this.resourcesCache;
    }

    const result = await this.call<ListResourcesResult>('resources/list');
    this.resourcesCache = result.resources ?? [];
    return this.resourcesCache;
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    const params: CallToolParams = {
      name,
      arguments: args,
    };
    return this.call<CallToolResult>('tools/call', params);
  }

  /**
   * 获取 Prompt
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    const params: GetPromptParams = {
      name,
      arguments: args,
    };
    return this.call<GetPromptResult>('prompts/get', params);
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<ResourceContent[]> {
    const params: ReadResourceParams = {
      uri,
    };
    const result = await this.call<ReadResourceResult>('resources/read', params);
    return result.contents ?? [];
  }

  /**
   * 发送 JSON-RPC 请求
   */
  private async call<T>(method: string, params?: unknown): Promise<T> {
    if (this.state !== 'ready' && method !== 'initialize') {
      await this.start();
    }

    if (!this.process?.stdin) {
      throw new Error('MCP server stdin is not available');
    }

    const id = this.nextId++;
    if (this.nextId > 2_000_000_000) {
      this.nextId = 1;
    }
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params: params as Record<string, unknown>,
    };

    this.log(`-> ${JSON.stringify(request)}`);

    // 创建 Promise
    const promise = new Promise<T>((resolve, reject) => {
      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    });

    // 发送请求
    this.process.stdin.write(JSON.stringify(request) + '\n');

    return promise;
  }

  /**
   * 处理输出（支持多行 JSON）
   */
  private handleOutput(chunk: string): void {
    this.outputBuffer += chunk;

    // 防止恶意服务器发送无换行符的超大数据包
    if (this.outputBuffer.length > MAX_OUTPUT_BUFFER_SIZE) {
      this.log(`Output buffer exceeded ${MAX_OUTPUT_BUFFER_SIZE} bytes, resetting`, 'warn');
      this.outputBuffer = '';
    }

    // 尝试解析完整的 JSON 行
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() ?? ''; // 保留最后一个不完整的行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed) as JSONRPCResponse;
        this.handleResponse(response);
      } catch (error) {
        this.log(`Failed to parse JSON: ${trimmed}`, 'error');
      }
    }
  }

  /**
   * 处理响应
   */
  private handleResponse(response: JSONRPCResponse): void {
    this.log(`<- ${JSON.stringify(response)}`);

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.log(`Received response for unknown request ID: ${response.id}`, 'warn');
      return;
    }

    // 清理
    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    // 判断是否为错误
    const isError = (resp: JSONRPCResponse): resp is { jsonrpc: '2.0'; id: number | string; error: { code: number; message: string; data?: unknown } } => {
      return 'error' in resp;
    };

    if (isError(response)) {
      pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * 拒绝所有待处理的请求
   */
  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.state === 'closed') {
      return;
    }

    this.log('Closing MCP server...');
    this.intentionalClose = true; // 防止触发重连

    // 拒绝所有待处理的请求
    this.rejectAllPending(new Error('MCP client is closing'));

    // 关闭进程并等待退出
    if (this.process) {
      const proc = this.process;
      this.process = undefined;

      // 清理所有事件监听器（防止内存泄漏）
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners();

      // 等待进程退出（最多 5 秒）
      await new Promise<void>((resolve) => {
        const forceKillTimer = setTimeout(() => {
          try { crossPlatformKill(proc, 'SIGKILL'); } catch { /* ignore */ }
          resolve();
        }, 5000);

        proc.once('exit', () => {
          clearTimeout(forceKillTimer);
          resolve();
        });

        crossPlatformKill(proc, 'SIGTERM');
      });
    }

    this.state = 'closed';
    this.log('MCP server closed');
  }

  /**
   * 获取当前状态
   */
  getState(): MCPServerState {
    return this.state;
  }

  /**
   * 获取服务器名称
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * 获取服务器信息（initialize 握手后可用）
   */
  getServerInfo(): { name: string; version: string } | undefined {
    return this.serverInfo;
  }

  /**
   * 获取服务器能力（initialize 握手后可用）
   */
  getServerCapabilities(): Record<string, unknown> | undefined {
    return this.serverCapabilities;
  }

  /**
   * 获取当前重连尝试次数
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  invalidateToolsCache(): void {
    this.toolsCache = undefined;
  }

  invalidateResourcesCache(): void {
    this.resourcesCache = undefined;
  }

  /**
   * 日志输出
   */
  protected log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.debug && level === 'info') {
      return;
    }

    const mcpLog = logger.child({ module: `MCPClient:${this.config.name}` });
    switch (level) {
      case 'error':
        mcpLog.error(message);
        break;
      case 'warn':
        mcpLog.warn(message);
        break;
      default:
        mcpLog.debug(message);
    }
  }
}
