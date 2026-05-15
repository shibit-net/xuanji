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
import { useAgentStateMachine, type AgentState as NewAgentState } from '../stores/AgentStateMachine';
import { Avatar } from './Avatar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// 主 agent 头像
import agentAvatar from '../assets/logos/01bff9e8a394133b79cf6911056f3bff.png';

// 浅比较两个对象，用于节点 data 变化检测
// 跳过高频字段：thinkingText（气泡内容由子组件监听 store 自行更新）
// currentMoment 只看 type/status/label（跳过 startTime/durationMs 这些实时变化的字段）
function hasNodeDataChanged(a: any, b: any): boolean {
  if (a === b) return false;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return true;
  const skipKeys = new Set(['thinkingText', 'currentTask']);
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return true;
  for (const k of ka) {
    if (skipKeys.has(k)) continue;
    // 数组类型（timelineEvents）比较长度和最后 4 项 id
    if (Array.isArray(a[k]) && Array.isArray(b[k])) {
      if (a[k].length !== b[k].length) return true;
      const aLast = a[k].slice(-4);
      const bLast = b[k].slice(-4);
      if (aLast.length !== bLast.length) return true;
      for (let i = 0; i < aLast.length; i++) {
        if (aLast[i]?.id !== bLast[i]?.id || aLast[i]?.status !== bLast[i]?.status) return true;
      }
      continue;
    }
    // currentMoment：跳过实时变化的毫秒字段，只看结构性变化
    if (k === 'currentMoment' && a[k] && b[k]) {
      if (a[k].type !== b[k].type || a[k].status !== b[k].status || a[k].label !== b[k].label) return true;
      continue;
    }
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
  scene?: string;
  executionMode?: 'acp' | 'in-process';
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
  done:       { bg: 'rgba(138,138,138,0.08)',  border: 'rgba(138,138,138,0.2)',   ring: 'rgba(138,138,138,0.3)',   glow: 'transparent' },
  failed:     { bg: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.5)',  ring: 'rgba(248,113,113,0.8)',  glow: 'rgba(248,113,113,0.15)' },
  error:      { bg: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.5)',  ring: 'rgba(248,113,113,0.8)',  glow: 'rgba(248,113,113,0.15)' },
  pending:    { bg: 'rgba(96,165,250,0.06)',  border: 'rgba(96,165,250,0.2)',  ring: 'rgba(96,165,250,0.25)', glow: 'transparent' },
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

function AgentNode({ data, id }: NodeProps<AgentNodeData>) {
  const colors = getColors(data.status);
  const active = isActiveStatus(data.status);
  const final = isFinalStatus(data.status);
  const now = useRealtimeClock();
  // thinkingText 不从 data 读取（data 引用稳定时不会更新），从 store 实时订阅
  const liveThinkingText = useAgentStateMachine((s) => s.agentMap[id]?.currentThought);
  const hasThought = !!liveThinkingText;
  const hasTaskHint = !!data.currentTask && !liveThinkingText;
  const hasMoment = !!data.currentMoment;
  const hasTimeline = data.timelineEvents && data.timelineEvents.length > 0;
  const hasLeftBubble = hasThought || hasTaskHint;

  // 策略徽章
  const strategyLabel = data.multiAgent?.strategy
    ? data.multiAgent.strategy.charAt(0).toUpperCase() + data.multiAgent.strategy.slice(1)
    : null;

  // 顺序/流水线策略的执行序号
  const showOrderBadge = (data.multiAgent?.strategy === 'sequential' || data.multiAgent?.strategy === 'pipeline')
    && data.multiAgent?.stepIndex !== undefined;
  // Unicode 带圈数字 ①–⑳
  const circledNumbers = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const orderSymbol = showOrderBadge
    ? (data.multiAgent!.stepIndex! < 20 ? circledNumbers[data.multiAgent!.stepIndex!] : `#${data.multiAgent!.stepIndex! + 1}`)
    : '';

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

      <div className="grid w-full h-full pt-2 pointer-events-none" style={{ gridTemplateColumns: '1fr auto 1fr', alignItems: 'start' }}>
        {/* 左侧：思维气泡（右对齐，贴近头像） */}
        <div className="flex justify-end" style={{ paddingRight: 6 }}>
          {hasLeftBubble && (
            <div style={{ width: 200 }}>
              <div className={`relative bg-card/90 backdrop-blur-sm rounded-xl px-3 py-2 shadow-glass-sm ${
                hasThought ? 'border border-green-500/40' : 'border border-yellow-500/40'
              }`}>
                <p className="text-[10px] text-muted-foreground leading-relaxed break-words whitespace-pre-wrap">
                  {hasThought ? liveThinkingText?.slice(-200) : data.currentTask?.slice(-200)}
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
          {/* 圆形头像容器 — Handles 在此使连线对接头像 */}
          <div className="relative" style={{ width: 56, height: 56 }}>
            <Handle type="target" position={Position.Top} className="!opacity-0" />
            <Handle type="source" position={Position.Bottom} className="!opacity-0" />
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
              {/* 主 agent 用实际 logo，其余用 DiceBear */}
              {data.id === 'xuanji' || data.name === 'Xuanji' ? (
                <img
                  src={agentAvatar}
                  alt={data.name}
                  className="w-full h-full rounded-full object-cover"
                  style={{ width: 48, height: 48 }}
                />
              ) : (
                <Avatar seed={data.name} size={48} className="w-full h-full rounded-full" />
              )}
            </div>

            {/* 执行序号徽章（顺序/流水线策略） */}
            {showOrderBadge && (
              <div className="absolute -top-1 -right-1 z-10 flex items-center justify-center"
                style={{ width: 18, height: 18 }}
                title={`执行顺序: 第 ${data.multiAgent!.stepIndex! + 1} / ${data.multiAgent!.totalSteps} 步`}
              >
                <span className="text-sm leading-none text-primary drop-shadow-sm"
                  style={{ textShadow: '0 0 3px rgba(0,0,0,0.5)' }}
                >{orderSymbol}</span>
              </div>
            )}

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
          <div className="mt-1.5 flex items-center justify-center max-w-[140px]">
            <span className="text-xs font-medium text-foreground/80 truncate">{data.name}</span>
          </div>

          {/* 标签行：类型 / 场景 / 执行模式（单排不换行） */}
          {data.type !== 'team' && (data.agentType || data.scene || data.executionMode) && (
            <div className="flex items-center gap-1 mt-1 justify-center max-w-[200px] overflow-hidden">
              {data.agentType && (
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25 whitespace-nowrap flex-shrink-0">
                  {data.agentType === 'builtin' ? '系统' :
                   data.agentType === 'preset' ? '应用' :
                   data.agentType === 'custom' ? '自定义' :
                   data.agentType === 'temporary' ? '临时' : data.agentType}
                </span>
              )}
              {data.scene && (
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/25 whitespace-nowrap flex-shrink-0 truncate">
                  {data.scene}
                </span>
              )}
              {data.executionMode && (
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 whitespace-nowrap flex-shrink-0">
                  {data.executionMode === 'acp' ? '子进程' : '主进程'}
                </span>
              )}
            </div>
          )}

          {/* 策略标签（团队类型） */}
          {strategyLabel && data.type === 'team' && (
            <span className="text-[8px] px-1 py-[1px] rounded bg-muted text-muted-foreground whitespace-nowrap mt-0.5">{strategyLabel}</span>
          )}

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

          {/* 层级模式：Leader / Worker 标签 */}
          {!data.debateRole && data.multiAgent?.strategy === 'hierarchical' && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded mt-0.5 font-medium ${
              data.name?.toLowerCase().includes('leader') || data.multiAgent?.stepIndex === 0
                ? 'bg-warning/20 text-warning'
                : 'bg-primary/15 text-primary'
            }`}>
              {data.name?.toLowerCase().includes('leader') || data.multiAgent?.stepIndex === 0 ? 'Leader' : `Worker ${(data.multiAgent?.stepIndex ?? 0) + 1}`}
            </span>
          )}

          {/* 并行模式：Worker 标签 */}
          {!data.debateRole && data.multiAgent?.strategy === 'parallel' && data.multiAgent?.totalSteps && data.multiAgent.totalSteps > 1 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded mt-0.5 font-medium bg-primary/15 text-primary">
              Worker {data.multiAgent?.stepIndex != null ? data.multiAgent.stepIndex + 1 : ''}
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
              {data.timelineEvents!.slice(-4).map((evt) => {
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
    <div className="relative w-full h-full" style={{ minWidth: 200, minHeight: 100 }}>
      <Handle type="target" position={Position.Top} className="!opacity-0 !pointer-events-none" style={{ left: '50%', top: 0, transform: 'translateX(-50%)' }} />
      <Handle type="source" position={Position.Bottom} className="!opacity-0 !pointer-events-none" style={{ left: '50%', bottom: 0, transform: 'translateX(-50%)' }} />

      {/* 虚线边界框 — 不设置 pointer-events-none，确保整个团队区域可拖拽 */}
      <div
        className="rounded-xl"
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
        <span className="text-xs font-semibold text-foreground/80 truncate max-w-[120px]">{ti.teamName}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground flex-shrink-0">{ti.strategy === 'sequential' ? '串行' : ti.strategy === 'parallel' ? '并行' : ti.strategy === 'debate' ? '辩论' : ti.strategy === 'hierarchical' ? '层级' : ti.strategy === 'pipeline' ? '流水线' : ti.strategy}</span>
        <div className="flex-1" />
        {ti.strategy === 'debate' && ti.currentRound != null && ti.maxRounds != null && (
          <span className="text-[10px] font-mono text-muted-foreground">R{ti.currentRound}/{ti.maxRounds}</span>
        )}
      </div>

      {/* 策略专属状态信息 */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[10px] text-muted-foreground/50 pointer-events-none">
        {ti.strategy === 'sequential' ? (
          <span className="text-blue-400/60">➡️ 顺序执行 · {ti.memberCount} 步</span>
        ) : ti.strategy === 'pipeline' ? (
          <span className="text-purple-400/60">🔗 流水线 · {ti.memberCount} 阶段</span>
        ) : (
          <>
            <span>{ti.memberCount} 名成员</span>
            {ti.strategy === 'parallel' && ti.currentRound != null && (
              <span className="text-primary/50">{ti.currentRound} 个运行中</span>
            )}
            {ti.strategy === 'hierarchical' && (
              <span className="text-warning/50">1 Leader · {ti.memberCount - 1} Worker</span>
            )}
          </>
        )}
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
// Flow 组件
// ============================================================

function Flow() {
  // 新 store 订阅
  const newAgentMap = useAgentStateMachine((s) => s.agentMap);
  const newMainAgentId = useAgentStateMachine((s) => s.mainAgent);
  const { fitView } = useReactFlow();
  const initialized = useRef(false);

  // 追踪用户手动拖拽位置，防止思考流更新时重置位置
  const draggedPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  // 记录每个成员的初始 dagre 位置（首次 flowData 布局后）
  const initialPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  // 记录 team 框拖拽时的基准偏移，用于同步移动内部成员
  const teamDragOffsets = useRef<Map<string, { dx: number; dy: number }>>(new Map());

  // ─── 新路径：从扁平 agentMap 构建 flow ───────────────
  const buildFlowFromAgentMap = useCallback((
    agentMap: Record<string, NewAgentState>,
    mainAgentId: string,
  ): { nodes: Node<AgentNodeData>[]; edges: Edge[]; teamNodes: Map<string, Node<AgentNodeData>>; teamMembers: Map<string, string[]> } => {
    const nodes: Node<AgentNodeData>[] = [];
    const edges: Edge[] = [];
    const teamNodes = new Map<string, Node<AgentNodeData>>();
    const teamMembers = new Map<string, string[]>();

    const activeAgents = Object.values(agentMap).filter(a => a.status !== 'cleared');
    const agentIds = new Set(activeAgents.map(a => a.id));

    for (const a of activeAgents) {
      const isTeamMember = a.taskType === 'team' && a.multiAgent?.teamName;
      const teamName = a.multiAgent?.teamName;
      const isActive = isActiveStatus(a.status);

      const nodeData: AgentNodeData = {
        id: a.id,
        name: a.name,
        status: a.status,
        type: a.taskType === 'team' ? 'team' : 'agent',
        thinkingText: a.currentThought,
        currentTask: a.currentTask,
        currentMoment: a.moment ? {
          icon: a.moment.icon || '',
          label: a.moment.label,
          durationMs: a.moment.duration,
          status: a.moment.status,
          startTime: a.moment.startTime,
        } : undefined,
        timelineEvents: a.currentTools.length > 0 ? a.currentTools.slice(-4).map((t: any) => ({
          id: t.id,
          icon: '',
          label: t.name,
          duration: t.endTime ? t.endTime - t.startTime : undefined,
          status: t.status,
          startTime: t.startTime,
        })) : undefined,
        agentType: a.agentType,
        scene: a.scene,
        executionMode: a.executionMode,
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
        strategy: a.multiAgent?.strategy,
        debateRole: a.multiAgent?.debateRole,
      };

      if (isTeamMember && teamName) {
        if (!teamMembers.has(teamName)) teamMembers.set(teamName, []);
        teamMembers.get(teamName)!.push(a.id);

        if (!teamNodes.has(teamName)) {
          const memberCount = a.multiAgent?.totalSteps || 1;
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

          const parentForTeam = a.parentId && agentIds.has(a.parentId) ? a.parentId : mainAgentId;
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

        nodes.push({
          id: a.id,
          type: 'agent',
          position: { x: 0, y: 0 },
          data: nodeData,
          draggable: false,
        });
      } else {
        nodes.push({
          id: a.id,
          type: 'agent',
          position: { x: 0, y: 0 },
          data: nodeData,
          draggable: true,
        });

        const pid = a.parentId;
        if (pid && agentIds.has(pid)) {
          edges.push({
            id: `e-${pid}-${a.id}`,
            source: pid,
            target: a.id,
            type: 'smoothstep',
            animated: isActive,
            style: { stroke: isActive ? 'hsl(var(--primary)/0.35)' : 'rgba(255,255,255,0.08)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: isActive ? 'hsl(var(--primary)/0.35)' : 'rgba(255,255,255,0.1)' },
          });
        }
      }
    }

    // 过滤边：移除直接连向 team member 的 agent → member 边
    const teamMemberSet = new Set<string>();
    teamMembers.forEach((members) => members.forEach(m => teamMemberSet.add(m)));
    const filteredEdges = edges.filter(e => {
      if (teamMemberSet.has(e.target)) return false;
      return true;
    });

    // 添加 team → member 透明边用于 dagre 布局
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
  }, []);

  const flowData = useMemo(() => {

      if (!newMainAgentId || Object.keys(newAgentMap).length === 0) return null;
      const raw = buildFlowFromAgentMap(newAgentMap, newMainAgentId);
      const allNodes = [...raw.nodes];
      raw.teamNodes.forEach((tn) => allNodes.push(tn));
      const laidOut = layoutNodes(allNodes, raw.edges);
      const restored = laidOut.map(n => {
        const dragged = draggedPositions.current.get(n.id);
        if (dragged) return { ...n, position: dragged };
        return n;
      });
      // 根据成员位置调整 team 框
      const adjustedNodes = restored.map(n => {
        if (!n.id.startsWith('team-')) return n;
        const tn = n.id.replace('team-', '');
        const members = raw.teamMembers.get(tn);
        if (!members || members.length === 0) return n;
        const memberNodes = members.map(mid => restored.find(rn => rn.id === mid)).filter(Boolean) as Node[];
        if (memberNodes.length === 0) return n;
        const isDebate = memberNodes.some(m => m.data?.strategy === 'debate');
        const padding = isDebate ? 140 : 80;
        const leftExtra = isDebate ? 220 : 120;
        const rightExtra = isDebate ? 120 : 80;
        const minX = Math.min(...memberNodes.map(m => m.position.x)) - leftExtra;
        const maxX = Math.max(...memberNodes.map(m => m.position.x + NODE_W)) + rightExtra;
        const minY = Math.min(...memberNodes.map(m => m.position.y)) - padding;
        const maxY = Math.max(...memberNodes.map(m => m.position.y + NODE_H)) + padding;
        return { ...n, position: { x: minX, y: minY }, width: maxX - minX, height: maxY - minY, style: { width: maxX - minX, height: maxY - minY } };
      });
      // 记录初始位置
      if (draggedPositions.current.size === 0) {
        adjustedNodes.filter(n => n.id.startsWith('team-')).forEach(tn => {
          initialPositions.current.set(tn.id, { ...tn.position });
        });
      }
      return { nodes: adjustedNodes, edges: raw.edges };

  }, [newAgentMap, newMainAgentId, buildFlowFromAgentMap]);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState(flowData?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData?.edges || []);

  // 辅助：判断 agent 是否某 team 成员
  const isTeamMember = useCallback((agentId: string): string | undefined => {
    const a = newAgentMap[agentId];
    return a?.multiAgent?.teamName;
  }, [newAgentMap]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // 只提取 team 框的拖拽变化，忽略所有其他节点的变化
    let teamChange: NodeChange | null = null;
    for (const c of changes) {
      if (c.type === 'position' && 'id' in c && typeof c.id === 'string' && c.id.startsWith('team-')) {
        teamChange = c;
        break;
      }
    }

    if (!teamChange) {
      // 过滤掉所有团队成员节点的变化（position / select / remove 等），
      // 成员位置完全由 dagre 布局 + team 拖拽偏移决定
      const filtered = changes.filter(c => {
        if ('id' in c && typeof c.id === 'string') {
          if (isTeamMember(c.id as string)) return false;
        }
        return true;
      });
      onNodesChangeRaw(filtered);
      return;
    }

    // 处理 team 框拖拽
    const change = teamChange as any;
    if (!change.position) return;
    const teamName = (change.id as string).replace('team-', '');
    // 首次拖拽：用 dagre 初始位置作为 oldPos，避免首次拖拽被忽略
    const initPos = initialPositions.current.get(change.id);
    if (!initPos) return;
    const oldPos = draggedPositions.current.get(change.id) || initPos;
    draggedPositions.current.set(change.id, { ...change.position });

    const dx = change.position.x - oldPos.x;
    const dy = change.position.y - oldPos.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    const prevOffset = teamDragOffsets.current.get(teamName) || { dx: 0, dy: 0 };
    teamDragOffsets.current.set(teamName, { dx: prevOffset.dx + dx, dy: prevOffset.dy + dy });
    const totalDx = prevOffset.dx + dx;
    const totalDy = prevOffset.dy + dy;

    setNodes(prev => prev.map(n => {
      if (n.id === change.id) return { ...n, position: { ...change.position } };
      if (isTeamMember(n.id) !== teamName) return n;
      const initPos = initialPositions.current.get(n.id);
      if (!initPos) return n;
      const newPos = { x: initPos.x + totalDx, y: initPos.y + totalDy };
      draggedPositions.current.set(n.id, newPos);
      return { ...n, position: newPos };
    }));
  }, [onNodesChangeRaw, newAgentMap, isTeamMember]);

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
        // 数据未变时保留旧引用避免闪烁，但必须同步最新拖拽位置，否则拖拽后位置会被重置
        if (pos.x !== old.position.x || pos.y !== old.position.y) {
          return { ...old, position: pos };
        }
        return old;
      }
      return { ...newNode, position: pos, data: { ...newNode.data } };
    });
    prevNodesRef.current = newNodes as Node[];

    // 清理已移除节点的拖拽/位置缓存，防止多次任务执行后 ref map 无限增长
    const newNodeIds = new Set(newNodes.map(n => n.id));
    for (const id of draggedPositions.current.keys()) {
      if (!newNodeIds.has(id)) draggedPositions.current.delete(id);
    }
    for (const id of initialPositions.current.keys()) {
      if (!newNodeIds.has(id)) initialPositions.current.delete(id);
    }
    for (const id of teamDragOffsets.current.keys()) {
      if (!newNodeIds.has(id)) teamDragOffsets.current.delete(id);
    }

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
      {!newMainAgentId || Object.values(newAgentMap).filter(a => a.status !== 'cleared').length === 0 ? (
        <div className="w-full h-full flex items-center justify-center relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[300px] h-[300px] rounded-full bg-primary/2 blur-[80px]" />
          </div>
          <div className="flex flex-col items-center gap-4 text-center relative z-10">
            <div className="w-14 h-14 rounded-2xl bg-card backdrop-blur-xl flex items-center justify-center shadow-glass-sm">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary/60">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground/60">执行监视</p>
              <p className="text-xs text-muted-foreground/40 max-w-[180px]">实时追踪多 Agent 协作执行过程</p>
            </div>
          </div>
        </div>
      ) : (
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
      )}
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
