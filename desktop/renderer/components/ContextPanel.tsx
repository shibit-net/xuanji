// ============================================================
// ContextPanel - 左侧上下文面板
// 展示 Agent 正在关注的内容：文件、记忆、活动
// ============================================================

import React, { useState, useMemo } from 'react';
import { FileText, Clock, X } from 'lucide-react';
import { useMessageStore } from '../stores/messageStore';

interface ContextPanelProps {
  onToggle: () => void;
}

type TabId = 'files' | 'activity';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'files', label: '文件', icon: <FileText size={16} /> },
  { id: 'activity', label: '活动', icon: <Clock size={16} /> },
];

export default function ContextPanel({ onToggle }: ContextPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('files');

  return (
    <div className="w-80 bg-card flex flex-col border-r border-border">
      {/* 标题 */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="text-lg">🧭</div>
          <div className="font-semibold">当前关注</div>
        </div>
        <button
          onClick={onToggle}
          className="p-1.5 hover:bg-muted rounded transition-colors"
          title="关闭面板"
        >
          <X size={16} className="text-muted-foreground" />
        </button>
      </div>

      {/* 标签页 */}
      <div className="flex-shrink-0 flex border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-background text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'files' && <FilesTab />}
        {activeTab === 'activity' && <ActivityTab />}
      </div>
    </div>
  );
}

// 文件标签（展示 Agent 访问过的文件）
function FilesTab() {
  const messages = useMessageStore((state) => state.messages);

  // 从消息中提取文件操作
  const recentFiles = useMemo(() => {
    const fileMap = new Map<string, { count: number; lastOp: string; timestamp: number }>();

    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (['read_file', 'write_file', 'edit_file', 'multi_edit'].includes(tc.name)) {
            const path = (tc.input?.file_path || tc.input?.path) as string | undefined;
            if (path) {
              const existing = fileMap.get(path);
              if (existing) {
                existing.count++;
                if (msg.timestamp) existing.timestamp = Math.max(existing.timestamp, msg.timestamp);
              } else {
                fileMap.set(path, {
                  count: 1,
                  lastOp: tc.name,
                  timestamp: msg.timestamp || 0,
                });
              }
            }
          }
        }
      }
    }

    // 按时间倒序排序
    return Array.from(fileMap.entries())
      .sort(([, a], [, b]) => b.timestamp - a.timestamp);
  }, [messages]);

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return new Date(timestamp).toLocaleDateString('zh-CN');
  };

  const operationLabels: Record<string, string> = {
    read_file: '读取',
    write_file: '写入',
    edit_file: '编辑',
    multi_edit: '批量编辑',
  };

  if (recentFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        <p>暂无文件记录</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">最近文件</div>
      {recentFiles.map(([path, info]) => (
        <div key={path} className="p-2 bg-muted rounded text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-foreground truncate">{path.split('/').pop()}</div>
              <div className="text-muted-foreground truncate mt-0.5">{path}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-muted-foreground">
            <span>{operationLabels[info.lastOp] || info.lastOp}</span>
            <span>·</span>
            <span>{info.count} 次</span>
            <span className="ml-auto">{formatTime(info.timestamp)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// 活动标签（实时展示 Agent 状态变化）
function ActivityTab() {
  const messages = useMessageStore((state) => state.messages);

  // 提取消息中的工具调用作为活动记录
  const activities = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'tool' | 'thinking' | 'response' | 'error';
      content: string;
      timestamp: number;
    }> = [];

    for (const msg of messages) {
      if (msg.role === 'assistant') {
        if (msg.content?.trim()) {
          items.push({
            id: msg.id + '-response',
            type: 'response',
            content: msg.content.substring(0, 100),
            timestamp: msg.timestamp ?? Date.now(),
          });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            const type = tc.status === 'error' ? 'error' : 'tool';
            items.push({
              id: tc.id,
              type,
              content: `${tc.name}(${tc.status})`,
              timestamp: msg.timestamp ?? Date.now(),
            });
          }
        }
      }
    }

    return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
  }, [messages]);

  const typeIcons: Record<string, string> = {
    tool: '🛠️',
    thinking: '🧠',
    response: '💬',
    error: '❌',
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (activities.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        <p>暂无活动记录</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-1">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-start gap-2 p-2 rounded text-xs hover:bg-muted transition-colors">
          <span className="flex-shrink-0">{typeIcons[activity.type] || '📋'}</span>
          <div className="flex-1 min-w-0">
            <div className="truncate text-foreground">{activity.content}</div>
          </div>
          <span className="text-muted-foreground flex-shrink-0">{formatTime(activity.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
