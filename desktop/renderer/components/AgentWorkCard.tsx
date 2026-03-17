// ============================================================
// Xuanji Desktop - Agent 工作卡片（重设计）
// ============================================================
// 现代化的 Agent 状态卡片，专注展示当前工作内容
// - 紧凑的状态指示器
// - 清晰的任务进度展示
// - SubAgent 嵌套布局
// ============================================================

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Wrench, Sparkles, CheckCircle, ChevronDown, ChevronRight,
  Loader2, Zap, Clock
} from 'lucide-react';
import type { AgentState } from '../stores';

interface AgentWorkCardProps {
  agent: AgentState;
  level: number;
  isRoot?: boolean;
}

export function AgentWorkCard({ agent, level, isRoot = false }: AgentWorkCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const getStatusConfig = () => {
    switch (agent.status) {
      case 'thinking':
        return {
          icon: Brain,
          label: '思考中',
          color: 'text-purple-400',
          bg: 'bg-purple-500/10',
          border: 'border-purple-500/30',
          glow: 'shadow-purple-500/20',
        };
      case 'executing':
        return {
          icon: Wrench,
          label: '执行工具',
          color: 'text-blue-400',
          bg: 'bg-blue-500/10',
          border: 'border-blue-500/30',
          glow: 'shadow-blue-500/20',
        };
      case 'responding':
        return {
          icon: Sparkles,
          label: '生成回复',
          color: 'text-orange-400',
          bg: 'bg-orange-500/10',
          border: 'border-orange-500/30',
          glow: 'shadow-orange-500/20',
        };
      case 'done':
        return {
          icon: CheckCircle,
          label: '已完成',
          color: 'text-green-400',
          bg: 'bg-green-500/10',
          border: 'border-green-500/30',
          glow: 'shadow-green-500/20',
        };
      default:
        return {
          icon: Loader2,
          label: '待命',
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
                {!isRoot && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-tertiary/80 text-text-tertiary rounded">
                    L{level}
                  </span>
                )}
              </div>
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
                {agent.currentThought && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-purple-400">
                      <Brain className="w-3.5 h-3.5" />
                      <span className="font-medium">思考</span>
                    </div>
                    <div className="text-xs text-text-secondary bg-bg-tertiary/30 rounded px-2.5 py-2 leading-relaxed">
                      {agent.currentThought}
                    </div>
                  </div>
                )}

                {/* 工具执行 */}
                {agent.currentTools.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-blue-400">
                      <Wrench className="w-3.5 h-3.5" />
                      <span className="font-medium">执行中的工具</span>
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
                      <span className="font-medium">正在回复</span>
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
