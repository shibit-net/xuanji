// ============================================================
// ExecutionFlow - 执行流程图组件（React Flow + Dagre 布局）
// 完全替换旧的 Canvas WorkspaceMonitor
// ============================================================

import ReactFlow, {
  Background, Controls, MiniMap, Node, Edge,
  useNodesState, useEdgesState, ConnectionLineType,
  Handle, Position, NodeProps, ReactFlowProvider, useReactFlow, MarkerType,
  type NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { useActiveAgentStore, type AgentState } from '../stores/activeAgentStore';
import { useRuntimeStore } from '../stores/runtimeStore';
import { Avatar } from './Avatar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// 浅比较两个对象，用于节点 data 变化检测
// 排除频繁变化的字段：timelineEvents, currentMoment, currentTask
// 这些字段只影响节点内部文本渲染，不影响节点结构
function hasNodeDataChanged(a: any, b: any): boolean {
  if (a === b) return false;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return true;
  const skipKeys = new Set(['timelineEvents', 'currentMoment', 'currentTask']);
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return true;
  for (const k of ka) {
    if (skipKeys.has(k)) continue;
    if (a[k] !== b[k]) return true;
  }
  return false;
}

// ============================================================
// 类型
// ============================================================

interface AgentNodeData {
  id: string;
  name: string;
  status: string;
  type: 'agent' | 'team';
  thinkingText?: string;
  currentTask?: string;
  currentMoment?: { icon: string; label: string; durationMs?: number; status?: string; startTime?: number };
  timelineEvents?: Array<{
    id: string; icon: string; label: string;
    duration?: number; status: 'running' | 'success' | 'error'; startTime?: number;
  }>;
  strategy?: string;
  debateRole?: string;
  agentType?: string;
  multiAgent?: {
    type?: string;
    strategy?: string;
    teamName?: string;
    currentRound?: number;
    maxRounds?: number;
    stepIndex?: number;
    totalSteps?: number;
    goal?: string;
  };
  // 团队节点专用
  teamInfo?: {
    teamName: string;
    strategy: string;
    memberCount: number;
    currentRound?: number;
    maxRounds?: number;
    goal?: string;
  };
  children?: string[]; // 子 agent ID 列表（团队节点专用）
}

// ============================================================
// 状态颜色（对应 Canvas StatusRing）
// ============================================================

const STATUS_RING_COLORS: Record<string, { bg: string; border: string; ring: string; glow: string }> = {
  idle:       { bg: 'rgba(46, 46, 46, 0.85)', border: 'rgba(255,255,255,0.08)', ring: 'rgba(138,138,138,0.3)',   glow: 'transparent' },
  thinking:   { bg: 'rgba(124,140,245,0.15)', border: 'rgba(124,140,245,0.5)',  ring: 'rgba(124,140,245,0.8)',  glow: 'hsl(var(--primary)/0.15)' },
  executing:  { bg: 'rgba(124,140,245,0.15)', border: 'rgba(124,140,245,0.5)',  ring: 'rgba(124,140,245,0.8)',  glow: 'hsl(var(--primary)/0.15)' },
  running:    { bg: 'rgba(124,140,245,0.15)', border: 'rgba(124,140,245,0.5)',  ring: 'rgba(124,140,245,0.8)',  glow: 'hsl(var(--primary)/0.15)' },
  responding: { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.4)',   ring: 'rgba(251,191,36,0.7)',   glow: 'rgba(251,191,36,0.12)' },
  success:    { bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.4)',   ring: 'rgba(52,211,153,0.7)',   glow: 'rgba(52,211,153,0.12)' },
  done:       { bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.25)',  ring: 'rgba(52,211,153,0.5)',   glow: 'transparent' },
  failed:     { bg: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.5)',  ring: 'rgba(248,113,113,0.8)',  glow: 'rgba(248,113,113,0.15)' },
  error:      { bg: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.5)',  ring: 'rgba(248,113,113,0.8)',  glow: 'rgba(248,113,113,0.15)' },
  pending:    { bg: 'rgba(138,138,138,0.12)', border: 'rgba(138,138,138,0.2)',  ring: 'rgba(138,138,138,0.3)',  glow: 'transparent' },
};

function getColors(s: string) {
  return STATUS_RING_COLORS[s] || STATUS_RING_COLORS.idle;
}

function isActiveStatus(s: string) {
  return ['thinking', 'executing', 'running', 'responding'].includes(s);
}
function isFinalStatus(s: string) {
  return ['done', 'success', 'failed', 'error'].includes(s);
}

// 团队策略颜色
const STRATEGY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  sequential:    { bg: 'rgba(124,140,245,0.08)', border: 'rgba(124,140,245,0.35)', text: '#7C8CF5' },
  parallel:      { bg: 'rgba(236,72,153,0.08)',  border: 'rgba(236,72,153,0.35)',  text: '#EC4899' },
  hierarchical:  { bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.35)',  text: '#FBBF24' },
  debate:        { bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.35)',  text: '#34D399' },
  pipeline:      { bg: 'rgba(139,92,246,0.08)',  border: 'rgba(139,92,246,0.35)',  text: '#8B5CF6' },
};

const STRATEGY_ICONS: Record<string, string> = {
  sequential: '📋', debate: '💬', hierarchical: '👑', pipeline: '🔗', parallel: '⚡',
};

// Dagre 布局尺寸
const NODE_W = 420;
const NODE_H = 160;

// ============================================================
// 实时 clock hook
// ============================================================

function useRealtimeClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ============================================================
// 格式化耗时
// ============================================================

function formatDuration(ms: number): string {
  const sec = Math.max(0, ms) / 1000;
  return `${sec.toFixed(2)}s`;
}

function computeLiveDuration(evt: { status?: string; duration?: number; startTime?: number }, now: number): number | null {
  if (evt.status === 'running' && evt.startTime) {
    return Math.max(0, now - evt.startTime);
  }
  if (evt.duration != null) return Math.max(0, evt.duration);
  return null;
}

// ============================================================
// 自定义 Agent 节点（VisionOS 圆形玻璃风格）
// ============================================================

function AgentNode({ data }: NodeProps<AgentNodeData>) {
  const colors = getColors(data.status);
  const active = isActiveStatus(data.status);
  const final = isFinalStatus(data.status);
  const now = useRealtimeClock();
  const hasThought = !!data.thinkingText;
  const hasTaskHint = !!data.currentTask && !data.thinkingText;
  const hasMoment = !!data.currentMoment;
  const hasTimeline = data.timelineEvents && data.timelineEvents.length > 0;
  const hasLeftBubble = hasThought || hasTaskHint;

  // 策略徽章
  const strategyLabel = data.multiAgent?.strategy
    ? data.multiAgent.strategy.charAt(0).toUpperCase() + data.multiAgent.strategy.slice(1)
    : null;

  return (
    <div className="relative" style={{ width: NODE_W, height: NODE_H }}>
      {/* 运行光晕 */}
      {active && (
        <div
          className="absolute animate-pulse pointer-events-none rounded-full"
          style={{
            width: 120, height: 120,
            left: '50%', marginLeft: -60,
            top: '50%', marginTop: -60,
            background: `radial-gradient(circle, ${colors.glow} 0%, transparent 70%)`,
            filter: 'blur(24px)',
          }}
        />
      )}

      {/* 连接点 — grid 布局保证头像始终居中 */}
      <Handle type="target" position={Position.Top} className="!opacity-0" style={{ left: '50%', top: 0, transform: 'translateX(-50%)' }} />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" style={{ left: '50%', bottom: 0, transform: 'translateX(-50%)' }} />

      <div className="grid w-full h-full pt-2 pointer-events-none" style={{ gridTemplateColumns: '1fr auto 1fr', alignItems: 'start' }}>
        {/* 左侧：思维气泡（右对齐，贴近头像） */}
        <div className="flex justify-end" style={{ paddingRight: 6 }}>
          {hasLeftBubble && (
            <div style={{ maxWidth: 220 }}>
              <div className={`relative bg-card/90 backdrop-blur-sm rounded-xl px-3 py-2 shadow-glass-sm ${
                hasThought ? 'border border-green-500/40' : 'border border-yellow-500/40'
              }`}>
                <p className="text-[10px] text-muted-foreground leading-relaxed break-words whitespace-pre-wrap">
                  {hasThought ? data.thinkingText?.slice(-200) : data.currentTask?.slice(-200)}
                </p>
                <div className={`absolute right-[-5px] top-[28px] -translate-y-1/2 w-2.5 h-2.5 bg-card/90 border-t border-r rotate-45 ${
                  hasThought ? 'border-green-500/40' : 'border-yellow-500/40'
                }`} />
              </div>
            </div>
          )}
        </div>

        {/* 中间：圆形节点（grid center column = auto，始终居中） */}
        <div className="flex flex-col items-center flex-shrink-0">
          {/* 圆形头像容器 */}
          <div className="relative" style={{ width: 56, height: 56 }}>
            {/* 自旋状态环 */}
            {active && (
              <svg className="absolute animate-spin" style={{ width: 60, height: 60, top: -2, left: -2 }} viewBox="0 0 60 60">
                <circle
                  cx="30" cy="30" r="28"
                  fill="none"
                  stroke={colors.ring}
                  strokeWidth="2.5"
                  strokeDasharray="44 132"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {/* 非活跃但非终态的状态环（动态圆环） */}
            {!active && !final && (
              <svg className="absolute inset-0 w-14 h-14" viewBox="0 0 56 56">
                <circle
                  cx="28" cy="28" r="26"
                  fill="none"
                  stroke={colors.ring}
                  strokeWidth="2.5"
                />
              </svg>
            )}
            {/* 终态静态环（成功/失败圆环） */}
            {final && (
              <svg className="absolute inset-0 w-14 h-14" viewBox="0 0 56 56">
                <circle
                  cx="28" cy="28" r="26"
                  fill="none"
                  stroke={colors.ring}
                  strokeWidth="2"
                  strokeDasharray={data.status === 'success' || data.status === 'done' ? undefined : '6,3'}
                />
              </svg>
            )}

            {/* 圆形背景 + 头像 */}
            <div
              className="w-12 h-12 rounded-full overflow-hidden shadow-lg"
              style={{
                position: 'absolute',
                top: 4, left: 4,
                background: colors.bg,
                border: `2px solid ${colors.border}`,
              }}
            >
              <Avatar seed={data.name} size={48} className="w-full h-full rounded-full" />
            </div>

            {/* 完成/错误徽章 */}
            {data.status === 'done' || data.status === 'success' ? (
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-success rounded-full border-2 border-background z-10 flex items-center justify-center">
                <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white"><path d="M3 6l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ) : data.status === 'error' || data.status === 'failed' ? (
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-destructive rounded-full border-2 border-background z-10 flex items-center justify-center">
                <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white"><path d="M4 4l4 4M8 4l-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </div>
            ) : null}
          </div>

          {/* 名称 */}
          <div className="mt-1.5 flex items-center justify-center gap-1 flex-wrap max-w-[140px]">
            <span className="text-xs font-medium text-foreground/80 truncate">{data.name}</span>
            {strategyLabel && (
              <span className="text-[8px] px-1 py-[1px] rounded bg-muted text-muted-foreground whitespace-nowrap">{strategyLabel}</span>
            )}
          </div>

          {/* 辩论角色标签 */}
          {data.debateRole && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded mt-0.5 font-medium ${
              data.debateRole === 'affirmative' ? 'bg-success/20 text-success' :
              data.debateRole === 'negative' ? 'bg-destructive/20 text-destructive' :
              'bg-warning/20 text-warning'
            }`}>
              {data.debateRole === 'affirmative' ? '正方' : data.debateRole === 'negative' ? '反方' : '裁判'}
            </span>
          )}

          {/* Agent 类型标签 */}
          {data.agentType && (
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground/60 mt-0.5">
              {data.agentType === 'builtin' ? '系统' :
               data.agentType === 'preset' ? '预设' :
               data.agentType === 'custom' ? '自定义' :
               data.agentType === 'temporary' ? '临时' : data.agentType}
            </span>
          )}
        </div>

        {/* 右侧：Moment + Timeline */}
        <div className="flex-shrink-0" style={{ paddingLeft: 6, maxWidth: 140 }}>
          {hasMoment && (
            <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[9px] font-medium max-w-full ${
              data.currentMoment!.status === 'error' ? 'bg-destructive/15 text-destructive' :
              data.currentMoment!.status === 'running' ? 'bg-primary/15 text-primary' :
              'bg-success/15 text-success'}`}>
              <span className="flex-shrink-0">{data.currentMoment!.icon}</span>
              <span className="truncate min-w-0">{data.currentMoment!.label}</span>
              {data.currentMoment!.status === 'running' && data.currentMoment!.startTime ? (
                <span className="opacity-60 font-mono flex-shrink-0">{formatDuration(now - data.currentMoment!.startTime)}</span>
              ) : data.currentMoment!.durationMs != null ? (
                <span className="opacity-60 font-mono flex-shrink-0">{formatDuration(data.currentMoment!.durationMs)}</span>
              ) : null}
            </div>
          )}

          {hasTimeline && (
            <div className="space-y-0.5 mt-1 min-w-0">
              {data.timelineEvents!.slice(-3).map((evt) => {
                const live = computeLiveDuration(evt, now);
                return (
                  <div key={evt.id} className="flex items-center gap-1 text-[9px] leading-none min-w-0">
                    <span className={`w-1 h-1 rounded-full flex-shrink-0 mt-0.5 ${
                      evt.status === 'running' ? 'bg-primary animate-pulse' :
                      evt.status === 'success' ? 'bg-success' : 'bg-destructive'
                    }`} />
                    <span className="text-muted-foreground truncate min-w-0">{evt.icon}{evt.label}</span>
                    {live != null && <span className="text-muted-foreground/50 flex-shrink-0 font-mono text-[8px]">{formatDuration(live)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 团队边界框节点（React Flow Group Node）
// ============================================================

function TeamNode({ data }: NodeProps<AgentNodeData>) {
  const ti = data.teamInfo;
  if (!ti) return null;
  const sc = STRATEGY_COLORS[ti.strategy] || STRATEGY_COLORS.sequential;
  const icon = STRATEGY_ICONS[ti.strategy] || '👥';

  return (
    <div className="relative" style={{ minWidth: 200, minHeight: 100 }}>
      <Handle type="target" position={Position.Top} className="!opacity-0 !pointer-events-none" style={{ left: '50%', top: 0, transform: 'translateX(-50%)' }} />
      <Handle type="source" position={Position.Bottom} className="!opacity-0 !pointer-events-none" style={{ left: '50%', bottom: 0, transform: 'translateX(-50%)' }} />

      {/* 虚线边界框 */}
      <div
        className="rounded-xl pointer-events-none"
        style={{
          position: 'absolute',
          inset: -2,
          border: `2px dashed ${sc.border}`,
          background: sc.bg,
        }}
      />

      {/* 标题栏 */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-t-xl cursor-grab active:cursor-grabbing"
        style={{
          position: 'absolute',
          top: -2, left: -2, right: -2,
          background: `linear-gradient(135deg, ${sc.bg}, transparent)`,
          borderBottom: `1px solid ${sc.border}`,
        }}
      >
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-foreground/80 truncate">{ti.teamName}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{ti.strategy.charAt(0).toUpperCase() + ti.strategy.slice(1)}</span>
        <div className="flex-1" />
        {ti.strategy === 'debate' && ti.currentRound != null && ti.maxRounds != null && (
          <span className="text-[10px] font-mono text-muted-foreground">R{ti.currentRound}/{ti.maxRounds}</span>
        )}
      </div>

      {/* 成员计数 */}
      <div
        className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/40 pointer-events-none"
      >
        {ti.memberCount} 名成员
      </div>
    </div>
  );
}

const nodeTypes = { agent: AgentNode, team: TeamNode };

// ============================================================
// Dagre 布局
// ============================================================

function layoutNodes(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 50, marginy: 50 });

  nodes.forEach((n) => {
    if (n.type === 'team') {
      g.setNode(n.id, { width: n.width || 260, height: n.height || 160 });
    } else {
      g.setNode(n.id, { width: NODE_W, height: NODE_H });
    }
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  // 计算同父级子节点的水平居中对齐
  // 找出每个父节点有多少个子节点，将子节点组水平居中
  const parentChildMap = new Map<string, { ids: string[]; parentX: number }>();
  for (const e of edges) {
    if (!parentChildMap.has(e.source)) {
      parentChildMap.set(e.source, { ids: [], parentX: 0 });
    }
    parentChildMap.get(e.source)!.ids.push(e.target);
  }
  // 获取父节点位置
  for (const [pid, info] of parentChildMap) {
    const pp = g.node(pid);
    if (pp) info.parentX = pp.x;
  }
  // 对子节点组做水平偏移，使整体居中于父节点
  for (const [, info] of parentChildMap) {
    if (info.ids.length < 2) continue;
    const childNodes = info.ids.map(id => g.node(id)).filter(Boolean);
    if (childNodes.length < 2) continue;
    const minX = Math.min(...childNodes.map(c => c.x));
    const maxX = Math.max(...childNodes.map(c => c.x));
    const groupCenter = (minX + maxX) / 2;
    const offset = info.parentX - groupCenter;
    for (const id of info.ids) {
      const cp = g.node(id);
      if (cp) cp.x += offset;
    }
  }

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    const w = n.type === 'team' ? (n.width || 260) : NODE_W;
    const h = n.type === 'team' ? (n.height || 160) : NODE_H;
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });
}

// ============================================================
// 工具函数：过滤活跃 agent
// 子 agent 保留原则：从创建（thinking）到完成（success/failed）一直在图上
// 终态（success/failed）展示绿色/红色状态环 + 暗色连线
// 节点会在 auto-summarize-start 时由 removeSubAgent 移除
// ============================================================

function isActiveOrHasActiveChild(agent: AgentState): boolean {
  if (agent.multiAgent?.type === 'agent_team') return true;
  // 只要不是 idle 就保留（含 success/failed 终态）
  // idle 是 addSubAgent 创建时的默认值，但 _promoteSubAgent 立即设为 thinking
  if (agent.status !== 'idle') return true;
  if (agent.subAgents && Array.isArray(agent.subAgents)) {
    return agent.subAgents.some(child => isActiveOrHasActiveChild(child));
  }
  return false;
}

// ============================================================
// Flow 组件
// ============================================================

function Flow() {
  const { mainAgent } = useActiveAgentStore();
  const agentActivity = useRuntimeStore((state) => state.agentActivity);
  const isProcessing = useRuntimeStore((state) => state.isProcessing);
  const { fitView } = useReactFlow();
  const initialized = useRef(false);

  // 追踪用户手动拖拽位置，防止思考流更新时重置位置
  const draggedPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  // 记录 team 框拖拽时的基准偏移，用于同步移动内部成员
  const teamDragOffsets = useRef<Map<string, { dx: number; dy: number }>>(new Map());

  // 从 agent 树中通过 id 查找 agent
  const findAgentById = useCallback((agent: AgentState, targetId: string): AgentState | null => {
    if (agent.id === targetId) return agent;
    if (agent.subAgents) {
      for (const sub of agent.subAgents) {
        const found = findAgentById(sub, targetId);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // 🔧 调试日志
  useEffect(() => {
    console.log('[ExecutionFlow] mainAgent:', mainAgent?.id, 'subAgents:', mainAgent?.subAgents?.length,
      'subIds:', mainAgent?.subAgents?.map(a => `${a.id}:${a.status}`));
    console.log('[ExecutionFlow] agentActivity moments:', Object.keys(agentActivity.currentMoments));
    console.log('[ExecutionFlow] agentActivity timelineEvents:', Object.keys(agentActivity.timelineEvents));
  }, [mainAgent, agentActivity]);

  const buildFlow = useCallback((
    agent: AgentState,
    parentId: string | null,
  ): { nodes: Node<AgentNodeData>[]; edges: Edge[]; teamNodes: Map<string, Node<AgentNodeData>>; teamMembers: Map<string, string[]> } => {
    const nodes: Node<AgentNodeData>[] = [];
    const edges: Edge[] = [];
    const teamNodes = new Map<string, Node<AgentNodeData>>();
    const teamMembers = new Map<string, string[]>();

    const addNode = (a: AgentState, pid: string | null, teamName?: string) => {
      const agentId = a.id;
      const isActive = isActiveStatus(a.status);
      const timelineEvents = agentActivity.timelineEvents[agentId] || [];
      const currentMoment = agentActivity.currentMoments?.[agentId];
      const strategy = a.multiAgent?.strategy;

      // 记录团队成员
      if (teamName) {
        if (!teamMembers.has(teamName)) teamMembers.set(teamName, []);
        teamMembers.get(teamName)!.push(agentId);
      }

      nodes.push({
        id: agentId,
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          id: agentId,
          name: a.name,
          status: a.status,
          type: 'agent',
          thinkingText: a.currentThought,
          currentTask: a.currentTask,
          currentMoment: currentMoment ? {
            icon: currentMoment.icon,
            label: currentMoment.label,
            durationMs: currentMoment.durationMs,
            status: currentMoment.status,
            startTime: currentMoment.startTime,
          } : undefined,
          timelineEvents: timelineEvents.length > 0 ? timelineEvents.map((e: any) => ({
            id: e.id, icon: e.icon, label: e.label,
            duration: e.duration, status: e.status, startTime: e.startTime,
          })) : undefined,
          strategy,
          debateRole: a.multiAgent?.debateRole,
          agentType: a.agentType,
          multiAgent: a.multiAgent ? {
            type: a.multiAgent.type,
            strategy: a.multiAgent.strategy,
            teamName: a.multiAgent.teamName,
            currentRound: a.multiAgent.currentRound,
            maxRounds: a.multiAgent.maxRounds,
            stepIndex: a.multiAgent.stepIndex,
            totalSteps: a.multiAgent.totalSteps,
            goal: a.multiAgent.goal,
          } : undefined,
        },
        draggable: true,
      });

      if (pid) {
        edges.push({
          id: `e-${pid}-${agentId}`,
          source: pid,
          target: agentId,
          type: 'smoothstep',
          animated: isActive,
          style: { stroke: isActive ? 'hsl(var(--primary)/0.35)' : 'rgba(255,255,255,0.08)', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: isActive ? 'hsl(var(--primary)/0.35)' : 'rgba(255,255,255,0.1)' },
        });
      }
    };

    const processAgent = (a: AgentState, pid: string | null): void => {
      const isTeamMember = a.multiAgent?.type === 'agent_team';
      const teamName = a.multiAgent?.teamName;

      // 如果该 agent 是团队成员的父级，先为团队创建一个边界框节点
      if (isTeamMember && teamName && !teamNodes.has(teamName)) {
        // subAgents 中的子 agent 数量（addNode 时已收集到 teamMembers）
        const memberCount = Math.max(1, a.subAgents?.length || 0);

        teamNodes.set(teamName, {
          id: `team-${teamName}`,
          type: 'team',
          position: { x: 0, y: 0 },
          data: {
            id: `team-${teamName}`,
            name: teamName,
            status: 'idle',
            type: 'team',
            teamInfo: {
              teamName,
              strategy: a.multiAgent?.strategy || 'parallel',
              memberCount,
              currentRound: a.multiAgent?.currentRound,
              maxRounds: a.multiAgent?.maxRounds,
              goal: a.multiAgent?.goal,
            },
          },
          draggable: true,
          width: 100,
          height: 60,
        });

        // 父节点 → 团队边界框的连线（和 task 线一样）
        const parentForTeam = pid || (mainAgent?.id || 'xuanji');
        edges.push({
          id: `e-${parentForTeam}-team-${teamName}`,
          source: parentForTeam,
          target: `team-${teamName}`,
          type: 'smoothstep',
          animated: true,
          style: { stroke: 'hsl(var(--primary)/0.35)', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary)/0.35)' },
        });
      }

      // 添加 agent 节点
      addNode(a, pid, isTeamMember ? teamName : undefined);

      // 递归处理子 agent
      if (a.subAgents && a.subAgents.length > 0) {
        for (const sub of a.subAgents) {
          if (!isActiveOrHasActiveChild(sub)) continue;
          processAgent(sub, a.id);
        }
      }
    };

    processAgent(agent, parentId);

    // 移除 agent → agent 的连线如果双方都在同一个团队中
    // 也移除父 agent → 团队成员的直接连线，改为 team → member 连线让 dagre 布局
    const agentIds = new Set(nodes.map(n => n.id));
    const teamAgentMap = new Map<string, string>();
    const teamMembersSet = new Set<string>();
    teamMembers.forEach((members, teamName) => {
      members.forEach(m => {
        teamAgentMap.set(m, teamName);
        teamMembersSet.add(m);
      });
    });

    const filteredEdges = edges.filter(e => {
      if (teamAgentMap.has(e.source) && teamAgentMap.has(e.target)) {
        return teamAgentMap.get(e.source) === teamAgentMap.get(e.target);
      }
      if (teamMembersSet.has(e.target)) {
        return false;
      }
      return true;
    });

    // 添加 team → member 边仅用于 dagre 布局（让成员在 team 框下方），渲染时隐藏
    teamMembers.forEach((members, teamName) => {
      const teamId = `team-${teamName}`;
      members.forEach(memberId => {
        if (agentIds.has(memberId)) {
          filteredEdges.push({
            id: `e-${teamId}-${memberId}`,
            source: teamId,
            target: memberId,
            type: 'smoothstep',
            animated: false,
            style: { stroke: 'transparent', strokeWidth: 0 },
          });
        }
      });
    });

    return { nodes, edges: filteredEdges, teamNodes, teamMembers };
  }, [agentActivity, mainAgent]);

  const flowData = useMemo(() => {
    if (!mainAgent) return null;
    const raw = buildFlow(mainAgent, null);
    // 合并团队节点
    const allNodes = [...raw.nodes];
    raw.teamNodes.forEach((tn) => allNodes.push(tn));
    const laidOut = layoutNodes(allNodes, raw.edges);
    // 恢复用户拖拽过的节点位置，防止 dagre 重算时拉回
    const restored = laidOut.map(n => {
      const dragged = draggedPositions.current.get(n.id);
      if (dragged) return { ...n, position: dragged };
      return n;
    });

    // 根据成员实际布局位置调整 team 虚线框的大小和位置，使其包裹所有成员
    const adjustedNodes = restored.map(n => {
      if (!n.id.startsWith('team-')) return n;
      const teamName = n.id.replace('team-', '');
      const members = raw.teamMembers.get(teamName);
      if (!members || members.length === 0) return n;
      const memberNodes = members.map(mid => restored.find(rn => rn.id === mid)).filter(Boolean) as Node[];
      if (memberNodes.length === 0) return n;
      const padding = 120; // 上下留足够空间包裹气泡
      const leftExtra = 220; // 左侧思考气泡最大宽度
      const rightExtra = 140; // 右侧 moment/timeline 最大宽度
      const minX = Math.min(...memberNodes.map(m => m.position.x)) - leftExtra;
      const maxX = Math.max(...memberNodes.map(m => m.position.x + NODE_W)) + rightExtra;
      const minY = Math.min(...memberNodes.map(m => m.position.y)) - padding;
      const maxY = Math.max(...memberNodes.map(m => m.position.y + NODE_H)) + padding;
      return {
        ...n,
        position: { x: minX, y: minY },
        width: maxX - minX,
        height: maxY - minY,
        style: { width: maxX - minX, height: maxY - minY },
      };
    });

    return { nodes: adjustedNodes, edges: raw.edges };
  }, [mainAgent, buildFlow, isProcessing]);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState(flowData?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData?.edges || []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        const id = change.id;
        const oldPos = draggedPositions.current.get(id);
        draggedPositions.current.set(id, { ...change.position });

        // 如果是 team 节点拖动，同步更新内部成员
        if (id.startsWith('team-') && oldPos) {
          const dx = change.position.x - oldPos.x;
          const dy = change.position.y - oldPos.y;
          const teamName = id.replace('team-', '');
          const currentNodes = nodes;
          currentNodes.forEach(n => {
            if (n.id.startsWith('team-')) return;
            const memberAgent = mainAgent ? findAgentById(mainAgent, n.id) : null;
            if (memberAgent?.multiAgent?.teamName === teamName) {
              const memberPos = draggedPositions.current.get(n.id);
              if (memberPos) {
                draggedPositions.current.set(n.id, { x: memberPos.x + dx, y: memberPos.y + dy });
              }
            }
          });
        }
      }
    }
    onNodesChangeRaw(changes);
  }, [onNodesChangeRaw, nodes, mainAgent]);

  // 使用 ref 缓存上一轮 nodes，避免 data 未变的节点被替换引用导致 React Flow 重挂载闪烁
  const prevNodesRef = useRef<Node[]>([]);

  useEffect(() => {
    if (!flowData) { setNodes([]); setEdges([]); prevNodesRef.current = []; return; }
    // 恢复用户拖拽过的节点位置
    const newNodes = flowData.nodes.map(newNode => {
      const dragged = draggedPositions.current.get(newNode.id);
      const pos = dragged ? dragged : newNode.position;
      // 对比旧节点：id + type + data 不变则保留旧引用，防止 React Flow 重挂载
      const old = prevNodesRef.current.find(n => n.id === newNode.id);
      if (old && old.type === newNode.type && !hasNodeDataChanged(old.data, newNode.data)) {
        return old;
      }
      return { ...newNode, position: pos, data: { ...newNode.data } };
    });
    prevNodesRef.current = newNodes as Node[];
    requestAnimationFrame(() => {
      setNodes(newNodes as any);
      setEdges(flowData.edges);
    });
    if (!initialized.current) {
      initialized.current = true;
      requestAnimationFrame(() => fitView({ duration: 0, padding: 0.3 }));
    }
  }, [flowData, setNodes, setEdges, fitView]);

  return (
    <div className="w-full h-full bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        defaultViewport={{ x: 0, y: 0, zoom: 1.0 }}
        minZoom={0.2}
        maxZoom={3}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="rgba(255,255,255,0.03)" />
        <Controls className="!bg-card !border-border !rounded-xl !shadow-glass-sm" showInteractive={false} />
        <MiniMap
          className="!bg-card !border-border !rounded-xl !shadow-glass-sm !overflow-hidden"
          nodeColor={(n) => {
            if (n.type === 'team') return 'rgba(255,255,255,0.08)';
            const d = n.data as AgentNodeData;
            if (!d) return 'rgba(255,255,255,0.1)';
            if (isActiveStatus(d.status)) return 'hsl(var(--primary))';
            if (d.status === 'done' || d.status === 'success') return 'hsl(var(--success))';
            if (d.status === 'error') return 'hsl(var(--destructive))';
            return 'rgba(255,255,255,0.15)';
          }}
          maskColor="rgba(0,0,0,0.6)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

// ============================================================
// 导出
// ============================================================

export default function ExecutionFlowWrapper() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
