// ============================================================
// RightPanel - 右侧面板组件
// ============================================================

import React, { useState } from 'react';
import { Clock, Wrench, Database, FileText, X } from 'lucide-react';

interface RightPanelProps {
  onToggle: () => void;
}

type TabId = 'checkpoint' | 'tools' | 'memory' | 'logs';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'checkpoint', label: 'Checkpoint', icon: <Clock size={16} /> },
  { id: 'tools', label: '工具', icon: <Wrench size={16} /> },
  { id: 'memory', label: '记忆', icon: <Database size={16} /> },
  { id: 'logs', label: '日志', icon: <FileText size={16} /> },
];

export default function RightPanel({ onToggle }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('checkpoint');

  return (
    <div className="w-80 bg-bg-secondary flex flex-col border-l border-bg-tertiary">
      {/* 标签页 */}
      <div className="flex items-center justify-between border-b border-bg-tertiary">
        <div className="flex flex-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-bg-primary text-primary border-b-2 border-primary'
                  : 'text-text-secondary hover:bg-bg-tertiary'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onToggle}
          className="p-2 hover:bg-bg-tertiary transition-colors"
          title="关闭面板"
        >
          <X size={16} className="text-text-secondary" />
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'checkpoint' && <CheckpointTab />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'memory' && <MemoryTab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}

// Checkpoint 标签
function CheckpointTab() {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">⏱️ Checkpoint 时间线</div>

      <div className="space-y-2">
        <div className="p-3 bg-bg-primary rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-primary rounded-full" />
            <div className="text-sm font-semibold">CP1: 初始设计</div>
          </div>
          <div className="text-xs text-text-secondary mb-2">15:00</div>
          <div className="text-xs text-text-secondary">
            📄 修改文件: auth.ts, login.ts
          </div>
          <div className="flex gap-2 mt-2">
            <button className="text-xs px-2 py-1 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors">
              查看变更
            </button>
            <button className="text-xs px-2 py-1 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors">
              回滚到此
            </button>
          </div>
        </div>
      </div>

      <button className="w-full px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm">
        + 创建 Checkpoint
      </button>
    </div>
  );
}

// 工具调用标签
function ToolsTab() {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">🛠️ 工具调用统计</div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center p-2 bg-bg-primary rounded">
          <span>📖 read_file</span>
          <span className="text-text-secondary">12 次</span>
        </div>
        <div className="flex justify-between items-center p-2 bg-bg-primary rounded">
          <span>✏️ edit_file</span>
          <span className="text-text-secondary">5 次</span>
        </div>
        <div className="flex justify-between items-center p-2 bg-bg-primary rounded">
          <span>🔍 grep</span>
          <span className="text-text-secondary">3 次</span>
        </div>
      </div>

      <div className="text-sm font-semibold mt-4 mb-2">⏱️ 最近调用</div>
      <div className="space-y-1 text-xs text-text-secondary">
        <div>• 15:45 read_file(auth.ts) 0.3s</div>
        <div>• 15:44 edit_file(api.ts) 0.5s</div>
      </div>
    </div>
  );
}

// 记忆库标签
function MemoryTab() {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">💾 记忆库</div>

      <input
        type="text"
        placeholder="搜索记忆..."
        className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
      />

      <div className="space-y-2">
        <div className="text-xs font-semibold text-text-secondary">📂 偏好 (23 条)</div>
        <div className="pl-2 space-y-1 text-sm">
          <div className="p-2 bg-bg-primary rounded hover:bg-bg-tertiary cursor-pointer transition-colors">
            代码风格偏好
          </div>
          <div className="p-2 bg-bg-primary rounded hover:bg-bg-tertiary cursor-pointer transition-colors">
            命名规范
          </div>
        </div>

        <div className="text-xs font-semibold text-text-secondary mt-3">📂 项目知识 (87 条)</div>
        <div className="pl-2 space-y-1 text-sm">
          <div className="p-2 bg-bg-primary rounded hover:bg-bg-tertiary cursor-pointer transition-colors">
            数据库 Schema
          </div>
        </div>
      </div>

      <button className="w-full px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm">
        + 添加记忆
      </button>
    </div>
  );
}

// 日志流标签
function LogsTab() {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">📋 日志流</div>

      <div className="flex gap-2 text-xs">
        <button className="px-2 py-1 bg-primary text-white rounded">全部</button>
        <button className="px-2 py-1 bg-bg-primary rounded hover:bg-bg-tertiary">错误</button>
        <button className="px-2 py-1 bg-bg-primary rounded hover:bg-bg-tertiary">Hook</button>
      </div>

      <div className="space-y-1 text-xs font-mono">
        <div className="p-2 bg-bg-primary rounded">
          <span className="text-text-secondary">15:45:12</span>{' '}
          <span className="text-success">INFO</span>{' '}
          <span>向量检索耗时 23ms</span>
        </div>
        <div className="p-2 bg-bg-primary rounded">
          <span className="text-text-secondary">15:45:10</span>{' '}
          <span className="text-primary">DEBUG</span>{' '}
          <span>意图路由: code</span>
        </div>
        <div className="p-2 bg-bg-primary rounded">
          <span className="text-text-secondary">15:45:08</span>{' '}
          <span className="text-warning">WARN</span>{' '}
          <span>慢 Hook: lint (1.2s)</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="text-xs px-2 py-1 bg-bg-primary rounded hover:bg-bg-tertiary">
          清空
        </button>
        <button className="text-xs px-2 py-1 bg-bg-primary rounded hover:bg-bg-tertiary">
          导出
        </button>
      </div>
    </div>
  );
}
