// ============================================================
// AgentStatusList - Agent 状态列表组件
// ============================================================
// 职责：
// - 以列表形式展示 agent 的状态
// - 显示 agent 的基本信息和执行进度
// - 支持点击查看 agent 详情
// ============================================================

import React, { useMemo } from 'react';
import { useActiveAgentStore } from '../stores/activeAgentStore';

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

const AgentStatusList: React.FC = () => {
  const { mainAgent } = useActiveAgentStore();

  // 从 activeAgentStore 生成 agent 列表
  const agents = useMemo(() => {
    const agentList: AgentStatus[] = [];

    // 递归处理 agent 树
    const processAgent = (agent: any, parentId: string | null) => {
      // 计算持续时间
      const startTime = agent.startTime || Date.now() - 30000; // 模拟开始时间
      const duration = Math.floor((Date.now() - startTime) / 1000);
      const durationStr = `${Math.floor(duration / 60).toString().padStart(2, '0')}:${(duration % 60).toString().padStart(2, '0')}`;

      // 获取当前工具
      const currentTool = agent.currentTools.length > 0 ? agent.currentTools[0].name : undefined;

      // 添加 agent 到列表
      agentList.push({
        id: agent.id,
        name: agent.name,
        type: parentId === null ? 'main' : 'sub',
        status: agent.status === 'done' ? 'completed' : agent.status === 'error' ? 'error' : agent.status,
        progress: agent.status === 'completed' ? 100 : agent.status === 'executing' ? 60 : agent.status === 'thinking' ? 30 : 0,
        tool: currentTool,
        startTime: new Date(startTime).toLocaleTimeString(),
        duration: durationStr,
        parentId: parentId || undefined,
      });

      // 处理子 agent
      agent.subAgents.forEach((subAgent: any) => {
        processAgent(subAgent, agent.id);
      });
    };

    // 处理主 agent
    if (mainAgent) {
      processAgent(mainAgent, null);
    }

    // 如果没有 agent，使用默认数据
    if (agentList.length === 0) {
      return [
        {
          id: '1',
          name: '主 Agent',
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
  }, [mainAgent]);

  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'thinking':
        return 'bg-indigo-500';
      case 'executing':
        return 'bg-emerald-500';
      case 'completed':
        return 'bg-teal-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-slate-500';
    }
  };

  // 获取状态文本
  const getStatusText = (status: string) => {
    switch (status) {
      case 'thinking':
        return '思考中';
      case 'executing':
        return '执行中';
      case 'completed':
        return '已完成';
      case 'error':
        return '错误';
      default:
        return '空闲';
    }
  };

  return (
    <div className="w-full h-full overflow-x-auto overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-text-secondary">Agent</th>
            <th className="px-4 py-2 text-left font-medium text-text-secondary">类型</th>
            <th className="px-4 py-2 text-left font-medium text-text-secondary">状态</th>
            <th className="px-4 py-2 text-left font-medium text-text-secondary">进度</th>
            <th className="px-4 py-2 text-left font-medium text-text-secondary">任务</th>
            <th className="px-4 py-2 text-left font-medium text-text-secondary">开始时间</th>
            <th className="px-4 py-2 text-left font-medium text-text-secondary">持续时间</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.id} className="border-t border-border-secondary hover:bg-bg-tertiary transition-colors">
              <td className="px-4 py-2 font-medium text-text-primary">
                {agent.parentId ? '└─ ' : ''}{agent.name}
              </td>
              <td className="px-4 py-2 text-text-secondary">{agent.type}</td>
              <td className="px-4 py-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(agent.status)} text-white`}>
                  {getStatusText(agent.status)}
                </span>
              </td>
              <td className="px-4 py-2">
                <div className="w-32 h-2 bg-bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary rounded-full transition-all duration-300 ease-in-out" 
                    style={{ width: `${agent.progress}%` }}
                  />
                </div>
                <span className="text-xs text-text-secondary ml-2">{agent.progress}%</span>
              </td>
              <td className="px-4 py-2 text-text-secondary">{agent.tool || '-'}</td>
              <td className="px-4 py-2 text-text-secondary">{agent.startTime}</td>
              <td className="px-4 py-2 text-text-secondary">{agent.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AgentStatusList;
