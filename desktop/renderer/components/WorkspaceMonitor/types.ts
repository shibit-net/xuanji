// ============================================================
// Workspace Monitor - 类型定义
// ============================================================

export interface Point {
  x: number;
  y: number;
}

/** 矩形区域，用于碰撞检测 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Circle {
  x: number;
  y: number;
  radius: number;
  scale?: number;
}

export interface Path {
  points: Point[];  // 支持多个点的路径，用于直角连接线
}

export type AgentState = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error' | 'done';
export type SubAgentState = 'idle' | 'running' | 'thinking' | 'executing' | 'done' | 'success' | 'error';
export type CollaborationType = 'task' | 'data' | 'sequential' | 'debate' | 'pipeline' | 'hierarchical' | 'parallel' | 'team';

// ─── Team 策略类型 ──────────────────────────────────────────

/**
 * 团队协作策略
 */
export type TeamStrategy = 'sequential' | 'parallel' | 'hierarchical' | 'debate' | 'pipeline';

/**
 * 团队边界框数据
 */
export interface TeamBoundary {
  /** 团队 ID */
  teamId: string;
  /** 团队名称 */
  teamName: string;
  /** 协作策略 */
  strategy: TeamStrategy;
  /** 团队成员 ID 列表 */
  memberIds: string[];
  /** 边界框位置和尺寸（由布局引擎计算） */
  bounds?: Rect;
  /** Leader ID（Hierarchical 策略专用） */
  leaderId?: string;
  /** 当前轮次（Debate 策略专用） */
  currentRound?: number;
  /** 最大轮次（Debate 策略专用） */
  maxRounds?: number;
  /** 团队目标/任务描述（Debate 策略用于显示辩论主题） */
  goal?: string;
}

// ─── 新增：动作/日志类型 ────────────────────────────────────

/**
 * 动作类型，决定区域3动作标签的图标和颜色
 *
 * 说明：
 * - thinking: 表示 agent 正在运行（不是具体的思考内容）
 * - writing: 子 agent 直接输出到对话框（编写）
 * - reporting: 子 agent 返回给主 agent（汇报）
 * - idle: 空闲状态
 *
 * 注意：
 * - 工具调用已在 timeline 中展示，不需要在 moment 中重复
 * - 具体的思考内容在气泡中展示，moment 只显示"思考中"状态
 */
export type MomentType =
  | 'thinking'    // 正在运行/思考中
  | 'writing'     // 子 agent 直接输出到对话框（编写）
  | 'reporting'   // 子 agent 返回给主 agent（汇报）
  | 'idle'        // 空闲状态
  | 'file'        // 文件操作
  | 'bash'        // 命令行
  | 'memory_read' // 内存读取
  | 'memory_write'// 内存写入
  | 'skill';      // 技能调用

/**
 * 当前动作（区域3：右侧动作标签）
 */
export interface AgentMoment {
  type: MomentType;
  icon: string;
  label: string;       // 最多 20 字符
  durationMs: number;  // 已经过的毫秒数（running 时由 store 定时器实时更新）
  status: 'running' | 'success' | 'error';
  startTime?: number;  // 开始时间戳，running 时由 runtimeStore 自动设置
}

/**
 * 时间条事件（区域5：节点正下方横向时间轴）
 */
export interface TimelineEvent {
  id: string;
  icon: string;
  label: string;
  duration?: number;
  status: 'running' | 'success' | 'error';
  startTime?: number;
  endTime?: number;
  /** 并行组 ID，同一并行组内的工具会显示并行标记 */
  parallelGroupId?: string;
}

/**
 * 历史点（区域4：节点左侧竖向点阵）
 */
export interface HistoryDot {
  id: string;
  status: 'success' | 'error' | 'running';
  tooltip: string;     // 悬停详情文字
}

/**
 * 连线中点标签
 */
export interface CollaborationLabel {
  text: string;        // 最多 16 字符
  direction: 'forward' | 'backward';
  opacity: number;     // 0-1，随粒子流淡入淡出
}

// ─── Agent 数据结构 ─────────────────────────────────────────

export interface MainAgentData {
  id: string;
  name: string;
  status: AgentState;
  roleIcon: string;            // 角色 emoji，默认 🤖
  currentThought?: string;     // 区域2：思考气泡文字（向后兼容保留）
  thinkingText?: string;       // 思考气泡文字（优先使用）
  currentTool?: string;        // 向后兼容保留
  // 新增
  currentMoment?: AgentMoment; // 区域3：右侧动作标签
  momentHistory: HistoryDot[]; // 区域4：左侧历史点阵（最多8条）
  timelineEvents: TimelineEvent[]; // 区域5：下方时间条（最多5条）
  debateGoal?: string;         // 辩论主题（辩论模式下显示在中心圆）
}

export interface SubAgentData {
  id: string;
  name: string;
  type: 'tool' | 'agent' | 'team' | 'pipeline' | 'delegate';
  status: SubAgentState;
  task?: string;
  duration?: number;
  tokenUsage?: number;
  progress?: number;
  roleIcon: string;            // 角色 emoji
  agentType?: 'builtin' | 'preset' | 'custom' | 'temporary'; // Agent 类型标识
  // 新增
  currentMoment?: AgentMoment; // 区域3：右侧动作标签
  momentHistory: HistoryDot[]; // 区域4：左侧历史点阵（最多8条）
  timelineEvents: TimelineEvent[]; // 区域5：下方时间条（最多5条）
  thinkingText?: string;       // 区域2：上方思考气泡

  // 出场动画
  /** 出场阶段：entering=淡入中, active=正常显示, exiting=淡出中 */
  exitPhase?: 'entering' | 'active' | 'exiting';
  /** 出场进度 (0=透明, 1=完全不透明)，由 CanvasRenderer 维护 */
  exitProgress?: number;

  // Multi-Agent 扩展字段
  multiAgent?: {
    type: 'orchestrate' | 'pipeline' | 'quick_team' | 'agent_team' | 'delegate';
    strategy?: string;
    teamName?: string;
    parentId?: string;
    stepIndex?: number;
    totalSteps?: number;
    subagentType?: string;
    /** 稳定的成员标识符，多轮辩论中保持不变（用于位置缓存） */
    memberId?: string;
    // Debate 策略专用
    currentRound?: number;
    maxRounds?: number;
    /** 辩论角色：正方/反方/裁判（从 systemPrompt 的 [debate_role:xxx] 标签解析） */
    debateRole?: 'affirmative' | 'negative' | 'judge';
    /** 团队目标/辩论主题 */
    goal?: string;
  };

  // 层级结构：子 agent 可以创建更深层的子 agent
  subAgents?: SubAgentData[];
  // 父 agent ID（用于构建创建关系）
  parentAgentId?: string;
}

export interface Collaboration {
  from: string;
  to: string;
  type: CollaborationType;
  active: boolean;
  label?: CollaborationLabel;  // 新增：连线中点标签
  /** 执行顺序（Sequential/Pipeline 专用） */
  sequenceNumber?: number;
  /** 是否为 Leader 连线（Hierarchical 专用） */
  isLeaderConnection?: boolean;
  /** 辩论轮次（Debate 专用） */
  debateRound?: number;
  /** 🔧 是否为团队连接（主 agent → 团队边界框） */
  isTeamConnection?: boolean;
  /** 🔧 团队边界框信息（用于计算连接点） */
  teamBounds?: { x: number; y: number; width: number; height: number };
}

export interface WorkspaceStats {
  totalTokens: number;
  /** 本次 LLM call 消耗的 token 数（input + output） */
  currentCallTokens: number;
  currentTokenDelta: number;
  duration: number;
  iteration: number;
  /** 运行开始时间戳，用于计算已运行时长 */
  startTime?: number;
}

export interface WorkspaceState {
  mainAgent: MainAgentData;
  subAgents: SubAgentData[];  // 扁平化的所有子 agent（用于渲染）
  collaborations: Collaboration[];
  stats: WorkspaceStats;
  /** 左下角事件流（最近5条） */
  recentEvents: RecentEvent[];
  /** 团队边界框列表 */
  teamBoundaries?: TeamBoundary[];
}

/**
 * 左下角事件流条目
 */
export interface RecentEvent {
  id: string;
  timestamp: number;
  agentName: string;
  description: string;  // 自然语言描述
  icon: string;
}

export interface Particle {
  x: number;
  y: number;
  progress: number;
  opacity?: number;
}

export interface Animation {
  id: string;
  startTime: number;
  duration: number;
  update: (progress: number, deltaTime: number) => void;
  draw?: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, currentTime: number) => void;
  isComplete: () => boolean;
}

export interface LayoutConfig {
  centerX: number;
  centerY: number;
  mainRadius: number;
  subRadius: number;
  orbitRadius: number;
  canvasWidth: number;
  canvasHeight: number;
}
