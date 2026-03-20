// ============================================================
// RightPanel - 右侧面板组件
// ============================================================

import React, { useState, useMemo } from 'react';
import { Clock, Wrench, Database, FileText, X, Plus, RotateCcw, Loader2, Search, Activity } from 'lucide-react';
import { useCheckpointManager } from '../hooks/useCheckpointManager';
import { useMemoryManager } from '../hooks/useMemoryManager';
import { useChatStore } from '../stores/chatStore';
import WorkspaceMonitor from './WorkspaceMonitor';

interface RightPanelProps {
  onToggle: () => void;
  width: number;
  onResize: (width: number) => void;
}

type TabId = 'workspace' | 'checkpoint' | 'tools' | 'memory' | 'logs';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'workspace', label: '监控', icon: <Activity size={16} /> },
  { id: 'checkpoint', label: 'Checkpoint', icon: <Clock size={16} /> },
  { id: 'tools', label: '工具', icon: <Wrench size={16} /> },
  { id: 'memory', label: '记忆', icon: <Database size={16} /> },
  { id: 'logs', label: '日志', icon: <FileText size={16} /> },
];

export default function RightPanel({ onToggle, width, onResize }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('workspace');
  const [isResizing, setIsResizing] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(width);

  // 处理拖拽开始
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    setStartX(e.clientX);
    setStartWidth(width);
    e.preventDefault();
  };

  // 处理拖拽中和拖拽结束
  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(280, Math.min(600, startWidth + delta));
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, startX, startWidth, onResize]);

  return (
    <div className="bg-bg-secondary flex flex-col border-l border-bg-tertiary relative" style={{ width: `${width}px` }}>
      {/* 拖拽手柄 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary transition-colors z-10"
        onMouseDown={handleMouseDown}
        style={{ userSelect: 'none' }}
      />

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
      <div className="flex-1 overflow-hidden">
        {activeTab === 'workspace' && <WorkspaceTab />}
        {activeTab === 'checkpoint' && <CheckpointTab />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'memory' && <MemoryTab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}

// Workspace 监控标签
function WorkspaceTab() {
  return (
    <div className="h-full w-full">
      <WorkspaceMonitor />
    </div>
  );
}

// Checkpoint 标签
function CheckpointTab() {
  const { checkpoints, loading, createCheckpoint, rewindToCheckpoint } = useCheckpointManager();
  const [creating, setCreating] = useState(false);
  const [rewinding, setRewinding] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [showLabelInput, setShowLabelInput] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    const label = labelInput.trim() || undefined;
    await createCheckpoint(label);
    setCreating(false);
    setLabelInput('');
    setShowLabelInput(false);
  };

  const handleRewind = async (checkpointId: string) => {
    if (!confirm('确定要回滚到此 checkpoint 吗？这将丢弃之后的所有消息。')) return;

    setRewinding(checkpointId);
    const messageCount = await rewindToCheckpoint(checkpointId);
    setRewinding(null);

    if (messageCount !== null) {
      alert(`已回滚到 checkpoint，当前消息数：${messageCount}`);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return '今天';
    }
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">⏱️ Checkpoint 时间线</div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={20} className="animate-spin text-text-secondary" />
        </div>
      ) : checkpoints.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无 checkpoint
        </div>
      ) : (
        <div className="space-y-2">
          {checkpoints.map((cp) => (
            <div key={cp.id} className="p-3 bg-bg-primary rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                <div className="text-sm font-semibold truncate">
                  {cp.label || `Checkpoint ${cp.id.slice(0, 8)}`}
                </div>
              </div>
              <div className="text-xs text-text-secondary mb-1">
                {formatDate(cp.createdAt)} {formatTime(cp.createdAt)}
              </div>
              <div className="text-xs text-text-secondary mb-2">
                📄 消息数: {cp.messageCount} (索引: {cp.messageIndex})
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleRewind(cp.id)}
                  disabled={rewinding === cp.id}
                  className="flex items-center gap-1 text-xs px-2 py-1 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors disabled:opacity-50"
                >
                  {rewinding === cp.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RotateCcw size={12} />
                  )}
                  <span>回滚到此</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建 Checkpoint */}
      {showLabelInput ? (
        <div className="space-y-2">
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="输入 checkpoint 标签（可选）"
            className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowLabelInput(false)}
              disabled={creating}
              className="flex-1 px-3 py-2 bg-bg-tertiary text-sm rounded hover:bg-bg-primary transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm disabled:opacity-50"
            >
              {creating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={16} />
              )}
              <span>创建</span>
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowLabelInput(true)}
          disabled={creating}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm disabled:opacity-50"
        >
          <Plus size={16} />
          <span>创建 Checkpoint</span>
        </button>
      )}
      </div>
    </div>
  );
}

// 工具调用标签（从 chatStore 的流式事件实时统计）
function ToolsTab() {
  const messages = useChatStore((state) => state.messages);

  // 从消息的 toolCalls 中实时统计工具使用
  const { toolStats, recentCalls } = useMemo(() => {
    const counts: Record<string, { total: number; success: number; error: number }> = {};
    const recent: Array<{ name: string; status: string; timestamp: number }> = [];

    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (!counts[tc.name]) {
            counts[tc.name] = { total: 0, success: 0, error: 0 };
          }
          counts[tc.name].total++;
          if (tc.status === 'success') counts[tc.name].success++;
          if (tc.status === 'error') counts[tc.name].error++;
          recent.push({ name: tc.name, status: tc.status, timestamp: msg.timestamp || 0 });
        }
      }
    }

    // 按调用次数排序
    const sorted = Object.entries(counts)
      .sort(([, a], [, b]) => b.total - a.total);

    return {
      toolStats: sorted,
      recentCalls: recent.slice(-10).reverse(),
    };
  }, [messages]);

  const toolIcons: Record<string, string> = {
    read_file: '📖', write_file: '📝', edit_file: '✏️', multi_edit: '📋',
    bash: '💻', glob: '🔎', grep: '🔍', ls: '📂',
    web_fetch: '🌐', plan_review: '📋', ask_user: '❓',
    todo_create: '✅', todo_list: '📋', todo_update: '🔄',
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">🛠️ 工具调用统计</div>

      {toolStats.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无工具调用记录
        </div>
      ) : (
        <>
          <div className="space-y-2 text-sm">
            {toolStats.map(([name, stat]) => (
              <div key={name} className="flex justify-between items-center p-2 bg-bg-primary rounded">
                <span>{toolIcons[name] || '🔧'} {name}</span>
                <div className="flex items-center gap-2">
                  {stat.error > 0 && (
                    <span className="text-xs text-red-500">{stat.error} 错误</span>
                  )}
                  <span className="text-text-secondary">{stat.total} 次</span>
                </div>
              </div>
            ))}
          </div>

          {recentCalls.length > 0 && (
            <>
              <div className="text-sm font-semibold mt-4 mb-2">⏱️ 最近调用</div>
              <div className="space-y-1 text-xs text-text-secondary">
                {recentCalls.map((call, idx) => {
                  const time = call.timestamp
                    ? new Date(call.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                    : '--:--';
                  const statusIcon = call.status === 'success' ? '✓' : call.status === 'error' ? '✗' : '…';
                  const statusColor = call.status === 'success' ? 'text-green-500' : call.status === 'error' ? 'text-red-500' : 'text-yellow-500';
                  return (
                    <div key={idx}>
                      <span>{time}</span>{' '}
                      <span className={statusColor}>{statusIcon}</span>{' '}
                      <span>{call.name}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// 记忆库标签
function MemoryTab() {
  const { entries, stats, loading, error, retrieve } = useMemoryManager();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      retrieve(searchQuery, selectedType ? { type: selectedType } : undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const memoryTypes = [
    { value: 'user_preference', label: '👤 偏好', icon: '👤' },
    { value: 'project_fact', label: '📂 项目知识', icon: '📂' },
    { value: 'decision', label: '💡 决策', icon: '💡' },
    { value: 'tool_pattern', label: '🛠️ 工具模式', icon: '🛠️' },
    { value: 'error_resolution', label: '🔧 错误解决', icon: '🔧' },
  ];

  return (
    <div className="h-full overflow-y-auto p-4">
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">💾 记忆库</div>

      {/* 统计信息 */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 bg-bg-primary rounded">
            <div className="text-text-secondary">总数</div>
            <div className="text-lg font-semibold">{stats.total || 0}</div>
          </div>
          {stats.byType && Object.entries(stats.byType).length > 0 && (
            <div className="p-2 bg-bg-primary rounded">
              <div className="text-text-secondary">类型</div>
              <div className="text-lg font-semibold">{Object.keys(stats.byType).length}</div>
            </div>
          )}
        </div>
      )}

      {/* 搜索框 */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-bg-primary border border-bg-tertiary rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
        />
        <button
          onClick={handleSearch}
          disabled={!searchQuery.trim() || loading}
          className="px-3 py-1.5 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </button>
      </div>

      {/* 类型筛选 */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedType(null)}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            selectedType === null ? 'bg-primary text-white' : 'bg-bg-primary hover:bg-bg-tertiary'
          }`}
        >
          全部
        </button>
        {memoryTypes.map((type) => (
          <button
            key={type.value}
            onClick={() => setSelectedType(type.value)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              selectedType === type.value ? 'bg-primary text-white' : 'bg-bg-primary hover:bg-bg-tertiary'
            }`}
          >
            {type.icon}
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="text-xs text-red-500 p-2 bg-red-500/10 rounded border border-red-500/30">
          {error}
        </div>
      )}

      {/* 记忆列表 */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">
            {searchQuery ? '没有找到匹配的记忆' : '输入关键词搜索记忆'}
          </div>
        ) : (
          entries.map((entry, index) => (
            <div key={index} className="p-2 bg-bg-primary rounded hover:bg-bg-tertiary transition-colors text-sm">
              <div className="flex items-start justify-between mb-1">
                <span className="text-xs text-text-secondary">{entry.type}</span>
                {entry.score !== undefined && (
                  <span className="text-xs text-primary">{(entry.score * 100).toFixed(0)}%</span>
                )}
              </div>
              <div className="text-sm">{entry.content}</div>
              {entry.tags && entry.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.tags.map((tag, idx) => (
                    <span key={idx} className="text-xs px-1 py-0.5 bg-bg-secondary rounded">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              {entry.createdAt && (
                <div className="text-xs text-text-secondary mt-1">
                  {new Date(entry.createdAt).toLocaleString('zh-CN')}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
    </div>
  );
}

// 日志流标签（从 chatStore 读取真实日志）
function LogsTab() {
  const logs = useChatStore((state) => state.logs);
  const clearLogs = useChatStore((state) => state.clearLogs);
  const [filter, setFilter] = useState<string | null>(null);

  const filteredLogs = filter
    ? logs.filter((log) => log.level === filter)
    : logs;

  const levelColors: Record<string, string> = {
    error: 'text-red-500',
    warn: 'text-yellow-500',
    info: 'text-green-500',
    debug: 'text-primary',
    tool: 'text-blue-400',
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">📋 日志流</div>

      <div className="flex gap-2 text-xs">
        {[
          { value: null, label: '全部' },
          { value: 'error', label: '错误' },
          { value: 'warn', label: '警告' },
          { value: 'info', label: '信息' },
          { value: 'tool', label: '工具' },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => setFilter(item.value)}
            className={`px-2 py-1 rounded transition-colors ${
              filter === item.value
                ? 'bg-primary text-white'
                : 'bg-bg-primary hover:bg-bg-tertiary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {filteredLogs.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无日志记录
        </div>
      ) : (
        <div className="space-y-1 text-xs font-mono max-h-96 overflow-y-auto">
          {filteredLogs.slice().reverse().map((log, idx) => (
            <div key={idx} className="p-2 bg-bg-primary rounded">
              <span className="text-text-secondary">{formatTime(log.timestamp)}</span>{' '}
              <span className={levelColors[log.level] || 'text-text-secondary'}>
                {log.level.toUpperCase()}
              </span>{' '}
              <span>{log.message}</span>
            </div>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={clearLogs}
            className="text-xs px-2 py-1 bg-bg-primary rounded hover:bg-bg-tertiary transition-colors"
          >
            清空
          </button>
        </div>
      )}
    </div>
  );
}
