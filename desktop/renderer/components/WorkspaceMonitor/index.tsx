// ============================================================
// Workspace Monitor - 主组件
// ============================================================

import React, { useRef, useEffect, useState } from 'react';
import { CanvasRenderer } from './CanvasRenderer';
import type { WorkspaceState } from './types';
import { useRuntimeStore } from '../../stores/runtimeStore';

export default function WorkspaceMonitor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const [isReady, setIsReady] = useState(false);

  // 从 runtimeStore 获取数据
  const agentStatus = useRuntimeStore((state) => state.agentStatus);
  const messageStream = useRuntimeStore((state) => state.messageStream);
  const tokenUsage = useRuntimeStore((state) => state.tokenUsage);
  const currentIteration = useRuntimeStore((state) => state.currentIteration);
  const isProcessing = useRuntimeStore((state) => state.isProcessing);

  // 初始化渲染器
  useEffect(() => {
    if (!canvasRef.current) return;

    const renderer = new CanvasRenderer(canvasRef.current);
    rendererRef.current = renderer;
    renderer.start();
    setIsReady(true);

    // 监听窗口大小变化
    const handleResize = () => {
      renderer.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      renderer.destroy();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // 构建 WorkspaceState
  useEffect(() => {
    if (!rendererRef.current || !isReady) return;

    // 调试日志
    console.log('[WorkspaceMonitor] 数据更新:', {
      agentStatus,
      messageStream,
      tokenUsage,
      currentIteration,
      isProcessing,
    });

    // 构建主 Agent 数据
    const mainAgent = {
      id: 'main',
      name: agentStatus?.name || 'Xuanji',
      status: agentStatus?.status || 'idle',
      currentThought: agentStatus?.currentThought,
      currentTool: agentStatus?.currentTool?.name,
    };

    // 构建子 Agent 数据（从工具调用映射）- 只显示正在执行的工具，完成后消失
    const subAgents = (messageStream?.toolCalls || [])
      .filter((toolCall) => toolCall.status === 'running')
      .flatMap((toolCall) => {
        // 如果是 Multi-Agent 工具，展开成员/步骤
        if (toolCall.multiAgent) {
          const { type, strategy, teamName, members, steps } = toolCall.multiAgent;

          // 对于团队类型（orchestrate, quick_team, agent_team），展示成员
          if ((type === 'orchestrate' || type === 'quick_team' || type === 'agent_team') && members && members.length > 0) {
            return members.map((member: any) => ({
              id: `${toolCall.id}-${member.id}`,
              name: member.name,
              type: 'agent' as const,
              status: (member.status === 'idle' ? 'idle' :
                       member.status === 'running' ? 'running' :
                       member.status === 'success' ? 'success' : 'error') as const,
              task: member.role,
              duration: member.duration,
              tokenUsage: member.tokenUsage,
              progress: member.progress || 0,
              multiAgent: {
                type,
                strategy,
                teamName,
                parentId: toolCall.id,
              },
            }));
          }

          // 对于流水线类型（pipeline），展示步骤
          if (type === 'pipeline' && steps && steps.length > 0) {
            return steps.map((step: any, index: number) => ({
              id: `${toolCall.id}-step-${index}`,
              name: step.name,
              type: 'agent' as const,
              status: (step.status === 'pending' ? 'idle' :
                       step.status === 'running' ? 'running' :
                       step.status === 'success' ? 'success' : 'error') as const,
              task: step.description,
              progress: step.progress || 0,
              multiAgent: {
                type,
                stepIndex: index,
                totalSteps: steps.length,
                parentId: toolCall.id,
              },
            }));
          }

          // 对于委托类型（delegate），展示为单个子代理
          if (type === 'delegate') {
            return [{
              id: toolCall.id,
              name: `Delegate: ${toolCall.multiAgent.subagentType || 'agent'}`,
              type: 'delegate' as const,
              status: 'running' as const,
              task: (toolCall.input?.description as string) || 'Delegated task',
              duration: toolCall.duration,
              progress: 0.5,
              multiAgent: {
                type,
                subagentType: toolCall.multiAgent.subagentType,
              },
            }];
          }
        }

        // 普通工具调用
        return [{
          id: toolCall.id,
          name: toolCall.name,
          type: 'tool' as const,
          status: 'running' as const,
          task: toolCall.input ? JSON.stringify(toolCall.input).slice(0, 50) : undefined,
          duration: toolCall.duration,
          tokenUsage: undefined,
          progress: 0.5,
        }];
      });

    // 构建协作关系（主 Agent → 工具）
    const collaborations = subAgents.map((agent) => ({
      from: 'main',
      to: agent.id,
      type: 'task' as const,
      active: agent.status === 'running',
    }));

    // 构建统计信息
    const stats = {
      totalTokens: tokenUsage.input + tokenUsage.output,
      currentTokenDelta: 0, // 暂时没有增量统计
      duration: 0, // 暂时没有总耗时统计
      iteration: currentIteration,
    };

    // 构建完整状态
    const state: WorkspaceState = {
      mainAgent,
      subAgents,
      collaborations,
      stats,
    };

    // 更新渲染器
    console.log('[WorkspaceMonitor] 更新状态:', state);
    rendererRef.current.updateState(state);
  }, [
    agentStatus,
    messageStream,
    tokenUsage,
    currentIteration,
    isProcessing,
    isReady,
  ]);

  // 处理鼠标移动（悬停检测）
  const handleMouseMove = (_e: React.MouseEvent<HTMLCanvasElement>) => {
    // TODO: 实现悬停检测逻辑
    // 这里需要根据鼠标位置判断是否悬停在某个 Agent 上
    // 暂时不实现，留待后续优化
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

      {/* Canvas 区域 */}
      <div className="flex-1 w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          onMouseMove={handleMouseMove}
        />
      </div>
    </div>
  );
}
