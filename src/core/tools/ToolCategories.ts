// ============================================================
// M6 工具系统 — 工具分类定义
// ============================================================
//
// 将工具分为三个层次：
// 1. 核心工具（CORE）：所有场景都需要的基础工具
// 2. 元能力工具（META）：任务管理相关工具，始终可用
// 3. 场景工具（SCENE）：按场景分组的专用工具

import type { SceneType } from '@/core/prompt/types';

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
   * - task: SubAgent 调度（旧）
   * - delegate: 委托子 Agent 执行任务
   * - orchestrate: 编排多个并行/串行子任务
   * - pipeline: 管道式多步骤执行
   * - list_agents: 列出可用 Agent
   * - match_agent: 匹配最佳 Agent
   *
   * 记忆系统:
   * - retrieve_memory: 检索历史记忆（所有 Agent 可用）
   *
   * 系统管理:
   * - butler_daemon: 智能管家守护进程
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
    'task_output',
    'plan_review',
    'enter_plan_mode',
    'exit_plan_mode',
    // Multi-Agent
    'task',
    'delegate',
    'orchestrate',
    'pipeline',
    'list_agents',
    'match_agent',
    // 记忆系统
    'retrieve_memory',
    // 系统管理
    'butler_daemon',
    'enter_worktree',
    // 调试/测试
    'sleep',
  ] as const,

  /**
   * 场景工具（按场景分组）
   *
   * 双索引：同时支持 Scene 名称（新）和 Skill ID（旧，降级兼容）
   */
  SCENE: {
    // === 按 Scene 名称索引（新） ===
    /**
     * 编程场景
     * - write_file: 创建文件
     * - edit_file: 编辑文件
     * - multi_edit: 批量编辑
     * - list_directory (ls): 目录浏览
     * - notebook_edit: Notebook 编辑
     */
    'coding': [
      'write_file',
      'edit_file',
      'multi_edit',
      'list_directory',  // 实际工具名
      'notebook_edit',
    ],

    /**
     * 生活场景
     * - memory_store / memory_search: 记忆管理
     * - reminder_set / reminder_check: 提醒管理
     * - web_search / web_fetch: Web 信息获取
     */
    'life': [
      'memory_store',
      'memory_search',
      'reminder_set',
      'reminder_check',
      'web_search',
      'web_fetch',
    ],

  } as Record<string, readonly string[]>,
} as const;

/**
 * 从 Skill/Scene 的 requiredTools 自动提取场景工具
 *
 * @param id - Scene 名称或 Skill ID
 * @param requiredTools - 声明的 requiredTools（可选）
 * @returns 对应的场景工具列表
 *
 * 优先级：
 * 1. requiredTools（如果提供）
 * 2. TOOL_CATEGORIES.SCENE[id]（硬编码默认值）
 * 3. 两者合并去重
 */
export function getSceneTools(id: string, requiredTools?: string[]): string[] {
  const hardcoded = TOOL_CATEGORIES.SCENE[id] || [];
  const fromSkill = requiredTools || [];

  // 合并去重
  return [...new Set([...hardcoded, ...fromSkill])];
}

/**
 * 计算指定场景/Skill 列表应该启用的所有工具
 *
 * @param skills - 激活的场景或 Skill 列表
 * @returns 应该启用的工具名称集合
 */
export function computeAllowedTools(skills: Array<{ id: string; requiredTools?: string[] }>): Set<string> {
  const allowed = new Set<string>();

  // 1. 核心工具（始终可用）
  TOOL_CATEGORIES.CORE.forEach(tool => allowed.add(tool));

  // 2. 元能力工具（始终可用）
  TOOL_CATEGORIES.META.forEach(tool => allowed.add(tool));

  // 3. 激活场景/Skill 的工具
  for (const skill of skills) {
    const sceneTools = getSceneTools(skill.id, skill.requiredTools);
    sceneTools.forEach(tool => allowed.add(tool));
  }

  return allowed;
}

/**
 * 基于 Scene 计算允许的工具集
 *
 * @param scene - 场景类型
 * @param extraTools - 额外的工具列表（来自 SceneTemplate.requiredTools）
 * @returns 应该启用的工具名称集合
 */
export function computeAllowedToolsByScene(scene: SceneType, extraTools?: string[]): Set<string> {
  return computeAllowedTools([{ id: scene, requiredTools: extraTools }]);
}
