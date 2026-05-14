/**
 * useFlowLayout — 策略感知布局 hook。
 *
 * 从 useFlowNodes 获取 nodes/edges，应用布局引擎。
 */

import { useMemo } from 'react';
import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../utils/flow/FlowNodeTypes';
import { applyLayout } from '../utils/flow/layout/engine';

export function useFlowLayout(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  fixedPositions?: Map<string, { x: number; y: number }>,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  return useMemo(() => {
    if (nodes.length === 0) return { nodes: [], edges: [] };
    return applyLayout(nodes, edges, fixedPositions);
  }, [nodes, edges, fixedPositions]);
}
