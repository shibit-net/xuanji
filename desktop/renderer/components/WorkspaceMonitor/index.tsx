// ============================================================
// Workspace Monitor - 主组件
// ============================================================

import React, { useRef, useEffect, useState } from 'react';
import { CanvasRenderer } from './CanvasRenderer';
import type { WorkspaceState, SubAgentData } from './types';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { useActiveAgentStore, type AgentState } from '../../stores/activeAgentStore';
import { MainFlowVisualization } from './MainFlowVisualization';
import { workspaceStore } from '../../stores/workspaceStore';

// Agent 角色图标映射
const ROLE_ICON_MAP: Record<string, string> = {
  xuanji: '🤖',
  main: '🤖',
  coder: '🔨',
  explore: '🔍',
  plan: '📐',
  'test-writer': '🧪',
  'doc-writer': '📝',
  'memory-extractor': '🧠',
  'general-purpose': '🎯',
  'context-compressor': '🗜️',
  'intent-analyzer': '🎯',
  delegate: '📦',
  pipeline: '🔗',
  tool: '🛠️',
  agent: '🤖',
  team: '👥',
};

// Agent 角色名称映射（友好显示）
const ROLE_NAME_MAP: Record<string, string> = {
  'general-purpose': 'General Purpose',
  coder: 'Coder',
  explore: 'Explorer',
  plan: 'Planner',
  'test-writer': 'Test Writer',
  'doc-writer': 'Doc Writer',
  'memory-extractor': 'Memory Extractor',
  'context-compressor': 'Context Compressor',
  'intent-analyzer': 'Intent Analyzer',
};

function getRoleIcon(name: string, type?: string): string {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(ROLE_ICON_MAP)) {
    if (lower.includes(key)) return icon;
  }
  if (type) return ROLE_ICON_MAP[type] || '🤖';
  return '🤖';
}

function getFriendlyName(name: string): string {
  const lower = name.toLowerCase();
  // 精确匹配
  if (ROLE_NAME_MAP[lower]) return ROLE_NAME_MAP[lower];
  // 模糊匹配
  for (const [key, friendlyName] of Object.entries(ROLE_NAME_MAP)) {
    if (lower.includes(key)) return friendlyName;
  }
  // 默认：首字母大写
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// 递归计算所有 agent 的总 token 使用量
function calculateTotalTokens(agent: AgentState | null): { input: number; output: number; cached: number } {
  if (!agent) return { input: 0, output: 0, cached: 0 };

  let total = {
    input: agent.stats.tokenUsage.input,
    output: agent.stats.tokenUsage.output,
    cached: agent.stats.tokenUsage.cached,
  };

  for (const subAgent of agent.subAgents) {
    const subTotal = calculateTotalTokens(subAgent);
    total.input += subTotal.input;
    total.output += subTotal.output;
    total.cached += subTotal.cached;
  }

  return total;
}

// 递归计算所有 agent 的总工具调用次数（作为迭代次数的近似）
function calculateTotalIterations(agent: AgentState | null): number {
  if (!agent) return 0;

  let total = agent.stats.toolCount;

  for (const subAgent of agent.subAgents) {
    total += calculateTotalIterations(subAgent);
  }

  return total;
}

export default function WorkspaceMonitor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const [isReady, setIsReady] = useState(false);

  // 从 workspaceStore 获取意图分析结果
  const [intentAnalysis, setIntentAnalysis] = useState<any>(null);
  const [promptBuild, setPromptBuild] = useState<any>(null);

  // 从 runtimeStore 获取数据
  const agentStatus = useRuntimeStore((state) => state.agentStatus);
  const isProcessing = useRuntimeStore((state) => state.isProcessing);
  const currentCallTokens = useRuntimeStore((state) => state.currentCallTokens);
  const agentActivity = useRuntimeStore((state) => state.agentActivity);
  const contextInfo = useRuntimeStore((state) => state.contextInfo);

  // 从 activeAgentStore 获取 agent 层级数据
  const activeMainAgent = useActiveAgentStore((state) => state.mainAgent);

  // 计算所有 agent 的总 token 和迭代次数
  const totalTokens = calculateTotalTokens(activeMainAgent);
  const totalIterations = calculateTotalIterations(activeMainAgent);

  // 监听 workspaceStore 的变化
  useEffect(() => {
    const unsubscribe = workspaceStore.subscribe(() => {
      setIntentAnalysis(workspaceStore.getIntentAnalysisResult());
      setPromptBuild(workspaceStore.getPromptBuildResult());
    });

    // 初始加载
    setIntentAnalysis(workspaceStore.getIntentAnalysisResult());
    setPromptBuild(workspaceStore.getPromptBuildResult());

    return unsubscribe;
  }, []);

  // 初始化渲染器
  useEffect(() => {
    if (!canvasRef.current) return;

    const renderer = new CanvasRenderer(canvasRef.current);
    rendererRef.current = renderer;
    renderer.start();
    setIsReady(true);

    const handleResize = () => { renderer.resize(); };
    window.addEventListener('resize', handleResize);

    return () => {
      renderer.destroy();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // 构建 WorkspaceState
  useEffect(() => {
    if (!rendererRef.current || !isReady) return;

    console.log('[WorkspaceMonitor] useEffect 触发');
    console.log('[WorkspaceMonitor] activeMainAgent:', activeMainAgent);
    console.log('[WorkspaceMonitor] activeMainAgent?.subAgents:', activeMainAgent?.subAgents);
    console.log('[WorkspaceMonitor] activeMainAgent?.subAgents.length:', activeMainAgent?.subAgents?.length);

    // 构建主 Agent 数据
    const mainId = 'main';

    console.log('[WorkspaceMonitor] agentActivity.currentMoments:', agentActivity.currentMoments);
    console.log('[WorkspaceMonitor] agentActivity.currentMoments[mainId]:', agentActivity.currentMoments[mainId]);

    const mainAgent = {
      id: mainId,
      name: agentStatus?.name || 'Xuanji',
      status: agentStatus?.status || 'idle',
      roleIcon: getRoleIcon(agentStatus?.name || 'xuanji'),
      currentThought: activeMainAgent?.currentThought || agentStatus?.currentThought,
      currentTool: agentStatus?.currentTool?.name,
      currentMoment: agentActivity.currentMoments[mainId],
      momentHistory: agentActivity.momentHistories[mainId] || [],
      timelineEvents: agentActivity.timelineEvents[mainId] || [],
    };

    console.log('[WorkspaceMonitor] mainAgent.currentMoment:', mainAgent.currentMoment);

    // 构建子 Agent 数据（从 activeAgentStore 读取）
    // 递归展平，保留真实父子关系
    // 判断 agent 或其子 agent 是否仍在活跃
    const isActiveOrHasActiveChild = (agent: AgentState): boolean => {
      // 🔧 特殊处理：团队成员即使完成也保留显示，直到整个团队结束
      if (agent.multiAgent?.type === 'agent_team' && agent.multiAgent?.teamName) {
        // 检查同一团队中是否还有其他成员在运行
        const teamName = agent.multiAgent.teamName;
        const hasActiveTeamMember = (a: AgentState): boolean => {
          if (a.multiAgent?.type === 'agent_team' && a.multiAgent?.teamName === teamName && a.status !== 'done') {
            return true;
          }
          if (a.subAgents && Array.isArray(a.subAgents)) {
            return a.subAgents.some(child => hasActiveTeamMember(child));
          }
          return false;
        };

        // 如果团队中还有活跃成员，则保留所有团队成员
        if (activeMainAgent && hasActiveTeamMember(activeMainAgent)) {
          return true;
        }
      }

      if (agent.status !== 'done') return true;
      if (agent.subAgents && Array.isArray(agent.subAgents)) {
        return agent.subAgents.some(child => isActiveOrHasActiveChild(child));
      }
      return false;
    };

    const flattenAgents = (agent: AgentState, parentId: string): SubAgentData[] => {
      const result: SubAgentData[] = [];

      if (!agent.subAgents || !Array.isArray(agent.subAgents)) {
        return result;
      }

      console.log('[WorkspaceMonitor] flattenAgents: agent.subAgents.length =', agent.subAgents.length);

      for (const subAgent of agent.subAgents) {
        console.log('[WorkspaceMonitor] flattenAgents: 处理 subAgent:', subAgent.id, 'status:', subAgent.status);

        // 只展示活跃的 agent，或有活跃子 agent 的 agent（保持结构）
        if (!isActiveOrHasActiveChild(subAgent)) {
          console.log('[WorkspaceMonitor] flattenAgents: 跳过非活跃 agent:', subAgent.id);
          continue;
        }

        const subId = subAgent.id;

        const mapStatus = (status: string): 'idle' | 'running' | 'success' | 'error' => {
          if (status === 'done') return 'success';
          if (status === 'thinking' || status === 'executing' || status === 'responding') return 'running';
          return status as any;
        };

        result.push({
          id: subId,
          name: getFriendlyName(subAgent.name),
          type: 'agent',
          status: mapStatus(subAgent.status),
          task: subAgent.currentTask || subAgent.currentThought || '', // 🔧 优先使用 currentTask
          duration: undefined,
          tokenUsage: subAgent.stats.tokenUsage.input + subAgent.stats.tokenUsage.output,
          progress: subAgent.status === 'done' ? 1 : (subAgent.status === 'executing' ? 0.5 : 0),
          roleIcon: getRoleIcon(subAgent.name, 'agent'),
          agentType: subAgent.agentType, // 传递 Agent 类型
          currentMoment: agentActivity.currentMoments[subId],
          momentHistory: agentActivity.momentHistories[subId] || [],
          timelineEvents: agentActivity.timelineEvents[subId] || [],
          thinkingText: subAgent.currentTask || subAgent.currentThought, // 🔧 优先使用 currentTask
          parentAgentId: parentId,
          multiAgent: subAgent.multiAgent, // 传递 multiAgent 信息
        });

        // 🔍 调试：打印 multiAgent 信息
        if (subAgent.multiAgent) {
          console.log('[WorkspaceMonitor] SubAgent multiAgent:', {
            id: subId,
            name: subAgent.name,
            multiAgent: subAgent.multiAgent,
          });
        }

        // 递归处理嵌套的子 agent
        if (subAgent.subAgents && Array.isArray(subAgent.subAgents) && subAgent.subAgents.length > 0) {
          result.push(...flattenAgents(subAgent, subId));
        }
      }

      return result;
    };

    const subAgents: SubAgentData[] = activeMainAgent ? flattenAgents(activeMainAgent, 'main') : [];

    // 🔍 调试：打印 activeMainAgent 的结构
    if (activeMainAgent && activeMainAgent.subAgents.length > 0) {
      console.log('[WorkspaceMonitor] activeMainAgent.subAgents:', activeMainAgent.subAgents.map(s => ({
        id: s.id,
        name: s.name,
        subAgentsCount: s.subAgents?.length || 0,
      })));
    }

    // 计算树形布局位置
    const treePositions = rendererRef.current.getTreePositions();

    console.log('[WorkspaceMonitor] 树形布局位置计算完成，共', treePositions.size, '个位置');

    // 计算团队边界框
    const teamBoundaries = rendererRef.current.getLayoutEngine().computeTeamBoundaries(subAgents, treePositions);

    console.log('[WorkspaceMonitor] 团队边界框计算完成，共', teamBoundaries.length, '个团队');
    teamBoundaries.forEach(boundary => {
      console.log('[WorkspaceMonitor] 团队边界框:', {
        teamName: boundary.teamName,
        strategy: boundary.strategy,
        memberCount: boundary.memberIds.length,
        bounds: boundary.bounds,
      });
    });

    // 构建协作关系（基于真实的父子关系 + 策略信息）
    const collaborations = subAgents
      .filter(agent => !agent.multiAgent?.teamName) // 🔧 过滤掉团队成员，只保留非团队 agent
      .map((agent) => {
        const strategy = agent.multiAgent?.strategy;
        const stepIndex = agent.multiAgent?.stepIndex;

        return {
          from: agent.parentAgentId || 'main',
          to: agent.id,
          type: (strategy as any) || 'task',
          active: agent.status === 'running',
          sequenceNumber: stepIndex,
          isLeaderConnection: strategy === 'hierarchical' && stepIndex === 0,
          debateRound: strategy === 'debate' ? stepIndex : undefined,
        };
      });

    // 🔧 添加主 agent 到团队边界框的连接
    const teamConnections = teamBoundaries.map((team) => ({
      from: 'main',
      to: `team-${team.teamName}`, // 使用团队 ID
      type: 'team' as any,
      active: true,
      isTeamConnection: true, // 标记为团队连接
      teamBounds: team.bounds, // 传递边界框信息
    }));

    // 🔧 合并团队连接和普通连接
    const allCollaborations = [...collaborations, ...teamConnections];

    // 构建统计信息
    const now = Date.now();
    const stats = {
      totalTokens: totalTokens.input + totalTokens.output,
      currentCallTokens: currentCallTokens.input + currentCallTokens.output,
      currentTokenDelta: 0,
      duration: agentActivity.runStartTime ? now - agentActivity.runStartTime : 0,
      iteration: totalIterations,
      startTime: agentActivity.runStartTime ?? undefined,
    };

    // 构建完整状态
    const state: WorkspaceState = {
      mainAgent,
      subAgents,
      collaborations: allCollaborations, // 使用合并后的连接
      stats,
      recentEvents: agentActivity.recentEvents,
      teamBoundaries, // 添加团队边界框
    };

    // 更新画布尺寸（根据 Agent 数量动态调整）
    rendererRef.current.updateCanvasSize(subAgents);
    rendererRef.current.updateState(state);
  }, [
    agentStatus,
    totalTokens,
    totalIterations,
    isProcessing,
    isReady,
    currentCallTokens,
    agentActivity,
    activeMainAgent,
  ]);

  // 处理鼠标移动（悬停检测）
  const handleMouseMove = (_e: React.MouseEvent<HTMLCanvasElement>) => {
    // TODO: 实现悬停检测逻辑
  };

  return (
    <div className="h-full w-full flex flex-col bg-bg-secondary">
      {/* 标题栏 */}
      <div className="h-10 bg-bg-primary border-b border-bg-tertiary flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          <span className="text-sm font-semibold text-text-primary">Work Space</span>
        </div>
        <div className="text-xs text-text-secondary">实时监控</div>
      </div>

      {/* 项目信息条 */}
      {contextInfo?.projectInfo && (
        <div className="bg-bg-primary border-b border-bg-tertiary px-4 py-2">
          <div className="flex flex-col gap-1">
            {/* 第一行：项目类型 */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-text-secondary">📦</span>
              <span className="text-text-tertiary">项目类型:</span>
              <span className="text-text-primary font-semibold">{contextInfo.projectInfo.type}</span>
            </div>

            {/* 第二行：Git 分支 */}
            {contextInfo.projectInfo.gitBranch && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-secondary">🌿</span>
                <span className="text-text-tertiary">Git 分支:</span>
                <span className="text-text-primary font-mono font-semibold">{contextInfo.projectInfo.gitBranch}</span>
              </div>
            )}

            {/* 第三行：项目路径 */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-text-secondary">📁</span>
              <span className="text-text-tertiary">项目路径:</span>
              <span className="text-text-primary font-mono text-xs break-all" title={contextInfo.projectInfo.rootPath}>
                {contextInfo.projectInfo.rootPath}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 意图分析结果展示 */}
      {intentAnalysis && (
        <div className="bg-bg-secondary border-b border-bg-tertiary px-4 py-2">
          <div className="flex flex-col gap-1">
            {/* 标题 */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-text-primary">🎯 意图分析</span>
            </div>

            {/* 分析结果 */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {/* 场景 */}
              {intentAnalysis.scene && (
                <div className="flex items-center gap-1.5 bg-bg-primary px-2 py-1 rounded">
                  <span className="text-text-tertiary">场景:</span>
                  <span className="text-text-primary font-semibold">{intentAnalysis.scene}</span>
                </div>
              )}

              {/* Agent */}
              {intentAnalysis.agent && (
                <div className="flex items-center gap-1.5 bg-bg-primary px-2 py-1 rounded">
                  <span className="text-text-tertiary">Agent:</span>
                  <span className="text-text-primary font-semibold">{intentAnalysis.agent}</span>
                </div>
              )}

              {/* 复杂度 */}
              {intentAnalysis.complexity && (
                <div className="flex items-center gap-1.5 bg-bg-primary px-2 py-1 rounded">
                  <span className="text-text-tertiary">复杂度:</span>
                  <span className="text-text-primary font-semibold">{intentAnalysis.complexity}</span>
                </div>
              )}

              {/* 模型 */}
              {intentAnalysis.model && (
                <div className="flex items-center gap-1.5 bg-bg-primary px-2 py-1 rounded">
                  <span className="text-text-tertiary">模型:</span>
                  <span className="text-text-primary font-mono text-xs">{intentAnalysis.model}</span>
                </div>
              )}
            </div>

            {/* Prompt构建结果 */}
            {promptBuild && (
              <div className="flex flex-wrap items-center gap-3 text-xs mt-1">
                {/* 组件数量 */}
                {promptBuild.components && promptBuild.components.length > 0 && (
                  <div className="flex items-center gap-1.5 bg-bg-primary px-2 py-1 rounded">
                    <span className="text-text-tertiary">Prompt组件:</span>
                    <span className="text-text-primary font-semibold">{promptBuild.components.length}个</span>
                  </div>
                )}

                {/* Token估算 */}
                {promptBuild.estimatedTokens && (
                  <div className="flex items-center gap-1.5 bg-bg-primary px-2 py-1 rounded">
                    <span className="text-text-tertiary">预估Token:</span>
                    <span className="text-text-primary font-mono text-xs">~{promptBuild.estimatedTokens}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🆕 主 Agent 执行状态（类似"正在回忆中"） */}
      <MainFlowVisualization />

      {/* Canvas 区域 */}
      <div className="flex-1 w-full overflow-auto">
        <canvas
          ref={canvasRef}
          className="block"
          onMouseMove={handleMouseMove}
        />
      </div>

      {/* 底部统计区域 */}
      <div className="h-16 bg-bg-primary border-t border-bg-tertiary flex items-center justify-between px-6">
        {/* 左侧：Token 统计 */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">累计 Token:</span>
            <span className="text-sm font-mono font-semibold text-warning">
              {totalTokens.input + totalTokens.output > 0
                ? (totalTokens.input + totalTokens.output).toLocaleString()
                : '0'}
            </span>
          </div>
          {currentCallTokens.input + currentCallTokens.output > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary">本次:</span>
              <span className="text-sm font-mono text-text-secondary">
                +{(currentCallTokens.input + currentCallTokens.output).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* 右侧：迭代次数和耗时 */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">迭代:</span>
            <span className="text-sm font-mono font-semibold text-success">
              {totalIterations}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">耗时:</span>
            <span className="text-sm font-mono font-semibold text-primary">
              {agentActivity.runStartTime
                ? ((Date.now() - agentActivity.runStartTime) / 1000).toFixed(1)
                : '0.0'}s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
