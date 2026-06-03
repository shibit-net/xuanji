// ============================================================
// AgentStatusList - Agent 状态列表组件
// ============================================================
// 职责：
// - 以列表形式展示 agent 的状态
// - 显示 agent 的基本信息和执行进度
// - 支持点击查看 agent 详情
// ============================================================

import React, { useMemo } from 'react';
import { t } from '@/i18n';
import { useAgentStateMachine, type AgentState as NewAgentState } from '../stores/AgentStateMachine';

// 定义 Agent 状态类型
interface AgentStatus {
  id: string;
  name: string;
  type: string;
  status: 'idle' | 'thinking' | 'executing' | 'completed' | 'error';
  progress: number;
  tool?: string;
  startTime: string;
  duration: string;
  parentId?: string;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'thinking': return 'bg-indigo-500';
    case 'executing': return 'bg-emerald-500';
    case 'completed': return 'bg-teal-500';
    case 'error': return 'bg-red-500';
    default: return 'bg-slate-500';
  }
}

function getStatusText(status: string) {
  switch (status) {
    case 'thinking': return t('agent.status_list.status.thinking');
    case 'executing': return t('agent.status_list.status.executing');
    case 'completed': return t('agent.status_list.status.completed');
    case 'error': return t('agent.status_list.status.error');
    default: return t('agent.status_list.status.idle');
  }
}

const AgentStatusList: React.FC = React.memo(() => {
  const newAgentMap = useAgentStateMachine((s) => s.agentMap);

  // 从扁平 agentMap 生成 agent 列表
  const agents = useMemo(() => {
    const agentList: AgentStatus[] = [];

    const activeAgents = Object.values(newAgentMap).filter(a => a.status !== 'cleared');
    for (const a of activeAgents) {
      const startTime = a.moment?.startTime || a.createdAt || Date.now();
      const duration = Math.floor((Date.now() - startTime) / 1000);
      const durationStr = `${Math.floor(duration / 60).toString().padStart(2, '0')}:${(duration % 60).toString().padStart(2, '0')}`;
      const currentTool = a.currentTools.length > 0 ? a.currentTools[0].name : undefined;

      agentList.push({
        id: a.id,
        name: a.name,
        type: a.parentId === null ? 'main' : 'sub',
        status: a.status === 'success' || a.status === 'done' ? 'completed' : a.status === 'failed' || a.status === 'cancelled' ? 'error' : a.status === 'executing' ? 'executing' : a.status === 'thinking' ? 'thinking' : 'idle',
        progress: a.status === 'success' || a.status === 'done' ? 100 : a.status === 'executing' || a.status === 'writing' ? 60 : a.status === 'thinking' ? 30 : a.status === 'failed' || a.status === 'cancelled' ? 100 : 0,
        tool: currentTool,
        startTime: new Date(startTime).toLocaleTimeString(),
        duration: durationStr,
        parentId: a.parentId || undefined,
      });
    }

    if (agentList.length === 0) {
      return [
        {
          id: '1',
          name: t('agent.status_list.name_default'),
          type: 'main',
          status: 'idle',
          progress: 0,
          startTime: new Date().toLocaleTimeString(),
          duration: '00:00',
          tool: undefined,
          parentId: undefined,
        } as AgentStatus,
      ];
    }

    return agentList;
  }, [newAgentMap]);

  return (
    <div className="w-full h-full overflow-x-auto overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="bg-card">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('agent.status_list.header.agent')}</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('agent.status_list.header.type')}</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('agent.status_list.header.status')}</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('agent.status_list.header.progress')}</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('agent.status_list.header.task')}</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('agent.status_list.header.start_time')}</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('agent.status_list.header.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.id} className="border-t border-border hover:bg-card/50 transition-colors">
              <td className="px-4 py-2 font-medium text-foreground">
                {agent.parentId ? '└─ ' : ''}{agent.name}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{agent.type === 'main' ? t('agent.status_list.type.main') : agent.type}</td>
              <td className="px-4 py-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(agent.status)} text-white`}>
                  {getStatusText(agent.status)}
                </span>
              </td>
              <td className="px-4 py-2">
                <div className="w-32 h-2 bg-card rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary rounded-full transition-all duration-300 ease-in-out" 
                    style={{ width: `${agent.progress}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground ml-2">{agent.progress}%</span>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{agent.tool || '-'}</td>
              <td className="px-4 py-2 text-muted-foreground">{agent.startTime}</td>
              <td className="px-4 py-2 text-muted-foreground">{agent.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default AgentStatusList;
