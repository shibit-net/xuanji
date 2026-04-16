// ============================================================
// Xuanji Desktop - Inspector Panel 组件
// ============================================================
// 职责：
// - 右侧监控面板容器
// - 包含多个监控 Tab（Agent / Tool / Context / Memory / Logs）
// - 支持折叠/展开
// - 所有内容只读展示，不可编辑
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, BarChart3, FileCode, Database, FileText, Activity } from 'lucide-react';
import { ToolMonitor, ContextView, MemoryView, LogsView } from '../monitors';
import ActiveAgentView from '../components/ActiveAgentView';
import { useHistoryStore } from '../stores';

interface InspectorPanelProps {
  activeTab?: string;
  onToggle: () => void;
  onTabChange?: (tab: string) => void;
}

type TabId = 'workspace' | 'tool' | 'context' | 'memory' | 'logs';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'workspace', label: '工作区', icon: <Activity size={14} /> },
  { id: 'tool', label: '工具', icon: <BarChart3 size={14} /> },
  { id: 'context', label: '上下文', icon: <FileCode size={14} /> },
  { id: 'memory', label: '记忆', icon: <Database size={14} /> },
  { id: 'logs', label: '日志', icon: <FileText size={14} /> },
];

export default function InspectorPanel({
  activeTab: externalActiveTab,
  onToggle,
  onTabChange,
}: InspectorPanelProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<TabId>('workspace');
  const loadMemoryEntries = useHistoryStore((state) => state.loadMemoryEntries);

  // 使用外部传入的 activeTab，如果没有则使用内部状态
  const activeTab = (externalActiveTab as TabId) || internalActiveTab;

  const handleTabChange = (tab: TabId) => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };

  // 当切换到 Memory Tab 时，自动加载记忆数据
  useEffect(() => {
    if (activeTab === 'memory') {
      loadMemoryEntries();
    }
  }, [activeTab, loadMemoryEntries]);

  return (
    <div className="h-full bg-bg-secondary flex flex-col border-l border-bg-tertiary">
      {/* Tab 导航 */}
      <div className="flex items-center border-b border-bg-tertiary">
        <div className="flex flex-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'bg-bg-primary text-primary border-primary font-medium'
                  : 'text-text-secondary hover:bg-bg-tertiary border-transparent'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 关闭按钮 */}
        <button
          onClick={onToggle}
          className="p-2 hover:bg-bg-tertiary transition-colors border-l border-bg-tertiary"
          title="关闭面板"
        >
          <X size={16} className="text-text-secondary" />
        </button>
      </div>

      {/* 内容区域 */}
      {activeTab === 'workspace' ? (
        <div className="flex-1 overflow-hidden">
          <ActiveAgentView />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'tool' && <ToolMonitor />}
          {activeTab === 'context' && <ContextView />}
          {activeTab === 'memory' && <MemoryView />}
          {activeTab === 'logs' && <LogsView />}
        </div>
      )}
    </div>
  );
}
