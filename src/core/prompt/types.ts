/**
 * ============================================================
 * System Prompt 模块 — 类型定义
 * ============================================================
 * 分层意图感知 System Prompt 架构的核心类型。
 *
 * 层级：
 *   L0 核心层 — 身份 + 安全底线（始终加载）
 *   L1 能力层 — 按场景选一个（standard/complex 加载）
 *   L2 行为层 — Planning + 循环控制（仅 complex 加载）
 *   L3 上下文层 — 项目上下文（动态注入）
 */

// ─── Prompt 构建事件 ────────────────────────────────────

/**
 * Prompt 构建事件类型
 */
export type PromptBuildEventType =
  | 'build:start'
  | 'intent:analyzed'
  | 'intent:match'
  | 'components:selected'
  | 'build:complete';

/**
 * Prompt 构建事件数据
 */
export interface PromptBuildEvent {
  type: PromptBuildEventType;
  timestamp: number;
  agentId: string;
  data?: any;
}

/**
 * Prompt 构建事件监听器
 */
export type PromptBuildEventListener = (event: PromptBuildEvent) => void;

// ─── 基础类型 ────────────────────────────────────────

/**
 * 场景类型 — 开放字符串类型。
 *
 * 单值示例: 'coding' | 'life'。
 * 支持逗号分隔多 scene: 'coding,debugging'（IntentRouter L1 多 scene 路由结果）。
 * 新增场景只需在 prompt 组件中声明 scenes: ['xxx']，LayeredPromptBuilder 自动扫描。
 */
export type SceneType = string;

/** Prompt 层级 */
export type PromptLayer = 'L0' | 'L1' | 'L2' | 'L3';

/** 意图复杂度 */
export type IntentComplexity = 'simple' | 'standard' | 'complex';

// ─── 场景匹配配置 ────────────────────────────────────

/** 场景匹配配置 — 随 PromptComponent 一起注册 */
export interface SceneMatchConfig {
  /** 关键词（自然语言短语，空格分隔，同时用于 L1 LLM prompt 注入和向量匹配） */
  keywords: string;
  /** 场景描述文本（Embedding 匹配用，启动时自动向量化） */
  description: string;
  /** 所需能力列表（用于 keyword 匹配时选择 agent） */
  requiredCapabilities?: string[];
}

// ─── PromptComponent ─────────────────────────────────

/**
 * PromptComponent — 分层 Prompt 的组成单元
 *
 * 替代旧的 PromptBlock + SceneTemplate，统一为一个接口。
 */
export interface PromptComponent {
  /** 唯一标识（如 'l0-identity', 'l1-coding'） */
  id: string;

  /** 人类可读名称 */
  name: string;

  /** 所属层级 */
  layer: PromptLayer;

  /** 适用场景（L1 组件必填，其他层可选） */
  scenes?: SceneType[];

  /** 优先级（同层内排序，越高越先输出） */
  priority: number;

  /** 预估 token 数（用于统计和调试） */
  estimatedTokens: number;

  /** 该组件需要的工具列表 */
  requiredTools?: string[];

  /** Extended Thinking 配置 */
  thinking?: import('@/core/types').ThinkingConfig;

  /** 场景匹配配置（仅 L1 组件需要） */
  match?: SceneMatchConfig;

  /** 组件来源（用户目录 or 项目目录） */
  source?: 'user' | 'project';

  /** 是否启用（用于 GUI 管理） */
  enabled?: boolean;

  /** 内部场景：list_scenes 不返回，不可删除，System Prompt 配置页正常展示和编辑 */
  internal?: boolean;

  /** 渲染方法 */
  render(context: PromptBuildContext): string | Promise<string>;
}

// ─── 意图分析结果 ─────────────────────────────────────

/** IntentAnalyzer 分析结果 */
export interface IntentAnalysis {
  /** 匹配的场景 */
  scene: SceneType | null;
  /** 匹配的 agent */
  agent: string | null;
  /** 复杂度 */
  complexity: IntentComplexity;
  /** 匹配方式 */
  matchMethod: 'keyword' | 'embedding' | 'default';
  /** 匹配置信度（0-1） */
  confidence: number;
}

// ─── Prompt 构建结果 ──────────────────────────────────

/** LayeredPromptBuilder 构建结果 */
export interface PromptBuildResult {
  /** 最终 prompt 文本 */
  prompt: string;
  /** 使用的组件 ID 列表 */
  components: string[];
  /** 匹配的场景 */
  scene: SceneType | null;
  /** 复杂度 */
  complexity: IntentComplexity;
  /** 需要的工具列表（合并所有组件的 requiredTools） */
  requiredTools: string[];
  /** Extended Thinking 配置（取最高优先级组件的） */
  thinking?: import('@/core/types').ThinkingConfig;
  /** 预估总 token 数 */
  estimatedTokens: number;
}

// ─── 构建上下文 ───────────────────────────────────────

/** Prompt 构建上下文 */
export interface PromptBuildContext {
  /** 语言 */
  language?: string;
  /** 工具列表（传给需要引用工具的组件） */
  toolList?: any[];
  /** 额外参数 */
  [key: string]: any;
}

// ─── 构建选项 ─────────────────────────────────────────

/** LayeredPromptBuilder 构建选项 */
export interface LayeredPromptBuildOptions {
  /** 用户消息（用于意图分析） */
  userMessage?: string;
  /** 强制场景（跳过意图分析） */
  scene?: SceneType | 'auto';
  /** 强制复杂度（跳过复杂度分析） */
  complexity?: IntentComplexity;
  /** Agent 类型（从意图分析结果传入） */
  agent?: string;
  /** 匹配方法（从意图分类结果传入） */
  matchMethod?: 'keyword' | 'embedding' | 'default' | 'llm';
  /** 语言 */
  language?: string;
  /** 工具列表 */
  toolList?: any[];
  /** 应用配置（传给 PromptComponent.render 的 context） */
  config?: import('@/core/types').AppConfig;
  /** Persona 配置（机器人性格/称呼等） */
  persona?: import('@/shared/types/config').PersonaConfig;
}
