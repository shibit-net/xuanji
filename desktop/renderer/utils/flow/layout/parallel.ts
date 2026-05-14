/**
 * parallel 布局 — 并行团队，成员按 stepIndex 从左到右、从上到下排列，无连接线。
 */

import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../FlowNodeTypes';

const MEMBER_W = 120;
const MEMBER_H = 100;
const GAP = 260;
const MAX_PER_ROW = 5;
const PADDING = { top: 60, right: 140, bottom: 60, left: 20 };

export function layoutParallel(
  _teamNode: Node<FlowNodeData>,
  members: Node<FlowNodeData>[],
): { nodes: Node<FlowNodeData>[]; edges: Edge[]; teamWidth: number; teamHeight: number } {
  // 按 stepIndex 排序（1→2→3→…）
  const sorted = [...members].sort((a, b) => {
    const ai = (a.data as any).stepIndex ?? 0;
    const bi = (b.data as any).stepIndex ?? 0;
    return ai - bi;
  });

  const rows = Math.ceil(sorted.length / MAX_PER_ROW);
  const colsPerRow = Math.min(sorted.length, MAX_PER_ROW);
  const totalWidth = colsPerRow * MEMBER_W + (colsPerRow - 1) * GAP + PADDING.left + PADDING.right;
  const totalHeight = rows * MEMBER_H + (rows - 1) * GAP + PADDING.top + PADDING.bottom;

  const positioned = sorted.map((m, i) => {
    const row = Math.floor(i / MAX_PER_ROW);
    const col = i % MAX_PER_ROW;
    // 最后一行居中
    const lastRowCount = sorted.length % MAX_PER_ROW || MAX_PER_ROW;
    const rowMembers = row === rows - 1 ? lastRowCount : MAX_PER_ROW;
    const rowWidth = rowMembers * MEMBER_W + (rowMembers - 1) * GAP;
    const rowOffset = (totalWidth - PADDING.left - PADDING.right - rowWidth) / 2;

    return {
      ...m,
      position: {
        x: PADDING.left + rowOffset + col * (MEMBER_W + GAP),
        y: PADDING.top + row * (MEMBER_H + GAP),
      },
      // 使用 parentNode 后 position 相对于父节点
      parentNode: m.parentNode,
    };
  });

  return {
    nodes: positioned,
    edges: [],
    teamWidth: Math.max(totalWidth, 260),
    teamHeight: totalHeight,
  };
}
