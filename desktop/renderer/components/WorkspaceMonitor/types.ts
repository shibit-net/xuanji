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
export type SubAgentState = 'idle' | 'running' | 'success' | 'error';
export type CollaborationType = 'task' | 'data' | 'sequential' | 'debate' | 'pipeline' | 'hierarchical';

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
 */
export type MomentType =
  | 'thinking'
  | 'file'
  | 'bash'
  | 'skill'
  | 'mcp'
  | 'memory_read'
  | 'memory_write'
  | 'idle';

/**
 * 当前动作（区域3：右侧动作标签）
 */
export interface AgentMoment {
  type: MomentType;
  icon: string;
  label: string;       // 最多 20 字符
  durationMs: number;  // 已经过的毫秒数
  status: 'running' | 'success' | 'error';
}

/**
 * 时间条事件（区域5：节点正下方横向时间轴）
 */
export interface TimelineEvent {
  id: string;
  icon: string;
  label: string;       // 最多 12 字符
  duration?: number;   // ms，完成后填入
  status: 'running' | 'success' | 'error';
  startTime?: number;  // 开始时间戳（ms），用于实时计算已过时间
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
  currentTool?: string;        // 向后兼容保留
  // 新增
  currentMoment?: AgentMoment; // 区域3：右侧动作标签
  momentHistory: HistoryDot[]; // 区域4：左侧历史点阵（最多8条）
  timelineEvents: TimelineEvent[]; // 区域5：下方时间条（最多5条）
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
  agentType?: 'builtin' | 'temporary' | 'custom'; // Agent 类型标识
  // 新增
  currentMoment?: AgentMoment; // 区域3：右侧动作标签
  momentHistory: HistoryDot[]; // 区域4：左侧历史点阵（最多8条）
  timelineEvents: TimelineEvent[]; // 区域5：下方时间条（最多5条）
  thinkingText?: string;       // 区域2：上方思考气泡

  // Multi-Agent 扩展字段
  multiAgent?: {
    type: 'orchestrate' | 'pipeline' | 'quick_team' | 'agent_team' | 'delegate';
    strategy?: string;
    teamName?: string;
    parentId?: string;
    stepIndex?: number;
    totalSteps?: number;
    subagentType?: string;
    // Debate 策略专用
    currentRound?: number;
    maxRounds?: number;
    /** 辩论角色：正方/反方/裁判（从 systemPrompt 的 [debate_role:xxx] 标签解析） */
    debateRole?: 'affirmative' | 'negative' | 'judge';
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
  draw?: (ctx: CanvasRenderingContext2D) => void;
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
