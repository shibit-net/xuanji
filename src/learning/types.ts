// ============================================================
// 学习系统类型定义（Learning System Types）
// ============================================================

// ============================================================
// 经验教训系统（Lessons Learned System）
// ============================================================

/** 经验类型 */
export type LessonType =
  | 'success'            // 成功经验（做对了什么）
  | 'failure'            // 失败教训（哪里做错了）
  | 'best_practice'      // 最佳实践（什么方法最优）
  | 'pitfall'            // 常见陷阱（什么要避免）
  | 'optimization';      // 优化经验（如何改进）

/** 经验领域 */
export type LessonDomain =
  | 'coding'             // 代码编写
  | 'debugging'          // 调试
  | 'tool_usage'         // 工具使用
  | 'communication'      // 沟通理解
  | 'decision_making'    // 决策
  | 'workflow';          // 工作流程

/** 影响程度 */
export type ImpactLevel = 'critical' | 'major' | 'minor';

/** 发现方式 */
export type DiscoveryMethod = 'user_feedback' | 'tool_result' | 'self_reflection' | 'comparison';

/** 经验教训事件 */
export interface LessonEvent {
  id: string;
  timestamp: number;

  // 经验分类
  type: LessonType;              // 成功/失败/最佳实践/陷阱/优化
  domain: LessonDomain;          // 领域

  // 经验详情
  experience: {
    title: string;               // 经验标题（简洁）
    description: string;         // 详细描述
    impact: ImpactLevel;         // 影响程度
    discoveredBy: DiscoveryMethod;  // 如何发现
  };

  // 上下文
  context: {
    task: string;                // 当前任务
    userInput: string;           // 用户输入
    myAction: string;            // 我的行为
    files: string[];             // 涉及的文件
    toolsUsed: string[];         // 使用的工具
    cwd: string;                 // 工作目录
    projectType?: string;        // 项目类型
  };

  // 根本原因/成功因素（分析后填充）
  analysis?: LessonAnalysis;

  // 核心教训
  lesson?: CoreLesson;

  // 应用规则（如何应用这个经验）
  applicationRule?: ApplicationRule;

  // 验证状态
  verification: {
    applied: boolean;            // 是否已应用
    verified: boolean;           // 是否已验证有效
    applicationCount: number;    // 应用次数
    successCount: number;        // 成功次数
  };

  // 向量表示（用于检索）
  embedding?: number[];
}

/** 经验分析（替代 RootCause） */
export interface LessonAnalysis {
  category: 'misunderstanding' | 'knowledge_gap' | 'logic_error' | 'context_missing' | 'better_approach';
  analysis: string;              // 详细分析（第一人称）
  confidence: number;            // 分析置信度（0-1）

  // 失败教训特有
  whatWentWrong?: string;        // 哪里出错了
  whyItFailed?: string;          // 为什么失败

  // 成功经验特有
  whatWorked?: string;           // 什么有效
  whyItWorked?: string;          // 为什么有效

  // 共有
  keyInsight: string;            // 核心洞察
}

/** 核心教训（替代 Lesson） */
export interface CoreLesson {
  // 通用
  summary: string;               // 一句话总结
  keyTakeaway: string;           // 核心要点

  // 失败教训
  whatToAvoid?: string;          // 要避免什么
  howToAvoid?: string;           // 如何避免
  whenToBeCareful?: string;      // 何时警惕

  // 成功经验
  whatToDo?: string;             // 要做什么
  howToDo?: string;              // 如何做
  whenToApply?: string;          // 何时应用

  // 最佳实践
  recommendedApproach?: string;  // 推荐方法
  alternatives?: string[];       // 替代方案
  tradeoffs?: string;            // 权衡考虑
}

/** 应用规则（替代 PreventionRule，更通用） */
export interface ApplicationRule {
  id: string;
  name: string;
  description: string;
  ruleType: 'prevention' | 'recommendation' | 'optimization' | 'warning';

  // 触发条件（什么情况下应用）
  trigger: {
    taskPattern?: RegExp;        // 任务模式
    toolName?: string;           // 工具名称
    contextMatch?: string[];     // 上下文关键词
    domain?: LessonDomain;       // 领域
  };

  // 应用逻辑
  application: {
    timing: 'pre_action' | 'post_action' | 'continuous';
    condition: string;           // 应用条件（自然语言描述）
    action: string;              // 应该采取的行动
  };

  // 提示消息
  message: string;

  // 自动应用（可选）
  autoApply?: {
    enabled: boolean;
    action: string;              // 自动执行的行为
  };

  // 来源
  learnedFrom: string;           // LessonEvent ID

  // 效果指标
  metrics: {
    triggeredCount: number;      // 触发次数
    appliedCount: number;        // 应用次数
    successCount: number;        // 成功次数
    failureCount: number;        // 失败次数
  };

  // 元数据
  createdAt: number;
  updatedAt: number;
  version: number;
}

/** 经验警告（替代 ErrorWarning） */
export interface LessonWarning {
  severity: 'high' | 'medium' | 'low';
  source: 'application_rule' | 'past_lesson' | 'best_practice';
  ruleId?: string;               // 规则 ID
  lessonId?: string;             // 经验 ID
  message: string;               // 提示消息
  context?: string;              // 上下文说明
  suggestedAction?: string;      // 建议行为
  type: 'prevention' | 'recommendation' | 'optimization';  // 类型
}

// ============================================================
// 经验与学习系统（Experience & Learning System）
// ============================================================

/** 任务类型 */
export type TaskType = 'coding' | 'debugging' | 'discussion' | 'research' | 'writing' | 'file_operation';

/** 工具调用记录 */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'success' | 'error';
  error?: string;
  duration?: number;
}

/** 交互记录 */
export interface Interaction {
  userInput: string;
  assistantResponse: string;
  toolCalls: ToolCall[];
  iterations: number;
  thinkingTime: number;
  tokenUsage: {
    input: number;
    output: number;
    cached?: number;
  };
  error?: string;
  interrupted?: boolean;
  userFeedback?: {
    rating: number;         // 1-5 分
    comment?: string;
  };
  cwd: string;
  filesAccessed?: string[];
}

/** 经验记录 */
export interface Experience {
  id: string;
  timestamp: number;

  // 任务信息
  task: {
    type: TaskType;
    description: string;
    complexity: number;     // 复杂度（1-5）
  };

  // 执行过程
  execution: {
    toolsUsed: string[];
    iterations: number;
    thinkingTime: number;
    tokens: {
      input: number;
      output: number;
      cached?: number;
    };
  };

  // 结果
  outcome: {
    success: boolean;
    userFeedback?: {
      rating: number;
      comment?: string;
    };
    error?: string;
    output: string;
  };

  // 上下文
  context: {
    workingDirectory: string;
    files: string[];
    currentProject?: string;
  };
}

/** 知识条目 */
export interface Knowledge {
  id?: string;
  type: 'pattern' | 'skill' | 'preference' | 'constraint' | 'fact';
  category: string;           // 任务类型或领域
  content: string;            // 知识内容
  name?: string;              // 技能名称（仅 skill 类型）
  description?: string;       // 描述
  steps?: string[];           // 执行步骤（仅 skill 类型）
  tools?: string[];           // 相关工具（仅 skill 类型）
  applicability?: string[];   // 适用条件（仅 pattern 类型）
  confidence?: number;        // 置信度（0-1）
  strength?: number;          // 强度（仅 preference 类型）
  examples: string[];         // 示例（Experience IDs）
  successRate?: number;       // 成功率（仅 skill 类型）
  usageCount?: number;        // 使用次数（仅 skill 类型）
  createdAt: number;
  updatedAt?: number;
}

/** 技能来源 */
export type SkillSource = 'static' | 'learned' | 'hybrid';

/** 技能（整合静态和动态） */
export interface Skill extends Knowledge {
  type: 'skill';
  name: string;
  steps: string[];
  tools: string[];
  successRate: number;
  usageCount: number;

  // 来源标记
  source: SkillSource;          // static（配置文件）| learned（学习得到）| hybrid（两者结合）

  // 配置文件路径（仅 static 和 hybrid）
  configPath?: string;

  // 触发条件
  triggers: {
    keywords: string[];         // 关键词（如 "调试"、"React"）
    taskType?: TaskType;        // 任务类型
    contextRequired?: string[]; // 需要的上下文（如项目类型）
  };

  // 性能指标
  metrics: {
    successRate: number;        // 成功率（0-1）
    avgExecutionTime: number;   // 平均执行时间（秒）
    usageCount: number;         // 使用次数
    lastUsed: number;           // 最后使用时间
  };

  // 学习元数据
  learnedFrom: string[];        // 学习来源（Experience IDs）
  refinedCount: number;         // 改进次数
  version: number;              // 版本号

  // 静态 skill 特有（从配置文件加载）
  builtin?: boolean;            // 是否内置
  enabled?: boolean;            // 是否启用

  // 动态 skill 特有（学习得到）
  confidence?: number;          // 置信度（0-1）
  needsValidation?: boolean;    // 是否需要验证
}

// ============================================================
// 反思系统（Reflection System）
// ============================================================

/** 优势分析 */
export interface Strength {
  area: string;               // 擅长的领域
  successRate: number;        // 成功率
  sampleSize: number;         // 样本数量
  description: string;        // 描述
}

/** 弱点分析 */
export interface Weakness {
  area: string;               // 弱势领域
  successRate: number;        // 成功率
  sampleSize: number;         // 样本数量
  commonErrors: string[];     // 常见错误
  description: string;        // 描述
}

/** 改进建议 */
export interface Improvement {
  id?: string;
  targetArea: string;         // 目标领域
  action: string;             // 改进行动
  details: string;            // 详细说明
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'applied' | 'rejected';
  createdAt: number;
  appliedAt?: number;
}

/** 反思报告 */
export interface ReflectionReport {
  period: 'daily' | 'weekly' | 'monthly';
  timestamp: number;

  // 绩效指标
  performance: {
    totalTasks: number;
    successRate: number;
    avgResponseTime: number;
    userSatisfaction: number;
  };

  // 优势分析
  strengths: Strength[];

  // 弱点分析
  weaknesses: Weakness[];

  // 改进建议
  improvements: Improvement[];
}

// ============================================================
// 导出接口（Export Interfaces）
// ============================================================

/** 经验验证报告（替代 VerificationReport） */
export interface LessonValidationReport {
  total: number;
  validated: number;
  stillIssues: number;
  results: Array<{
    lessonId: string;
    status: 'validated' | 'needs_refinement';
    message: string;
  }>;
}

/** 诊断报告 */
export interface DiagnosisReport {
  timestamp: number;
  overallHealth: number;      // 0-100
  issues: Issue[];
  recommendations: string[];
}

/** 问题 */
export interface Issue {
  severity: 'low' | 'medium' | 'high';
  area: string;
  description: string;
  suggestedFix: string;
}
