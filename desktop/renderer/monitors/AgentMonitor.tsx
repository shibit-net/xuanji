// ============================================================
// Xuanji Desktop - Agent 监控组件
// ============================================================
// 职责：
// - 展示 Agent 当前运行状态
// - 显示当前思考内容
// - 显示当前执行的工具
// - 显示执行迭代次数
// - 数据来源：runtimeStore.agentStatus
// ============================================================

import React from 'react';
import { Activity, Loader, CheckCircle, XCircle, Clock, Play } from 'lucide-react';
import { useRuntimeStore } from '../stores';

export default function AgentMonitor() {
  const agentStatus = useRuntimeStore((state) => state.agentStatus);
  const currentIteration = useRuntimeStore((state) => state.currentIteration);
  const isProcessing = useRuntimeStore((state) => state.isProcessing);

  if (!agentStatus && !isProcessing) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-2">🤖 Agent 监控</div>
        <div className="p-3 bg-bg-primary rounded-lg text-sm text-text-secondary text-center">
          Agent 空闲中
        </div>
      </div>
    );
  }

  const getStatusIcon = () => {
    if (!agentStatus) return <Activity size={16} className="text-text-secondary" />;

    switch (agentStatus.status) {
      case 'thinking':
        return <Loader size={16} className="text-blue-500 animate-spin" />;
      case 'executing':
        return <Play size={16} className="text-green-500" />;
      case 'waiting':
        return <Clock size={16} className="text-yellow-500" />;
      case 'done':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'error':
        return <XCircle size={16} className="text-error" />;
      default:
        return <Activity size={16} className="text-text-secondary" />;
    }
  };

  const getStatusLabel = () => {
    if (!agentStatus) return '运行中';

    switch (agentStatus.status) {
      case 'thinking':
        return '思考中';
      case 'executing':
        return '执行中';
      case 'waiting':
        return '等待中';
      case 'done':
        return '已完成';
      case 'error':
        return '错误';
      default:
        return '空闲';
    }
  };

  const getStatusColor = () => {
    if (!agentStatus) return 'text-text-secondary';

    switch (agentStatus.status) {
      case 'thinking':
        return 'text-blue-500';
      case 'executing':
        return 'text-green-500';
      case 'waiting':
        return 'text-yellow-500';
      case 'done':
        return 'text-green-500';
      case 'error':
        return 'text-error';
      default:
        return 'text-text-secondary';
    }
  };

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="text-sm font-semibold mb-2">🤖 Agent 监控</div>

      {/* Agent 信息 */}
      {agentStatus && (
        <div className="p-3 bg-bg-primary rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Agent</span>
            <span className="text-sm font-medium">{agentStatus.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">状态</span>
            <div className="flex items-center gap-1.5">
              {getStatusIcon()}
              <span className={`text-sm font-medium ${getStatusColor()}`}>
                {getStatusLabel()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 迭代次数 */}
      <div className="p-3 bg-bg-primary rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">执行轮次</span>
          <span className="text-sm font-mono font-medium">{currentIteration}</span>
        </div>
      </div>

      {/* 当前思考 */}
      {agentStatus?.currentThought && (
        <div className="p-3 bg-bg-primary rounded-lg space-y-2">
          <div className="text-xs text-text-secondary">当前思考</div>
          <div className="text-sm text-text-primary leading-relaxed">
            {agentStatus.currentThought}
          </div>
        </div>
      )}

      {/* 当前工具 */}
      {agentStatus?.currentTool && (
        <div className="p-3 bg-bg-primary rounded-lg space-y-2">
          <div className="text-xs text-text-secondary">当前工具</div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono font-medium">{agentStatus.currentTool.name}</span>
            <div className="flex items-center gap-1.5">
              {agentStatus.currentTool.status === 'running' && (
                <>
                  <Loader size={12} className="text-blue-500 animate-spin" />
                  <span className="text-xs text-blue-500">执行中</span>
                </>
              )}
              {agentStatus.currentTool.status === 'success' && (
                <>
                  <CheckCircle size={12} className="text-green-500" />
                  <span className="text-xs text-green-500">成功</span>
                  {agentStatus.currentTool.duration && (
                    <span className="text-xs text-text-secondary ml-1">
                      ({agentStatus.currentTool.duration}ms)
                    </span>
                  )}
                </>
              )}
              {agentStatus.currentTool.status === 'error' && (
                <>
                  <XCircle size={12} className="text-error" />
                  <span className="text-xs text-error">失败</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
