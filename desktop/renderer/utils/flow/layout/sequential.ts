/**
 * sequential 布局 — 串行团队，成员水平排列（LR），带箭头。
 */

import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../FlowNodeTypes';

const MEMBER_W = 120;
const MEMBER_H = 100;
const GAP = 280;
const PADDING = { top: 60, right: 140, bottom: 60, left: 20 };

export function layoutSequential(
  _teamNode: Node<FlowNodeData>,
  members: Node<FlowNodeData>[],
): { nodes: Node<FlowNodeData>[]; edges: Edge[]; teamWidth: number; teamHeight: number } {
  const totalWidth = members.length * MEMBER_W + (members.length - 1) * GAP + PADDING.left + PADDING.right;
  const innerHeight = MEMBER_H;
  const totalHeight = innerHeight + PADDING.top + PADDING.bottom;

  const newEdges: Edge[] = [];
  const positioned: Node<FlowNodeData>[] = [];

  for (let i = 0; i < members.length; i++) {
    const x = PADDING.left + i * (MEMBER_W + GAP);
    const y = PADDING.top;

    positioned.push({
      ...members[i],
      position: { x, y },
    });

    // 成员之间的箭头边
    if (i > 0) {
      newEdges.push({
        id: `seq-${members[i - 1].id}-${members[i].id}`,
        source: members[i - 1].id,
        target: members[i].id,
        type: 'smoothstep',
        animated: (members[i - 1].data as any).status === 'success',
        style: { stroke: 'hsl(var(--primary)/0.35)', strokeWidth: 2 },
      });
    }
  }

  return {
    nodes: positioned,
    edges: newEdges,
    teamWidth: Math.max(totalWidth, 260),
    teamHeight: totalHeight,
  };
}
