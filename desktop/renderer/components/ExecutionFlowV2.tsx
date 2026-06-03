/**
 * ExecutionFlowV2 — 重构后的执行流程图组件。
 *
 * 相比 V1 的改进：
 * - 5 种节点类型（foreground/subagent/team/team-member/user-input）
 * - LR 布局方向，策略感知团队内部布局
 * - 统一数据流：useFlowNodes + useFlowLayout
 * - 节点可拖拽，拖拽后位置保持，新节点自动避让
 * - 终态节点保留灰显，cleared 节点自动移除
 */

import { useCallback, useEffect, useMemo, useRef, memo } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState, ConnectionLineType,
  ReactFlowProvider, useReactFlow,
  type NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useFlowNodes } from '../hooks/useFlowNodes';
import { useFlowLayout } from '../hooks/useFlowLayout';
import {
  ForegroundNode, SubagentNode, TeamNode, TeamMemberNode, UserInputNode,
} from './flow';
import { isActiveStatus } from '../utils/flow/FlowNodeTypes';
import { flowLogger } from '../utils/flow/flowLogger';
import { t } from '@/core/i18n';

// ============================================================
// 节点类型注册
// ============================================================

const nodeTypes = {
  foreground: ForegroundNode,
  subagent: SubagentNode,
  team: TeamNode,
  'team-member': TeamMemberNode,
  'user-input': UserInputNode,
};

// ============================================================
// Flow 组件
// ============================================================

function Flow() {
  const { fitView } = useReactFlow();
  const initialized = useRef(false);
  const prevNodeCount = useRef(0);

  // 用户手动拖拽过的节点 ID 集合
  const draggedNodeIds = useRef<Set<string>>(new Set());

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // 拦截 onNodesChange，记录用户拖拽
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.dragging) {
        draggedNodeIds.current.add(change.id);
      }
    }
    onNodesChange(changes);
  }, [onNodesChange]);

  // 清理已移除节点的拖拽记录
  const currentNodesRef = useRef(nodes);
  currentNodesRef.current = nodes;

  // 构建固定位置映射（仅用户拖拽过的节点）
  const fixedPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of currentNodesRef.current) {
      if (draggedNodeIds.current.has(n.id)) {
        map.set(n.id, { x: n.position.x, y: n.position.y });
      }
    }
    return map;
  }, [nodes]);

  // 清理不再存在的节点
  useEffect(() => {
    const currentIds = new Set(nodes.map((n) => n.id));
    for (const id of draggedNodeIds.current) {
      if (!currentIds.has(id)) {
        draggedNodeIds.current.delete(id);
      }
    }
  }, [nodes]);

  // 新数据流：useFlowNodes → useFlowLayout
  const { nodes: rawNodes, edges: rawEdges } = useFlowNodes();
  const { nodes: layoutedNodes, edges: layoutedEdges } = useFlowLayout(rawNodes, rawEdges, fixedPositions);

  // 同步布局结果到 React Flow state
  const prevNodesRef = useRef<string>('');

  useEffect(() => {
    const nodeCount = layoutedNodes.length;
    const key = layoutedNodes.map((n) => {
      const d = n.data as any;
      const momentKey = d?.currentMoment
        ? `${d.currentMoment.status}:${d.currentMoment.label}:${d.currentMoment.startTime ?? ''}:${d.currentMoment.durationMs ?? ''}`
        : '';
      const timelineKey = d?.timelineEvents?.length
        ? d.timelineEvents.map((t: any) => `${t.id}:${t.status}:${t.duration ?? ''}`).join(',')
        : '';
      return `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)}:${n.type}:${d?.status}:m=${momentKey}:t=${timelineKey}`;
    }).join('|');

    if (key === prevNodesRef.current) return;
    prevNodesRef.current = key;

    flowLogger.log('ExecutionFlowV2', 'syncing nodes:',
      layoutedNodes.map(n => ({
        id: n.id, type: n.type, pos: n.position, status: (n.data as any)?.status,
      })));

    // 合并布局结果：拖拽过的节点保持用户设置的位置
    const mergedNodes = layoutedNodes.map((ln) => {
      if (draggedNodeIds.current.has(ln.id)) {
        const current = currentNodesRef.current.find((n) => n.id === ln.id);
        if (current) {
          return { ...ln, position: current.position };
        }
      }
      return ln;
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setNodes(mergedNodes as any);
        setEdges(layoutedEdges as any);
      });
    });

    if (!initialized.current && layoutedNodes.length > 0) {
      initialized.current = true;
      prevNodeCount.current = nodeCount;
    } else if (initialized.current && nodeCount !== prevNodeCount.current && nodeCount > 0) {
      prevNodeCount.current = nodeCount;
    }
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges, fitView]);

  // 空状态：只要 agentMap 中有非 cleared 的 agent 就显示
  const hasAgents = useAgentStateMachine((s) =>
    Object.values(s.agentMap).some((a) => a.status !== 'cleared')
  );

  if (!hasAgents) {
    return (
      <div className="w-full h-full bg-background flex items-center justify-center relative">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[300px] h-[300px] rounded-full bg-primary/2 blur-[80px]" />
        </div>
        <div className="flex flex-col items-center gap-4 text-center relative z-10">
          <div className="w-14 h-14 rounded-2xl bg-card backdrop-blur-xl flex items-center justify-center shadow-glass-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary/60">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground/60">{t('executionflow.exec_monitor')}</p>
            <p className="text-xs text-muted-foreground/40 max-w-[180px]">{t('executionflow.exec_desc')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
        minZoom={0.1}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable={true}
      >
        <Background gap={24} size={1} color="rgba(255,255,255,0.03)" />
        <Controls
          className="!bg-card !border-border !rounded-xl !shadow-glass-sm"
          showInteractive={false}
        />
        <MiniMap
          className="!bg-card !border-border !rounded-xl !shadow-glass-sm !overflow-hidden"
          nodeColor={(n) => {
            if (n.type === 'team') return 'rgba(255,255,255,0.08)';
            const d = n.data as any;
            if (!d) return 'rgba(255,255,255,0.1)';
            const status = d.status;
            if (isActiveStatus(status)) return '#6366f1';
            if (status === 'success') return '#22c55e';
            if (status === 'failed') return '#ef4444';
            return 'rgba(255,255,255,0.15)';
          }}
          maskColor="rgba(0,0,0,0.6)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

// ============================================================
// 导出
// ============================================================

function ExecutionFlowV2Wrapper() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}

export default memo(ExecutionFlowV2Wrapper);
