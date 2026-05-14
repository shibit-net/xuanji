/**
 * Layout Engine — 全局布局编排器。
 *
 * 策略：
 * 1. UserInput 顶部居中，Foreground 下方居中
 * 2. Foreground 的直接子节点（team + subagent）水平展开排列
 *    - 单个子节点：正下方居中
 *    - 多个子节点：左右两侧均匀分布
 * 3. 每个 team 内部执行策略感知子布局
 * 4. 调整 team 框尺寸 + 下游节点偏移
 */

import dagre from 'dagre';
import type { Node, Edge } from 'reactflow';
import type { FlowNodeData, TeamStrategy } from '../FlowNodeTypes';
import { layoutSequential } from './sequential';
import { layoutParallel } from './parallel';
import { layoutHierarchical } from './hierarchical';
import { layoutDebate } from './debate';
import { layoutPipeline } from './pipeline';

const FOREGROUND_W = 100;
const FOREGROUND_H = 130;
const SUBAGENT_W = 140;
const SUBAGENT_H = 110;
const TEAM_DEFAULT_W = 260;
const TEAM_DEFAULT_H = 160;
const USER_INPUT_W = 200;
const USER_INPUT_H = 60;

const VERT_GAP = 100;
const HORIZ_GAP = 80;

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
  fixedPositions?: Map<string, { x: number; y: number }>,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  if (inputNodes.length === 0) return { nodes: [], edges: [] };

  // 1. 分类节点
  const userInput = inputNodes.find((n) => n.type === 'user-input');
  const foreground = inputNodes.find((n) => n.type === 'foreground');
  const teamNodes = inputNodes.filter((n) => n.type === 'team');
  const teamMemberNodes = inputNodes.filter((n) => n.type === 'team-member');
  const subagentNodes = inputNodes.filter((n) => n.type === 'subagent');

  const fixed = fixedPositions || new Map();

  // 构建 parent → children 边关系（仅非 team-member 边）
  const childEdges = inputEdges.filter(
    (e) => !e.id.startsWith('e-team-') || e.style?.stroke !== 'transparent',
  );
  const childrenOf = new Map<string, string[]>();
  for (const e of childEdges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
  }

  // teamId → members 映射
  const teamMemberMap = new Map<string, Node<FlowNodeData>[]>();
  for (const tm of teamMemberNodes) {
    const data = tm.data as any;
    const teamId = `team-${data.teamId}`;
    if (!teamMemberMap.has(teamId)) teamMemberMap.set(teamId, []);
    teamMemberMap.get(teamId)!.push(tm);
  }

  const positioned = new Map<string, { x: number; y: number }>();

  // 收集固定节点边界框，用于新节点避让
  const fixedBounds: { x: number; y: number; w: number; h: number }[] = [];
  for (const [id, pos] of fixed) {
    const n = inputNodes.find((n) => n.id === id);
    if (n) {
      fixedBounds.push({
        x: pos.x,
        y: pos.y,
        w: getNodeWidth(n.type as string),
        h: getNodeHeight(n.type as string),
      });
    }
  }

  // 2. 计算全局画布中心 X
  const allNonMember = [...(userInput ? [userInput] : []), ...(foreground ? [foreground] : []), ...teamNodes, ...subagentNodes];
  const maxWidth = Math.max(
    ...allNonMember.map((n) => getNodeWidth(n.type as string)),
    USER_INPUT_W,
  );
  const canvasCenterX = 400; // 固定参考点，后续可根据内容扩展

  // 2a. UserInput 顶部居中
  let currentY = 0;
  if (userInput) {
    if (fixed.has(userInput.id)) {
      positioned.set(userInput.id, fixed.get(userInput.id)!);
    } else {
      positioned.set(userInput.id, {
        x: canvasCenterX - USER_INPUT_W / 2,
        y: currentY,
      });
    }
    currentY = Math.max(currentY, (positioned.get(userInput.id)?.y || 0) + USER_INPUT_H + VERT_GAP);
  }

  // 2b. Foreground 居中
  if (foreground) {
    if (fixed.has(foreground.id)) {
      positioned.set(foreground.id, fixed.get(foreground.id)!);
    } else {
      positioned.set(foreground.id, {
        x: canvasCenterX - FOREGROUND_W / 2,
        y: currentY,
      });
    }
    currentY = Math.max(currentY, (positioned.get(foreground.id)?.y || 0) + FOREGROUND_H + VERT_GAP);
  }

  // 2c. Foreground 的直接子节点水平展开，居中对齐在前台下方
  const fgId = foreground?.id || '';
  const fgPos = foreground ? (positioned.get(foreground.id) || fixed.get(foreground.id)) : null;
  const fgCenterX = fgPos ? fgPos.x + FOREGROUND_W / 2 : canvasCenterX;
  const fgChildren = (fgId ? childrenOf.get(fgId) : []) || [];
  const directTeams = teamNodes.filter((t) => fgChildren.includes(t.id));
  const directSubagents = subagentNodes.filter((s) => fgChildren.includes(s.id));
  const directChildren = [...directTeams, ...directSubagents];

  if (directChildren.length > 0) {
    const childWidths = directChildren.map((c) => getNodeWidth(c.type as string));
    const totalChildWidth = childWidths.reduce((a, b) => a + b, 0) + (directChildren.length - 1) * HORIZ_GAP;

    // 以前台 agent 中心为基准居中展开
    let childX = fgCenterX - totalChildWidth / 2;

    for (let i = 0; i < directChildren.length; i++) {
      const c = directChildren[i];
      const cw = childWidths[i];

      if (fixed.has(c.id)) {
        positioned.set(c.id, fixed.get(c.id)!);
      } else {
        let x = childX;
        const y = currentY;
        const ch = getNodeHeight(c.type as string);

        // 避让所有已定位节点（固定 + 已放置的同级节点）
        x = avoidOverlap(x, y, cw, ch, fixedBounds, positioned, inputNodes);

        positioned.set(c.id, { x, y });
      }
      childX += cw + HORIZ_GAP;
    }
    currentY += Math.max(...directChildren.map((c) => getNodeHeight(c.type as string))) + VERT_GAP;
  }

  // 2d. 非前景直接子节点的 subagent（如有 parent 已在上方覆盖，dagre 处理剩余）
  const remainingNodes = subagentNodes.filter((s) => !fgChildren.includes(s.id) && !fixed.has(s.id));
  const remainingTeamNodes = teamNodes.filter((t) => !fgChildren.includes(t.id) && !fixed.has(t.id));

  // 固定位置的剩余节点直接放入 positioned
  for (const s of subagentNodes.filter((s) => !fgChildren.includes(s.id) && fixed.has(s.id))) {
    positioned.set(s.id, fixed.get(s.id)!);
  }
  for (const t of teamNodes.filter((t) => !fgChildren.includes(t.id) && fixed.has(t.id))) {
    positioned.set(t.id, fixed.get(t.id)!);
  }

  if (remainingNodes.length > 0 || remainingTeamNodes.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: HORIZ_GAP, ranksep: VERT_GAP, marginx: 60, marginy: 60 });

    for (const n of remainingNodes) {
      g.setNode(n.id, { width: SUBAGENT_W, height: SUBAGENT_H });
    }
    for (const tn of remainingTeamNodes) {
      g.setNode(tn.id, { width: TEAM_DEFAULT_W, height: TEAM_DEFAULT_H });
    }

    for (const e of childEdges) {
      const src = e.source;
      const tgt = e.target;
      if (g.node(src) && g.node(tgt)) {
        g.setEdge(src, tgt);
      }
      // 如果 source 已在 positioned 中，作为虚拟连接点
      if (positioned.has(src) && g.node(tgt)) {
        g.setNode(src, { width: 10, height: 10 });
        g.setEdge(src, tgt);
      }
    }

    // 为已定位的 source 设置固定位置
    for (const [id, pos] of positioned) {
      if (!g.node(id)) continue;
      // dagre 不允许固定位置，用边权重间接影响
    }

    dagre.layout(g);

    for (const n of remainingNodes) {
      const pos = g.node(n.id);
      if (pos) {
        positioned.set(n.id, { x: pos.x - SUBAGENT_W / 2, y: pos.y - SUBAGENT_H / 2 });
      }
    }
    for (const tn of remainingTeamNodes) {
      const pos = g.node(tn.id);
      if (pos) {
        positioned.set(tn.id, { x: pos.x - TEAM_DEFAULT_W / 2, y: pos.y - TEAM_DEFAULT_H / 2 });
      }
    }
  }

  // 3. Team 内部子布局
  const allNodes: Node<FlowNodeData>[] = [];
  const allEdges: Edge[] = [...inputEdges];
  const teamDimensionChanges: Map<string, { oldW: number; oldH: number; newW: number; newH: number }> = new Map();

  for (const tn of teamNodes) {
    const pos = positioned.get(tn.id) || fixed.get(tn.id) || { x: 0, y: 0 };
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
      width: result.teamWidth,
      height: result.teamHeight,
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
  if (userInput) allNodes.push({ ...userInput, position: positioned.get(userInput.id) || { x: 0, y: 0 } });
  if (foreground) allNodes.push({ ...foreground, position: positioned.get(foreground.id) || { x: 0, y: 0 } });
  for (const n of subagentNodes) {
    allNodes.push({ ...n, position: positioned.get(n.id) || { x: 0, y: 0 } });
  }

  // 4. 偏移：team 框变高时，下方的节点下移
  for (const [teamId, diff] of teamDimensionChanges) {
    const heightDelta = diff.newH - diff.oldH;
    if (heightDelta <= 0) continue;

    const teamPos = positioned.get(teamId);
    if (!teamPos) continue;

    const teamBottom = teamPos.y + diff.oldH;

    for (let i = 0; i < allNodes.length; i++) {
      const n = allNodes[i];
      if (n.id.startsWith('team-')) continue;
      if (n.type === 'team-member' && (n.data as any).teamId === teamId.replace('team-', '')) continue;

      const nPos = positioned.get(n.id);
      if (nPos && nPos.y >= teamBottom) {
        allNodes[i] = {
          ...n,
          position: { x: n.position.x, y: n.position.y + heightDelta },
        };
      }
    }
  }

  return { nodes: allNodes, edges: allEdges };
}

function getNodeWidth(type: string): number {
  switch (type) {
    case 'foreground': return FOREGROUND_W;
    case 'subagent': return SUBAGENT_W;
    case 'team': return TEAM_DEFAULT_W;
    case 'user-input': return USER_INPUT_W;
    default: return SUBAGENT_W;
  }
}

function getNodeHeight(type: string): number {
  switch (type) {
    case 'foreground': return FOREGROUND_H;
    case 'subagent': return SUBAGENT_H;
    case 'team': return TEAM_DEFAULT_H;
    case 'user-input': return USER_INPUT_H;
    default: return SUBAGENT_H;
  }
}

/** 避让所有已定位节点，向右偏移直到不重叠 */
function avoidOverlap(
  desiredX: number,
  y: number,
  nodeW: number,
  nodeH: number,
  fixedBounds: { x: number; y: number; w: number; h: number }[],
  positioned: Map<string, { x: number; y: number }>,
  allNodes: Node<FlowNodeData>[],
): number {
  // 收集所有已定位节点的边界（固定节点 + 已放置的节点）
  const occupied: { x: number; y: number; w: number; h: number }[] = [...fixedBounds];
  for (const [id, pos] of positioned) {
    const n = allNodes.find((n) => n.id === id);
    if (n) {
      occupied.push({ x: pos.x, y: pos.y, w: getNodeWidth(n.type as string), h: getNodeHeight(n.type as string) });
    }
  }

  let x = desiredX;
  const maxIter = 20;
  for (let iter = 0; iter < maxIter; iter++) {
    let overlapped = false;
    for (const ob of occupied) {
      if (
        x < ob.x + ob.w + HORIZ_GAP &&
        x + nodeW + HORIZ_GAP > ob.x &&
        y < ob.y + ob.h + VERT_GAP &&
        y + nodeH + VERT_GAP > ob.y
      ) {
        x = ob.x + ob.w + HORIZ_GAP;
        overlapped = true;
        break;
      }
    }
    if (!overlapped) break;
  }
  return x;
}
