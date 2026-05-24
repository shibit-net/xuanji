/**
 * TeamNode — 团队边界框（虚线框 + 标题栏 + 策略信息）。
 * 尺寸由布局引擎预先计算，不再事后反算。
 */

import { Handle, Position, type NodeProps } from 'reactflow';
import { type TeamNodeData, STRATEGY_VISUAL } from '../../utils/flow/FlowNodeTypes';
import { t } from '@/core/i18n';

const STRATEGY_LABELS: Record<string, string> = {
  sequential: t('flow.strategy.sequential'),
  parallel: t('flow.strategy.parallel'),
  hierarchical: t('flow.strategy.hierarchical'),
  debate: t('flow.strategy.debate'),
  pipeline: t('flow.strategy.pipeline'),
};

const STRATEGY_ICONS: Record<string, string> = {
  sequential: '📋',
  parallel: '⚡',
  hierarchical: '👑',
  debate: '💬',
  pipeline: '🔗',
};

export function TeamNode({ data }: NodeProps<TeamNodeData>) {
  const sc = STRATEGY_VISUAL[data.strategy] || STRATEGY_VISUAL.sequential;
  const icon = STRATEGY_ICONS[data.strategy] || '👥';
  const label = STRATEGY_LABELS[data.strategy] || data.strategy;

  return (
    <div className="relative w-full h-full">
      {/* Handles — 顶部居中 */}
      <Handle
        type="target"
        position={Position.Top}
        className="!opacity-0 !pointer-events-none"
        style={{ left: '50%', top: 0 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!opacity-0 !pointer-events-none"
        style={{ left: '50%', bottom: 0 }}
      />

      {/* 虚线边界框 */}
      <div
        className="rounded-xl"
        style={{
          position: 'absolute',
          inset: 0,
          border: `2px dashed ${sc.border}`,
          background: sc.bg,
        }}
      />

      {/* 标题栏 */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-t-xl cursor-grab active:cursor-grabbing"
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          background: `linear-gradient(135deg, ${sc.bg}, transparent)`,
          borderBottom: `1px solid ${sc.border}`,
        }}
      >
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-foreground/80 truncate max-w-[120px]">
          {data.teamName}
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground flex-shrink-0">
          {label}
        </span>
        <div className="flex-1" />
        {/* Debate 轮次 */}
        {data.strategy === 'debate' && data.currentRound != null && data.maxRounds != null && (
          <span className="text-[10px] font-mono text-muted-foreground">
            R{data.currentRound}/{data.maxRounds}
          </span>
        )}
      </div>

      {/* 底部策略状态信息 */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[10px] text-muted-foreground/50 pointer-events-none">
        {data.strategy === 'sequential' ? (
          <span className="text-blue-400/60">{t('flow.strategy.sequential_steps', { count: data.memberCount })}</span>
        ) : data.strategy === 'pipeline' ? (
          <span className="text-purple-400/60">{t('flow.strategy.pipeline_stages', { count: data.memberCount })}</span>
        ) : (
          <>
            <span>{t('flow.strategy.member_count', { count: data.memberCount })}</span>
            {data.goal && (
              <span className="max-w-[200px] truncate">{data.goal.slice(0, 80)}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
