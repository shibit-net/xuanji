/**
 * FlowNodeTypes — React Flow 节点数据类型定义。
 *
 * 5 种节点类型：foreground / subagent / team / team-member / user-input
 * 每种有明确的视觉和生命周期语义。
 */

import type { AgentStatus, AgentState } from '../../stores/AgentStateMachine';

// ============================================================
// 基础类型
// ============================================================

export type FlowNodeType = 'foreground' | 'subagent' | 'team' | 'team-member' | 'user-input';

export interface BaseNodeData {
  agentId: string;
  name: string;
  status: AgentStatus;
  statusSince: number;
  parentId: string | null;
}

// ============================================================
// 5 种节点 data
// ============================================================

export interface ForegroundNodeData extends BaseNodeData {
  nodeType: 'foreground';
  scene?: string;
  complexity?: string;
  agentType?: string;
  executionMode?: 'acp' | 'in-process';
  model?: string;
  iterationCount: number;
  thinkingText?: string;
  currentTask?: string;
  currentMoment?: {
    icon: string;
    label: string;
    durationMs?: number;
    status?: string;
    startTime?: number;
  };
  timelineEvents?: Array<{
    id: string;
    icon: string;
    label: string;
    duration?: number;
    status: 'running' | 'success' | 'error';
    startTime?: number;
  }>;
}

export interface SubagentNodeData extends BaseNodeData {
  nodeType: 'subagent';
  scene?: string;
  taskDescription: string;
  executionMode: 'acp' | 'in-process';
  agentType?: string;
  thinkingText?: string;
  currentTask?: string;
  currentMoment?: {
    icon: string;
    label: string;
    durationMs?: number;
    status?: string;
    startTime?: number;
  };
  timelineEvents?: Array<{
    id: string;
    icon: string;
    label: string;
    duration?: number;
    status: 'running' | 'success' | 'error';
    startTime?: number;
  }>;
}

export type TeamStrategy = 'sequential' | 'parallel' | 'hierarchical' | 'debate' | 'pipeline';

export interface TeamNodeData extends BaseNodeData {
  nodeType: 'team';
  teamName: string;
  strategy: TeamStrategy;
  memberCount: number;
  currentRound?: number;
  maxRounds?: number;
  goal: string;
  memberIds: string[];
}

export interface TeamMemberNodeData extends BaseNodeData {
  nodeType: 'team-member';
  teamId: string;
  memberRole: string;
  scene?: string;
  agentType?: string;
  executionMode?: 'acp' | 'in-process';
  debateRole?: 'affirmative' | 'negative' | 'judge';
  stepIndex?: number;
  taskDescription: string;
  thinkingText?: string;
  currentTask?: string;
  currentMoment?: {
    icon: string;
    label: string;
    durationMs?: number;
    status?: string;
    startTime?: number;
  };
  timelineEvents?: Array<{
    id: string;
    icon: string;
    label: string;
    duration?: number;
    status: 'running' | 'success' | 'error';
    startTime?: number;
  }>;
}

export interface UserInputNodeData {
  nodeType: 'user-input';
  messageId: string;
  content: string;
}

export type FlowNodeData =
  | ForegroundNodeData
  | SubagentNodeData
  | TeamNodeData
  | TeamMemberNodeData
  | UserInputNodeData;

// ============================================================
// 分类函数
// ============================================================

export interface ClassifiedAgent {
  agent: AgentState;
  nodeType: FlowNodeType;
  teamId?: string;
}

export function classifyAgent(agent: AgentState, foregroundAgentId: string | null): ClassifiedAgent {
  const isTeam = agent.taskType === 'team' || agent.multiAgent?.type === 'agent_team';
  // team-member 与 team 的区分：team-member 有 multiAgent.memberId，team 没有
  const isTeamMember = (agent.taskType === 'team' || agent.multiAgent?.type === 'agent_team') && !!agent.multiAgent?.memberId;
  const isForeground = agent.id === foregroundAgentId || (agent.parentId === null && agent.taskType === undefined && agent.multiAgent?.type !== 'agent_team');

  if (isTeam && !isTeamMember) {
    return { agent, nodeType: 'team' };
  }
  if (isTeamMember) {
    return {
      agent,
      nodeType: 'team-member',
      teamId: agent.multiAgent!.teamName!,
    };
  }
  if (isForeground) {
    return { agent, nodeType: 'foreground' };
  }
  return { agent, nodeType: 'subagent' };
}

// ============================================================
// 节点尺寸常量
// ============================================================

export const NODE_DIMENSIONS: Record<FlowNodeType, { width: number; height: number }> = {
  foreground:  { width: 100, height: 130 },
  subagent:    { width: 140, height: 110 },
  team:        { width: 0, height: 0 },     // 动态计算
  'team-member': { width: 120, height: 100 },
  'user-input':  { width: 200, height: 60 },
};

// ============================================================
// 状态颜色映射（来自设计文档 7.1）
// ============================================================

export const STATUS_VISUAL: Record<string, { color: string; border: string; ring: string; glow: string }> = {
  pending:   { color: '#94a3b8', border: '#94a3b8', ring: 'rgba(148,163,184,0.3)', glow: 'transparent' },
  thinking:  { color: '#8b5cf6', border: '#8b5cf6', ring: 'rgba(139,92,246,0.6)', glow: 'rgba(139,92,246,0.15)' },
  executing: { color: '#3b82f6', border: '#3b82f6', ring: 'rgba(59,130,246,0.6)', glow: 'rgba(59,130,246,0.15)' },
  writing:   { color: '#06b6d4', border: '#06b6d4', ring: 'rgba(6,182,212,0.6)', glow: 'rgba(6,182,212,0.15)' },
  reporting: { color: '#eab308', border: '#eab308', ring: 'rgba(234,179,8,0.6)', glow: 'rgba(234,179,8,0.12)' },
  success:   { color: '#22c55e', border: 'rgba(34,197,94,0.4)', ring: 'rgba(34,197,94,0.3)', glow: 'transparent' },
  failed:    { color: '#ef4444', border: 'rgba(239,68,68,0.5)', ring: 'rgba(239,68,68,0.3)', glow: 'transparent' },
  cancelled: { color: '#6b7280', border: 'rgba(107,114,128,0.4)', ring: 'rgba(107,114,128,0.3)', glow: 'transparent' },
};

export function getStatusVisual(status: string) {
  return STATUS_VISUAL[status] ?? STATUS_VISUAL.pending;
}

export function isActiveStatus(status: string): boolean {
  return ['thinking', 'executing', 'writing'].includes(status);
}

export function isTerminalStatus(status: string): boolean {
  return ['success', 'failed', 'cancelled'].includes(status);
}

// ============================================================
// AgentType 中文映射
// ============================================================

const AGENT_TYPE_LABELS: Record<string, string> = {
  builtin: '系统',
  preset: '应用',
  custom: '自定义',
  temporary: '临时',
};

export function getAgentTypeLabel(agentType?: string): string {
  if (!agentType) return '';
  return AGENT_TYPE_LABELS[agentType] || agentType;
}

// ============================================================
// Moment 颜色映射
// ============================================================

const MOMENT_COLORS: Record<string, string> = {
  pending: 'bg-muted/30 text-muted-foreground',
  thinking: 'bg-purple-500/10 text-purple-400',
  executing: 'bg-blue-500/10 text-blue-400',
  writing: 'bg-cyan-500/10 text-cyan-400',
  reporting: 'bg-amber-500/10 text-amber-400',
  success: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  cancelled: 'bg-muted/30 text-muted-foreground',
};

export function getMomentColor(status?: string): string {
  if (!status) return MOMENT_COLORS.pending;
  return MOMENT_COLORS[status] || MOMENT_COLORS.executing;
}

/** 判断 moment 是否处于活跃状态（显示实时计时器） */
export function isMomentActive(status?: string): boolean {
  return status === 'thinking' || status === 'executing' || status === 'writing';
}

// ============================================================
// 策略颜色（来自设计文档 5.2）
// ============================================================

export const STRATEGY_VISUAL: Record<string, { bg: string; border: string; text: string }> = {
  sequential:   { bg: 'rgba(124,140,245,0.08)', border: 'rgba(124,140,245,0.35)', text: '#7C8CF5' },
  parallel:     { bg: 'rgba(236,72,153,0.08)',  border: 'rgba(236,72,153,0.35)',  text: '#EC4899' },
  hierarchical: { bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.35)',  text: '#FBBF24' },
  debate:       { bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.35)',  text: '#34D399' },
  pipeline:     { bg: 'rgba(139,92,246,0.08)',  border: 'rgba(139,92,246,0.35)',  text: '#8B5CF6' },
};
