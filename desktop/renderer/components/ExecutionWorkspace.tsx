// ============================================================
// ExecutionWorkspace - 拟人化 Agent 监视器
// ============================================================
// 设计理念：
// - 圆形头像 + 呼吸动画 + 光晕效果
// - 柔和的渐变色和圆角
// - Agent "站在" 连线上，像真实的工作流
// - 工具像"漂浮的气泡"围绕在 Agent 周围
// ============================================================

import React, { useRef, useEffect, useState } from 'react';
import { Activity, Loader2, ChevronDown, GitBranch, Sparkles } from 'lucide-react';
import { useExecutionStore } from '../stores/executionStore';
import { useChatStore } from '../stores/chatStore';

interface AgentCard {
  id: string;
  name: string;
  mode: 'plan' | 'team' | 'subagent' | 'main';
  currentTask?: string;
  tools: { id: string; name: string; status: string; startTime: number }[];
  children: AgentCard[];
  isParallel: boolean;
  status: 'running' | 'completed' | 'failed';
}

export default function ExecutionWorkspace() {
  const rootAgent = useExecutionStore((state) => state.rootAgent);
  const toolExecutions = useExecutionStore((state) => state.toolExecutions);
  const systemStatus = useExecutionStore((state) => state.systemStatus);
  const messages = useChatStore((state) => state.messages);

  const [agentCards, setAgentCards] = useState<AgentCard[]>([]);

  // 获取最后一条用户消息
  const lastUserMessage = messages.filter((m) => m.role === 'user').slice(-1)[0];

  // ========== 构建 Agent 卡片树 ==========
  useEffect(() => {
    if (!rootAgent || rootAgent.status !== 'running') {
      setAgentCards([]);
      return;
    }

    // 检测当前执行模式
    const detectMode = (): 'plan' | 'team' | 'main' => {
      const recentTools = toolExecutions.slice(-5);
      const hasPlanMode = recentTools.some(
        (t) => t.name === 'EnterPlanMode' || t.name === 'ExitPlanMode'
      );
      if (hasPlanMode) return 'plan';

      const hasTeamTool = recentTools.some(
        (t) => t.name === 'QuickTeam' || t.name === 'Orchestrate'
      );
      if (hasTeamTool) return 'team';

      return 'main';
    };

    // 递归构建 Agent 卡片
    const buildAgentCard = (agent: any, mode: 'plan' | 'team' | 'subagent' | 'main'): AgentCard | null => {
      if (agent.status !== 'running') return null;

      // 找出属于该 Agent 的工具（运行中的）
      const agentTools = toolExecutions
        .filter((t) => t.status === 'running')
        .map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          startTime: t.startTime,
        }));

      // 递归处理子 Agent
      const children: AgentCard[] = [];
      if (agent.children && agent.children.length > 0) {
        const runningChildren = agent.children.filter((c: any) => c.status === 'running');
        const isParallel = runningChildren.length > 1;

        runningChildren.forEach((child: any) => {
          const childCard = buildAgentCard(child, 'subagent');
          if (childCard) {
            childCard.isParallel = isParallel;
            children.push(childCard);
          }
        });
      }

      return {
        id: agent.id,
        name: agent.name,
        mode: agent.id === rootAgent.id ? detectMode() : mode,
        currentTask: agent.currentTask,
        tools: agentTools,
        children,
        isParallel: false,
        status: agent.status,
      };
    };

    const mainCard = buildAgentCard(rootAgent, detectMode());
    setAgentCards(mainCard ? [mainCard] : []);
  }, [rootAgent, toolExecutions]);

  // ========== 获取头像信息 ==========
  const getAvatarInfo = (mode: string) => {
    switch (mode) {
      case 'plan':
        return {
          emoji: '🧠',
          gradient: 'from-purple-500 via-violet-500 to-purple-600',
          glow: 'rgba(139, 92, 246, 0.5)',
          name: '设计师',
          badge: '📋 Plan',
        };
      case 'team':
        return {
          emoji: '👑',
          gradient: 'from-orange-500 via-amber-500 to-orange-600',
          glow: 'rgba(245, 158, 11, 0.5)',
          name: '团队领导',
          badge: '👥 Team',
        };
      case 'subagent':
        return {
          emoji: '🤖',
          gradient: 'from-green-500 via-emerald-500 to-green-600',
          glow: 'rgba(16, 185, 129, 0.5)',
          name: '执行者',
          badge: '🔀 SubAgent',
        };
      default:
        return {
          emoji: '✨',
          gradient: 'from-blue-500 via-cyan-500 to-blue-600',
          glow: 'rgba(59, 130, 246, 0.5)',
          name: '助手',
          badge: '▶️ 运行中',
        };
    }
  };

  // ========== 渲染 Agent 卡片（递归） ==========
  const renderAgentCard = (card: AgentCard, depth: number = 0) => {
    const avatarInfo = getAvatarInfo(card.mode);

    return (
      <div key={card.id} className="space-y-6">
        {/* Agent 容器 */}
        <div
          className="relative"
          style={{ paddingLeft: depth > 0 ? `${depth * 48}px` : '0' }}
        >
          <div className="relative flex items-start gap-6">
            {/* 头像区域 */}
            <div className="relative flex-shrink-0">
              {/* 光晕效果（呼吸动画） */}
              <div
                className="absolute inset-0 rounded-full animate-pulse"
                style={{
                  background: `radial-gradient(circle, ${avatarInfo.glow} 0%, transparent 70%)`,
                  filter: 'blur(20px)',
                  transform: 'scale(1.2)',
                }}
              />

              {/* 头像主体 */}
              <div className="relative group">
                <div
                  className={`w-20 h-20 rounded-full bg-gradient-to-br ${avatarInfo.gradient}
                    flex items-center justify-center text-4xl shadow-2xl
                    transform transition-transform group-hover:scale-110
                    border-4 border-white/20`}
                >
                  {avatarInfo.emoji}
                </div>

                {/* 状态指示器（右上角） */}
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full border-4 border-gray-900 flex items-center justify-center">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                </div>

                {/* 模式徽章（底部） */}
                <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                  <div className="px-2 py-0.5 bg-gray-900/90 backdrop-blur-sm border border-white/20 rounded-full text-xs text-white font-medium shadow-lg">
                    {avatarInfo.badge}
                  </div>
                </div>
              </div>
            </div>

            {/* 信息区域 */}
            <div className="flex-1 min-w-0 pt-2">
              {/* Agent 名称和角色 */}
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-bold text-white">{card.name}</h3>
                <span className="text-sm text-gray-400">• {avatarInfo.name}</span>
                {card.isParallel && (
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-500/20 border border-orange-500/50 rounded-full text-xs text-orange-300">
                    <GitBranch size={12} />
                    <span>并行</span>
                  </div>
                )}
              </div>

              {/* 当前任务 */}
              {card.currentTask && (
                <div className="mb-3 flex items-center gap-2 text-sm text-gray-300">
                  <Sparkles size={14} className="text-yellow-400" />
                  <span>{card.currentTask}</span>
                </div>
              )}

              {/* 工具气泡列表 */}
              {card.tools.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {card.tools.map((tool) => (
                    <div
                      key={tool.id}
                      className="group relative flex items-center gap-2 px-3 py-2
                        bg-gradient-to-r from-gray-800/80 to-gray-700/80
                        backdrop-blur-sm border border-white/10 rounded-full
                        shadow-lg hover:shadow-xl transition-all hover:scale-105"
                    >
                      {/* 工具图标 */}
                      <div className="flex items-center justify-center w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full">
                        <span className="text-xs">🔧</span>
                      </div>

                      {/* 工具名称 */}
                      <span className="text-sm font-medium text-white">{tool.name}</span>

                      {/* 执行时长 */}
                      <span className="text-xs text-gray-400 ml-1">
                        {((Date.now() - tool.startTime) / 1000).toFixed(1)}s
                      </span>

                      {/* Loading 指示器 */}
                      <Loader2 size={14} className="text-cyan-400 animate-spin" />

                      {/* Hover 光晕 */}
                      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity -z-10 blur-xl" />
                    </div>
                  ))}
                </div>
              )}

              {/* 无工具提示 */}
              {card.tools.length === 0 && (
                <div className="text-sm text-gray-500 italic">
                  思考中...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 子 Agent */}
        {card.children.length > 0 && (
          <div className="space-y-6">
            {/* 连接线（垂直） */}
            <div className="flex items-center gap-3 ml-10">
              <div className="w-0.5 h-8 bg-gradient-to-b from-gray-600 to-transparent" />
              {card.children[0]?.isParallel ? (
                <div className="flex items-center gap-2 text-xs text-orange-400 font-medium">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
                    <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                  </div>
                  <span>并行执行 {card.children.length} 个任务</span>
                  <ChevronDown size={14} />
                </div>
              ) : (
                <div className="text-xs text-gray-500">
                  <ChevronDown size={14} className="inline" /> 继续执行
                </div>
              )}
            </div>

            {/* 子 Agent 布局 */}
            {card.children[0]?.isParallel ? (
              // 并行布局（水平排列）
              <div className="grid grid-cols-2 gap-6 ml-10">
                {card.children.map((child, index) => (
                  <div key={child.id} className="relative">
                    {/* 分支线 */}
                    <div className="absolute -left-6 top-10 w-6 h-0.5 bg-gradient-to-r from-gray-600 to-transparent" />
                    {renderAgentCard(child, depth + 1)}
                  </div>
                ))}
              </div>
            ) : (
              // 串行布局（垂直排列）
              <div className="space-y-6">
                {card.children.map((child) => renderAgentCard(child, depth + 1))}
              </div>
            )}

            {/* 汇总指示器 */}
            <div className="flex items-center gap-3 ml-10">
              <div className="w-0.5 h-8 bg-gradient-to-t from-gray-600 to-transparent" />
              <div className="flex items-center gap-2 text-xs text-blue-400 font-medium">
                <ChevronDown size={14} className="rotate-180" />
                <span>结果汇总到 {card.name}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const totalTokens = systemStatus.tokenUsage.input + systemStatus.tokenUsage.output;

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-lg">
            <Activity size={20} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Agent 执行监视器</div>
            <div className="text-xs text-gray-400">
              {agentCards.length > 0
                ? `${agentCards.length} 个 Agent 正在工作`
                : '等待任务...'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs text-white">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            <span className="text-gray-300">迭代</span>
            <span className="font-bold">{systemStatus.currentIteration}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-300">Token</span>
            <span className="font-bold">{(totalTokens / 1000).toFixed(1)}K</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-300">成本</span>
            <span className="font-bold text-green-400">${systemStatus.cost.toFixed(4)}</span>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* 用户输入 */}
          {lastUserMessage && rootAgent?.status === 'running' && (
            <div className="relative">
              <div className="flex items-start gap-6">
                {/* 用户头像 */}
                <div className="relative flex-shrink-0">
                  <div className="w-16 h-16 bg-gradient-to-br from-gray-700 to-gray-800 rounded-full flex items-center justify-center text-3xl shadow-xl border-4 border-white/10">
                    👤
                  </div>
                </div>

                {/* 消息气泡 */}
                <div className="flex-1 bg-gradient-to-r from-gray-800/50 to-gray-700/50 backdrop-blur-sm border border-white/10 rounded-2xl rounded-tl-none px-6 py-4 shadow-lg">
                  <div className="text-xs text-gray-400 mb-1">用户</div>
                  <div className="text-sm text-white leading-relaxed">
                    {lastUserMessage.content.slice(0, 200)}
                    {lastUserMessage.content.length > 200 ? '...' : ''}
                  </div>
                </div>
              </div>

              {/* 连接线 */}
              <div className="ml-8 mt-4 flex items-center gap-3">
                <div className="w-0.5 h-12 bg-gradient-to-b from-gray-600 to-transparent" />
                <div className="text-xs text-gray-500">开始处理</div>
              </div>
            </div>
          )}

          {/* Agent 卡片列表 */}
          {agentCards.length > 0 ? (
            <div className="space-y-8">
              {agentCards.map((card) => renderAgentCard(card))}
            </div>
          ) : (
            // 空状态
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <div className="mb-6 relative inline-block">
                  {/* 脉动光圈 */}
                  <div className="absolute inset-0 bg-blue-500/30 rounded-full animate-ping" />
                  <div className="relative w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-5xl shadow-2xl">
                    ✨
                  </div>
                </div>
                <div className="text-xl font-bold text-white mb-2">等待执行任务...</div>
                <div className="text-sm text-gray-400">
                  发送消息后，Agent 将开始工作
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="border-t border-white/10 bg-black/30 backdrop-blur-xl px-6 py-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            {rootAgent?.status === 'running' ? (
              <>
                <Loader2 size={14} className="animate-spin text-blue-400" />
                <span className="text-white font-medium">正在执行任务...</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 bg-gray-600 rounded-full" />
                <span>待命中</span>
              </>
            )}
          </div>
          <div className="text-gray-500">
            实时显示 · 拟人化交互
          </div>
        </div>
      </div>
    </div>
  );
}
