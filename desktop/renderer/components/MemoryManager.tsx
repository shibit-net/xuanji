// ============================================================
// MemoryManager - 记忆系统管理面板
// ============================================================
// 职责：
// - 展示记忆统计信息（总数、分类、timeline/topic/fact 分布）
// - 配置智能刷新（token/时间阈值、保留消息数等）
// - 配置主题提取（合并阈值、最小条目数等）
// - 手动触发刷新和主题提取
// - 查看和搜索记忆列表
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  X,
  Brain,
  Settings,
  Zap,
  Clock,
  TrendingUp,
  Database,
  Save,
  RefreshCw,
  Sparkles,
  BarChart3,
  Filter,
  Search,
  Loader2,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { useToast } from './Toast';
import PermissionRulesPanel from './PermissionRulesPanel';

interface MemoryManagerProps {
  onClose: () => void;
}

interface MemoryStats {
  total: number;
  byType: Record<string, number>;
  byCategory?: {
    timeline?: number;
    topic?: number;
    fact?: number;
  };
}

interface MemoryConfig {
  intelligentFlush?: {
    enabled: boolean;
    tokenThreshold: number;
    timeThreshold: number;
    valueThreshold: number;
    keepRecentMessages: number;
  };
  topicExtraction?: {
    enabled: boolean;
    mergeThreshold: number;
    minEntriesForExtraction: number;
  };
  tokenEstimation?: {
    charsPerToken: number;
  };
}

type Tab = 'stats' | 'config' | 'list' | 'permissions' | 'rules';

export default function MemoryManager({ onClose }: MemoryManagerProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('stats');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [config, setConfig] = useState<MemoryConfig>({
    intelligentFlush: {
      enabled: true,
      tokenThreshold: 0.75,
      timeThreshold: 1800000, // 30 分钟
      valueThreshold: 50,
      keepRecentMessages: 5,
    },
    topicExtraction: {
      enabled: true,
      mergeThreshold: 0.85,
      minEntriesForExtraction: 2,
    },
    tokenEstimation: {
      charsPerToken: 3,
    },
  });
  const [searchQuery, setSearchQuery] = useState('');

  // 加载记忆统计
  useEffect(() => {
    loadStats();
    loadConfig();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const result = await window.electron.getMemoryStats();
      if (result.success && result.stats) {
        setStats(result.stats);
      }
    } catch (err) {
      console.error('Failed to load memory stats:', err);
      toast.error('加载记忆统计失败');
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    try {
      const result = await window.electron.getMemoryConfig();
      if (result.success && result.config) {
        // 深度合并：只更新后端有对应字段的部分，保留 GUI 默认值
        setConfig((prev) => ({
          intelligentFlush: {
            ...prev.intelligentFlush!,
            ...(result.config.intelligentFlush ?? {}),
          },
          topicExtraction: {
            ...prev.topicExtraction!,
            ...(result.config.topicExtraction ?? {}),
          },
          tokenEstimation: {
            ...prev.tokenEstimation!,
            ...(result.config.tokenEstimation ?? {}),
          },
        }));
      }
    } catch (err) {
      console.error('Failed to load memory config:', err);
    }
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    try {
      const result = await window.electron.saveMemoryConfig({ config });
      if (result.success) {
        if (result.requiresRestart) {
          toast.success('配置已保存，请重启会话使配置生效');
        } else {
          toast.success('配置保存成功');
        }
      } else {
        toast.error(result.error || '保存失败');
      }
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleManualFlush = async () => {
    setLoading(true);
    try {
      const result = await window.electron.manualMemoryFlush();
      if (result.success) {
        toast.success('手动刷新成功');
        await loadStats();
      } else {
        toast.error(result.error || '刷新失败');
      }
    } catch (err) {
      toast.error(`刷新失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractTopics = async () => {
    setLoading(true);
    try {
      const result = await window.electron.extractTopics();
      if (result.success) {
        toast.success('主题提取成功');
        await loadStats();
      } else {
        toast.error(result.error || '提取失败');
      }
    } catch (err) {
      toast.error(`提取失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">记忆系统</h1>
            <p className="text-sm text-text-secondary">管理和配置 AI 记忆</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-bg-secondary rounded-lg transition-colors"
          title="关闭"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tab 导航 */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-bg-tertiary">
        <button
          onClick={() => setActiveTab('stats')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'stats'
              ? 'bg-primary text-white'
              : 'bg-bg-secondary hover:bg-bg-tertiary'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span className="text-sm font-medium">统计</span>
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'config'
              ? 'bg-primary text-white'
              : 'bg-bg-secondary hover:bg-bg-tertiary'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span className="text-sm font-medium">配置</span>
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'list'
              ? 'bg-primary text-white'
              : 'bg-bg-secondary hover:bg-bg-tertiary'
          }`}
        >
          <Database className="w-4 h-4" />
          <span className="text-sm font-medium">记忆列表</span>
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'rules'
              ? 'bg-primary text-white'
              : 'bg-bg-secondary hover:bg-bg-tertiary'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span className="text-sm font-medium">核心规则</span>
        </button>
        <button
          onClick={() => setActiveTab('permissions')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'permissions'
              ? 'bg-primary text-white'
              : 'bg-bg-secondary hover:bg-bg-tertiary'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span className="text-sm font-medium">权限规则</span>
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'stats' && (
          <StatsView stats={stats} loading={loading} onRefresh={loadStats} />
        )}
        {activeTab === 'config' && (
          <ConfigView
            config={config}
            onChange={setConfig}
            onSave={handleSaveConfig}
            onFlush={handleManualFlush}
            onExtract={handleExtractTopics}
            loading={loading}
          />
        )}
        {activeTab === 'list' && (
          <ListView searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        )}
        {activeTab === 'rules' && (
          <CoreRulesView />
        )}
        {activeTab === 'permissions' && (
          <PermissionRulesPanel />
        )}
      </div>
    </div>
  );
}

// ============================================================
// 统计视图
// ============================================================

function StatsView({
  stats,
  loading,
  onRefresh,
}: {
  stats: MemoryStats | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const byCategory = stats?.byCategory || {};
  const categoryStats = [
    { label: '时间线', value: byCategory.timeline || 0, color: 'bg-blue-500', icon: Clock },
    { label: '主题', value: byCategory.topic || 0, color: 'bg-green-500', icon: Sparkles },
    { label: '事实', value: byCategory.fact || 0, color: 'bg-purple-500', icon: Brain },
  ];

  return (
    <div className="space-y-6">
      {/* 总览卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-bg-secondary border border-bg-tertiary rounded-lg p-6">
          <div className="flex items-center gap-3 mb-2">
            <Database className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-medium text-text-secondary">总记忆数</h3>
          </div>
          <p className="text-3xl font-bold">{stats?.total || 0}</p>
        </div>

        {categoryStats.map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-bg-secondary border border-bg-tertiary rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <Icon className={`w-5 h-5 ${color.replace('bg-', 'text-')}`} />
              <h3 className="text-sm font-medium text-text-secondary">{label}</h3>
            </div>
            <p className="text-3xl font-bold">{value}</p>
            {stats && stats.total > 0 && (
              <p className="text-xs text-text-secondary mt-1">
                占比 {((value / stats.total) * 100).toFixed(1)}%
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 类型分布 */}
      <div className="bg-bg-secondary border border-bg-tertiary rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">记忆类型分布</h3>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="space-y-3">
          {stats?.byType &&
            Object.entries(stats.byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <div key={type} className="flex items-center gap-3">
                  <span className="w-32 text-sm text-text-secondary">{type}</span>
                  <div className="flex-1 bg-bg-tertiary rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{
                        width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="w-16 text-right text-sm font-medium">{count}</span>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 配置视图
// ============================================================

function ConfigView({
  config,
  onChange,
  onSave,
  onFlush,
  onExtract,
  loading,
}: {
  config: MemoryConfig;
  onChange: (config: MemoryConfig) => void;
  onSave: () => void;
  onFlush: () => void;
  onExtract: () => void;
  loading: boolean;
}) {
  const flushConfig = config.intelligentFlush!;
  const topicConfig = config.topicExtraction!;
  const tokenConfig = config.tokenEstimation!;

  return (
    <div className="space-y-6">
      {/* 智能刷新配置 */}
      <div className="bg-bg-secondary border border-bg-tertiary rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Zap className="w-5 h-5 text-yellow-500" />
          <h3 className="text-lg font-semibold">智能记忆刷新</h3>
        </div>

        <div className="space-y-4">
          {/* 启用开关 */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={flushConfig.enabled}
              onChange={(e) =>
                onChange({
                  ...config,
                  intelligentFlush: { ...flushConfig, enabled: e.target.checked },
                })
              }
              className="w-4 h-4"
            />
            <span className="text-sm">启用智能刷新</span>
          </label>

          {/* Token 阈值 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Token 阈值（{(flushConfig.tokenThreshold * 100).toFixed(0)}%）
            </label>
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.05"
              value={flushConfig.tokenThreshold}
              onChange={(e) =>
                onChange({
                  ...config,
                  intelligentFlush: { ...flushConfig, tokenThreshold: parseFloat(e.target.value) },
                })
              }
              className="w-full"
              disabled={!flushConfig.enabled}
            />
            <p className="text-xs text-text-secondary mt-1">
              当上下文 Token 超过此阈值时触发刷新
            </p>
          </div>

          {/* 时间阈值 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              时间阈值（{(flushConfig.timeThreshold / 60000).toFixed(0)} 分钟）
            </label>
            <input
              type="range"
              min="600000"
              max="3600000"
              step="300000"
              value={flushConfig.timeThreshold}
              onChange={(e) =>
                onChange({
                  ...config,
                  intelligentFlush: { ...flushConfig, timeThreshold: parseInt(e.target.value) },
                })
              }
              className="w-full"
              disabled={!flushConfig.enabled}
            />
            <p className="text-xs text-text-secondary mt-1">
              距离上次刷新超过此时间时触发刷新
            </p>
          </div>

          {/* 价值评分阈值 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              价值评分阈值（{flushConfig.valueThreshold}）
            </label>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={flushConfig.valueThreshold}
              onChange={(e) =>
                onChange({
                  ...config,
                  intelligentFlush: { ...flushConfig, valueThreshold: parseInt(e.target.value) },
                })
              }
              className="w-full"
              disabled={!flushConfig.enabled}
            />
            <p className="text-xs text-text-secondary mt-1">
              低于此分数的内容将被丢弃
            </p>
          </div>

          {/* 保留消息数 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              保留最近 {flushConfig.keepRecentMessages} 条消息
            </label>
            <input
              type="range"
              min="2"
              max="20"
              step="1"
              value={flushConfig.keepRecentMessages}
              onChange={(e) =>
                onChange({
                  ...config,
                  intelligentFlush: { ...flushConfig, keepRecentMessages: parseInt(e.target.value) },
                })
              }
              className="w-full"
              disabled={!flushConfig.enabled}
            />
            <p className="text-xs text-text-secondary mt-1">
              刷新后保留最近的 N 条消息
            </p>
          </div>

          {/* 手动刷新按钮 */}
          <button
            onClick={onFlush}
            disabled={loading || !flushConfig.enabled}
            className="w-full px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Zap className="w-4 h-4" />
            手动触发刷新
          </button>
        </div>
      </div>

      {/* 主题提取配置 */}
      <div className="bg-bg-secondary border border-bg-tertiary rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Sparkles className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-semibold">主题提取</h3>
        </div>

        <div className="space-y-4">
          {/* 启用开关 */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={topicConfig.enabled}
              onChange={(e) =>
                onChange({
                  ...config,
                  topicExtraction: { ...topicConfig, enabled: e.target.checked },
                })
              }
              className="w-4 h-4"
            />
            <span className="text-sm">启用主题提取</span>
          </label>

          {/* 合并阈值 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              合并阈值（{topicConfig.mergeThreshold.toFixed(2)}）
            </label>
            <input
              type="range"
              min="0.7"
              max="0.95"
              step="0.05"
              value={topicConfig.mergeThreshold}
              onChange={(e) =>
                onChange({
                  ...config,
                  topicExtraction: { ...topicConfig, mergeThreshold: parseFloat(e.target.value) },
                })
              }
              className="w-full"
              disabled={!topicConfig.enabled}
            />
            <p className="text-xs text-text-secondary mt-1">
              相似度超过此阈值的主题将被合并
            </p>
          </div>

          {/* 最小条目数 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              最小条目数（{topicConfig.minEntriesForExtraction}）
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={topicConfig.minEntriesForExtraction}
              onChange={(e) =>
                onChange({
                  ...config,
                  topicExtraction: {
                    ...topicConfig,
                    minEntriesForExtraction: parseInt(e.target.value),
                  },
                })
              }
              className="w-full"
              disabled={!topicConfig.enabled}
            />
            <p className="text-xs text-text-secondary mt-1">
              至少需要此数量的时间线记忆才会提取主题
            </p>
          </div>

          {/* 手动提取按钮 */}
          <button
            onClick={onExtract}
            disabled={loading || !topicConfig.enabled}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            手动提取主题
          </button>
        </div>
      </div>

      {/* Token 估算配置 */}
      <div className="bg-bg-secondary border border-bg-tertiary rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-semibold">Token 估算</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              字符/Token 比例（{tokenConfig.charsPerToken}）
            </label>
            <input
              type="range"
              min="2"
              max="5"
              step="0.5"
              value={tokenConfig.charsPerToken}
              onChange={(e) =>
                onChange({
                  ...config,
                  tokenEstimation: { charsPerToken: parseFloat(e.target.value) },
                })
              }
              className="w-full"
            />
            <p className="text-xs text-text-secondary mt-1">
              中文约 2，英文约 4，混合约 3
            </p>
          </div>
        </div>
      </div>

      {/* 保存按钮 */}
      <button
        onClick={onSave}
        disabled={loading}
        className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Save className="w-4 h-4" />
        {loading ? '保存中...' : '保存配置'}
      </button>
    </div>
  );
}

// ============================================================
// 记忆列表视图
// ============================================================

function ListView({
  searchQuery,
  onSearchChange,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [memories, setMemories] = React.useState<any[]>([]);
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  // 加载记忆列表
  const loadMemories = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electron.getMemoryList({
        query: searchQuery,
        category: categoryFilter === 'all' ? undefined : categoryFilter,
        limit: 100,
      });
      if (result.success && result.memories) {
        setMemories(result.memories);
      }
    } catch (err) {
      console.error('Failed to load memories:', err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, categoryFilter]);

  // 监听搜索和过滤条件变化
  React.useEffect(() => {
    const timer = setTimeout(() => {
      loadMemories();
    }, 300); // 防抖
    return () => clearTimeout(timer);
  }, [loadMemories]);

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  // 获取类型图标和颜色
  const getCategoryStyle = (category?: string) => {
    switch (category) {
      case 'timeline':
        return { icon: '📅', label: '时间线', color: 'text-blue-400' };
      case 'topic':
        return { icon: '✨', label: '主题', color: 'text-green-400' };
      case 'fact':
        return { icon: '📚', label: '事实', color: 'text-purple-400' };
      default:
        return { icon: '📝', label: '其他', color: 'text-gray-400' };
    }
  };

  return (
    <div className="space-y-4">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
        <input
          type="text"
          placeholder="搜索记忆内容..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-bg-secondary border border-bg-tertiary rounded-lg focus:outline-none focus:border-primary"
        />
      </div>

      {/* 过滤器 */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-text-secondary" />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 bg-bg-secondary border border-bg-tertiary rounded-lg text-sm focus:outline-none focus:border-primary"
        >
          <option value="all">全部类型</option>
          <option value="timeline">时间线</option>
          <option value="topic">主题</option>
          <option value="fact">事实</option>
        </select>
        <span className="text-sm text-text-secondary ml-auto">
          {memories.length} 条记忆
        </span>
      </div>

      {/* 记忆列表 */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : memories.length === 0 ? (
          <div className="text-center text-text-secondary py-12">
            {searchQuery || categoryFilter !== 'all' ? '没有找到匹配的记忆' : '暂无记忆'}
          </div>
        ) : (
          memories.map((memory) => {
            const style = getCategoryStyle(memory.category);
            const isExpanded = expandedId === memory.id;

            return (
              <div
                key={memory.id}
                className="bg-bg-secondary border border-bg-tertiary rounded-lg p-4 hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : memory.id)}
              >
                {/* 头部 */}
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium ${style.color}`}>
                        {style.label}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {memory.type}
                      </span>
                      <span className="text-xs text-text-secondary ml-auto">
                        {formatDate(memory.lastAccessedAt || memory.createdAt)}
                      </span>
                    </div>
                    <p className={`text-sm text-text-primary ${isExpanded ? '' : 'line-clamp-2'}`}>
                      {memory.content}
                    </p>
                  </div>
                </div>

                {/* 展开详情 */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-bg-tertiary space-y-2 text-xs">
                    {memory.keywords && memory.keywords.length > 0 && (
                      <div>
                        <span className="text-text-secondary">关键词: </span>
                        <span className="text-text-primary">
                          {memory.keywords.join(', ')}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-text-secondary">置信度: </span>
                      <span className="text-text-primary">
                        {(memory.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-text-secondary">访问次数: </span>
                      <span className="text-text-primary">{memory.accessCount}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">来源: </span>
                      <span className="text-text-primary">{memory.source}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">ID: </span>
                      <span className="text-text-primary font-mono text-xs">{memory.id}</span>
                    </div>
                    {memory.topicId && (
                      <div>
                        <span className="text-text-secondary">主题 ID: </span>
                        <span className="text-text-primary">{memory.topicId}</span>
                      </div>
                    )}
                    {memory.dayKey && (
                      <div>
                        <span className="text-text-secondary">日期键: </span>
                        <span className="text-text-primary">{memory.dayKey}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================
// 核心规则视图
// ============================================================

interface CoreRule {
  id: string;
  rule: string;
  description?: string;
  category: 'behavior' | 'privacy' | 'communication' | 'ethics' | 'task' | 'custom';
  createdAt: string;
  updatedAt: string;
  active: boolean;
  source: 'user_explicit' | 'inferred' | 'llm_extracted';
}

function CoreRulesView() {
  const toast = useToast();
  const [rules, setRules] = useState<CoreRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    setLoading(true);
    try {
      const result = await window.electron.getCoreRules();
      if (result.success && result.rules) {
        setRules(result.rules);
      }
    } catch (err) {
      console.error('Failed to load core rules:', err);
      toast.error('加载核心规则失败');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    try {
      const result = await window.electron.updateCoreRule({ id, active });
      if (result.success) {
        toast.success(active ? '规则已启用' : '规则已停用');
        await loadRules();
      } else {
        toast.error(result.error || '操作失败');
      }
    } catch (err) {
      toast.error(`操作失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条规则吗？此操作不可撤销。')) {
      return;
    }

    try {
      const result = await window.electron.deleteCoreRule({ id });
      if (result.success) {
        toast.success('规则已删除');
        await loadRules();
      } else {
        toast.error(result.error || '删除失败');
      }
    } catch (err) {
      toast.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const getCategoryLabel = (category: CoreRule['category']) => {
    const labels: Record<CoreRule['category'], string> = {
      behavior: '行为',
      privacy: '隐私',
      communication: '沟通',
      ethics: '伦理',
      task: '任务',
      custom: '自定义',
    };
    return labels[category];
  };

  const getCategoryColor = (category: CoreRule['category']) => {
    const colors: Record<CoreRule['category'], string> = {
      behavior: 'bg-blue-500/10 text-blue-500',
      privacy: 'bg-red-500/10 text-red-500',
      communication: 'bg-green-500/10 text-green-500',
      ethics: 'bg-purple-500/10 text-purple-500',
      task: 'bg-yellow-500/10 text-yellow-500',
      custom: 'bg-gray-500/10 text-gray-500',
    };
    return colors[category];
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading && rules.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <ShieldAlert className="w-16 h-16 text-text-tertiary mb-4" />
        <h3 className="text-lg font-semibold mb-2">暂无核心规则</h3>
        <p className="text-sm text-text-secondary max-w-md">
          核心规则是您设定的不可违反的底线。在对话中使用"你永远不要..."、"这是我的底线"等表述来添加规则。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 说明卡片 */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-blue-500 mb-1">关于核心规则</h3>
            <p className="text-xs text-text-secondary">
              核心规则是您设定的最高优先级安全约束，AI 必须始终遵守。这些规则会在每次对话时自动注入到系统提示中。
              您可以在对话中使用"你永远不要..."、"绝对不能..."等表述来添加新规则。
            </p>
          </div>
        </div>
      </div>

      {/* 规则列表 */}
      <div className="space-y-3">
        {rules.map((rule) => {
          const isExpanded = expandedRuleId === rule.id;
          return (
            <div
              key={rule.id}
              className="bg-bg-secondary border border-bg-tertiary rounded-lg p-4 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* 状态指示器 */}
                <div className="flex-shrink-0 mt-1">
                  {rule.active ? (
                    <div className="w-3 h-3 rounded-full bg-green-500" title="已启用" />
                  ) : (
                    <div className="w-3 h-3 rounded-full bg-gray-500" title="已停用" />
                  )}
                </div>

                {/* 规则内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${getCategoryColor(rule.category)}`}>
                      {getCategoryLabel(rule.category)}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {formatDate(rule.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-text-primary mb-2">{rule.rule}</p>
                  {rule.description && (
                    <p className="text-xs text-text-secondary mb-2">{rule.description}</p>
                  )}

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-bg-tertiary space-y-2 text-xs">
                      <div>
                        <span className="text-text-secondary">规则 ID: </span>
                        <span className="text-text-primary font-mono">{rule.id}</span>
                      </div>
                      <div>
                        <span className="text-text-secondary">来源: </span>
                        <span className="text-text-primary">
                          {rule.source === 'user_explicit' ? '用户明确指定' :
                           rule.source === 'inferred' ? '系统推断' : 'LLM 提取'}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-secondary">最后更新: </span>
                        <span className="text-text-primary">{formatDate(rule.updatedAt)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setExpandedRuleId(isExpanded ? null : rule.id)}
                    className="px-3 py-1.5 text-xs bg-bg-tertiary hover:bg-bg-quaternary rounded transition-colors"
                  >
                    {isExpanded ? '收起' : '详情'}
                  </button>
                  <button
                    onClick={() => handleToggleActive(rule.id, !rule.active)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      rule.active
                        ? 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20'
                        : 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                    }`}
                  >
                    {rule.active ? '停用' : '启用'}
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="px-3 py-1.5 text-xs bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 刷新按钮 */}
      <button
        onClick={loadRules}
        disabled={loading}
        className="w-full px-4 py-2 bg-bg-secondary hover:bg-bg-tertiary border border-bg-tertiary rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        刷新列表
      </button>
    </div>
  );
}
