/**
 * pipeline 布局 — 流水线团队，阶段水平排列（LR），粗箭头+文件传递。
 */

import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../FlowNodeTypes';

const MEMBER_W = 120;
const MEMBER_H = 100;
const GAP = 280;
const PADDING = { top: 60, right: 140, bottom: 60, left: 20 };

export function layoutPipeline(
  _teamNode: Node<FlowNodeData>,
  members: Node<FlowNodeData>[],
): { nodes: Node<FlowNodeData>[]; edges: Edge[]; teamWidth: number; teamHeight: number } {
  // 按 stepIndex 排序
  const sorted = [...members].sort(
    (a, b) => ((a.data as any).stepIndex ?? 0) - ((b.data as any).stepIndex ?? 0),
  );

  const totalWidth = sorted.length * MEMBER_W + (sorted.length - 1) * GAP + PADDING.left + PADDING.right;
  const totalHeight = MEMBER_H + PADDING.top + PADDING.bottom;

  const newEdges: Edge[] = [];
  const positioned: Node<FlowNodeData>[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const x = PADDING.left + i * (MEMBER_W + GAP);
    const y = PADDING.top;

    positioned.push({
      ...sorted[i],
      position: { x, y },
    });

    // 阶段间粗箭头
    if (i > 0) {
      newEdges.push({
        id: `pipe-${sorted[i - 1].id}-${sorted[i].id}`,
        source: sorted[i - 1].id,
        target: sorted[i].id,
        type: 'smoothstep',
        animated: (sorted[i - 1].data as any).status === 'success',
        style: { stroke: 'rgba(139,92,246,0.5)', strokeWidth: 3 },
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
