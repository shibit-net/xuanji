// ============================================================
// Xuanji Desktop - 活跃 Agent 视图（重设计）
// ============================================================
// 多 Agent 协作看板：展示所有活跃 Agent 的实时工作状态
// - 主区域：当前活跃的 Agent 卡片（网格布局）
// - 每个 Agent 显示：状态、当前任务、进度
// - SubAgent 用嵌套卡片显示，体现协作关系
// ============================================================

import React from 'react';
import { useActiveAgentStore } from '../stores';
import { AgentWorkCard } from './AgentWorkCard';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Sparkles } from 'lucide-react';

export default function ActiveAgentView() {
  const mainAgent = useActiveAgentStore((state) => state.mainAgent);

  if (!mainAgent) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md"
        >
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-10 h-10 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">璇玑 Agent 工作台</h3>
          <p className="text-sm text-text-secondary leading-relaxed">
            开始对话后，这里会实时显示所有正在工作的 Agent
            <br />
            您可以看到每个 Agent 的思考、执行和协作过程
          </p>
        </motion.div>
      </div>
    );
  }

  // 收集所有活跃的 Agent（主 Agent + 所有 SubAgent）
  const collectAllAgents = (agent: typeof mainAgent): typeof mainAgent[] => {
    const agents = [agent];
    agent.subAgents.forEach(sub => {
      agents.push(...collectAllAgents(sub));
    });
    return agents;
  };

  const allAgents = collectAllAgents(mainAgent);
  const activeAgents = allAgents.filter(a => a.status !== 'idle' && a.status !== 'done');

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 顶部状态栏 */}
      <div className="sticky top-0 z-10 bg-bg-primary/95 backdrop-blur-sm border-b border-bg-tertiary px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium">
              {activeAgents.length > 0 ? `${activeAgents.length} 个 Agent 正在工作` : '任务完成'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-text-secondary">
            <div>
              Token: {mainAgent.stats.tokenUsage.input + mainAgent.stats.tokenUsage.output}
              {mainAgent.stats.tokenUsage.cached > 0 && (
                <span className="ml-1 text-primary">⚡{mainAgent.stats.tokenUsage.cached}</span>
              )}
            </div>
            <div>工具: {mainAgent.stats.toolCount}</div>
            {mainAgent.stats.cost > 0 && <div>${mainAgent.stats.cost.toFixed(4)}</div>}
          </div>
        </div>
      </div>

      {/* Agent 工作区 */}
      <div className="p-4">
        <AnimatePresence mode="popLayout">
          <AgentWorkCard key={mainAgent.id} agent={mainAgent} level={0} isRoot />
        </AnimatePresence>
      </div>
    </div>
  );
}
