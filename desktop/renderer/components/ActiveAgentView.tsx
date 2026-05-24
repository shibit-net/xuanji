// ============================================================
// Xuanji Desktop - 活跃 Agent 视图（重设计）
// ============================================================
// 多 Agent 协作看板：展示所有活跃 Agent 的实时工作状态
// - 主区域：当前活跃的 Agent 卡片（网格布局）
// - 每个 Agent 显示：状态、当前任务、进度
// - SubAgent 用嵌套卡片显示，体现协作关系
// ============================================================

import { useAgentStateMachine, type AgentState as NewAgentState } from '../stores/AgentStateMachine';
import { useConfigStore } from '../stores/configStore';
import { AgentWorkCard } from './AgentWorkCard';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';

// 将扁平 agentMap 构建为树结构（兼容 AgentWorkCard 的 subAgents 递归）
function buildAgentTree(agentMap: Record<string, NewAgentState>, rootId: string): any {
  const root = agentMap[rootId];
  if (!root) return null;
  const children = Object.values(agentMap).filter(a => a.parentId === rootId && a.id !== rootId);
  return {
    id: root.id,
    name: root.name,
    status: root.status === 'success' ? 'done' : root.status === 'failed' ? 'error' : root.status === 'cleared' ? 'done' : root.status,
    startTime: root.moment?.startTime || root.createdAt,
    currentTools: root.currentTools || [],
    stats: root.stats,
    subAgents: children.map(c => buildAgentTree(agentMap, c.id)).filter(Boolean),
  };
}

// 递归聚合 token 统计
function aggregateStats(agent: any): { input: number; output: number; cached: number; toolCount: number; cost: number } {
  const sum = {
    input: agent.stats?.tokenUsage?.input || 0,
    output: agent.stats?.tokenUsage?.output || 0,
    cached: agent.stats?.tokenUsage?.cached || 0,
    toolCount: agent.stats?.toolCount || 0,
    cost: agent.stats?.cost || 0,
  };
  (agent.subAgents || []).forEach((sub: any) => {
    const s = aggregateStats(sub);
    sum.input += s.input;
    sum.output += s.output;
    sum.cached += s.cached;
    sum.toolCount += s.toolCount;
    sum.cost += s.cost;
  });
  return sum;
}

export default function ActiveAgentView() {
  const newAgentMap = useAgentStateMachine((state) => state.agentMap);
  const newMainAgentId = useAgentStateMachine((state) => state.mainAgent);

  const mainAgent = newMainAgentId ? buildAgentTree(newAgentMap, newMainAgentId) : null;
  const showTokenUsage = useConfigStore((s) => s.settings.showTokenUsage);
  const showCost = useConfigStore((s) => s.settings.showCost);

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
          <h3 className="text-lg font-semibold mb-2">{t('activeagent.title')}</h3>
          <p className="text-sm text-text-secondary leading-relaxed">
            {t('activeagent.desc_start')}
            <br />
            {t('activeagent.desc_see')}
          </p>
        </motion.div>
      </div>
    );
  }

  // 收集所有活跃的 Agent（主 Agent + 所有 SubAgent）
  const collectAllAgents = (agent: typeof mainAgent): typeof mainAgent[] => {
    const agents = [agent];
    (agent.subAgents || []).forEach((sub: any) => {
      agents.push(...collectAllAgents(sub));
    });
    return agents;
  };

  const allAgents = collectAllAgents(mainAgent);
  const activeAgents = allAgents.filter((a: any) => a.status !== 'idle' && a.status !== 'done');

  const stats = aggregateStats(mainAgent);

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
            {showTokenUsage && (
            <div>
              Token: {stats.input + stats.output}
              {stats.cached > 0 && (
                <span className="ml-1 text-primary">⚡{stats.cached}</span>
              )}
            </div>
            )}
            <div>工具: {stats.toolCount}</div>
            {showCost && stats.cost > 0 && <div>${stats.cost.toFixed(4)}</div>}
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
