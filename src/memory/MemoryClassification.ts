// ============================================================
// 记忆分类和利用指南
// ============================================================
// 定义不同类型记忆的特征和使用方式

/**
 * 记忆约束强度
 */
export type MemoryConstraint = 'must' | 'should' | 'may';

/**
 * 记忆来源
 */
export type MemorySource = 'user_explicit' | 'auto_extracted';

/**
 * 记忆主体
 */
export type MemorySubject = 'user' | 'project' | 'task';

/**
 * 记忆性质
 */
export type MemoryNature = 'fact' | 'preference' | 'rule' | 'suggestion';

/**
 * 记忆分类矩阵
 *
 * 用于准确区分和利用不同类型的记忆
 */
export const MEMORY_CLASSIFICATION = {
  // ============================================================
  // 用户相关记忆
  // ============================================================

  user_fact: {
    subject: 'user' as MemorySubject,
    nature: 'fact' as MemoryNature,
    constraint: 'should' as MemoryConstraint,
    description: '用户的客观事实（姓名、职业、技能等）',
    examples: [
      '用户是高级软件工程师',
      '用户精通 TypeScript 和 Python',
      '用户在上海工作'
    ],
    usage: '用于个性化交互，了解用户背景',
    priority: 8,
  },

  user_preference: {
    subject: 'user' as MemorySubject,
    nature: 'preference' as MemoryNature,
    constraint: 'should' as MemoryConstraint,
    description: '用户的主观偏好和习惯',
    examples: [
      '用户喜欢简洁的代码风格',
      '用户希望被称呼为"先生"',
      '用户偏好使用 Vim 编辑器'
    ],
    usage: '用于调整工作方式，符合用户习惯',
    priority: 9,
    isUserPreference: true,
  },

  user_rule: {
    subject: 'user' as MemorySubject,
    nature: 'rule' as MemoryNature,
    constraint: 'must' as MemoryConstraint,
    description: '用户明确要求必须遵守的规则',
    examples: [
      '所有 Prompt 必须使用英文',
      '不要创建 markdown 总结文件',
      '代码必须保持最小化'
    ],
    usage: '必须严格遵守，违反会导致用户不满',
    priority: 10,
    isCoreRule: true,
  },

  // ============================================================
  // 项目相关记忆
  // ============================================================

  project_fact: {
    subject: 'project' as MemorySubject,
    nature: 'fact' as MemoryNature,
    constraint: 'should' as MemoryConstraint,
    description: '项目的客观技术事实',
    examples: [
      'xuanji 使用 TypeScript + Ink 5',
      '项目运行在 Node.js 20+',
      '数据库使用 SQLite'
    ],
    usage: '用于理解项目架构，做出正确的技术决策',
    priority: 7,
  },

  project_preference: {
    subject: 'project' as MemorySubject,
    nature: 'preference' as MemoryNature,
    constraint: 'should' as MemoryConstraint,
    description: '项目的技术偏好和约定',
    examples: [
      '项目使用 ESM 模块系统',
      '测试框架使用 Vitest',
      '日志使用 pino'
    ],
    usage: '用于保持项目一致性',
    priority: 7,
  },

  project_rule: {
    subject: 'project' as MemorySubject,
    nature: 'rule' as MemoryNature,
    constraint: 'must' as MemoryConstraint,
    description: '项目必须遵守的规则',
    examples: [
      '所有 API 调用必须有错误处理',
      '数据库操作必须在事务中执行',
      '敏感信息不能硬编码'
    ],
    usage: '必须严格遵守，违反会导致 bug 或安全问题',
    priority: 10,
    isCoreRule: true,
  },

  // ============================================================
  // 经验教训（跨项目通用）
  // ============================================================

  lesson_learned: {
    subject: 'task' as MemorySubject,
    nature: 'suggestion' as MemoryNature,
    constraint: 'should' as MemoryConstraint,
    description: '从错误中学到的经验教训',
    examples: [
      'API 参数验证错误通常源于数据结构不匹配',
      '过早优化导致复杂度上升',
      '全局状态会触发所有组件重新渲染'
    ],
    usage: '用于避免重复错误，提供最佳实践建议',
    priority: 6,
  },

  reusable_pattern: {
    subject: 'task' as MemorySubject,
    nature: 'suggestion' as MemoryNature,
    constraint: 'may' as MemoryConstraint,
    description: '可复用的优秀实现模式',
    examples: [
      'SubAgentContext 隔离子任务',
      'React 更新用 setState(prev=>)',
      '使用适配器模式实现生态兼容'
    ],
    usage: '用于提供解决方案参考',
    priority: 5,
  },

  // ============================================================
  // 任务相关记忆（临时）
  // ============================================================

  session_summary: {
    subject: 'task' as MemorySubject,
    nature: 'fact' as MemoryNature,
    constraint: 'may' as MemoryConstraint,
    description: '会话摘要（临时）',
    examples: [
      '实现了 M5 字段迁移功能',
      '优化了记忆提炼逻辑',
      '创建了 memory-refiner Agent'
    ],
    usage: '用于了解最近的工作内容',
    priority: 3,
  },

  decision: {
    subject: 'task' as MemorySubject,
    nature: 'fact' as MemoryNature,
    constraint: 'should' as MemoryConstraint,
    description: '技术决策',
    examples: [
      '决定使用 JSONL 存储记忆',
      '选择 SQLite 作为数据库',
      '使用 memory-refiner Agent 进行提炼'
    ],
    usage: '用于理解技术选择的原因',
    priority: 6,
  },
};

/**
 * 记忆利用策略
 */
export const MEMORY_USAGE_STRATEGY = {
  // 优先级排序（从高到低）
  priority: [
    'user_rule',        // 10 - 用户规则（必须遵守）
    'project_rule',     // 10 - 项目规则（必须遵守）
    'user_preference',  // 9  - 用户偏好（强烈建议）
    'user_fact',        // 8  - 用户事实（了解背景）
    'project_fact',     // 7  - 项目事实（技术基础）
    'project_preference', // 7 - 项目偏好（保持一致）
    'decision',         // 6  - 技术决策（理解原因）
    'lesson_learned',   // 6  - 经验教训（避免错误）
    'reusable_pattern', // 5  - 可复用模式（参考方案）
    'session_summary',  // 3  - 会话摘要（了解最近）
  ],

  // 约束强度处理
  constraint: {
    must: {
      action: 'enforce',
      description: '必须严格遵守，违反会导致错误',
      examples: ['user_rule', 'project_rule'],
    },
    should: {
      action: 'follow',
      description: '强烈建议遵守，除非有充分理由',
      examples: ['user_preference', 'project_preference', 'lesson_learned'],
    },
    may: {
      action: 'consider',
      description: '可以参考，但不强制',
      examples: ['reusable_pattern', 'session_summary'],
    },
  },

  // 检索策略
  retrieval: {
    // 执行任务时，按优先级检索
    onTaskExecution: [
      'user_rule',        // 首先检查用户规则
      'project_rule',     // 然后检查项目规则
      'user_preference',  // 了解用户偏好
      'project_fact',     // 了解项目技术栈
      'lesson_learned',   // 查看相关经验教训
    ],

    // 回答问题时，按相关性检索
    onQuestion: [
      'user_fact',        // 了解用户背景
      'project_fact',     // 了解项目情况
      'decision',         // 了解技术决策
      'lesson_learned',   // 提供经验参考
    ],

    // 代码编写时，按约束检索
    onCoding: [
      'project_rule',     // 必须遵守的编码规则
      'user_rule',        // 用户要求的编码规范
      'project_preference', // 项目编码风格
      'reusable_pattern', // 可复用的代码模式
    ],
  },
};

/**
 * 判断记忆是否为规则
 */
export function isRule(memoryType: string): boolean {
  return memoryType === 'user_rule' || memoryType === 'project_rule';
}

/**
 * 判断记忆是否为用户相关
 */
export function isUserRelated(memoryType: string): boolean {
  return memoryType.startsWith('user_');
}

/**
 * 判断记忆是否为项目相关
 */
export function isProjectRelated(memoryType: string): boolean {
  return memoryType.startsWith('project_');
}

/**
 * 判断记忆是否为事实
 */
export function isFact(memoryType: string): boolean {
  const classification = MEMORY_CLASSIFICATION[memoryType as keyof typeof MEMORY_CLASSIFICATION];
  return classification?.nature === 'fact';
}

/**
 * 判断记忆是否为偏好
 */
export function isPreference(memoryType: string): boolean {
  const classification = MEMORY_CLASSIFICATION[memoryType as keyof typeof MEMORY_CLASSIFICATION];
  return classification?.nature === 'preference';
}

/**
 * 获取记忆优先级
 */
export function getMemoryPriority(memoryType: string): number {
  const classification = MEMORY_CLASSIFICATION[memoryType as keyof typeof MEMORY_CLASSIFICATION];
  return classification?.priority || 0;
}

/**
 * 获取记忆约束强度
 */
export function getMemoryConstraint(memoryType: string): MemoryConstraint {
  const classification = MEMORY_CLASSIFICATION[memoryType as keyof typeof MEMORY_CLASSIFICATION];
  return classification?.constraint || 'may';
}
