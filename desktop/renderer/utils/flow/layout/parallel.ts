/**
 * parallel 布局 — 并行团队，成员水平并排，无连接线。
 */

import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../FlowNodeTypes';

const MEMBER_W = 120;
const MEMBER_H = 100;
const GAP = 40;
const PADDING = { top: 40, right: 30, bottom: 40, left: 30 };

export function layoutParallel(
  teamNode: Node<FlowNodeData>,
  members: Node<FlowNodeData>[],
): { nodes: Node<FlowNodeData>[]; edges: Edge[]; teamWidth: number; teamHeight: number } {
  const tx = teamNode.position.x;
  const ty = teamNode.position.y;

  const totalWidth = members.length * MEMBER_W + (members.length - 1) * GAP + PADDING.left + PADDING.right;
  const totalHeight = MEMBER_H + PADDING.top + PADDING.bottom;

  const positioned = members.map((m, i) => ({
    ...m,
    position: {
      x: tx + PADDING.left + i * (MEMBER_W + GAP),
      y: ty + PADDING.top,
    },
  }));

  return {
    nodes: positioned,
    edges: [],
    teamWidth: Math.max(totalWidth, 260),
    teamHeight: totalHeight,
  };
}
