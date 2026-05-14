/**
 * debate 布局 — Judge 顶部居中，正反方并排下方（TB）。
 */

import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../FlowNodeTypes';

const MEMBER_W = 120;
const MEMBER_H = 100;
const JUDGE_W = 160;
const JUDGE_H = 110;
const GAP = 260;
const VERT_GAP = 60;
const PADDING = { top: 60, right: 140, bottom: 60, left: 20 };

export function layoutDebate(
  _teamNode: Node<FlowNodeData>,
  members: Node<FlowNodeData>[],
): { nodes: Node<FlowNodeData>[]; edges: Edge[]; teamWidth: number; teamHeight: number } {
  // 找 Judge 和 正反方
  const judge = members.find((m) => (m.data as any).debateRole === 'judge');
  const affirmative = members.find((m) => (m.data as any).debateRole === 'affirmative');
  const negative = members.find((m) => (m.data as any).debateRole === 'negative');
  const others = members.filter((m) => m !== judge && m !== affirmative && m !== negative);

  const debaters = [affirmative, negative, ...others].filter(Boolean) as Node<FlowNodeData>[];
  const debaterWidth = debaters.length * MEMBER_W + (debaters.length - 1) * GAP;
  const totalWidth = Math.max(JUDGE_W, debaterWidth) + PADDING.left + PADDING.right;
  const innerHeight = judge ? JUDGE_H + VERT_GAP + MEMBER_H : MEMBER_H;
  const totalHeight = innerHeight + PADDING.top + PADDING.bottom;

  const newEdges: Edge[] = [];
  const positioned: Node<FlowNodeData>[] = [];

  // Judge
  if (judge) {
    const jx = (totalWidth - JUDGE_W) / 2;
    const jy = PADDING.top;
    positioned.push({ ...judge, position: { x: jx, y: jy } });

    // Judge → debaters
    for (const d of debaters) {
      newEdges.push({
        id: `deb-judge-${d.id}`,
        source: judge.id,
        target: d.id,
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1.5 },
      });
    }
  }

  // Debaters 水平排列
  const debatersStartX = (totalWidth - debaterWidth) / 2;
  const debatersY = PADDING.top + (judge ? JUDGE_H + VERT_GAP : 0);

  for (let i = 0; i < debaters.length; i++) {
    positioned.push({
      ...debaters[i],
      position: {
        x: debatersStartX + i * (MEMBER_W + GAP),
        y: debatersY,
      },
    });
  }

  return {
    nodes: positioned,
    edges: newEdges,
    teamWidth: Math.max(totalWidth, 280),
    teamHeight: totalHeight,
  };
}
