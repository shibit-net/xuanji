/**
 * Layout Engine — 全局布局编排器。
 *
 * 策略：
 * 1. Dagre LR 布局非 team 节点 + team 占位框
 * 2. 每个 team 内部执行策略感知子布局
 * 3. 调整 team 框尺寸 + 下游节点偏移
 */

import dagre from 'dagre';
import type { Node, Edge } from 'reactflow';
import type { FlowNodeData, TeamStrategy } from '../FlowNodeTypes';
import { layoutSequential } from './sequential';
import { layoutParallel } from './parallel';
import { layoutHierarchical } from './hierarchical';
import { layoutDebate } from './debate';
import { layoutPipeline } from './pipeline';

const FOREGROUND_W = 180;
const FOREGROUND_H = 200;
const SUBAGENT_W = 140;
const SUBAGENT_H = 160;
const TEAM_DEFAULT_W = 260;
const TEAM_DEFAULT_H = 160;
const USER_INPUT_W = 200;
const USER_INPUT_H = 60;

const STRATEGY_LAYOUTS: Record<string, typeof layoutSequential> = {
  sequential: layoutSequential,
  parallel: layoutParallel,
  hierarchical: layoutHierarchical,
  debate: layoutDebate,
  pipeline: layoutPipeline,
};

export function applyLayout(
  inputNodes: Node<FlowNodeData>[],
  inputEdges: Edge[],
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  if (inputNodes.length === 0) return { nodes: [], edges: [] };

  // 1. 分类节点
  const teamNodes = inputNodes.filter((n) => n.type === 'team');
  const teamMemberNodes = inputNodes.filter((n) => n.type === 'team-member');
  const otherNodes = inputNodes.filter(
    (n) => n.type !== 'team' && n.type !== 'team-member',
  );

  // 组建 teamId → members 映射
  const teamMemberMap = new Map<string, Node<FlowNodeData>[]>();
  for (const tm of teamMemberNodes) {
    const data = tm.data as any;
    const teamId = `team-${data.teamId}`;
    if (!teamMemberMap.has(teamId)) teamMemberMap.set(teamId, []);
    teamMemberMap.get(teamId)!.push(tm);
  }

  // 2. Dagre LR 全局布局（非 team 节点 + team 占位框）
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 120, marginx: 60, marginy: 60 });

  for (const n of otherNodes) {
    const dims = getNodeDimensions(n.type as string);
    g.setNode(n.id, { width: dims.w, height: dims.h });
  }
  for (const tn of teamNodes) {
    g.setNode(tn.id, { width: TEAM_DEFAULT_W, height: TEAM_DEFAULT_H });
  }

  // 只添加非 team-member 的边给 Dagre
  const dagreEdges = inputEdges.filter(
    (e) => !e.id.startsWith('e-team-') || e.style?.stroke !== 'transparent',
  );
  for (const e of dagreEdges) {
    if (g.node(e.source) && g.node(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  // 应用 Dagre 位置到非 team 节点
  const positioned = new Map<string, { x: number; y: number }>();
  for (const n of otherNodes) {
    const pos = g.node(n.id);
    if (pos) {
      const dims = getNodeDimensions(n.type as string);
      positioned.set(n.id, { x: pos.x - dims.w / 2, y: pos.y - dims.h / 2 });
    }
  }
  for (const tn of teamNodes) {
    const pos = g.node(tn.id);
    if (pos) {
      positioned.set(tn.id, { x: pos.x - TEAM_DEFAULT_W / 2, y: pos.y - TEAM_DEFAULT_H / 2 });
    }
  }

  // 3. Team 内部子布局
  const allNodes: Node<FlowNodeData>[] = [];
  const allEdges: Edge[] = [...inputEdges];
  const teamDimensionChanges: Map<string, { oldW: number; oldH: number; newW: number; newH: number }> = new Map();

  for (const tn of teamNodes) {
    const pos = positioned.get(tn.id) || { x: 0, y: 0 };
    const members = teamMemberMap.get(tn.id) || [];
    const strategy = (tn.data as any).strategy as TeamStrategy;
    const layoutFn = STRATEGY_LAYOUTS[strategy] || layoutParallel;

    const result = layoutFn(
      { ...tn, position: pos },
      members,
    );

    allNodes.push({
      ...tn,
      position: pos,
      style: { width: result.teamWidth, height: result.teamHeight },
    });
    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);

    teamDimensionChanges.set(tn.id, {
      oldW: TEAM_DEFAULT_W,
      oldH: TEAM_DEFAULT_H,
      newW: result.teamWidth,
      newH: result.teamHeight,
    });
  }

  // 非 team 节点直接放置
  for (const n of otherNodes) {
    const pos = positioned.get(n.id) || { x: 0, y: 0 };
    allNodes.push({ ...n, position: pos });
  }

  // 4. 偏移：如果 team 框变宽了，右侧下游节点需要右移
  // 简单处理：对每个 team 尺寸变化，找 dagre 中在该 team 右侧的节点
  for (const [teamId, diff] of teamDimensionChanges) {
    const widthDelta = diff.newW - diff.oldW;
    if (widthDelta <= 0) continue;

    const teamPos = positioned.get(teamId);
    if (!teamPos) continue;

    const teamRight = teamPos.x + diff.oldW;

    // 偏移在 team 右侧的节点
    for (let i = 0; i < allNodes.length; i++) {
      const n = allNodes[i];
      if (n.id.startsWith('team-')) continue;
      if (n.type === 'team-member' && (n.data as any).teamId === teamId.replace('team-', '')) continue;

      const nPos = positioned.get(n.id);
      if (nPos && nPos.x + getNodeDimensions(n.type as string).w / 2 > teamRight) {
        allNodes[i] = {
          ...n,
          position: { x: n.position.x + widthDelta, y: n.position.y },
        };
      }
    }
  }

  return { nodes: allNodes, edges: allEdges };
}

function getNodeDimensions(type: string): { w: number; h: number } {
  switch (type) {
    case 'foreground': return { w: FOREGROUND_W, h: FOREGROUND_H };
    case 'subagent': return { w: SUBAGENT_W, h: SUBAGENT_H };
    case 'team-member': return { w: 120, h: 140 };
    case 'user-input': return { w: USER_INPUT_W, h: USER_INPUT_H };
    default: return { w: SUBAGENT_W, h: SUBAGENT_H };
  }
}
