/**
 * flowBuilder — 从扁平 agentMap 构建 React Flow 节点和边。
 *
 * 替代旧 activeAgentStore 中的递归树遍历（4 种递归搜索 → O(1) Map 索引）。
 * 使用 dagre 计算节点层级位置（rankdir=TB）。
 */

import dagre from 'dagre';

// ============================================================
// 常量
// ============================================================

const NODE_W = 420;
const NODE_H = 160;
const TEAM_NODE_W = 260;
const TEAM_NODE_H = 160;

// ============================================================
// 类型
// ============================================================

export interface AgentNode {
  id: string;
  name: string;
  status: string;
  parentId: string | null;
  agentType?: string;
  taskType?: 'task' | 'team';
  createdAt: number;
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    status: string;
    color: string;
    animation?: string;
    agentType?: string;
    taskType?: string;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  animated?: boolean;
}

/** React Flow 节点样式映射 */
export const STATUS_STYLE_MAP: Record<string, { color: string; animation?: string }> = {
  pending:   { color: '#94a3b8' },
  thinking:  { color: '#6366f1', animation: 'pulse' },
  executing: { color: '#f59e0b', animation: 'rotate' },
  writing:   { color: '#3b82f6', animation: 'streaming' },
  reporting: { color: '#8b5cf6' },
  success:   { color: '#22c55e' },
  failed:    { color: '#ef4444' },
  cancelled: { color: '#78716c' },
};

// ============================================================
// 构建函数
// ============================================================

/**
 * 从扁平 agentMap 构建 React Flow 节点列表（不含布局位置）。
 */
export function buildFlowNodes(
  agentMap: Record<string, AgentNode>,
  clearedIds?: Set<string>,
): FlowNode[] {
  const excluded = clearedIds ?? new Set<string>();
  const nodes: FlowNode[] = [];

  for (const [id, agent] of Object.entries(agentMap)) {
    if (excluded.has(id)) continue;
    const style = STATUS_STYLE_MAP[agent.status] ?? STATUS_STYLE_MAP.pending;
    nodes.push({
      id,
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        label: agent.name,
        status: agent.status,
        color: style.color,
        animation: style.animation,
        agentType: agent.agentType,
        taskType: agent.taskType,
      },
    });
  }

  return nodes;
}

/**
 * 从扁平 agentMap 构建 React Flow 边列表。
 */
export function buildFlowEdges(agentMap: Record<string, AgentNode>): FlowEdge[] {
  const edges: FlowEdge[] = [];

  for (const [id, agent] of Object.entries(agentMap)) {
    if (agent.parentId && agentMap[agent.parentId]) {
      edges.push({
        id: `${agent.parentId}->${id}`,
        source: agent.parentId,
        target: id,
        type: 'smoothstep',
        animated: agent.status === 'thinking' || agent.status === 'executing',
      });
    }
  }

  return edges;
}

// ============================================================
// Dagre 布局
// ============================================================

/**
 * 使用 dagre 对节点进行层级布局（rankdir=TB）。
 * team 节点使用更大的尺寸，成员节点居中对齐于父节点。
 */
export function calculateLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
  teamNodeIds?: Set<string>,
): FlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 50, marginy: 50 });

  // 设置节点尺寸
  for (const n of nodes) {
    if (teamNodeIds?.has(n.id)) {
      g.setNode(n.id, { width: TEAM_NODE_W, height: TEAM_NODE_H });
    } else {
      g.setNode(n.id, { width: NODE_W, height: NODE_H });
    }
  }

  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  // 子节点组水平居中于父节点
  centerChildGroups(g, edges);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    const isTeam = teamNodeIds?.has(n.id);
    const w = isTeam ? TEAM_NODE_W : NODE_W;
    const h = isTeam ? TEAM_NODE_H : NODE_H;
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });
}

/**
 * 一站式：从 agentMap 构建布局好的 nodes + edges。
 */
export function buildFlowLayout(
  agentMap: Record<string, AgentNode>,
  clearedIds?: Set<string>,
  teamNodeIds?: Set<string>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = buildFlowNodes(agentMap, clearedIds);
  const edges = buildFlowEdges(agentMap);
  const laidOut = calculateLayout(nodes, edges, teamNodeIds);
  return { nodes: laidOut, edges };
}

// ============================================================
// 辅助
// ============================================================

/** 子节点组水平居中于父节点 */
function centerChildGroups(g: dagre.graphlib.Graph, edges: FlowEdge[]): void {
  const parentChildMap = new Map<string, { ids: string[]; parentX: number }>();

  for (const e of edges) {
    if (!parentChildMap.has(e.source)) {
      parentChildMap.set(e.source, { ids: [], parentX: 0 });
    }
    parentChildMap.get(e.source)!.ids.push(e.target);
  }

  for (const [pid, info] of parentChildMap) {
    const pp = g.node(pid);
    if (pp) info.parentX = pp.x;
  }

  for (const [, info] of parentChildMap) {
    if (info.ids.length < 2) continue;
    const childNodes = info.ids.map((id) => g.node(id)).filter(Boolean);
    if (childNodes.length < 2) continue;
    const minX = Math.min(...childNodes.map((c) => c.x));
    const maxX = Math.max(...childNodes.map((c) => c.x));
    const groupCenter = (minX + maxX) / 2;
    const offset = info.parentX - groupCenter;
    for (const id of info.ids) {
      const cp = g.node(id);
      if (cp) cp.x += offset;
    }
  }
}

/**
 * 获取 agent 的所有后代 ID 列表（从扁平 Map O(n) 遍历）。
 */
export function getDescendantIds(
  agentMap: Record<string, AgentNode>,
  parentId: string,
): string[] {
  const result: string[] = [];
  for (const [id, agent] of Object.entries(agentMap)) {
    if (agent.parentId === parentId) {
      result.push(id);
      result.push(...getDescendantIds(agentMap, id));
    }
  }
  return result;
}
