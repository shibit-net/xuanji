/**
 * SubagentNode — 后台子 Agent 节点。
 * 左侧：聊天气泡，右侧：moment + timeline，内部：头像 + 名称 + 元信息
 */

import { Handle, Position, type NodeProps } from 'reactflow';
import {
  getStatusVisual, isActiveStatus, isTerminalStatus, getAgentTypeLabel,
  getMomentColor, isMomentActive,
  type SubagentNodeData,
} from '../../utils/flow/FlowNodeTypes';
import { useAgentStateMachine } from '../../stores/AgentStateMachine';
import { Avatar } from '../Avatar';
import { useRealtimeClock, formatDuration } from './hooks';

const NODE_W = 100;
const AVATAR_SIZE = 44;

export function SubagentNode({ data, id }: NodeProps<SubagentNodeData>) {
  const visual = getStatusVisual(data.status);
  const active = isActiveStatus(data.status);
  const terminal = isTerminalStatus(data.status);
  const liveThinkingText = useAgentStateMachine((s) => s.agentMap[id]?.currentThought);
  const liveResponseText = useAgentStateMachine((s) => s.agentMap[id]?.currentResponse);
  const now = useRealtimeClock();

  const isThinking = data.status === 'thinking';
  const isReporting = data.status === 'reporting';
  const hasThought = !!liveThinkingText && isThinking;
  const hasReport = !!liveResponseText && isReporting;
  const hasTask = !!(data.taskDescription || data.currentTask);
  const showTaskBubble = hasTask && !isThinking && !isReporting;
  const showThoughtBubble = hasThought && !!liveThinkingText;
  const showReportingBubble = hasReport && !!liveResponseText;
  const hasMoment = !!data.currentMoment;
  const hasTimeline = !!(data.timelineEvents && data.timelineEvents.length > 0);
  const hasRightSide = hasMoment || hasTimeline;

  const taskText = data.taskDescription || data.currentTask;

  return (
    <div className="relative flex flex-col items-center overflow-visible" style={{ width: NODE_W, minHeight: 110 }}>
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />

      {/* 脉冲光晕 */}
      {active && (
        <div
          className="absolute animate-pulse pointer-events-none rounded-full"
          style={{
            width: 70, height: 70,
            left: '50%', top: 26,
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, ${visual.glow} 0%, transparent 70%)`,
            filter: 'blur(16px)',
          }}
        />
      )}

      {/* 自旋环（thinking） */}
      {data.status === 'thinking' && (
        <svg className="absolute animate-spin" style={{ width: 52, height: 52, top: 0, left: '50%', marginLeft: -26 }} viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="24" fill="none" stroke={visual.ring}
            strokeWidth="2" strokeDasharray="38 113" strokeLinecap="round" />
        </svg>
      )}

      {/* 静态环 */}
      {!active && !terminal && data.status !== 'pending' && (
        <svg className="absolute" style={{ width: 50, height: 50, top: 1, left: '50%', marginLeft: -25 }} viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="23" fill="none" stroke={visual.ring} strokeWidth="2" />
        </svg>
      )}

      {/* 终态环 */}
      {terminal && (
        <svg className="absolute" style={{ width: 50, height: 50, top: 1, left: '50%', marginLeft: -25 }} viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="23" fill="none" stroke={visual.ring} strokeWidth="1.5" opacity={0.4} />
        </svg>
      )}

      {/* 头像 */}
      <div
        className="rounded-full overflow-hidden shadow-md flex-shrink-0"
        style={{
          width: AVATAR_SIZE, height: AVATAR_SIZE,
          background: 'rgba(46,46,46,0.85)',
          border: `2px solid ${visual.border}`,
          marginTop: 4,
          opacity: terminal ? 0.4 : 1,
        }}
      >
        <Avatar seed={data.name} size={AVATAR_SIZE} className="w-full h-full rounded-full" />
      </div>

      {/* 名称 */}
      <div className="mt-1 text-center max-w-[120px]">
        <span className="text-[10px] font-medium truncate block"
          style={{ color: terminal ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)' }}>
          {data.name}
        </span>
      </div>

      {/* 元信息标签行：scene + agentType + executionMode + 任务 */}
      <div className="flex items-center gap-1 mt-0.5 flex-wrap justify-center">
        {data.scene && (
          <span className="text-[7px] px-1 py-0 rounded bg-purple-500/15 text-purple-400 border border-purple-500/25 truncate max-w-[80px]">
            {data.scene}
          </span>
        )}
        {data.agentType && (
          <span className={`text-[7px] px-1 py-0 rounded ${
            data.agentType === 'temporary'
              ? 'bg-orange-500/10 text-orange-400/70'
              : 'bg-blue-500/10 text-blue-400/70'
          }`}>
            {getAgentTypeLabel(data.agentType)}
          </span>
        )}
        {data.executionMode && (
          <span className="text-[7px] px-1 py-0 rounded bg-amber-500/10 text-amber-400/70">
            {data.executionMode === 'acp' ? 'acp' : 'proc'}
          </span>
        )}
        {data.isAsync !== undefined && (
          <span className={`text-[7px] px-1 py-0 rounded ${data.isAsync ? 'bg-orange-500/15 text-orange-400/80' : 'bg-blue-500/10 text-blue-400/70'}`}>
            {data.isAsync ? 'async' : 'sync'}
          </span>
        )}
        {data.currentTask && (
          <span className="text-[7px] px-1 py-0 rounded bg-cyan-500/10 text-cyan-400/70 truncate max-w-[90px]">
            {data.currentTask.slice(0, 40)}
          </span>
        )}
      </div>

      {/* 任务描述 */}
      {data.taskDescription && (
        <span className="text-[8px] text-muted-foreground/60 truncate max-w-[120px] mt-0.5">
          {data.taskDescription.slice(0, 80)}
        </span>
      )}

      {/* ─── 左侧：聊天气泡 ─── */}
      {/* 任务气泡（黄色边框）— 分配了任务但尚未开始思考 */}
      {showTaskBubble && (
        <div
          className="absolute top-0 right-full mr-0 bg-card/90 backdrop-blur-sm rounded-lg px-1.5 py-1 border border-yellow-500/40 shadow-glass-sm min-w-[140px] max-w-[180px]"
          style={{ zIndex: 10 }}
        >
          <span className="text-[6px] text-yellow-400/70 uppercase tracking-wider">任务</span>
          <p className="text-[8px] text-muted-foreground leading-relaxed break-words whitespace-pre-wrap mt-0.5">
            {taskText!.slice(-150)}
          </p>
        </div>
      )}

      {/* 思考气泡（绿色边框）— 正在思考 */}
      {showThoughtBubble && (
        <div
          className="absolute top-0 right-full mr-0 bg-card/90 backdrop-blur-sm rounded-lg px-1.5 py-1 border border-green-500/40 shadow-glass-sm min-w-[140px] max-w-[180px]"
          style={{ zIndex: 10 }}
        >
          <span className="text-[6px] text-muted-foreground/50 uppercase tracking-wider">思考</span>
          <p className="text-[8px] text-muted-foreground leading-relaxed break-words whitespace-pre-wrap mt-0.5">
            {liveThinkingText!.slice(-150)}
          </p>
        </div>
      )}

      {/* 汇报气泡（琥珀色边框）— 异步任务完成后汇报结果 */}
      {showReportingBubble && (
        <div
          className="absolute top-0 right-full mr-0 bg-card/90 backdrop-blur-sm rounded-lg px-1.5 py-1 border border-amber-400/50 shadow-glass-sm min-w-[140px] max-w-[180px]"
          style={{ zIndex: 10 }}
        >
          <span className="text-[6px] text-amber-400/70 uppercase tracking-wider">汇报</span>
          <p className="text-[8px] text-muted-foreground leading-relaxed break-words whitespace-pre-wrap mt-0.5">
            {liveResponseText!.slice(-150)}
          </p>
        </div>
      )}

      {/* ─── 右侧：moment + timeline ─── */}
      {hasRightSide && (
        <div
          className="absolute top-0 left-full ml-0 flex flex-col gap-0.5 max-w-[130px]"
          style={{ zIndex: 10 }}
        >
          {hasMoment && (
            <div className={`inline-flex items-center gap-1 px-1 py-0.5 rounded text-[7px] whitespace-nowrap ${getMomentColor(data.currentMoment!.status)}`}>
              <span>{data.currentMoment!.label}</span>
              {isMomentActive(data.currentMoment!.status) && data.currentMoment!.startTime ? (
                <span className="opacity-50 font-mono">{formatDuration(now - data.currentMoment!.startTime)}</span>
              ) : data.currentMoment!.durationMs != null ? (
                <span className="opacity-50 font-mono">{formatDuration(data.currentMoment!.durationMs)}</span>
              ) : null}
            </div>
          )}

          {hasTimeline && (
            <div className="flex flex-col gap-0.5">
              {data.timelineEvents!.map((evt) => (
                <div key={evt.id} className="flex items-center gap-1 px-1 py-0.5 rounded text-[7px] bg-muted/30">
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
        </div>
      )}
    </div>
  );
}
