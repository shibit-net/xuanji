// ============================================================
// ContextPanel - 左侧上下文面板
// 展示 Agent 正在关注的内容：文件、记忆、活动
// ============================================================

import React, { useState, useMemo } from 'react';
import { FileText, Database, Clock, Search, X } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { useMemoryManager } from '../hooks/useMemoryManager';

interface ContextPanelProps {
  onToggle: () => void;
}

type TabId = 'files' | 'memory' | 'activity';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'files', label: '文件', icon: <FileText size={16} /> },
  { id: 'memory', label: '记忆', icon: <Database size={16} /> },
  { id: 'activity', label: '活动', icon: <Clock size={16} /> },
];

export default function ContextPanel({ onToggle }: ContextPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('files');

  return (
    <div className="w-80 bg-bg-secondary flex flex-col border-r border-bg-tertiary">
      {/* 标题 */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-2">
          <div className="text-lg">🧭</div>
          <div className="font-semibold">当前关注</div>
        </div>
        <button
          onClick={onToggle}
          className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
          title="关闭面板"
        >
          <X size={16} className="text-text-secondary" />
        </button>
      </div>

      {/* 标签页 */}
      <div className="flex border-b border-bg-tertiary">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm transition-colors ${
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

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'files' && <FilesTab />}
        {activeTab === 'memory' && <MemoryTab />}
        {activeTab === 'activity' && <ActivityTab />}
      </div>
    </div>
  );
}

// 文件标签（展示 Agent 访问过的文件）
function FilesTab() {
  const messages = useChatStore((state) => state.messages);

  // 从消息中提取文件操作
  const recentFiles = useMemo(() => {
    const fileMap = new Map<string, { count: number; lastOp: string; timestamp: number }>();

    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (['read_file', 'write_file', 'edit_file', 'multi_edit'].includes(tc.name)) {
            const path = (tc.input?.file_path || tc.input?.path) as string | undefined;
            if (path) {
              const existing = fileMap.get(path) || { count: 0, lastOp: tc.name, timestamp: 0 };
              fileMap.set(path, {
                count: existing.count + 1,
                lastOp: tc.name,
                timestamp: msg.timestamp || 0,
              });
            }
          }
        }
      }
    }

    return Array.from(fileMap.entries())
      .map(([path, info]) => ({ path, ...info }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);
  }, [messages]);

  const getFileIcon = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    const iconMap: Record<string, string> = {
      ts: '🟦', tsx: '⚛️', js: '🟨', jsx: '⚛️',
      py: '🐍', md: '📝', json: '📋', css: '🎨',
      html: '🌐', yml: '⚙️', yaml: '⚙️',
      txt: '📄', pdf: '📕', doc: '📘', docx: '📘',
      jpg: '🖼️', png: '🖼️', gif: '🖼️',
    };
    return iconMap[ext || ''] || '📄';
  };

  const getOpLabel = (op: string) => {
    const labels: Record<string, string> = {
      read_file: '读取',
      write_file: '写入',
      edit_file: '编辑',
      multi_edit: '批量编辑',
    };
    return labels[op] || op;
  };

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-text-secondary mb-2">
        Agent 最近访问的文件
      </div>

      {recentFiles.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无文件访问记录
        </div>
      ) : (
        <div className="space-y-2">
          {recentFiles.map(({ path, count, lastOp, timestamp }) => {
            const fileName = path.split('/').pop() || path;
            const dirPath = path.substring(0, path.lastIndexOf('/'));
            const timeStr = timestamp
              ? new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              : '';

            return (
              <div
                key={path}
                className="p-2.5 bg-bg-primary hover:bg-bg-tertiary rounded-lg transition-colors cursor-pointer group"
              >
                <div className="flex items-start gap-2">
                  <div className="text-lg flex-shrink-0">{getFileIcon(path)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{fileName}</div>
                    {dirPath && (
                      <div className="text-xs text-text-secondary truncate mt-0.5">{dirPath}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                      <span>{getOpLabel(lastOp)}</span>
                      <span>•</span>
                      <span>{count} 次</span>
                      {timeStr && (
                        <>
                          <span>•</span>
                          <span>{timeStr}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 记忆标签
function MemoryTab() {
  const { entries, loading, retrieve } = useMemoryManager();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = () => {
    if (searchQuery.trim()) {
      retrieve(searchQuery);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const getTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      user_preference: '💝',
      project_fact: '📚',
      decision: '💡',
      tool_pattern: '⚡',
      error_resolution: '🔧',
    };
    return icons[type] || '💾';
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      user_preference: '偏好',
      knowledge: '知识',
      decision: '决策',
      tool_pattern: '经验',
      error_resolution: '问题',
      user_fact: '个人',
      relationship: '关系',
      important_date: '日期',
    };
    return labels[type] || type;
  };

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-text-secondary mb-2">
        Agent 记住的关于你的信息
      </div>

      {/* 搜索框 */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
        />
        <button
          onClick={handleSearch}
          disabled={!searchQuery.trim() || loading}
          className="px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Search size={14} />
        </button>
      </div>

      {/* 记忆列表 */}
      <div className="space-y-2">
        {entries.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">
            {searchQuery ? '没有找到相关记忆' : '输入关键词搜索记忆'}
          </div>
        ) : (
          entries.slice(0, 10).map((entry, index) => (
            <div
              key={index}
              className="p-2.5 bg-bg-primary hover:bg-bg-tertiary rounded-lg transition-colors"
            >
              <div className="flex items-start gap-2 mb-1.5">
                <div className="text-base">{getTypeIcon(entry.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-secondary mb-1">
                    {getTypeLabel(entry.type)}
                  </div>
                  <div className="text-sm">{entry.content}</div>
                </div>
                {entry.score !== undefined && (
                  <div className="text-xs text-primary font-semibold">
                    {(entry.score * 100).toFixed(0)}%
                  </div>
                )}
              </div>
              {entry.tags && entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {entry.tags.slice(0, 3).map((tag, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-1.5 py-0.5 bg-bg-secondary rounded text-text-secondary"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 活动标签（最近的对话）
function ActivityTab() {
  const messages = useChatStore((state) => state.messages);

  // 提取最近的对话活动（只展示用户和助手的对话，不展示工具调用）
  const recentActivities = useMemo(() => {
    const activities: Array<{
      type: 'user' | 'assistant';
      content: string;
      timestamp: number;
      icon: string;
    }> = [];

    for (const msg of messages.slice(-20)) {
      if (msg.role === 'user') {
        activities.push({
          type: 'user',
          content: typeof msg.content === 'string' ? msg.content : '用户提问',
          timestamp: msg.timestamp || 0,
          icon: '👤',
        });
      } else if (msg.role === 'assistant') {
        // 提取 assistant 回复的文本内容
        let textContent = '';
        if (typeof msg.content === 'string') {
          textContent = msg.content;
        } else if (Array.isArray(msg.content)) {
          const textBlock = (msg.content as any[]).find((block: any) => block.type === 'text');
          textContent = textBlock?.text || '';
        }

        if (textContent) {
          activities.push({
            type: 'assistant',
            content: textContent,
            timestamp: msg.timestamp || 0,
            icon: '🤖',
          });
        }
      }
    }

    return activities.reverse().slice(0, 30);
  }, [messages]);

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-text-secondary mb-2">
        最近的对话和操作
      </div>

      {recentActivities.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无活动记录
        </div>
      ) : (
        <div className="space-y-1.5">
          {recentActivities.map((activity, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 p-2 bg-bg-primary hover:bg-bg-tertiary rounded transition-colors text-sm"
            >
              <div className="flex-shrink-0 mt-0.5">{activity.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="truncate">{activity.content}</div>
                <div className="text-xs text-text-secondary mt-0.5">
                  {formatTime(activity.timestamp)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
