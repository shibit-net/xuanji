// ============================================================
// ExecutionFlow - 执行流程图组件
// ============================================================
// 职责：
// - 以图形化方式展示 agent 之间的执行流程
// - 实时更新 agent 的状态和执行进度
// - 支持点击 agent 节点查看详情
// ============================================================

import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  ConnectionLineType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useActiveAgentStore } from '../stores/activeAgentStore';

// 定义节点类型
interface AgentNode extends Node {
  data: {
    label: string;
    type: string;
    status: 'idle' | 'thinking' | 'executing' | 'completed' | 'error';
    progress: number;
  };
}

const ExecutionFlow: React.FC = () => {
  const { mainAgent } = useActiveAgentStore();

  // 使用 React Flow 的状态管理
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // 从 activeAgentStore 生成节点和边
  const { generatedNodes, generatedEdges } = useMemo(() => {
    const nodes: AgentNode[] = [];
    const edges: Edge[] = [];
    const positionMap = new Map<string, { x: number; y: number }>();

    // 递归处理 agent 树
    const processAgent = (agent: any, parentId: string | null, level: number, index: number) => {
      const x = level * 200;
      const y = 100 + index * 120;

      positionMap.set(agent.id, { x, y });

      // 创建节点
      nodes.push({
        id: agent.id,
        type: 'default',
        position: { x, y },
        data: {
          label: agent.name,
          type: parentId === null ? 'main' : 'sub',
          status: agent.status === 'done' ? 'completed' : agent.status === 'error' ? 'error' : agent.status,
          progress: agent.status === 'completed' ? 100 : agent.status === 'executing' ? 60 : agent.status === 'thinking' ? 30 : 0,
        },
      });

      // 创建边
      if (parentId) {
        edges.push({
          id: `e${parentId}-${agent.id}`,
          source: parentId,
          target: agent.id,
          label: '任务',
          animated: true,
        });
      }

      // 处理子 agent
      agent.subAgents.forEach((subAgent: any, subIndex: number) => {
        processAgent(subAgent, agent.id, level + 1, subIndex);
      });
    };

    // 处理主 agent
    if (mainAgent) {
      processAgent(mainAgent, null, 0, 0);
    }

    // 如果没有 agent，使用默认数据
    if (nodes.length === 0) {
      const defaultNode: AgentNode = {
        id: '1',
        type: 'default',
        position: { x: 100, y: 100 },
        data: {
          label: '主 Agent',
          type: 'main',
          status: 'idle',
          progress: 0,
        },
      };
      return {
        generatedNodes: [defaultNode],
        generatedEdges: [],
      };
    }

    return { generatedNodes: nodes, generatedEdges: edges };
  }, [mainAgent]);

  // 当 agent 状态变化时更新节点和边
  useEffect(() => {
    setNodes(generatedNodes as any);
    setEdges(generatedEdges);
  }, [generatedNodes, generatedEdges, setNodes, setEdges]);

  // 处理节点点击
  const onNodeClick = useCallback((_event: React.MouseEvent, node: AgentNode) => {
    // 这里可以添加查看节点详情的逻辑
  }, []);

  return (
    <div className="w-full h-full min-h-[200px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        connectionLineType={ConnectionLineType.Bezier}
        defaultViewport={{ x: 0, y: 0, zoom: 1.2 }}
        minZoom={0.5}
        maxZoom={2}
        fitView
        attributionPosition="bottom-right"
      >
        <Background gap={16} color="#f8fafc" />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
};

export default ExecutionFlow;
