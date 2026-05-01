// ============================================================
// Workspace Monitor - 主组件（OffscreenCanvas + Web Worker）
// ============================================================

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { WorkspaceState, SubAgentData } from './types';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { useActiveAgentStore, type AgentState } from '../../stores/activeAgentStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { formatModelName } from '../../stores/chatStore';

/**
 * 快速结构哈希：仅对影响布局/渲染的关键字段计算摘要，避免 JSON.stringify 全量序列化。
 * 当并行 task 运行时新 agent 节点加入，只有 agent ID/status 变化才触发 Worker 重布局。
 */
function fastStructuralHash(state: WorkspaceState): string {
  const parts: string[] = [];
  parts.push(`m:${state.mainAgent.status}:${state.mainAgent.currentMoment?.type || ''}:${state.mainAgent.currentMoment?.status || ''}`);
  parts.push(`t:${state.stats.totalTokens}:${state.stats.iteration}:${state.stats.currentCallTokens}`);
  for (const a of state.subAgents) {
    parts.push(`s:${a.id}:${a.status}:${a.multiAgent?.strategy || ''}:${a.multiAgent?.currentRound ?? ''}:${a.thinkingText?.slice(0, 40) || ''}:${a.currentMoment?.type || ''}:${a.currentMoment?.status || ''}`);
  }
  for (const c of state.collaborations) {
    parts.push(`c:${c.from}:${c.to}:${c.active}:${c.type}`);
  }
  parts.push(`ev:${state.recentEvents.length}:${state.recentEvents[0]?.id || ''}`);
  return parts.join('|');
}

// Agent 角色图标映射
const ROLE_ICON_MAP: Record<string, string> = {
  xuanji: '🤖', main: '🤖', coder: '🔨', explore: '🔍', plan: '📐',
  'test-writer': '🧪', 'doc-writer': '📝', 'memory-extractor': '🧠',
  'general-purpose': '🎯', 'context-compressor': '🗜️', 'intent-analyzer': '🎯',
  delegate: '📦', pipeline: '🔗', tool: '🛠️', agent: '🤖', team: '👥',
};

const ROLE_NAME_MAP: Record<string, string> = {
  'general-purpose': 'General Purpose', coder: 'Coder', explore: 'Explorer',
  plan: 'Planner', 'test-writer': 'Test Writer', 'doc-writer': 'Doc Writer',
  'memory-extractor': 'Memory Extractor', 'context-compressor': 'Context Compressor',
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
  if (ROLE_NAME_MAP[lower]) return ROLE_NAME_MAP[lower];
  for (const [key, friendlyName] of Object.entries(ROLE_NAME_MAP)) {
    if (lower.includes(key)) return friendlyName;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

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
  const workerRef = useRef<Worker | null>(null);
  const rAFRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // DOM canvas 2D 上下文（用于绘制 Worker 返回的 ImageBitmap）
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  // 节流 & diff 优化
  const lastStateRef = useRef<string>('');
  const pendingStateRef = useRef<WorkspaceState | null>(null);
  const throttleRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);
  // 帧同步：防止 frame 消息在 Worker 队列中堆积导致缩放/平移延迟
  const framePendingRef = useRef(false);

  const [isReady, setIsReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [viewScale, setViewScale] = useState(1.0);
  const [intentResult, setIntentResult] = useState<any>(null);
  const [promptResult, setPromptResult] = useState<any>(null);

  // 平移/缩放 UI 状态
  const [isDragging, setIsDragging] = useState(false);
  const isPanning = useRef(false);
  const panLastPos = useRef({ x: 0, y: 0 });

  // 从 stores 获取数据
  const agentStatus = useRuntimeStore((state) => state.agentStatus);
  const isProcessing = useRuntimeStore((state) => state.isProcessing);
  const currentCallTokens = useRuntimeStore((state) => state.currentCallTokens);
  const agentActivity = useRuntimeStore((state) => state.agentActivity);
  const contextInfo = useRuntimeStore((state) => state.contextInfo);
  const activeMainAgent = useActiveAgentStore((state) => state.mainAgent);

  // 订阅 workspaceStore
  useEffect(() => {
    const unsubscribe = workspaceStore.subscribe(() => {
      setIntentResult(workspaceStore.getIntentAnalysisResult());
      setPromptResult(workspaceStore.getPromptBuildResult());
    });
    setIntentResult(workspaceStore.getIntentAnalysisResult());
    setPromptResult(workspaceStore.getPromptBuildResult());
    return unsubscribe;
  }, []);

  const totalTokens = useMemo(() => calculateTotalTokens(activeMainAgent), [activeMainAgent]);
  const totalIterations = useMemo(() => calculateTotalIterations(activeMainAgent), [activeMainAgent]);

  // ─── Worker 初始化 ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const containerRect = canvas.parentElement?.getBoundingClientRect();
    const width = containerRect?.width || 800;
    const height = containerRect?.height || 600;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    // 设置 DOM canvas 尺寸（用于绘制 Worker 返回的 ImageBitmap）
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const domCtx = canvas.getContext('2d');
    if (!domCtx) return;
    ctxRef.current = domCtx;

    // 创建独立的 OffscreenCanvas（不使用 transferControlToOffscreen，兼容 StrictMode）
    const offscreen = new OffscreenCanvas(width * dpr, height * dpr);

    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL('./offscreen-renderer.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;
    } catch (err) {
      console.error('[WorkspaceMonitor] Worker 创建失败:', err);
      return;
    }

    // 监听 worker 消息
    worker.onmessage = (e: MessageEvent) => {
      switch (e.data.type) {
        case 'ready':
          setIsReady(true);
          break;
        case 'bitmap': {
          // Worker 完成一帧渲染，将 ImageBitmap 绘制到 DOM canvas
          framePendingRef.current = false;
          const bmp = e.data.bitmap as ImageBitmap;
          domCtx.clearRect(0, 0, canvas.width, canvas.height);
          domCtx.drawImage(bmp, 0, 0);
          bmp.close();
          break;
        }
        case 'stats':
          if (e.data.fps !== undefined) setFps(e.data.fps);
          if (e.data.viewScale !== undefined) setViewScale(e.data.viewScale);
          break;
        case 'error':
          console.error('[WorkspaceMonitor] Worker 错误:', e.data.message);
          break;
      }
    };

    worker.onerror = (err) => {
      console.error('[WorkspaceMonitor] Worker onerror:', err);
    };

    // 初始化 worker：发送 OffscreenCanvas + 配置
    worker.postMessage(
      { type: 'init', canvas: offscreen, dpr, containerWidth: width, containerHeight: height },
      [offscreen]
    );

    // 启动主线程 rAF 驱动循环（空闲时自动降帧）
    const IDLE_FPS = 10;
    const idleInterval = 1000 / IDLE_FPS;
    let lastIdleFrame = 0;

    const sendFrame = (_timestamp: number) => {
      if (!worker) return;

      const now = Date.now();

      // 空闲模式：降帧至 10fps
      if (!isActiveRef.current) {
        if (now - lastIdleFrame < idleInterval) {
          rAFRef.current = requestAnimationFrame(sendFrame);
          return;
        }
        lastIdleFrame = now;
      }

      // 帧同步：Worker 还在处理上一帧时跳过，防止 frame 消息堆积
      // 堆积的 frame 会导致 zoom/pan 命令在消息队列中等待，造成高延迟
      if (framePendingRef.current) {
        rAFRef.current = requestAnimationFrame(sendFrame);
        return;
      }

      framePendingRef.current = true;
      worker.postMessage({ type: 'frame', timestamp: now });
      rAFRef.current = requestAnimationFrame(sendFrame);
    };
    rAFRef.current = requestAnimationFrame(sendFrame);

    return () => {
      if (rAFRef.current !== null) {
        cancelAnimationFrame(rAFRef.current);
        rAFRef.current = null;
      }
      if (throttleRef.current !== null) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
      if (worker) {
        worker.postMessage({ type: 'destroy' });
        worker.terminate();
        workerRef.current = null;
      }
      ctxRef.current = null;
      setIsReady(false);
      setFps(0);
    };
  }, []);

  // ─── 构建并发送 WorkspaceState（快速哈希 diff + 16ms 节流）─────────────
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !isReady) return;

    // 更新活跃状态（控制 rAF 帧率）
    const hasActiveAgents = activeMainAgent?.subAgents?.some(
      (a: AgentState) => a.status !== 'done' && a.status !== 'idle'
    ) ?? false;
    isActiveRef.current = isProcessing || hasActiveAgents;

    // 构建主 Agent 数据
    const mainId = activeMainAgent?.id || 'xuanji';
    const mainActivityKey = mainId;

    // 🔧 查找辩论目标（辩论模式下显示在中心圆）
    const debateGoal = activeMainAgent?.subAgents?.find(
      (a: AgentState) => a.multiAgent?.strategy === 'debate' && a.multiAgent?.goal
    )?.multiAgent?.goal;

    const mainAgent = {
      id: mainId,
      name: agentStatus?.name || 'Xuanji',
      status: agentStatus?.status || 'idle',
      roleIcon: getRoleIcon(agentStatus?.name || 'xuanji'),
      currentThought: activeMainAgent?.currentThought || agentStatus?.currentThought,
      thinkingText: activeMainAgent?.currentThought || agentStatus?.currentThought,
      currentTool: agentStatus?.currentTool?.name,
      currentMoment: agentActivity.currentMoments[mainActivityKey],
      momentHistory: agentActivity.momentHistories[mainActivityKey] || [],
      timelineEvents: agentActivity.timelineEvents[mainActivityKey] || [],
      debateGoal,
    };

    // 展平子 agent 树
    const isActiveOrHasActiveChild = (agent: AgentState): boolean => {
      if (agent.multiAgent?.type === 'agent_team') return true;
      if (agent.status !== 'done') return true;
      if (agent.subAgents && Array.isArray(agent.subAgents)) {
        return agent.subAgents.some(child => isActiveOrHasActiveChild(child));
      }
      return false;
    };

    const flattenAgents = (agent: AgentState, parentId: string): SubAgentData[] => {
      const result: SubAgentData[] = [];
      if (!agent.subAgents || !Array.isArray(agent.subAgents)) return result;

      for (const subAgent of agent.subAgents) {
        if (!isActiveOrHasActiveChild(subAgent)) continue;

        const subId = subAgent.id;
        const mapStatus = (status: string): 'idle' | 'running' | 'success' | 'error' => {
          if (status === 'done') return 'success';
          if (status === 'pending') return 'idle';
          if (status === 'thinking' || status === 'executing' || status === 'responding') return 'running';
          return status as any;
        };

        // 意图识别 agent 的思考气泡仅展示 emoji + 模型名称
        // 匹配 intent-analyzer（子agent）和 intent-classifier（ModelClassifier）
        let thinkingText = subAgent.currentThought || subAgent.currentTask || '';
        const isIntentAgent = subAgent.name?.toLowerCase().includes('intent-analyzer')
          || subAgent.name?.toLowerCase().includes('intent-classifier')
          || subAgent.id?.toLowerCase().includes('intent-classifier');
        if (isIntentAgent) {
          const intentResult = workspaceStore.getIntentAnalysisResult();
          const modelName = intentResult?.model || '';
          // 仅当 workspaceStore 中有模型名称时才覆盖，否则保留 currentThought 中的模型名称
          if (modelName) {
            thinkingText = `🎯 ${formatModelName(modelName)}`;
          }
        }

        result.push({
          id: subId,
          name: getFriendlyName(subAgent.name),
          type: 'agent',
          status: mapStatus(subAgent.status),
          task: subAgent.currentTask || subAgent.currentThought || '',
          duration: undefined,
          tokenUsage: subAgent.stats.tokenUsage.input + subAgent.stats.tokenUsage.output,
          progress: subAgent.status === 'done' ? 1 : 0,
          roleIcon: getRoleIcon(subAgent.name, 'agent'),
          agentType: subAgent.agentType,
          currentMoment: agentActivity.currentMoments[subId],
          momentHistory: agentActivity.momentHistories[subId] || [],
          timelineEvents: agentActivity.timelineEvents[subId] || [],
          thinkingText,
          parentAgentId: parentId,
          multiAgent: subAgent.multiAgent,
        });

        if (subAgent.subAgents && Array.isArray(subAgent.subAgents) && subAgent.subAgents.length > 0) {
          result.push(...flattenAgents(subAgent, subId));
        }
      }
      return result;
    };

    const subAgents: SubAgentData[] = activeMainAgent ? flattenAgents(activeMainAgent, mainId) : [];

    // 构建协作关系
    const collaborations = subAgents
      .filter(agent => !agent.multiAgent?.teamName)
      .map((agent) => ({
        from: agent.parentAgentId || mainId,
        to: agent.id,
        type: (agent.multiAgent?.strategy as any) || 'task',
        active: agent.status === 'running',
        sequenceNumber: agent.multiAgent?.stepIndex,
        isLeaderConnection: agent.multiAgent?.strategy === 'hierarchical' && agent.multiAgent?.stepIndex === 0,
        debateRound: agent.multiAgent?.strategy === 'debate' ? agent.multiAgent?.stepIndex : undefined,
      }));

    // 构建统计
    const now = Date.now();
    const stats = {
      totalTokens: totalTokens.input + totalTokens.output,
      currentCallTokens: currentCallTokens.input + currentCallTokens.output,
      currentTokenDelta: 0,
      duration: agentActivity.runStartTime ? now - agentActivity.runStartTime : 0,
      iteration: totalIterations,
      startTime: agentActivity.runStartTime ?? undefined,
    };

    // 构建 state（不包含 teamBoundaries，worker 自己计算）
    const state: WorkspaceState = {
      mainAgent,
      subAgents,
      collaborations,
      stats,
      recentEvents: agentActivity.recentEvents,
      teamBoundaries: [],
    };

    // 快速哈希 diff：仅关键字段变化时发送，避免 JSON.stringify 全量序列化
    const stateHash = fastStructuralHash(state);
    if (stateHash === lastStateRef.current) return;

    lastStateRef.current = stateHash;
    pendingStateRef.current = state;

    if (throttleRef.current !== null) return;

    throttleRef.current = window.setTimeout(() => {
      throttleRef.current = null;
      const pending = pendingStateRef.current;
      pendingStateRef.current = null;
      if (pending && workerRef.current) {
        workerRef.current.postMessage({ type: 'updateState', state: pending });
      }
    }, 16);
  }, [
    agentStatus, totalTokens, totalIterations, isProcessing, isReady,
    currentCallTokens, agentActivity, activeMainAgent,
  ]);

  // ─── Resize 处理 ──────────────────────────────────────────────
  useEffect(() => {
    const handleResize = () => {
      const worker = workerRef.current;
      const canvas = canvasRef.current;
      if (!worker || !canvas) return;

      const container = canvas.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      if (worker) {
        worker.postMessage({ type: 'resize', width: rect.width, height: rect.height, dpr });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isReady]);

  // ─── 事件处理 ──────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    workerRef.current?.postMessage({ type: 'zoom', factor: zoomFactor, screenX: mouseX, screenY: mouseY });
  }, []);

  // React 默认将 onWheel 注册为 passive listener，导致 preventDefault() 报错
  // 手动 attach 非 passive 的 wheel 监听器以支持阻止默认滚动行为
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      isPanning.current = true;
      setIsDragging(true);
      panLastPos.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panLastPos.current.x;
    const dy = e.clientY - panLastPos.current.y;
    panLastPos.current = { x: e.clientX, y: e.clientY };
    workerRef.current?.postMessage({ type: 'pan', deltaX: dx, deltaY: dy });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning.current) {
      isPanning.current = false;
      setIsDragging(false);
      (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const worker = workerRef.current;
    if (!worker) return;

    switch (e.key) {
      case '+': case '=':
        e.preventDefault();
        worker.postMessage({ type: 'zoom', factor: 1.2, screenX: 400, screenY: 300 });
        break;
      case '-':
        e.preventDefault();
        worker.postMessage({ type: 'zoom', factor: 0.8, screenX: 400, screenY: 300 });
        break;
      case '0':
        e.preventDefault();
        worker.postMessage({ type: 'resetView' });
        setViewScale(1.0);
        break;
      case 'f': case 'F':
        if (e.ctrlKey) {
          e.preventDefault();
          worker.postMessage({ type: 'zoomToFit' });
        }
        break;
    }
  }, []);

  const sendZoomCommand = (factor: number) => {
    workerRef.current?.postMessage({
      type: 'zoom', factor, screenX: 400, screenY: 300
    });
  };

  // ─── UI 渲染 ────────────────────────────────────────────────────
  return (
    <div className="h-full w-full flex flex-col bg-bg-secondary">
      {/* 标题栏 */}
      <div className="h-10 bg-bg-primary border-b border-bg-tertiary flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          <span className="text-sm font-semibold text-text-primary">Work Space</span>
        </div>
        <div className="flex items-center gap-3">
          {fps > 0 && (
            <span className="text-xs text-text-secondary font-mono">{fps} FPS</span>
          )}
          <span className="text-xs text-text-secondary">实时监控</span>
        </div>
      </div>

      {/* 当前目录信息条（始终显示：workspace 或项目路径） */}
      {contextInfo?.workingDirectory && (
        <div className="bg-bg-primary border-b border-bg-tertiary px-4 py-2">
          <div className="flex flex-col gap-1">
            {contextInfo.projectInfo && contextInfo.projectInfo.type !== 'workspace' ? (
              <>
                {contextInfo.projectInfo.type !== 'unknown' && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-secondary">📦</span>
                    <span className="text-text-tertiary">项目类型:</span>
                    <span className="text-text-primary font-semibold">{contextInfo.projectInfo.type}</span>
                  </div>
                )}
                {contextInfo.projectInfo.gitBranch && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-secondary">🌿</span>
                    <span className="text-text-tertiary">Git 分支:</span>
                    <span className="text-text-primary font-mono font-semibold">{contextInfo.projectInfo.gitBranch}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-text-secondary">📁</span>
                  <span className="text-text-tertiary">项目路径:</span>
                  <span className="text-text-primary font-mono text-xs break-all" title={contextInfo.workingDirectory}>
                    {contextInfo.workingDirectory}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-secondary">📂</span>
                <span className="text-text-tertiary">工作区:</span>
                <span className="text-text-primary font-mono text-xs break-all" title={contextInfo.workingDirectory}>
                  {contextInfo.workingDirectory}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 意图分析和 Prompt 信息 */}
      {(intentResult || promptResult) && (
        <div className="bg-bg-primary border-b border-bg-tertiary px-4 py-2">
          <div className="flex flex-col gap-2">
            {intentResult && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-secondary">🎯</span>
                <span className="text-text-tertiary font-semibold">意图分析:</span>
                {intentResult.scene && (
                  <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 rounded">{intentResult.scene}</span>
                )}
                {intentResult.agent && (
                  <span className="px-2 py-0.5 bg-green-500/10 text-green-400 rounded">{intentResult.agent}</span>
                )}
                {intentResult.complexity && (
                  <span className={`px-2 py-0.5 rounded ${intentResult.complexity === 'complex' ? 'bg-orange-500/10 text-orange-400' : 'bg-gray-500/10 text-gray-400'}`}>
                    {intentResult.complexity}
                  </span>
                )}
                {intentResult.matchMethod && intentResult.matchMethod !== 'unknown' && (
                  <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded">
                    {intentResult.matchMethod === 'llm' ? 'LLM' :
                     intentResult.matchMethod === 'vector' ? '向量' :
                     intentResult.matchMethod === 'keyword' ? '关键词' : '默认'}
                  </span>
                )}
              </div>
            )}
            {promptResult && promptResult.components && promptResult.components.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-secondary">📝</span>
                <span className="text-text-tertiary font-semibold">Prompt 组件:</span>
                <div className="flex flex-wrap gap-1">
                  {promptResult.components.map((comp: any, index: number) => {
                    const layerColors: Record<string, string> = {
                      'L0': 'bg-red-500/10 text-red-400', 'L1': 'bg-blue-500/10 text-blue-400',
                      'L2': 'bg-green-500/10 text-green-400', 'L3': 'bg-amber-500/10 text-amber-400',
                    };
                    const colorClass = layerColors[comp.layer] || 'bg-bg-tertiary text-text-secondary';
                    return (
                      <span key={index} className={`px-2 py-0.5 rounded text-xs ${colorClass}`}>
                        {comp.name}
                      </span>
                    );
                  })}
                </div>
                {promptResult.estimatedTokens != null && (
                  <span className="text-xs text-text-tertiary font-mono whitespace-nowrap">
                    ~{promptResult.estimatedTokens}t
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Canvas 区域 */}
      <div ref={containerRef} className="flex-1 w-full overflow-hidden relative">
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={handleKeyDown}
        />
        {/* 缩放指示器 */}
        <div className="absolute bottom-3 right-3 bg-bg-primary/80 backdrop-blur-sm border border-bg-tertiary rounded-lg px-3 py-1.5 flex items-center gap-3 text-xs text-text-secondary z-10">
          <button
            className="hover:text-text-primary transition-colors w-5 h-5 flex items-center justify-center rounded"
            onClick={() => sendZoomCommand(0.8)}
            title="缩小 (-)"
          >−</button>
          <span
            className="font-mono text-text-primary min-w-[42px] text-center cursor-pointer"
            title="重置缩放 (0)"
            onClick={() => { workerRef.current?.postMessage({ type: 'resetView' }); setViewScale(1.0); }}
          >{Math.round(viewScale * 100)}%</span>
          <button
            className="hover:text-text-primary transition-colors w-5 h-5 flex items-center justify-center rounded"
            onClick={() => sendZoomCommand(1.2)}
            title="放大 (+)"
          >+</button>
          <button
            className="hover:text-text-primary transition-colors text-xs ml-1"
            onClick={() => workerRef.current?.postMessage({ type: 'zoomToFit' })}
            title="适配窗口 (Ctrl+F)"
          >⊞</button>
        </div>
      </div>

      {/* 底部统计区域 */}
      <div className="h-16 bg-bg-primary border-t border-bg-tertiary flex items-center justify-between px-6">
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
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">迭代:</span>
            <span className="text-sm font-mono font-semibold text-success">{totalIterations}</span>
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
