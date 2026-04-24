// ============================================================
// AgentManager - Agent 管理器主组件（优化版）
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { Search, Plus, X, Bot, Package, Folder, RefreshCw, Filter, ChevronDown, Download, CheckCircle } from 'lucide-react';
import { useAgentManager } from '../hooks/useAgentManager';
import { useToast } from './Toast';
import AgentDetail from './AgentDetail';
import AgentEditor from './AgentEditor';
import { LOCAL_MODELS } from '../hooks/useLocalModel';

interface AgentManagerProps {
  onClose: () => void;
}

type ViewType = 'detail' | 'editor' | null;
type FilterSource = 'all' | 'system' | 'app' | 'custom';
type FilterStatus = 'all' | 'enabled' | 'disabled';
type SortBy = 'name' | 'created' | 'source';

export default function AgentManager({ onClose }: AgentManagerProps) {
  const toast = useToast();
  const { agents, loading, error, createAgent, updateAgent, deleteAgent, reload } = useAgentManager();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [viewType, setViewType] = useState<ViewType>(null);
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [showFilters, setShowFilters] = useState(false);
  const [modelStatuses, setModelStatuses] = useState<Record<string, { installed: boolean; downloading: boolean; progress: number }>>({});

  // 监听模型下载状态
  useEffect(() => {
    const checkModelStatuses = async () => {
      const statuses: Record<string, any> = {};

      for (const agent of agents) {
        const modelId = agent.model?.primary;
        if (modelId && modelId in LOCAL_MODELS) {
          try {
            // 检查是否已安装
            const checkResult = await window.electron.localModelCheck(modelId);
            const installed = checkResult.success && checkResult.installed;

            // 检查是否正在下载
            const tasksResult = await window.electron.downloadGetTasks();
            let downloading = false;
            let progress = 0;

            if (tasksResult.success && tasksResult.tasks) {
              const modelInfo = LOCAL_MODELS[modelId as keyof typeof LOCAL_MODELS];
              const modelTask = tasksResult.tasks.find(
                (t: any) => t.category === 'model' && t.name.includes(modelInfo?.filename || '')
              );

              if (modelTask) {
                downloading = modelTask.status === 'downloading';
                progress = modelTask.progress || 0;
              }
            }

            statuses[agent.id] = { installed, downloading, progress };
          } catch (err) {
            console.error(`Failed to check model status for ${agent.id}:`, err);
          }
        }
      }

      setModelStatuses(statuses);
    };

    checkModelStatuses();

    // 每2秒更新一次状态
    const interval = setInterval(checkModelStatuses, 2000);
    return () => clearInterval(interval);
  }, [agents]);

  // 过滤和排序
  const filteredAndSortedAgents = useMemo(() => {
    let result = [...agents];

    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((agent) =>
        agent.id?.toLowerCase().includes(query) ||
        agent.name?.toLowerCase().includes(query) ||
        agent.description?.toLowerCase().includes(query) ||
        agent.capabilities?.some((cap: string) => cap.toLowerCase().includes(query))
      );
    }

    // 来源过滤
    if (filterSource !== 'all') {
      result = result.filter((agent) => agent.metadata?.category === filterSource);
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
        const categoryOrder: Record<string, number> = { system: 0, app: 1, custom: 2 };
        const aOrder = categoryOrder[a.metadata?.category] ?? 99;
        const bOrder = categoryOrder[b.metadata?.category] ?? 99;
        return aOrder - bOrder;
      }
      return 0;
    });

    return result;
  }, [agents, searchQuery, filterSource, filterStatus, sortBy]);

  // 分组（按 system/app/custom 分组）
  const groupedAgents = useMemo(() => {
    const systemAgents: typeof agents = [];
    const appAgents: typeof agents = [];
    const customAgents: typeof agents = [];

    filteredAndSortedAgents.forEach((agent) => {
      const category = agent.metadata?.category;
      if (category === 'system') {
        systemAgents.push(agent);
      } else if (agent.metadata?.category === 'app') {
        appAgents.push(agent);
      } else {
        customAgents.push(agent);
      }
    });

    const groups: Record<string, typeof agents> = {};
    if (customAgents.length > 0) groups['custom'] = customAgents;
    if (appAgents.length > 0) groups['app'] = appAgents;
    if (systemAgents.length > 0) groups['system'] = systemAgents;

    return groups;
  }, [filteredAndSortedAgents]);

  const handleSelectAgent = (agent: any) => {
    setSelectedAgent(agent);
    setViewType('detail');
  };

  const handleEditAgent = () => {
    setViewType('editor');
  };

  const handleCreateAgent = () => {
    setSelectedAgent(null);
    setViewType('editor');
  };

  const handleSaveAgent = async (config: any) => {
    try {
      const result = selectedAgent
        ? await updateAgent(selectedAgent.id, config)
        : await createAgent(config);

      if (result.success) {
        toast.success(selectedAgent ? 'Agent 更新成功' : 'Agent 创建成功');

        // 主动拉取最新 Agent 详情，避免列表状态更新时序问题
        const latest = await window.electron.agentGet({ agentId: config.id });
        if (latest.success && latest.agent) {
          setSelectedAgent(latest.agent);
        }

        setViewType('detail');
      } else {
        toast.error(result.error || '操作失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    if (!confirm(`确定要删除 Agent "${selectedAgent.name}" 吗？\n\n此操作不可撤销。`)) return;

    try {
      const result = await deleteAgent(selectedAgent.id);
      if (result.success) {
        toast.success('Agent 删除成功');
        setSelectedAgent(null);
        setViewType(null);
      } else {
        toast.error(result.error || '删除失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleCopyAgent = () => {
    if (!selectedAgent) return;

    const copiedConfig = {
      ...selectedAgent,
      id: `${selectedAgent.id}-copy`,
      name: `${selectedAgent.name}（副本）`,
      metadata: undefined, // 移除元数据
    };

    setSelectedAgent(copiedConfig);
    setViewType('editor');
    toast.info('已复制 Agent 配置，请修改后保存');
  };

  const handleRefresh = async () => {
    try {
      await reload();
      toast.success('刷新成功');
    } catch (err) {
      toast.error('刷新失败');
    }
  };

  const getSourceIcon = (category: string) => {
    switch (category) {
      case 'system':
        return <Package size={14} className="text-gray-400" />;
      case 'app':
        return <Bot size={14} className="text-blue-500" />;
      case 'custom':
        return <Folder size={14} className="text-green-500" />;
      default:
        return <Bot size={14} />;
    }
  };

  const getGroupLabel = (group: string) => {
    switch (group) {
      case 'system': return '⚙️ 系统 Agent';
      case 'app': return '🌟 应用 Agent';
      case 'custom': return '📝 自定义 Agent';
      default: return '未知';
    }
  };

  // Agent 类型标识
  const getAgentTypeInfo = (agent: any) => {
    const category = agent.metadata?.category;

    if (agent.metadata?.isMainAgent) {
      return {
        type: '主 Agent',
        typeEn: 'Main',
        icon: '⭐',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/20',
        description: '主 Agent，负责所有用户交互和任务执行',
      };
    }

    if (category === 'system') {
      return {
        type: '系统',
        typeEn: 'System',
        icon: '⚙️',
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        description: '系统内置 Agent，不可删除',
      };
    }

    if (category === 'app') {
      return {
        type: '应用',
        typeEn: 'App',
        icon: '🤖',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/20',
        description: '应用 Agent，可配置模型和工具',
      };
    }

    return {
      type: '自定义',
      typeEn: 'Custom',
      icon: '📝',
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/20',
      description: '用户自定义 Agent',
    };
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg-primary overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-3">
          <Bot size={24} className="text-primary" />
          <h2 className="text-lg font-bold">Agent 管理</h2>
          {agents.length > 0 && (
            <span className="text-xs bg-bg-tertiary px-2 py-1 rounded">
              {filteredAndSortedAgents.length} / {agents.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1.5 hover:bg-bg-tertiary rounded transition-colors disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：Agent 列表 */}
        <div className="w-64 border-r border-bg-tertiary flex flex-col">
          {/* 搜索框 */}
          <div className="p-3 border-b border-bg-tertiary space-y-2">
            <div className="relative">
              <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                type="text"
                placeholder="搜索 Agent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-bg-secondary border border-bg-tertiary rounded px-8 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* 筛选按钮 */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-tertiary rounded transition-colors"
            >
              <div className="flex items-center gap-2">
                <Filter size={14} />
                <span>筛选</span>
              </div>
              <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>

            {/* 筛选选项 */}
            {showFilters && (
              <div className="space-y-2 pt-2 border-t border-bg-tertiary">
                <div>
                  <label className="text-xs text-text-secondary block mb-1">分类</label>
                  <select
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="all">全部</option>
                    <option value="system">系统 Agent</option>
                    <option value="app">应用 Agent</option>
                    <option value="custom">自定义 Agent</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-text-secondary block mb-1">状态</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="all">全部</option>
                    <option value="enabled">已启用</option>
                    <option value="disabled">已禁用</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-text-secondary block mb-1">排序</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="name">按名称</option>
                    <option value="created">按创建时间</option>
                    <option value="source">按来源</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* 创建按钮 */}
          <div className="p-2 border-b border-bg-tertiary">
            <button
              onClick={handleCreateAgent}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-50"
            >
              <Plus size={16} />
              <span>创建 Agent</span>
            </button>
          </div>

          {/* Agent 列表 */}
          <div className="flex-1 overflow-y-auto p-2">
            {error ? (
              <div className="text-center py-8">
                <p className="text-sm text-red-400 mb-3">❌ {error}</p>
                <button
                  onClick={handleRefresh}
                  className="text-sm text-primary hover:underline"
                >
                  重试
                </button>
              </div>
            ) : loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="bg-bg-tertiary animate-pulse rounded p-3 h-20" />
                ))}
              </div>
            ) : filteredAndSortedAgents.length === 0 ? (
              <div className="text-center text-sm text-text-secondary py-8">
                {searchQuery || filterSource !== 'all' || filterStatus !== 'all'
                  ? '没有找到匹配的 Agent'
                  : agents.length === 0
                  ? '暂无 Agent\n点击"创建 Agent"开始'
                  : '暂无 Agent'}
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(groupedAgents).map(([group, groupAgents]) => {
                  const agentList = groupAgents as typeof agents;
                  return (
                    <div key={group}>
                      <div className="text-xs text-text-secondary px-2 py-1 mb-1 flex items-center justify-between">
                        <span>{getGroupLabel(group)}</span>
                        <span>{agentList.length}</span>
                      </div>
                      {agentList.map((agent: any) => {
                        const typeInfo = getAgentTypeInfo(agent);
                        const source = agent.metadata?.source || 'unknown';
                        const modelId = agent.model?.primary;
                        const isLocalModel = modelId && modelId in LOCAL_MODELS;
                        const modelStatus = modelStatuses[agent.id];

                        return (
                          <button
                            key={agent.id}
                            onClick={() => handleSelectAgent(agent)}
                            className={`
                              w-full text-left px-3 py-2 rounded mb-1 transition-colors
                              ${selectedAgent?.id === agent.id
                                ? 'bg-primary/20 border-l-2 border-primary'
                                : 'hover:bg-bg-tertiary'
                              }
                            `}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {/* Avatar */}
                              <div
                                className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${
                                  agent.color ? `bg-gradient-to-br ${agent.color}` : 'bg-primary/20'
                                }`}
                              >
                                <span className="text-sm">{agent.avatar || '🤖'}</span>
                              </div>
                              <span className="text-sm font-medium truncate flex-1">
                                {agent.name}
                              </span>
                              {/* 模型状态 */}
                              {isLocalModel && modelStatus && (
                                <>
                                  {modelStatus.downloading ? (
                                    <span className="text-xs text-blue-400 flex items-center gap-1" title={`下载中 ${modelStatus.progress}%`}>
                                      <Download size={12} className="animate-pulse" />
                                      {modelStatus.progress}%
                                    </span>
                                  ) : modelStatus.installed ? (
                                    <span className="text-xs text-green-400" title="模型已安装">
                                      <CheckCircle size={12} />
                                    </span>
                                  ) : (
                                    <span className="text-xs text-yellow-400" title="模型未安装">
                                      <Download size={12} />
                                    </span>
                                  )}
                                </>
                              )}
                              {/* Agent 类型徽章 */}
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded ${typeInfo.bgColor}`}
                                title={typeInfo.description}
                              >
                                {typeInfo.icon}
                              </span>
                              {agent.enabled === false && (
                                <span className="text-xs text-red-500">禁</span>
                              )}
                            </div>
                            <div className="text-xs text-text-secondary truncate">
                              {agent.description}
                            </div>
                            {/* Agent 类型英文标签 + Capabilities */}
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded ${typeInfo.bgColor} ${typeInfo.color}`}
                              >
                                {typeInfo.typeEn}
                              </span>
                              {agent.capabilities && agent.capabilities.slice(0, 2).map((cap: string) => (
                                <span
                                  key={cap}
                                  className="text-xs bg-bg-tertiary px-1.5 py-0.5 rounded"
                                  title={cap}
                                >
                                  {cap.length > 8 ? cap.slice(0, 8) + '...' : cap}
                                </span>
                              ))}
                              {agent.capabilities && agent.capabilities.length > 2 && (
                                <span className="text-xs text-text-secondary">
                                  +{agent.capabilities.length - 2}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：详情/编辑器 */}
        <div className="flex-1 overflow-auto">
          {viewType === 'detail' && selectedAgent ? (
            <AgentDetail
              agent={selectedAgent}
              onEdit={handleEditAgent}
              onDelete={handleDeleteAgent}
              onCopy={handleCopyAgent}
              onTest={() => toast.info('测试功能开发中...')}
            />
          ) : viewType === 'editor' ? (
            <AgentEditor
              agent={selectedAgent}
              builtinAgents={agents.filter((a) => a.metadata?.category === 'app')}
              onSave={handleSaveAgent}
              onCancel={() => setViewType(selectedAgent ? 'detail' : null)}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-text-secondary">
                <Bot size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm mb-1">选择或创建一个 Agent</p>
                {agents.length === 0 && !loading && (
                  <button
                    onClick={handleCreateAgent}
                    className="mt-3 text-xs text-primary hover:underline"
                  >
                    立即创建 →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
