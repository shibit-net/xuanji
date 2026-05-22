/**
 * FilteredToolRegistry — 工具注册表包装器
 *
 * 职责：
 * 1. 工具白名单过滤（agent 权限控制）
 * 2. 独立工作目录管理（消除 change_directory 全局副作用）
 * 3. 注入 _cwd + agent 上下文到工具调用
 */

import * as path from 'node:path';
import type { IToolRegistry } from '@/core/types';

/** 临时子 agent 的默认工具集（当 LLM 未指定 tools 时使用） */
export const DEFAULT_SUBAGENT_TOOLS = [
  'read_file', 'glob', 'grep', 'list_directory',
  'write_file', 'edit_file', 'bash',
  'memory_search', 'memory_graph',
  'ssh_exec', 'ssh_read', 'ssh_write', 'ssh_list',
];

/** L2 行为层编排工具集 — 加载 L2 时自动注入 */
const L2_ORCHESTRATION_TOOLS = [
  'task', 'agent_team', 'list_agents', 'match_agent', 'list_scenes',
  'task_control', 'task_output',
];

/** 任务管理工具 — 有创建能力就必须有管理能力 */
const TASK_MANAGEMENT_TOOLS = ['task_control', 'task_output'];
/** 编排发现工具 — 有 task/agent_team 就必须有动态发现能力 */
const ORCHESTRATION_DISCOVERY_TOOLS = ['list_scenes', 'list_agents', 'match_agent'];
const TASK_CREATION_TOOLS = ['task', 'agent_team'];

/**
 * 自动补齐工具列表：
 * - 有 task/agent_team → 补 task_control + task_output（能创建必须能管理）
 * - 有 task/agent_team → 补 list_scenes + list_agents + match_agent（任务委派需要动态发现）
 * - complexity === 'complex' (L2 行为层) → 补全部编排工具
 */
export function augmentToolList(tools: string[], complexity?: string): string[] {
  const result = new Set(tools);

  const hasTaskCreation = tools.some((t) => TASK_CREATION_TOOLS.includes(t));
  if (hasTaskCreation) {
    for (const t of TASK_MANAGEMENT_TOOLS) result.add(t);
    for (const t of ORCHESTRATION_DISCOVERY_TOOLS) result.add(t);
  }

  if (complexity === 'complex') {
    for (const t of L2_ORCHESTRATION_TOOLS) result.add(t);
  }

  return [...result];
}

/** 路径类工具名集合（input.path 需要针对 workingDir 解析相对路径） */
const PATH_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'list_directory', 'grep', 'glob',
]);

export type ToolExecuteHook = (name: string, input: Record<string, unknown>) => void;

export class FilteredToolRegistry implements IToolRegistry {
  private inner: IToolRegistry;
  private allowedTools: Set<string> | null;
  private allowAll: boolean;
  private agentContext?: { agentId: string; agentName: string };
  private workingDir: string;
  private onBeforeExecute: ToolExecuteHook | null = null;

  constructor(
    inner: IToolRegistry,
    allowedTools: string[] | null | undefined,
    agentContext?: { agentId: string; agentName: string },
    workingDir?: string,
  ) {
    this.inner = inner;
    this.allowAll = allowedTools === null || allowedTools === undefined;
    this.allowedTools = this.allowAll ? null : new Set(allowedTools);
    this.agentContext = agentContext;
    this.workingDir = workingDir || process.cwd();
  }

  /** 设置工具执行前回调（用于项目检测等） */
  setOnBeforeExecute(hook: ToolExecuteHook | null): void {
    this.onBeforeExecute = hook;
  }

  register(): void {
    throw new Error('FilteredToolRegistry does not support register()');
  }

  unregister(): void {
    throw new Error('FilteredToolRegistry does not support unregister()');
  }

  get(name: string): any | undefined {
    if (this.allowAll) return this.inner.get(name);
    if (!this.allowedTools!.has(name)) return undefined;
    return this.inner.get(name);
  }

  getAll(): any[] {
    if (this.allowAll) return this.inner.getAll();
    return this.inner.getAll().filter((t: any) =>
      this.allowedTools!.has(t.name)
    );
  }

  getSchemas(): any[] {
    return this.getAll().map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  /** 委托给 inner registry 的 getMCPSchemas() */
  getMCPSchemas(): Array<{ serverName: string; toolName: string; description: string; inputSchema: object }> {
    if (typeof (this.inner as any).getMCPSchemas === 'function') {
      return (this.inner as any).getMCPSchemas();
    }
    return [];
  }

  has(name: string): boolean {
    if (this.allowAll) return this.inner.has(name);
    if (!this.allowedTools!.has(name)) return false;
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

    this.onBeforeExecute?.(name, input);

    const result = await this.inner.execute(name, input, signal);

    // change_directory 成功后，更新 workingDir
    if (name === 'change_directory' && !result.isError) {
      this.workingDir = process.cwd();
    }

    return result;
  }
}
