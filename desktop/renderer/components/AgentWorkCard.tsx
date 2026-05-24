// ============================================================
// Xuanji Desktop - Agent 工作卡片（重设计）
// ============================================================
// 现代化的 Agent 状态卡片，专注展示当前工作内容
// - 紧凑的状态指示器
// - 清晰的任务进度展示
// - SubAgent 嵌套布局
// ============================================================

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Wrench, Sparkles, CheckCircle, ChevronDown, ChevronRight,
  Loader2, Zap, Clock, Tag, Layers, Server
} from 'lucide-react';
import { useConfigStore } from '../stores/configStore';
import { t } from '@/core/i18n';
import type { ToolExecution } from '../stores/AgentStateMachine';

// 树节点类型（由 ActiveAgentView.buildAgentTree 构建）
interface TreeNode {
  id: string;
  name: string;
  status: string;
  startTime?: number;
  currentTools: ToolExecution[];
  currentTask?: string;
  currentThought?: string;
  currentResponse?: string;
  agentType?: string;
  executionMode?: string;
  scene?: string;
  stats: { tokenUsage: { input: number; output: number; cached: number }; cost: number; toolCount: number };
  multiAgent?: {
    type: string;
    strategy?: string;
    teamName?: string;
    memberId?: string;
    stepIndex?: number;
    totalSteps?: number;
    currentRound?: number;
    maxRounds?: number;
    debateRole?: string;
  };
  subAgents: TreeNode[];
}

// 子 Agent 标签映射
const AGENT_TYPE_LABEL: Record<string, string> = {
  builtin: t('agent.work_card.agent_type.builtin'),
  preset: t('agent.work_card.agent_type.preset'),
  custom: t('agent.work_card.agent_type.custom'),
  temporary: t('agent.work_card.agent_type.temporary'),
};

const EXECUTION_MODE_LABEL: Record<string, string> = {
  'acp': t('agent.work_card.exec_mode.acp'),
  'in-process': t('agent.work_card.exec_mode.in_process'),
};

interface AgentWorkCardProps {
  agent: TreeNode;
  level: number;
  isRoot?: boolean;
}

export function AgentWorkCard({ agent, level, isRoot = false }: AgentWorkCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const showThinking = useConfigStore((s) => s.settings.showThinking);

  const getStatusConfig = () => {
    switch (agent.status) {
      case 'thinking':
        return {
          icon: Brain,
          label: t('agent.work_card.status.thinking'),
          color: 'text-purple-400',
          bg: 'bg-purple-500/10',
          border: 'border-purple-500/30',
          glow: 'shadow-purple-500/20',
        };
      case 'executing':
        return {
          icon: Wrench,
          label: t('agent.work_card.status.executing'),
          color: 'text-blue-400',
          bg: 'bg-blue-500/10',
          border: 'border-blue-500/30',
          glow: 'shadow-blue-500/20',
        };
      case 'responding':
        return {
          icon: Sparkles,
          label: t('agent.work_card.status.responding'),
          color: 'text-orange-400',
          bg: 'bg-orange-500/10',
          border: 'border-orange-500/30',
          glow: 'shadow-orange-500/20',
        };
      case 'done':
        return {
          icon: CheckCircle,
          label: t('agent.work_card.status.done'),
          color: 'text-green-400',
          bg: 'bg-green-500/10',
          border: 'border-green-500/30',
          glow: 'shadow-green-500/20',
        };
      default:
        return {
          icon: Loader2,
          label: t('agent.work_card.status.idle'),
          color: 'text-gray-400',
          bg: 'bg-gray-500/10',
          border: 'border-gray-500/30',
          glow: 'shadow-gray-500/20',
        };
    }
  };

  const statusConfig = getStatusConfig();
  const StatusIcon = statusConfig.icon;
  const hasSubAgents = agent.subAgents.length > 0;
  const isActive = agent.status !== 'idle' && agent.status !== 'done';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`relative ${level > 0 ? 'ml-8 mt-3' : ''}`}
    >
      {/* 连接线（SubAgent） */}
      {level > 0 && (
        <div className="absolute -left-6 top-6 w-6 h-px bg-bg-tertiary" />
      )}

      {/* 主卡片 */}
      <div
        className={`
          relative rounded-lg border transition-all duration-200
          ${statusConfig.border} ${statusConfig.bg}
          ${isActive ? `shadow-lg ${statusConfig.glow}` : 'shadow-sm'}
        `}
      >
        {/* 状态指示条 */}
        <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-lg ${statusConfig.bg}`}>
          {isActive && (
            <motion.div
              className={`h-full ${statusConfig.color.replace('text-', 'bg-')}`}
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
        </div>

        {/* 卡片头部 */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            {/* 展开/收起按钮 */}
            {hasSubAgents && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex-shrink-0 p-1 hover:bg-bg-tertiary/50 rounded transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-text-secondary" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-text-secondary" />
                )}
              </button>
            )}

            {/* 状态图标 */}
            <div className={`flex-shrink-0 w-10 h-10 rounded-full ${statusConfig.bg} flex items-center justify-center`}>
              <StatusIcon className={`w-5 h-5 ${statusConfig.color} ${isActive ? 'animate-pulse' : ''}`} />
            </div>

            {/* Agent 信息 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{agent.name}</span>
              </div>
              {!isRoot && (agent.agentType || agent.scene || agent.executionMode || agent.multiAgent?.type) && (
                <div className="flex items-center gap-1 mt-1">
                  {agent.multiAgent?.type && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 rounded border border-indigo-500/20 whitespace-nowrap">
                      <Layers className="w-2.5 h-2.5" />
                      {agent.multiAgent.type === 'agent_team' ? t('agent.work_card.multi_type.agent_team') :
                       agent.multiAgent.type === 'delegate' ? t('agent.work_card.multi_type.delegate') :
                       agent.multiAgent.type === 'pipeline' ? t('agent.work_card.multi_type.pipeline') :
                       agent.multiAgent.type === 'quick_team' ? t('agent.work_card.multi_type.quick_team') :
                       agent.multiAgent.type === 'orchestrate' ? t('agent.work_card.multi_type.orchestrate') :
                       agent.multiAgent.type}
                    </span>
                  )}
                  {agent.agentType && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20 whitespace-nowrap">
                      <Tag className="w-2.5 h-2.5" />
                      {AGENT_TYPE_LABEL[agent.agentType] || agent.agentType}
                    </span>
                  )}
                  {agent.scene && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20 whitespace-nowrap">
                      {agent.scene}
                    </span>
                  )}
                  {agent.executionMode && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded border border-amber-500/20 whitespace-nowrap">
                      <Server className="w-2.5 h-2.5" />
                      {EXECUTION_MODE_LABEL[agent.executionMode] || agent.executionMode}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className={`w-1.5 h-1.5 rounded-full ${statusConfig.color.replace('text-', 'bg-')} ${isActive ? 'animate-pulse' : ''}`} />
                <span className={`text-xs ${statusConfig.color}`}>{statusConfig.label}</span>
              </div>
            </div>

            {/* 统计信息 */}
            <div className="flex-shrink-0 flex items-center gap-3 text-[10px] text-text-tertiary">
              {agent.currentTools.length > 0 && (
                <div className="flex items-center gap-1">
                  <Wrench className="w-3 h-3" />
                  <span>{agent.currentTools.length}</span>
                </div>
              )}
              {agent.stats.toolCount > 0 && (
                <div className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  <span>{agent.stats.toolCount}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 卡片内容（仅当有内容时显示） */}
        <AnimatePresence>
          {(agent.currentThought || agent.currentTools.length > 0 || agent.currentResponse) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-bg-tertiary/50"
            >
              <div className="px-4 py-3 space-y-3">
                {/* 思考内容 */}
                {showThinking && agent.currentThought && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-purple-400">
                      <Brain className="w-3.5 h-3.5" />
                      <span className="font-medium">{t('agent.work_card.thinking_title')}</span>
                    </div>
                    <div className="text-xs text-text-secondary bg-bg-tertiary/30 rounded px-2.5 py-2 leading-relaxed max-h-28 overflow-y-auto">
                      {agent.currentThought}
                    </div>
                  </div>
                )}

                {/* 工具执行 */}
                {agent.currentTools.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-blue-400">
                      <Wrench className="w-3.5 h-3.5" />
                      <span className="font-medium">{t('agent.work_card.tools_title')}</span>
                    </div>
                    <div className="space-y-1.5">
                      {agent.currentTools.map((tool) => (
                        <div
                          key={tool.id}
                          className="flex items-center gap-2 text-xs bg-bg-tertiary/30 rounded px-2.5 py-1.5"
                        >
                          <Loader2 className="w-3 h-3 text-blue-400 animate-spin flex-shrink-0" />
                          <span className="flex-1 truncate text-text-secondary">{tool.name}</span>
                          {tool.duration && (
                            <span className="text-[10px] text-text-tertiary flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {tool.duration}ms
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 回复内容（精简显示） */}
                {agent.currentResponse && !agent.currentThought && agent.currentTools.length === 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-orange-400">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span className="font-medium">{t('agent.work_card.responding_title')}</span>
                    </div>
                    <div className="text-xs text-text-secondary bg-bg-tertiary/30 rounded px-2.5 py-2 leading-relaxed line-clamp-3">
                      {agent.currentResponse}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SubAgent 列表 */}
        <AnimatePresence>
          {hasSubAgents && isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-bg-tertiary/50 px-4 py-3"
            >
              <div className="space-y-2">
                {agent.subAgents.map((subAgent) => (
                  <AgentWorkCard
                    key={subAgent.id}
                    agent={subAgent}
                    level={level + 1}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
