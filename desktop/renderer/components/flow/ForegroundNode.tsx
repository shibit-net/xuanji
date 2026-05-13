/**
 * ForegroundNode — 前台 Agent 节点。
 * LR 布局中思考气泡置于上方，下方展示 moment + timeline。
 */

import { useMemo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import {
  getStatusVisual, isActiveStatus, isTerminalStatus,
  type ForegroundNodeData,
} from '../../utils/flow/FlowNodeTypes';
import { useAgentStateMachine } from '../../stores/AgentStateMachine';
import { Avatar } from '../Avatar';
import { useRealtimeClock, formatDuration } from './hooks';
import agentAvatar from '../../assets/logos/01bff9e8a394133b79cf6911056f3bff.png';

const NODE_W = 180;
const AVATAR_SIZE = 64;

export function ForegroundNode({ data, id }: NodeProps<ForegroundNodeData>) {
  const visual = getStatusVisual(data.status);
  const active = isActiveStatus(data.status);
  const terminal = isTerminalStatus(data.status);
  const liveThinkingText = useAgentStateMachine((s) => s.agentMap[id]?.currentThought);
  const now = useRealtimeClock();

  const hasThought = !!liveThinkingText && data.status === 'thinking';
  const hasMoment = !!data.currentMoment;
  const hasTimeline = !!(data.timelineEvents && data.timelineEvents.length > 0);

  const badge = useMemo(() => {
    if (data.status === 'success') return { icon: '✓', color: 'bg-success' };
    if (data.status === 'failed') return { icon: '✕', color: 'bg-destructive' };
    return null;
  }, [data.status]);

  return (
    <div className="relative flex flex-col items-center" style={{ width: NODE_W, minHeight: 200 }}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Handle type="source" position={Position.Right} className="!opacity-0" />

      {/* 脉冲光晕（活跃态） */}
      {active && (
        <div
          className="absolute animate-pulse pointer-events-none rounded-full"
          style={{
            width: 100, height: 100,
            left: '50%', top: 40,
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, ${visual.glow} 0%, transparent 70%)`,
            filter: 'blur(20px)',
          }}
        />
      )}

      {/* 自旋虚线环（thinking） */}
      {data.status === 'thinking' && (
        <svg
          className="absolute animate-spin"
          style={{ width: 72, height: 72, top: 4, left: '50%', marginLeft: -36 }}
          viewBox="0 0 72 72"
        >
          <circle cx="36" cy="36" r="34" fill="none" stroke={visual.ring}
            strokeWidth="2" strokeDasharray="54 159" strokeLinecap="round" />
        </svg>
      )}

      {/* 静态环（非活跃非终态） */}
      {!active && !terminal && (
        <svg className="absolute" style={{ width: 70, height: 70, top: 5, left: '50%', marginLeft: -35 }} viewBox="0 0 70 70">
          <circle cx="35" cy="35" r="33" fill="none" stroke={visual.ring} strokeWidth="2" />
        </svg>
      )}

      {/* 终态静态环 */}
      {terminal && (
        <svg className="absolute" style={{ width: 70, height: 70, top: 5, left: '50%', marginLeft: -35 }} viewBox="0 0 70 70">
          <circle cx="35" cy="35" r="33" fill="none" stroke={visual.ring} strokeWidth="1.5" opacity={0.4} />
        </svg>
      )}

      {/* 头像 */}
      <div
        className="rounded-full overflow-hidden shadow-lg flex-shrink-0"
        style={{
          width: AVATAR_SIZE, height: AVATAR_SIZE,
          background: 'rgba(46,46,46,0.85)',
          border: `2px solid ${visual.border}`,
          marginTop: 8,
          opacity: terminal ? 0.5 : 1,
        }}
      >
        {data.agentId === 'xuanji' || data.name === 'Xuanji' ? (
          <img src={agentAvatar} alt={data.name} className="w-full h-full rounded-full object-cover" />
        ) : (
          <Avatar seed={data.name} size={AVATAR_SIZE} className="w-full h-full rounded-full" />
        )}
      </div>

      {/* 状态徽章 */}
      {badge && (
        <div
          className={`absolute rounded-full border-2 border-background z-10 flex items-center justify-center ${badge.color}`}
          style={{ width: 18, height: 18, top: AVATAR_SIZE, left: '50%', marginLeft: AVATAR_SIZE / 2 - 8 }}
        >
          <span className="text-[8px] text-white font-bold">{badge.icon}</span>
        </div>
      )}

      {/* 名称 */}
      <div className="mt-2 text-center max-w-[160px]">
        <span className="text-xs font-medium truncate block"
          style={{ color: terminal ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.8)' }}>
          {data.name}
        </span>
      </div>

      {/* 场景 + Agent类型标签 */}
      <div className="flex items-center gap-1 mt-0.5 flex-wrap justify-center">
        {data.scene && (
          <span className="text-[8px] px-1 py-0 rounded bg-purple-500/15 text-purple-400 border border-purple-500/25 truncate max-w-[100px]">
            {data.scene}
          </span>
        )}
        {data.agentType && (
          <span className="text-[8px] px-1 py-0 rounded bg-blue-500/10 text-blue-400/70 border border-blue-500/20">
            {data.agentType}
          </span>
        )}
        {data.executionMode && (
          <span className="text-[8px] px-1 py-0 rounded bg-amber-500/10 text-amber-400/70 border border-amber-500/20">
            {data.executionMode === 'acp' ? 'acp' : 'proc'}
          </span>
        )}
      </div>

      {/* Moment 状态指示 */}
      {hasMoment && (
        <div className={`inline-flex items-center gap-1 px-1 py-0 rounded text-[8px] mt-0.5 ${
          data.currentMoment!.status === 'error' ? 'bg-destructive/15 text-destructive' :
          data.currentMoment!.status === 'failed' ? 'bg-destructive/15 text-destructive' :
          active ? 'bg-primary/15 text-primary' :
          'bg-success/15 text-success'
        }`}>
          <span>{data.currentMoment!.label}</span>
          {active && data.currentMoment!.startTime ? (
            <span className="opacity-50 font-mono">{formatDuration(now - data.currentMoment!.startTime)}</span>
          ) : data.currentMoment!.durationMs != null ? (
            <span className="opacity-50 font-mono">{formatDuration(data.currentMoment!.durationMs)}</span>
          ) : null}
        </div>
      )}

      {/* Timeline 工具调用 */}
      {hasTimeline && (
        <div className="flex flex-col gap-0.5 mt-1 w-full max-w-[160px]">
          {data.timelineEvents!.map((evt) => (
            <div key={evt.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] bg-muted/30">
              <span className={`w-1 h-1 rounded-full flex-shrink-0 ${
                evt.status === 'running' ? 'bg-primary animate-pulse' :
                evt.status === 'success' ? 'bg-success' : 'bg-destructive'
              }`} />
              <span className="text-muted-foreground truncate flex-1">{evt.label}</span>
              {evt.duration != null && (
                <span className="text-muted-foreground/50 font-mono flex-shrink-0">{formatDuration(evt.duration)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* thinking 气泡 — LR 布局中放节点上方，避免与右侧子节点重叠 */}
      {hasThought && liveThinkingText && (
        <div
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-sm rounded-xl px-2 py-1.5 border border-green-500/40 shadow-glass-sm max-w-[200px]"
          style={{ zIndex: 10 }}
        >
          <p className="text-[10px] text-muted-foreground leading-relaxed break-words whitespace-pre-wrap">
            {liveThinkingText.slice(-150)}
          </p>
        </div>
      )}
    </div>
  );
}
