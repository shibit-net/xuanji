/**
 * ============================================================
 * Skill System - Type Definitions
 * ============================================================
 * 定义 Skill 系统的核心类型和接口
 */

/**
 * Skill 元数据
 */
export interface SkillMetadata {
  /** 唯一标识 (e.g., "xuanji-assistant") */
  id: string;

  /** 人类可读名称 */
  name: string;

  /** 语义版本 (e.g., "1.0.0") */
  version: string;

  /** 功能描述 */
  description: string;

  /** 分类 */
  category: 'prompt' | 'agent' | 'workflow';

  /** 标签 (e.g., ["system", "core"]) */
  tags: string[];

  /** 作者 */
  author?: string;

  /** 创建时间 */
  createdAt?: Date;

  /** 更新时间 */
  updatedAt?: Date;
}

/**
 * Skill 参数定义
 */
export interface SkillParameter {
  /** 参数名称 */
  name: string;

  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** 参数描述 */
  description: string;

  /** 默认值 */
  default?: any;

  /** 是否必需 */
  required?: boolean;

  /** 枚举值 */
  enum?: any[];

  /** JSON Schema 校验 */
  schema?: Record<string, any>;
}

/**
 * Skill 渲染选项
 */
export interface SkillRenderOptions {
  /** 参数 */
  params?: Record<string, any> & {
    /** 依赖 Skill 的返回值 (key 为 skillId, value 为渲染结果) */
    dependencies?: Record<string, string>;
  };

  /** 是否应用依赖 */
  includeDependencies?: boolean;

  /** 自定义参数转换 */
  transformer?: (content: string, params: Record<string, any>) => string;
}

/**
 * Skill 主接口
 */
export interface Skill<T = any> extends SkillMetadata {
  /** Skill 内容 (可以是 string, object 等) */
  content?: T;

  /** 参数定义 */
  parameters?: Record<string, SkillParameter>;

  /** 依赖的其他 Skill ID */
  dependencies?: string[];

  /** 冲突的 Skill ID */
  conflicts?: string[];

  /** 需要的工具 (e.g., ["read_file"]) */
  requiredTools?: string[];

  /** 是否启用 */
  enabled?: boolean;

  /** 优先级 (越高越先被使用) */
  priority?: number;

  /** 🆕 P1 优化：Extended Thinking 配置（Anthropic Claude 4.5+，可选） */
  thinking?: import('@/core/types').ThinkingConfig;

  /** 渲染方法 (用于 Prompt Skill, 支持同步和异步) */
  render?: (options?: SkillRenderOptions) => string | Promise<string>;

  /** 验证方法 */
  validate?: (input: any) => boolean;

  /** 执行方法 (用于 Agent/Workflow Skill) */
  execute?: (params?: Record<string, any>) => Promise<any>;

  /** 关联的斜杠命令 (用于 Workflow Skill，如 '/commit') */
  slashCommand?: string;

  /** 组合方法 */
  compose?: (skills: Skill[]) => string;
}

/**
 * Workflow Skill 执行结果
 */
export interface WorkflowResult {
  /** 是否成功 */
  success: boolean;
  /** 输出文本（显示给用户） */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 额外元数据 */
  metadata?: Record<string, any>;
}

/**
 * Skill 加载选项
 */
export interface SkillLoadOptions {
  /** 是否加载内置 Skill */
  loadBuiltin?: boolean;

  /** 是否加载自定义 Skill */
  loadCustom?: boolean;

  /** 自定义 Skill 路径 */
  customPath?: string;

  /** 过滤函数 */
  filter?: (skill: Skill) => boolean;

  /** 加载超时 (毫秒) */
  timeout?: number;
}

/**
 * Skill 注册表选项
 */
export interface SkillRegistryOptions {
  /** 自动加载 */
  autoLoad?: boolean;

  /** 自定义 Skill 路径 */
  customPath?: string;

  /** 缓存大小 */
  cacheSize?: number;

  /** 是否验证依赖 */
  validateDependencies?: boolean;
}

/**
 * Skill 验证结果
 */
export interface SkillValidationResult {
  /** 是否有效 */
  valid: boolean;

  /** 错误信息 */
  errors: string[];

  /** 警告信息 */
  warnings: string[];

  /** 缺失的依赖 */
  missingDependencies?: string[];

  /** 冲突的 Skill */
  conflicts?: string[];
}

/**
 * Skill 查询过滤器
 */
export interface SkillQueryFilter {
  /** 分类 */
  category?: 'prompt' | 'agent' | 'workflow';

  /** 标签 */
  tags?: string[];

  /** 是否启用 */
  enabled?: boolean;

  /** 搜索关键词 */
  search?: string;
}

/**
 * Skill 组合结果
 */
export interface SkillComposeResult {
  /** 组合后的内容 */
  content: string;

  /** 使用的 Skill */
  skills: Skill[];

  /** 组合顺序 */
  order: string[];

  /** 元数据 */
  metadata: {
    totalSkills: number;
    totalDependencies: number;
    renderTime: number;
  };
}

/**
 * 始终加载的核心 Skill ID（不参与意图过滤和向量匹配）
 * 统一定义，避免 registry.ts 和 VectorSkillMatcher.ts 各自维护
 */
export const CORE_SKILL_IDS = new Set([
  'xuanji-assistant',
  'project-rules',
  'memory-context',
  'tool-guidance',
  'security-rules',
  'agent-rules',
]);
