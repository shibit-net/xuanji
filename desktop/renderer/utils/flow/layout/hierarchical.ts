/**
 * hierarchical 布局 — Leader 居中上方，Workers 下方水平排列（TB）。
 */

import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../FlowNodeTypes';

const MEMBER_W = 120;
const MEMBER_H = 100;
const LEADER_W = 140;
const LEADER_H = 110;
const WORKER_GAP = 40;
const VERT_GAP = 60;
const PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

export function layoutHierarchical(
  teamNode: Node<FlowNodeData>,
  members: Node<FlowNodeData>[],
): { nodes: Node<FlowNodeData>[]; edges: Edge[]; teamWidth: number; teamHeight: number } {
  const tx = teamNode.position.x;
  const ty = teamNode.position.y;

  // 找 Leader（第一个成员或名称含 leader）
  const leaderIdx = members.findIndex((m) =>
    (m.data as any).name?.toLowerCase()?.includes('leader'),
  );
  const leader = leaderIdx >= 0 ? members[leaderIdx] : members[0];
  const workers = leaderIdx >= 0
    ? [...members.slice(0, leaderIdx), ...members.slice(leaderIdx + 1)]
    : members.slice(1);

  const workersWidth = workers.length * MEMBER_W + (workers.length - 1) * WORKER_GAP;
  const totalWidth = Math.max(LEADER_W, workersWidth) + PADDING.left + PADDING.right;
  const totalHeight = LEADER_H + VERT_GAP + MEMBER_H + PADDING.top + PADDING.bottom;

  const newEdges: Edge[] = [];
  const positioned: Node<FlowNodeData>[] = [];

  // Leader 水平居中于 team
  const leaderX = tx + (totalWidth - LEADER_W) / 2;
  const leaderY = ty + PADDING.top;

  positioned.push({
    ...leader,
    position: { x: leaderX, y: leaderY },
  });

  // Workers 水平居中排列
  const workersStartX = tx + (totalWidth - workersWidth) / 2;
  const workersY = leaderY + LEADER_H + VERT_GAP;

  for (let i = 0; i < workers.length; i++) {
    const worker = workers[i];
    const wx = workersStartX + i * (MEMBER_W + WORKER_GAP);
    positioned.push({
      ...worker,
      position: { x: wx, y: workersY },
    });

    // Leader → Worker 边
    newEdges.push({
      id: `hier-${leader.id}-${worker.id}`,
      source: leader.id,
      target: worker.id,
      type: 'smoothstep',
      animated: (worker.data as any).status === 'thinking' || (worker.data as any).status === 'executing',
      style: { stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1.5 },
    });
  }

  return {
    nodes: positioned,
    edges: newEdges,
    teamWidth: Math.max(totalWidth, 260),
    teamHeight: totalHeight,
  };
}
