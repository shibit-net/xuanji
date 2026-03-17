// ============================================================
// Xuanji Desktop - AgentLibrary 组件
// ============================================================
// 职责：
// - Agent 库视图（配置域）
// - 展示所有 Agents（内置 + 自定义）
// - 支持查看、编辑、创建、删除
// - 使用 configStore 管理数据
// ============================================================

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Plus,
  X,
  Bot,
  Eye,
  EyeOff,
  Edit2,
  Trash2,
  Copy,
  RefreshCw,
  Filter,
  ChevronDown,
} from 'lucide-react';
import { useConfigStore } from '../stores';
import type { AgentProfile } from '../types/models';
import AgentDetail from '../components/AgentDetail';
import AgentEditor from '../components/AgentEditor';

interface AgentLibraryProps {
  onClose: () => void;
}

type ViewMode = 'list' | 'detail' | 'editor';
type FilterSource = 'all' | 'builtin' | 'global' | 'project';
type FilterStatus = 'all' | 'enabled' | 'disabled';
type SortBy = 'name' | 'created' | 'source';

export default function AgentLibrary({ onClose }: AgentLibraryProps) {
  // ========== Store 数据 ==========
  const { agents, loading, error, loadAgents, createAgent, updateAgent, deleteAgent } =
    useConfigStore();

  // ========== 本地状态 ==========
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedAgent, setSelectedAgent] = useState<AgentProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [showFilters, setShowFilters] = useState(false);

  // ========== 初始化加载 ==========
  useEffect(() => {
    loadAgents();
  }, []);

  // ========== 过滤和排序 ==========
  const filteredAndSortedAgents = useMemo(() => {
    let result = [...agents];

    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (agent) =>
          agent.id?.toLowerCase().includes(query) ||
          agent.name?.toLowerCase().includes(query) ||
          agent.description?.toLowerCase().includes(query) ||
          agent.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    // 来源过滤
    if (filterSource !== 'all') {
      result = result.filter((agent) => agent.metadata?.source === filterSource);
    }

    // 状态过滤
    if (filterStatus === 'enabled') {
      result = result.filter((agent) => agent.enabled !== false);
    } else if (filterStatus === 'disabled') {
      result = result.filter((agent) => agent.enabled === false);
    }

    // 排序
    result.sort((a, b) => {
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      } else if (sortBy === 'created') {
        return (b.metadata?.createdAt || '').localeCompare(a.metadata?.createdAt || '');
      } else if (sortBy === 'source') {
        const sourceOrder = { builtin: 0, global: 1, project: 2 };
        const aOrder = sourceOrder[a.metadata?.source as keyof typeof sourceOrder] ?? 99;
        const bOrder = sourceOrder[b.metadata?.source as keyof typeof sourceOrder] ?? 99;
        return aOrder - bOrder;
      }
      return 0;
    });

    return result;
  }, [agents, searchQuery, filterSource, filterStatus, sortBy]);

  // ========== 分组 ==========
  const groupedAgents = useMemo(() => {
    const groups: Record<string, AgentProfile[]> = {};
    for (const agent of filteredAndSortedAgents) {
      const source = agent.metadata?.source || 'unknown';
      if (!groups[source]) {
        groups[source] = [];
      }
      groups[source].push(agent);
    }
    return groups;
  }, [filteredAndSortedAgents]);

  // ========== 事件处理 ==========
  const handleSelectAgent = (agent: AgentProfile) => {
    setSelectedAgent(agent);
    setViewMode('detail');
  };

  const handleCreateAgent = () => {
    setSelectedAgent(null);
    setViewMode('editor');
  };

  const handleEditAgent = () => {
    if (selectedAgent) {
      setViewMode('editor');
    }
  };

  const handleSaveAgent = async (config: Partial<AgentProfile>) => {
    try {
      if (selectedAgent) {
        await updateAgent(selectedAgent.id, config);
      } else {
        await createAgent(config);
      }
      await loadAgents(); // 重新加载
      setViewMode('list');
    } catch (err) {
      console.error('Save agent failed:', err);
    }
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    if (!confirm(`确定要删除 Agent "${selectedAgent.name}" 吗？\n\n此操作不可撤销。`)) {
      return;
    }

    try {
      await deleteAgent(selectedAgent.id);
      await loadAgents(); // 重新加载
      setSelectedAgent(null);
      setViewMode('list');
    } catch (err) {
      console.error('Delete agent failed:', err);
    }
  };

  const handleBack = () => {
    setViewMode('list');
    setSelectedAgent(null);
  };

  // ========== 渲染 ==========
  if (viewMode === 'detail' && selectedAgent) {
    return (
      <AgentDetail
        agent={selectedAgent}
        onClose={handleBack}
        onEdit={handleEditAgent}
        onDelete={handleDeleteAgent}
      />
    );
  }

  if (viewMode === 'editor') {
    return (
      <AgentEditor
        agent={selectedAgent || undefined}
        onSave={handleSaveAgent}
        onCancel={handleBack}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-2">
          <Bot size={24} className="text-primary" />
          <div>
            <h1 className="text-xl font-bold">Agent 库</h1>
            <p className="text-sm text-text-secondary">
              {filteredAndSortedAgents.length} 个 Agent
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadAgents()}
            className="p-2 hover:bg-bg-tertiary rounded transition-colors"
            title="刷新"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleCreateAgent}
            className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            <span>新建 Agent</span>
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-tertiary rounded transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 搜索和过滤栏 */}
      <div className="p-4 border-b border-bg-tertiary space-y-3">
        {/* 搜索框 */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="搜索 Agent（名称、ID、描述、标签）"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-bg-secondary border border-bg-tertiary rounded pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 border rounded transition-colors ${
              showFilters
                ? 'bg-primary/10 border-primary text-primary'
                : 'bg-bg-secondary border-bg-tertiary hover:bg-bg-tertiary'
            }`}
          >
            <Filter size={16} />
            <span className="text-sm">筛选</span>
          </button>
        </div>

        {/* 筛选选项 */}
        {showFilters && (
          <div className="flex gap-4">
            {/* 来源筛选 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">来源:</span>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                className="bg-bg-secondary border border-bg-tertiary rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
              >
                <option value="all">全部</option>
                <option value="builtin">内置</option>
                <option value="global">全局</option>
                <option value="project">项目</option>
              </select>
            </div>

            {/* 状态筛选 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">状态:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                className="bg-bg-secondary border border-bg-tertiary rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
              >
                <option value="all">全部</option>
                <option value="enabled">已启用</option>
                <option value="disabled">未启用</option>
              </select>
            </div>

            {/* 排序 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">排序:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="bg-bg-secondary border border-bg-tertiary rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
              >
                <option value="name">名称</option>
                <option value="created">创建时间</option>
                <option value="source">来源</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Agent 列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && agents.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw size={24} className="animate-spin text-text-secondary" />
          </div>
        ) : error ? (
          <div className="text-center text-sm text-error py-8">{error}</div>
        ) : filteredAndSortedAgents.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">
            {searchQuery || filterSource !== 'all' || filterStatus !== 'all'
              ? '没有找到匹配的 Agent'
              : '暂无 Agent，点击"新建 Agent"创建'}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedAgents).map(([source, sourceAgents]) => (
              <div key={source}>
                {/* 分组标题 */}
                <h2 className="text-sm font-semibold text-text-secondary mb-3">
                  {source === 'builtin' && '⭐ 内置 Agents'}
                  {source === 'global' && '🌐 全局 Agents'}
                  {source === 'project' && '📁 项目 Agents'}
                  {!['builtin', 'global', 'project'].includes(source) && `❓ ${source}`}
                  <span className="ml-2 text-xs">({sourceAgents.length})</span>
                </h2>

                {/* Agent 卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sourceAgents.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} onClick={() => handleSelectAgent(agent)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ========== Agent 卡片组件 ==========
interface AgentCardProps {
  agent: AgentProfile;
  onClick: () => void;
}

function AgentCard({ agent, onClick }: AgentCardProps) {
  const isBuiltin = agent.metadata?.builtin || agent.metadata?.source === 'builtin';

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-bg-secondary border border-bg-tertiary rounded-lg hover:border-primary/50 transition-colors"
    >
      {/* 头部：Avatar + 名称 + 状态 */}
      <div className="flex items-start gap-3 mb-2">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
          style={{ background: agent.color || '#8b5cf6' }}
        >
          {agent.avatar || '🤖'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-semibold truncate">{agent.name}</h3>
            {agent.enabled ? (
              <Eye size={12} className="text-green-500 flex-shrink-0" />
            ) : (
              <EyeOff size={12} className="text-text-secondary flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-text-tertiary font-mono truncate">{agent.id}</p>
        </div>
      </div>

      {/* 描述 */}
      <p className="text-sm text-text-secondary line-clamp-2 mb-3">{agent.description}</p>

      {/* 标签 */}
      {agent.tags && agent.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2">
          {agent.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
          {agent.tags.length > 3 && (
            <span className="text-xs text-text-secondary">+{agent.tags.length - 3}</span>
          )}
        </div>
      )}

      {/* 底部：来源 */}
      <div className="flex items-center justify-between text-xs text-text-tertiary pt-2 border-t border-bg-tertiary">
        <span>
          {isBuiltin ? '内置' : agent.metadata?.source === 'global' ? '全局' : '项目'}
        </span>
        {agent.metadata?.isSubAgent && <span className="text-primary">SubAgent</span>}
      </div>
    </button>
  );
}
