// ============================================================
// AgentManager - Agent 管理器主组件（优化版）
// ============================================================

import { useState, useMemo } from 'react';
import { Search, Plus, X, Bot, RefreshCw, Filter, ChevronDown } from 'lucide-react';
import { t } from '@/core/i18n';
import { useAgentManager } from '../hooks/useAgentManager';
import { useToast } from './Toast';
import AgentDetail from './AgentDetail';
import AgentEditor from './AgentEditor';
import { Avatar } from './Avatar';

// 主 agent 头像
import agentAvatar from '../assets/logos/01bff9e8a394133b79cf6911056f3bff.png';

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
        ? await updateAgent(selectedAgent.id, (({ id, metadata, ...rest }) => rest)(config))
        : await createAgent(config);

      if (result.success) {
        toast.success(selectedAgent ? t('agent.toast_update_success') : t('agent.toast_create_success'));

        // 主动拉取最新 Agent 详情，避免列表状态更新时序问题
        const latest = await window.electron.agentGet({ agentId: config.id });
        if (latest.success && latest.agent) {
          setSelectedAgent(latest.agent);
        }

        setViewType('detail');
      } else {
        toast.error(result.error || t('agent.toast_operation_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.toast_operation_failed'));
    }
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    if (!confirm(t('agent.confirm_delete', { name: selectedAgent.name }))) return;

    try {
      const result = await deleteAgent(selectedAgent.id);
      if (result.success) {
        toast.success(t('agent.toast_delete_success'));
        setSelectedAgent(null);
        setViewType(null);
      } else {
        toast.error(result.error || t('agent.toast_delete_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.toast_delete_failed'));
    }
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    if (!selectedAgent) return;

    // 启用时校验：非本地模型必须有 API Key
    if (enabled) {
      const LOCAL_PROVIDERS = new Set(['ollama', 'vllm', 'lmstudio', 'local-llama']);
      const adapter = selectedAgent.provider?.adapter || 'anthropic';
      if (!LOCAL_PROVIDERS.has(adapter) && !selectedAgent.provider?.apiKey) {
        toast.error(t('agent.editor.error.cannot_enable'));
        return;
      }
    }

    try {
      const result = await updateAgent(selectedAgent.id, { enabled });
      if (result.success) {
        toast.success(enabled ? t('agent.toast_enabled') : t('agent.toast_disabled'));

        // 主动拉取最新 Agent 详情
        const latest = await window.electron.agentGet({ agentId: selectedAgent.id });
        if (latest.success && latest.agent) {
          setSelectedAgent(latest.agent);
        }
      } else {
        toast.error(result.error || t('agent.toast_operation_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.toast_operation_failed'));
    }
  };

  const handleRefresh = async () => {
    try {
      await reload();
      toast.success(t('agent.toast_refresh_success'));
    } catch (err) {
      toast.error(t('agent.toast_refresh_failed'));
    }
  };

  const getGroupLabel = (group: string) => {
    switch (group) {
      case 'system': return t('agent.group_system');
      case 'app': return t('agent.group_app');
      case 'custom': return t('agent.group_custom');
      default: return t('agent.group_unknown');
    }
  };

  // Agent 类型标识
  const getAgentTypeInfo = (agent: any) => {
    const category = agent.metadata?.category;

    if (agent.metadata?.isMainAgent) {
      return {
        type: t('agent.type_main'),
        typeEn: 'Main',
        icon: '⭐',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/20',
        description: t('agent.desc_main'),
      };
    }

    if (category === 'system') {
      return {
        type: t('agent.type_system'),
        typeEn: 'System',
        icon: '⚙️',
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/20',
        description: t('agent.desc_system'),
      };
    }

    if (category === 'app') {
      return {
        type: t('agent.type_app'),
        typeEn: 'App',
        icon: '🤖',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/20',
        description: t('agent.desc_app'),
      };
    }

    return {
      type: t('agent.type_custom'),
      typeEn: 'Custom',
      icon: '📝',
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/20',
      description: t('agent.desc_custom'),
    };
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Bot size={24} className="text-primary" />
          <h2 className="text-lg font-bold">{t('agent.title')}</h2>
          {agents.length > 0 && (
            <span className="text-xs bg-primary/10 px-2 py-1 rounded">
              {filteredAndSortedAgents.length} / {agents.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1.5 hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
            title={t('agent.refresh')}
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-primary/10 rounded transition-colors"
            title={t('agent.close')}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：Agent 列表 */}
        <div className="w-64 border-r border-border flex flex-col">
          {/* 搜索框 */}
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={t('agent.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-card border border-border rounded px-8 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* 筛选按钮 */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-sm text-muted-foreground hover:bg-primary/10 rounded transition-colors"
            >
              <div className="flex items-center gap-2">
                <Filter size={14} />
                <span>{t('agent.filter')}</span>
              </div>
              <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>

            {/* 筛选选项 */}
            {showFilters && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t('agent.filter_category')}</label>
                  <select
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="all">{t('agent.filter_all')}</option>
                    <option value="system">{t('agent.group_system')}</option>
                    <option value="app">{t('agent.group_app')}</option>
                    <option value="custom">{t('agent.group_custom')}</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t('agent.filter_status')}</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="all">{t('agent.filter_all')}</option>
                    <option value="enabled">{t('agent.filter_enabled')}</option>
                    <option value="disabled">{t('agent.filter_disabled')}</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t('agent.filter_sort')}</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="name">{t('agent.filter_sort_name')}</option>
                    <option value="created">{t('agent.filter_sort_created')}</option>
                    <option value="source">{t('agent.filter_sort_source')}</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* 创建按钮 */}
          <div className="p-2 border-b border-border">
            <button
              onClick={handleCreateAgent}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-50"
            >
              <Plus size={16} />
              <span>{t('agent.create')}</span>
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
                  {t('agent.retry')}
                </button>
              </div>
            ) : loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="bg-primary/5 animate-pulse rounded p-3 h-20" />
                ))}
              </div>
            ) : filteredAndSortedAgents.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                {searchQuery || filterSource !== 'all' || filterStatus !== 'all'
                  ? t('agent.empty_no_match')
                  : agents.length === 0
                  ? t('agent.empty_no_agents_hint')
                  : t('agent.empty_no_agents')}
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(groupedAgents).map(([group, groupAgents]) => {
                  const agentList = groupAgents as typeof agents;
                  return (
                    <div key={group}>
                      <div className="text-xs text-muted-foreground px-2 py-1 mb-1 flex items-center justify-between">
                        <span>{getGroupLabel(group)}</span>
                        <span>{agentList.length}</span>
                      </div>
                      {agentList.map((agent: any) => {
                        const typeInfo = getAgentTypeInfo(agent);

                        return (
                          <button
                            key={agent.id}
                            onClick={() => handleSelectAgent(agent)}
                            className={`
                              w-full text-left px-3 py-2 rounded mb-1 transition-colors
                              ${selectedAgent?.id === agent.id
                                ? 'bg-primary/20 border-l-2 border-primary'
                                : 'hover:bg-primary/5'
                              }
                            `}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {/* Avatar */}
                              {/* 主 agent 用应用图标 */}
                              {agent.id === 'xuanji' || agent.name === 'Xuanji' ? (
                                <img src={agentAvatar} alt={agent.name} className="w-8 h-8 rounded-full object-cover" />
                              ) : (
                                <Avatar seed={agent.name || agent.id} size={32} className="w-8 h-8" />
                              )}
                              <span className="text-sm font-medium truncate flex-1">
                                {agent.name}
                              </span>
                              {/* Agent 类型徽章 */}
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded ${typeInfo.bgColor}`}
                                title={typeInfo.description}
                              >
                                {typeInfo.icon}
                              </span>
                              {agent.enabled === false && (
                                <span className="text-xs text-red-500">{t('agent.disabled_badge')}</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
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
                                  className="text-xs bg-accent/10 px-1.5 py-0.5 rounded"
                                  title={cap}
                                >
                                  {cap.length > 8 ? cap.slice(0, 8) + '...' : cap}
                                </span>
                              ))}
                              {agent.capabilities && agent.capabilities.length > 2 && (
                                <span className="text-xs text-muted-foreground">
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
              onTest={() => toast.info(t('agent.toast_test_in_progress'))}
              onToggleEnabled={handleToggleEnabled}
            />
          ) : viewType === 'editor' ? (
            <AgentEditor
              agent={selectedAgent}
              builtinAgents={agents.filter((a) => a.metadata?.category !== 'system')}
              onSave={handleSaveAgent}
              onCancel={() => setViewType(selectedAgent ? 'detail' : null)}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-muted-foreground">
                <Bot size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm mb-1">{t('agent.select_hint')}</p>
                {agents.length === 0 && !loading && (
                  <button
                    onClick={handleCreateAgent}
                    className="mt-3 text-xs text-primary hover:underline"
                  >
                    {t('agent.create_now')}
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
