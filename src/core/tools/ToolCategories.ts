// ============================================================
// M6 工具系统 — 工具分类定义
// ============================================================
//
// 将工具分为三个层次：
// 1. 核心工具（CORE）：所有场景都需要的基础工具
// 2. 元能力工具（META）：任务管理相关工具，始终可用
// 3. 场景工具（SCENE）：按 Skill 场景分组的专用工具

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
   * 元能力工具（任务管理，始终可用）
   * - todo_*: 任务管理
   * - task: SubAgent 调度
   * - plan_review: 计划审查
   * - enter_plan_mode / exit_plan_mode: Plan Mode 控制
   */
  META: [
    'todo_create',
    'todo_update',
    'todo_list',
    'todo_get',
    'task',
    'plan_review',
    'enter_plan_mode',
    'exit_plan_mode',
  ] as const,

  /**
   * 场景工具（按 Skill 场景分组）
   *
   * 注意：这里的分组是硬编码的默认值，实际使用时会与
   * Skill.requiredTools 合并（优先使用 requiredTools）
   */
  SCENE: {
    /**
     * 编程助手场景
     * - write_file: 创建文件
     * - edit_file: 编辑文件
     * - multi_edit: 批量编辑
     * - ls: 目录浏览
     * - notebook_edit: Notebook 编辑
     */
    'code-assistant': [
      'write_file',
      'edit_file',
      'multi_edit',
      'ls',
      'notebook_edit',
    ],

    /**
     * 生活秘书场景
     * - memory_store / memory_search: 记忆管理
     * - reminder_set / reminder_check: 提醒管理
     * - web_search / web_fetch: Web 信息获取
     */
    'life-secretary': [
      'memory_store',
      'memory_search',
      'reminder_set',
      'reminder_check',
      'web_search',
      'web_fetch',
    ],
  } as const,
} as const;

/**
 * 从 Skill 的 requiredTools 自动提取场景工具
 *
 * @param skillId - Skill ID
 * @param requiredTools - Skill 声明的 requiredTools（可选）
 * @returns 该 Skill 对应的场景工具列表
 *
 * 优先级：
 * 1. Skill.requiredTools（如果提供）
 * 2. TOOL_CATEGORIES.SCENE[skillId]（硬编码默认值）
 * 3. 两者合并去重
 */
export function getSceneTools(skillId: string, requiredTools?: string[]): string[] {
  const hardcoded = TOOL_CATEGORIES.SCENE[skillId as keyof typeof TOOL_CATEGORIES.SCENE] || [];
  const fromSkill = requiredTools || [];

  // 合并去重
  return [...new Set([...hardcoded, ...fromSkill])];
}

/**
 * 计算指定 Skill 列表应该启用的所有工具
 *
 * @param skills - 激活的 Skill 列表
 * @returns 应该启用的工具名称集合
 */
export function computeAllowedTools(skills: Array<{ id: string; requiredTools?: string[] }>): Set<string> {
  const allowed = new Set<string>();

  // 1. 核心工具（始终可用）
  TOOL_CATEGORIES.CORE.forEach(tool => allowed.add(tool));

  // 2. 元能力工具（始终可用）
  TOOL_CATEGORIES.META.forEach(tool => allowed.add(tool));

  // 3. 激活 Skill 的场景工具
  for (const skill of skills) {
    const sceneTools = getSceneTools(skill.id, skill.requiredTools);
    sceneTools.forEach(tool => allowed.add(tool));
  }

  return allowed;
}
