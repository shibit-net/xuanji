// ============================================================
// AgentExecutionPanel - Agent 执行面板组件
// ============================================================
// 职责：
// - 展示多 agent 场景的执行状态
// - 可视化 agent 之间的执行流程
// - 显示 agent 的状态和执行进度
// ============================================================

import React from 'react';
import ExecutionFlow from './ExecutionFlow';
import AgentStatusList from './AgentStatusList';
import { Button } from '@/components/ui/button';

const AgentExecutionPanel: React.FC = () => {
  return (
    <div className="h-full min-h-[200px] flex flex-col">
      {/* 面板标题和控制按钮 */}
      <div className="px-6 py-3 border-b border-border-secondary flex justify-between items-center">
        <h2 className="text-lg font-semibold text-text-primary">Agent 执行面板</h2>
        <div className="flex gap-2">
          <Button variant="default" size="sm">
            开始
          </Button>
          <Button variant="secondary" size="sm">
            暂停
          </Button>
          <Button variant="secondary" size="sm">
            停止
          </Button>
        </div>
      </div>

      {/* 执行流程图 */}
      <div className="flex-1 p-4 overflow-auto">
        <ExecutionFlow />
      </div>

      {/* Agent 状态列表 */}
      <div className="h-[120px] border-t border-border-secondary overflow-auto">
        <AgentStatusList />
      </div>
    </div>
  );
};

export default AgentExecutionPanel;
