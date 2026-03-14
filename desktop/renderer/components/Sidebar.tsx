// ============================================================
// Sidebar - 左侧边栏组件（会话列表 + 导航）
// ============================================================

import React, { useState } from 'react';
import { Search, Plus, Settings, HelpCircle, Trash2, Loader2, Bot } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { useSessionManager } from '../hooks/useSessionManager';

interface SidebarProps {
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
}

export default function Sidebar({ onToggle, onOpenSettings, onOpenAgents }: SidebarProps) {
  const reset = useChatStore((state) => state.reset);
  const { sessions, loading, resumeSession, deleteSession } = useSessionManager();
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleNewChat = () => {
    reset();
  };

  const handleResumeSession = async (sessionId: string) => {
    const result = await resumeSession(sessionId);
    if (result) {
      // 先清空当前消息（await 确保 reset 完成后再添加）
      await reset();

      // 将历史消息添加到 chatStore
      if (result.historyMessages && result.historyMessages.length > 0) {
        const { addMessage } = useChatStore.getState();
        for (const msg of result.historyMessages) {
          addMessage({
            id: `restored-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
          });
        }
      }

      // 恢复 usage 统计
      if (result.usage) {
        useChatStore.setState((state) => ({
          stats: {
            ...state.stats,
            tokenUsage: {
              input: result.usage.input ?? 0,
              output: result.usage.output ?? 0,
            },
            cost: result.usage.cost ?? 0,
          },
        }));
      }

      console.log('Session resumed:', result.sessionId, `${result.historyMessages?.length ?? 0} messages`);
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个会话吗？')) return;

    setDeletingId(sessionId);
    await deleteSession(sessionId);
    setDeletingId(null);
  };

  // 过滤会话
  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      session.name.toLowerCase().includes(query) ||
      session.preview?.toLowerCase().includes(query)
    );
  });

  // 按日期分组
  const groupedSessions = filteredSessions.reduce((groups, session) => {
    const date = new Date(session.updatedAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let label = '';
    if (date.toDateString() === today.toDateString()) {
      label = '📅 今天';
    } else if (date.toDateString() === yesterday.toDateString()) {
      label = '📅 昨天';
    } else {
      label = `📅 ${date.getMonth() + 1}月${date.getDate()}日`;
    }

    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(session);
    return groups;
  }, {} as Record<string, typeof sessions>);

  return (
    <div className="w-56 bg-bg-secondary flex flex-col border-r border-bg-tertiary">
      {/* 搜索框 */}
      <div className="p-3 border-b border-bg-tertiary">
        <div className="relative">
          <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="搜索会话..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-primary border border-bg-tertiary rounded px-8 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin text-text-secondary" />
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">
            {searchQuery ? '没有找到匹配的会话' : '暂无会话历史'}
          </div>
        ) : (
          Object.entries(groupedSessions).map(([label, groupSessions]) => (
            <div key={label} className="mb-3">
              <div className="text-xs text-text-secondary px-2 py-1 mb-1">{label}</div>
              {groupSessions.map((session) => (
                <div key={session.id} className="mb-1 relative group">
                  <button
                    onClick={() => handleResumeSession(session.id)}
                    className="w-full text-left px-3 py-2 rounded hover:bg-bg-tertiary transition-colors"
                  >
                    <div className="text-sm text-text-primary truncate pr-6">
                      {session.name}
                    </div>
                    <div className="text-xs text-text-secondary truncate">
                      {session.preview || `${session.messageCount} 条消息`}
                    </div>
                  </button>
                  <button
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    disabled={deletingId === session.id}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all disabled:opacity-50"
                    title="删除会话"
                  >
                    {deletingId === session.id ? (
                      <Loader2 size={14} className="animate-spin text-red-500" />
                    ) : (
                      <Trash2 size={14} className="text-red-500" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* 底部快捷入口 */}
      <div className="border-t border-bg-tertiary p-2 space-y-1">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Plus size={16} className="text-primary" />
          <span>新建会话</span>
        </button>

        <button
          onClick={onOpenAgents}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Bot size={16} className="text-text-secondary" />
          <span>Agent 管理</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Settings size={16} className="text-text-secondary" />
          <span>设置</span>
        </button>

        <button
          onClick={() => window.open('https://github.com/shibit/xuanji', '_blank')}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <HelpCircle size={16} className="text-text-secondary" />
          <span>帮助</span>
        </button>
      </div>
    </div>
  );
}
