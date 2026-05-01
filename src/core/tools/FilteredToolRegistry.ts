/**
 * FilteredToolRegistry — 工具注册表包装器
 *
 * 职责：
 * 1. 工具白名单过滤（子 agent 权限控制）
 * 2. 独立工作目录管理（消除 change_directory 全局副作用）
 * 3. 注入 _cwd + agent 上下文到工具调用
 *
 * 用于：
 * - 子 agent（SubAgentFactory）：过滤工具 + 独立 cwd
 * - 主 agent（SessionFactory）：仅独立 cwd（允许所有工具）
 */

import * as path from 'node:path';
import type { IToolRegistry } from '@/core/types';

/** 路径类工具名集合（input.path 需要针对 workingDir 解析相对路径） */
const PATH_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'list_directory', 'grep', 'glob',
]);

export class FilteredToolRegistry implements IToolRegistry {
  private inner: IToolRegistry;
  private allowedTools: Set<string> | null;
  private agentContext?: { agentId: string; agentName: string };
  private workingDir: string;
  private allowAll: boolean;

  constructor(
    inner: IToolRegistry,
    allowedTools?: string[] | null,
    agentContext?: { agentId: string; agentName: string },
    workingDir?: string,
  ) {
    this.inner = inner;
    this.allowAll = !allowedTools || allowedTools.length === 0;
    this.allowedTools = this.allowAll ? null : new Set(allowedTools);
    this.agentContext = agentContext;
    this.workingDir = workingDir || process.cwd();
  }

  register(): void {
    throw new Error('FilteredToolRegistry does not support register()');
  }

  unregister(): void {
    throw new Error('FilteredToolRegistry does not support unregister()');
  }

  get(name: string): any | undefined {
    if (!this.allowAll && !this.allowedTools!.has(name)) return undefined;
    return this.inner.get(name);
  }

  getAll(): any[] {
    const all = this.inner.getAll();
    if (this.allowAll) return all;
    return all.filter((t: any) => this.allowedTools!.has(t.name));
  }

  getSchemas(): any[] {
    return this.getAll().map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  has(name: string): boolean {
    if (!this.allowAll && !this.allowedTools!.has(name)) return false;
    return this.inner.has(name);
  }

  /** 获取当前工作目录 */
  getWorkingDir(): string {
    return this.workingDir;
  }

  async execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    if (!this.allowAll && !this.allowedTools!.has(name)) {
      return {
        content: `Tool "${name}" is not available in this sub-agent.`,
        isError: true,
      };
    }

    // 切换到 agent 的独立工作目录
    try { process.chdir(this.workingDir); } catch (e) { /* ignore */ }

    // 注入 agent 上下文到 ask_user
    if (name === 'ask_user' && this.agentContext) {
      input = {
        ...input,
        _agentId: this.agentContext.agentId,
        _agentName: this.agentContext.agentName,
      };
    }

    // 统一注入 _cwd，让所有工具使用 agent 独立的工作目录
    input = { ...input, _cwd: this.workingDir };

    // 路径类工具：相对路径基于 workingDir 解析
    if (PATH_TOOLS.has(name) && input.path) {
      const inputPath = input.path as string;
      if (!path.isAbsolute(inputPath)) {
        input = { ...input, path: path.resolve(this.workingDir, inputPath) };
      }
    }

    const result = await this.inner.execute(name, input, signal);

    // change_directory 成功后，更新 workingDir
    if (name === 'change_directory' && !result.isError) {
      this.workingDir = process.cwd();
    }

    return result;
  }
}
