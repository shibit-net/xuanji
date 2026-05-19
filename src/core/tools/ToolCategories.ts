// ============================================================
// M6 工具系统 — 工具分类定义
// ============================================================
//
// 将工具分为三个层次：
// 1. 核心工具（CORE）：所有场景都需要的基础工具
// 2. 元能力工具（META）：任务管理相关工具，始终可用

/**
 * 工具分类常量
 */
export const TOOL_CATEGORIES = {
  /**
   * 核心工具（所有场景都需要）
   * - read_file: 信息获取
   * - ask_user: 用户交互
   * - bash: 命令执行
   * - glob: 文件发现
   * - grep: 内容搜索
   */
  CORE: [
    'read_file',
    'ask_user',
    'bash',
    'glob',
    'grep',
  ] as const,

  /**
   * 元能力工具（任务管理、Multi-Agent、记忆、调试，始终可用）
   *
   * 任务管理:
   * - todo_create / todo_update / todo_list: 任务管理
   * - task_output: 后台任务输出查看
   * - plan_review: 计划审查
   * - enter_plan_mode / exit_plan_mode: Plan Mode 控制
   *
   * Multi-Agent:
   * - task: SubAgent 调度
   * - agent_team: 多 Agent 协作
   * - list_agents: 列出可用 Agent
   * - match_agent: 匹配最佳 Agent
   *
   * 系统管理:
   * - enter_worktree: 进入 Git 工作树
   *
   * 调试/测试:
   * - sleep: 延迟执行
   */
  META: [
    // 任务管理
    'todo_create',
    'todo_update',
    'todo_list',
    'todo_archive',
    'todo_clear',
    'task_output',
    'plan_review',
    'enter_plan_mode',
    'exit_plan_mode',
    // Multi-Agent
    'task',
    'agent_team',
    'list_agents',
    'match_agent',
    // 系统管理
    'enter_worktree',
    // 调试/测试
    'sleep',
  ] as const,

} as const;

/**
 * 工具权限需求类型
 */
export type ToolPermissionRequirement =
  | 'none'      // 无需权限检查（只读查询型工具）
  | 'fileRead'  // 需要文件读取权限
  | 'fileWrite' // 需要文件写入权限
  | 'bashExec'  // 需要命令执行权限
  | 'network';  // 需要网络访问权限

/**
 * 工具权限需求映射表
 *
 * 定义每个工具的天然权限需求，用于权限系统的精细化控制。
 * 未在此映射表中的工具默认需要最高权限（bashExec）。
 */
export const TOOL_PERMISSION_MAP: Record<string, ToolPermissionRequirement[]> = {
  // 无需权限检查的工具（天然安全）
  'ask_user': ['none'],
  'todo_create': ['none'],
  'todo_update': ['none'],
  'todo_list': ['none'],
  'todo_archive': ['none'],
  'todo_clear': ['none'],
  'list_agents': ['none'],
  'match_agent': ['none'],
  'plan_review': ['none'],
  'enter_plan_mode': ['none'],
  'exit_plan_mode': ['none'],
  'sleep': ['none'],

  // 只读文件操作
  'read_file': ['fileRead'],
  'list_directory': ['fileRead'],
  'grep': ['fileRead'],
  'glob': ['fileRead'],

  // 写入文件操作
  'write_file': ['fileWrite'],
  'edit_file': ['fileWrite'],
  'multi_edit': ['fileWrite'],
  'notebook_edit': ['fileWrite'],

  // 命令执行
  'bash': ['bashExec'],
  'task_output': ['bashExec'],
  'enter_worktree': ['bashExec'],

  // 网络操作
  'web_search': ['network'],
  'web_fetch': ['network'], // backward compat — 新 agent 调 web_search

  // SSH 远程操作
  'ssh_exec': ['bashExec', 'network'],
  'ssh_read': ['fileRead', 'network'],
  'ssh_write': ['fileWrite', 'network'],
  'ssh_list': ['fileRead', 'network'],

  // 复合权限
  'task': ['bashExec'], // SubAgent 可能执行任意操作
  'agent_team': ['bashExec'], // 多 Agent 协作可能执行任意操作



};

/**
 * 判断工具是否豁免权限检查
 *
 * 用于 PermissionMiddleware 快速跳过无副作用的工具。
 */
export function isPermissionExempt(toolName: string): boolean {
  const reqs = TOOL_PERMISSION_MAP[toolName];
  return reqs !== undefined && reqs.length === 1 && reqs[0] === 'none';
}

/**
 * 获取工具的权限需求列表
 *
 * 未知工具默认返回 bashExec（最高权限要求）。
 */
export function getToolPermissionRequirements(toolName: string): ToolPermissionRequirement[] {
  return TOOL_PERMISSION_MAP[toolName] ?? ['bashExec'];
}

