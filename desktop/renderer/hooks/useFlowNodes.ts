/**
 * useFlowNodes — 从 AgentStateMachine.agentMap 构建 React Flow nodes/edges。
 *
 * 单一数据源：agentMap 是唯一真相源，React Flow 只做纯渲染。
 * 过滤规则：status === 'cleared' 的节点不显示。
 * UserInput 节点通过 MessageBus 事件管理生命周期。
 */

import { useMemo, useState, useEffect } from 'react';
import type { Node, Edge } from 'reactflow';
import { MarkerType } from 'reactflow';
import { useAgentStateMachine, type AgentState } from '../stores/AgentStateMachine';
import { messageBus } from '../utils/MessageBus';
import {
  classifyAgent,
  type FlowNodeData,
  type TeamStrategy,
} from '../utils/flow/FlowNodeTypes';
import { flowLogger } from '../utils/flow/flowLogger';
import { formatToolName } from '../utils/toolSummary';

// ============================================================
// UserInput 状态
// ============================================================

interface UserInputState {
  messageId: string;
  content: string;
  opacity: number;       // 1 → 0.4 → 0（移除）
}

// ============================================================
// Hook
// ============================================================

export function useFlowNodes(): {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
} {
  const agentMap = useAgentStateMachine((s) => s.agentMap);
  const foregroundAgentId = useAgentStateMachine((s) => s.foregroundAgentId);
  const [userInput, setUserInput] = useState<UserInputState | null>(null);

  // UserInput 生命周期监听
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(messageBus.on('agent:intent-route', (data: { messageId?: string; content?: string }) => {
      if (data.messageId && data.content) {
        setUserInput({
          messageId: data.messageId,
          content: data.content.length > 120 ? data.content.slice(0, 120) + '…' : data.content,
          opacity: 1,
        });
      }
    }));

    unsubs.push(messageBus.on('agent:started', () => {
      setUserInput((prev) => prev ? { ...prev, opacity: 0.4 } : null);
    }));

    unsubs.push(messageBus.on('agent:text', () => {
      setUserInput(null);
    }));

    return () => unsubs.forEach((fn) => fn());
  }, []);

  // 构建 nodes + edges
  return useMemo(() => {
    const allAgents = Object.values(agentMap);
    const clearedAgents = allAgents.filter((a) => a.status === 'cleared');
    const activeAgents = allAgents.filter((a) => a.status !== 'cleared');

    flowLogger.log('useFlowNodes',
      'total:', allAgents.length, 'active:', activeAgents.length,
      'cleared:', clearedAgents.length,
      'agents:', activeAgents.map(a => `${a.id}(${a.agentType||'-'},${a.taskType||'-'})`).join(', '));

    const nodes: Node<FlowNodeData>[] = [];
    const edges: Edge[] = [];
    const agentIdSet = new Set(activeAgents.map((a) => a.id));

    // 收集 team 信息（双向索引：id → info + name → id）
    const teamMap = new Map<string, {
      teamId: string;
      teamName: string;
      strategy: TeamStrategy;
      memberIds: string[];
      goal: string;
      currentRound?: number;
      maxRounds?: number;
    }>();
    const teamNameToId = new Map<string, string>();

    // 第一遍：分类 + 构建节点
    for (const agent of activeAgents) {
      const classified = classifyAgent(agent, foregroundAgentId);
      const nodeData = buildNodeData(agent, classified);

      flowLogger.log('useFlowNodes',
        'agent:', agent.id, 'name:', agent.name,
        'taskType:', agent.taskType, 'parentId:', agent.parentId,
        '→ classified as:', classified.nodeType, 'fgId:', foregroundAgentId);

      if (classified.nodeType === 'team') {
        // team 节点：收集信息，稍后统一创建
        teamMap.set(agent.id, {
          teamId: agent.id,
          teamName: agent.name,
          strategy: (agent.multiAgent?.strategy || 'parallel') as TeamStrategy,
          memberIds: [],
          goal: agent.multiAgent?.goal || '',
          currentRound: agent.multiAgent?.currentRound,
          maxRounds: agent.multiAgent?.maxRounds,
        });
        teamNameToId.set(agent.name, agent.id);
        // 先把 team 节点本身加入
        nodes.push({
          id: `team-${agent.id}`,
          type: 'team',
          position: { x: 0, y: 0 },
          draggable: true,
          data: nodeData as any,
        });
      } else if (classified.nodeType === 'team-member') {
        // team-member 节点：通过 teamName 或 parentId 查找所属 team
        const lookupName = classified.teamId!;
        const resolvedTeamId = teamNameToId.get(lookupName)
          || teamNameToId.get(agent.parentId || '')
          || undefined;
        const team = resolvedTeamId ? teamMap.get(resolvedTeamId) : undefined;
        if (team) {
          team.memberIds.push(agent.id);
          // 辩论模式：从成员更新 team 的轮次信息（取最新轮次）
          if (agent.multiAgent?.currentRound != null &&
              (team.currentRound == null || agent.multiAgent.currentRound > team.currentRound)) {
            team.currentRound = agent.multiAgent.currentRound;
            if (agent.multiAgent?.maxRounds != null) team.maxRounds = agent.multiAgent.maxRounds;
          }
        }
        // 修正 teamId：layout engine 用 team-${data.teamId} 匹配 team 节点 ID，
        // 但 classified.teamId 是 team name，必须替换为 team agent ID 才能匹配
        const memberData = resolvedTeamId
          ? { ...nodeData, teamId: resolvedTeamId }
          : nodeData;
        flowLogger.log('useFlowNodes',
          'team-member lookup:', lookupName,
          'parentId:', agent.parentId, '→ resolved:', resolvedTeamId || 'NOT FOUND');
        nodes.push({
          id: agent.id,
          type: 'team-member',
          position: { x: 0, y: 0 },
          parentNode: resolvedTeamId ? `team-${resolvedTeamId}` : undefined,
          draggable: false,
          extent: 'parent',
          data: memberData as any,
        });
      } else {
        // foreground / subagent 节点
        const isSubagent = classified.nodeType === 'subagent';
        nodes.push({
          id: agent.id,
          type: classified.nodeType,
          position: { x: 0, y: 0 },
          draggable: isSubagent,  // 子 agent 节点可拖拽
          data: nodeData as any,
        });
      }
    }

    // 更新 team 节点的 memberIds 和辩论轮次（从成员 multiAgent 取 currentRound）
    for (const node of nodes) {
      if (node.type === 'team') {
        const teamId = node.id.replace('team-', '');
        const team = teamMap.get(teamId);
        if (team && node.data) {
          (node.data as any).memberIds = team.memberIds;
          (node.data as any).memberCount = team.memberIds.length;
          // 同步 team 的 currentRound（优先取 teamMap 中的值）
          if (team.currentRound != null) {
            (node.data as any).currentRound = team.currentRound;
          }
          if (team.maxRounds != null) {
            (node.data as any).maxRounds = team.maxRounds;
          }
        }
      }
    }

    // 构建边
    for (const agent of activeAgents) {
      const classified = classifyAgent(agent, foregroundAgentId);

      if (classified.nodeType === 'team-member') {
        // team-member → team 的边（仅供布局，透明）
        // 使用解析后的 team agent ID 而非 team name，确保 source 存在
        const resolvedId = teamNameToId.get(classified.teamId!)
          || teamNameToId.get(agent.parentId || '')
          || undefined;
        const teamNodeId = resolvedId ? `team-${resolvedId}` : `team-${classified.teamId!}`;
        edges.push({
          id: `e-${teamNodeId}-${agent.id}`,
          source: teamNodeId,
          target: agent.id,
          type: 'smoothstep',
          animated: false,
          style: { stroke: 'transparent', strokeWidth: 0 },
        });
      } else if (classified.nodeType !== 'team') {
        // foreground / subagent → parent
        const pid = agent.parentId;
        if (pid && agentIdSet.has(pid)) {
          const isActive = ['thinking', 'executing', 'writing'].includes(agent.status);
          edges.push({
            id: `e-${pid}-${agent.id}`,
            source: pid,
            target: agent.id,
            type: 'smoothstep',
            animated: isActive,
            style: {
              stroke: isActive ? 'hsl(var(--primary)/0.35)' : 'rgba(255,255,255,0.08)',
              strokeWidth: isActive ? 2 : 1,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isActive ? 'hsl(var(--primary)/0.35)' : 'rgba(255,255,255,0.1)',
            },
          });
        } else if (!pid && classified.nodeType === 'subagent' && foregroundAgentId) {
          // 没有 parent 的后台 agent，连接到 foreground
          edges.push({
            id: `e-${foregroundAgentId}-${agent.id}`,
            source: foregroundAgentId,
            target: agent.id,
            type: 'smoothstep',
            animated: false,
            style: { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: 'rgba(255,255,255,0.1)',
            },
          });
        }
      }
    }

    // team → parent 边
    for (const [teamId] of teamMap) {
      const teamAgent = agentMap[teamId];
      if (teamAgent?.parentId && agentIdSet.has(teamAgent.parentId)) {
        edges.push({
          id: `e-${teamAgent.parentId}-team-${teamId}`,
          source: teamAgent.parentId,
          target: `team-${teamId}`,
          type: 'smoothstep',
          animated: true,
          style: { stroke: 'hsl(var(--primary)/0.35)', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'hsl(var(--primary)/0.35)',
          },
        });
      } else if (foregroundAgentId) {
        edges.push({
          id: `e-${foregroundAgentId}-team-${teamId}`,
          source: foregroundAgentId,
          target: `team-${teamId}`,
          type: 'smoothstep',
          animated: true,
          style: { stroke: 'hsl(var(--primary)/0.35)', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'hsl(var(--primary)/0.35)',
          },
        });
      }
    }

    // UserInput 节点
    if (userInput && userInput.opacity > 0) {
      const uiNode: Node<FlowNodeData> = {
        id: `ui-${userInput.messageId}`,
        type: 'user-input',
        position: { x: 0, y: 0 },
        draggable: false,
        data: {
          nodeType: 'user-input',
          messageId: userInput.messageId,
          content: userInput.content,
        },
        style: { opacity: userInput.opacity },
      };
      nodes.unshift(uiNode); // 放在最前面

      // user-input → foreground edge
      if (foregroundAgentId && agentIdSet.has(foregroundAgentId)) {
        edges.push({
          id: `e-ui-${userInput.messageId}-${foregroundAgentId}`,
          source: `ui-${userInput.messageId}`,
          target: foregroundAgentId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: 'hsl(var(--primary)/0.2)', strokeWidth: 1, strokeDasharray: '4,4' },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'hsl(var(--primary)/0.2)',
          },
        });
      }
    }

    flowLogger.log('useFlowNodes', 'result → nodes:', nodes.length, 'edges:', edges.length,
      'nodeTypes:', nodes.map(n => `${n.id}(${n.type})`).join(', '));

    return { nodes, edges };
  }, [agentMap, foregroundAgentId, userInput]);
}

// ============================================================
// 节点数据构建
// ============================================================

function buildNodeData(
  agent: AgentState,
  classified: ReturnType<typeof classifyAgent>,
): FlowNodeData {
  const base = {
    agentId: agent.id,
    name: agent.name,
    status: agent.status,
    statusSince: agent.createdAt,
    parentId: agent.parentId,
  };

  const momentData = agent.moment ? {
    icon: agent.moment.icon || '',
    label: agent.moment.label,
    durationMs: agent.moment.duration,
    status: agent.moment.status,
    startTime: agent.moment.startTime,
  } : undefined;

  const timelineData = agent.currentTools.length > 0 ? agent.currentTools
    .slice(-4).map((t) => ({
    id: t.id,
    icon: '',
    label: formatToolName(t.name),
    duration: t.endTime ? t.endTime - t.startTime : undefined,
    status: t.status as 'running' | 'success' | 'error',
    startTime: t.startTime,
  })) : undefined;

  switch (classified.nodeType) {
    case 'foreground':
      return {
        ...base,
        nodeType: 'foreground',
        scene: agent.scene,
        agentType: agent.agentType,
        executionMode: agent.executionMode,
        model: undefined,
        iterationCount: 0,
        thinkingText: agent.currentThought,
        currentTask: agent.currentTask,
        currentMoment: momentData,
        timelineEvents: timelineData,
      };

    case 'subagent':
      return {
        ...base,
        nodeType: 'subagent',
        scene: agent.scene,
        taskDescription: agent.currentTask || '',
        executionMode: agent.executionMode || 'in-process',
        agentType: agent.agentType,
        thinkingText: agent.currentThought,
        currentTask: agent.currentTask,
        currentMoment: momentData,
        timelineEvents: timelineData,
      };

    case 'team':
      return {
        ...base,
        nodeType: 'team',
        teamName: agent.name,
        strategy: (agent.multiAgent?.strategy || 'parallel') as TeamStrategy,
        memberCount: 0, // 后续更新
        goal: agent.multiAgent?.goal || '',
        currentRound: agent.multiAgent?.currentRound,
        maxRounds: agent.multiAgent?.maxRounds,
        memberIds: [],
      };

    case 'team-member':
      return {
        ...base,
        nodeType: 'team-member',
        teamId: classified.teamId!,
        memberRole: agent.multiAgent?.debateRole || 'worker',
        scene: agent.scene,
        agentType: agent.agentType,
        executionMode: agent.executionMode,
        debateRole: agent.multiAgent?.debateRole as any,
        stepIndex: agent.multiAgent?.stepIndex,
        taskDescription: agent.currentTask || '',
        thinkingText: agent.currentThought,
        currentTask: agent.currentTask,
        currentMoment: momentData,
        timelineEvents: timelineData,
      };

    default:
      throw new Error(`Unknown nodeType: ${classified.nodeType}`);
  }
}
