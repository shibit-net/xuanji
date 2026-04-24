// ============================================================
// ToolsPage - 工具列表页面
// ============================================================

import { useState, useEffect } from 'react';
import { Wrench, RefreshCw, Info } from 'lucide-react';

interface Tool {
  name: string;
  description: string;
  category: string;
  enabled?: boolean;
  config?: Record<string, any>;
}

interface ToolsPageProps {
  onClose: () => void;
}

function ToolCard({ tool }: { tool: Tool }) {
  const categoryColors: Record<string, string> = {
    file: 'bg-blue-500/10 text-blue-400',
    code: 'bg-green-500/10 text-green-400',
    system: 'bg-purple-500/10 text-purple-400',
    network: 'bg-orange-500/10 text-orange-400',
    meta: 'bg-pink-500/10 text-pink-400',
    other: 'bg-gray-500/10 text-gray-400',
  };

  const categoryColor = categoryColors[tool.category] || categoryColors.other;

  return (
    <div className="bg-bg-secondary rounded-lg border border-bg-tertiary overflow-hidden hover:border-primary/30 transition-colors">
      <div className="flex items-start gap-3 px-4 py-3">
        <Wrench size={16} className="text-accent mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-sm font-semibold text-text-primary">{tool.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${categoryColor}`}>
              {tool.category}
            </span>
            {tool.enabled !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                tool.enabled
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-gray-500/10 text-gray-400'
              }`}>
                {tool.enabled ? '✓ 已启用' : '✗ 已禁用'}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary">{tool.description || '无描述'}</p>

          {/* 配置信息 */}
          {tool.config && Object.keys(tool.config).length > 0 && (
            <div className="mt-2 p-2 bg-bg-primary rounded text-xs">
              <div className="text-text-tertiary mb-1">配置:</div>
              <pre className="text-text-secondary font-mono">
                {JSON.stringify(tool.config, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ToolsPage({ onClose }: ToolsPageProps) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterEnabled, setFilterEnabled] = useState<string>('all');

  useEffect(() => {
    loadTools();
  }, []);

  const loadTools = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('[ToolsPage] 开始加载工具列表...');
      const response = await window.electron.toolsList();
      console.log('[ToolsPage] 收到响应:', JSON.stringify(response, null, 2));

      // 处理响应格式 { success: true, tools: [...] } 或 { success: false, error: '...' }
      if (response && typeof response === 'object') {
        if ('success' in response && !response.success) {
          console.error('[ToolsPage] 加载失败:', response.error);
          setError(response.error || '加载工具列表失败');
          setTools([]);
        } else if ('tools' in response) {
          console.log('[ToolsPage] 工具数量:', response.tools?.length || 0);
          setTools(response.tools || []);
        } else {
          // 兼容直接返回数组的情况
          console.log('[ToolsPage] 直接数组格式');
          setTools(Array.isArray(response) ? response : []);
        }
      } else {
        console.warn('[ToolsPage] 响应格式异常:', typeof response);
        setTools([]);
      }
    } catch (err) {
      console.error('[ToolsPage] 异常:', err);
      setError(err instanceof Error ? err.message : '加载工具列表失败');
      setTools([]);
    } finally {
      setLoading(false);
    }
  };

  // 获取所有类别
  const categories = Array.from(new Set(tools.map(t => t.category)));

  // 过滤工具
  const filtered = tools.filter((t) => {
    const matchSearch =
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase());

    const matchCategory = filterCategory === 'all' || t.category === filterCategory;

    const matchEnabled =
      filterEnabled === 'all' ||
      (filterEnabled === 'enabled' && t.enabled !== false) ||
      (filterEnabled === 'disabled' && t.enabled === false);

    return matchSearch && matchCategory && matchEnabled;
  });

  // 按类别分组
  const groupedTools = filtered.reduce((acc, tool) => {
    const category = tool.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(tool);
    return acc;
  }, {} as Record<string, Tool[]>);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-bg-tertiary flex-shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">工具配置</h1>
          {!loading && !error && (
            <p className="text-xs text-text-secondary mt-0.5">
              共 {tools.length} 个工具，已启用 {tools.filter(t => t.enabled !== false).length} 个
            </p>
          )}
        </div>
        <button
          onClick={loadTools}
          disabled={loading}
          className="p-1.5 rounded hover:bg-bg-secondary text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 说明 */}
      <div className="px-5 py-3 bg-blue-500/10 border-b border-blue-500/20 flex-shrink-0">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-400">
            <p className="font-medium mb-1">工具配置说明</p>
            <ul className="space-y-0.5 text-text-secondary">
              <li>• 工具是 Agent 可以调用的原子操作</li>
              <li>• 每个工具可以单独启用/禁用</li>
              <li>• 在 Agent 配置中设置工具的 enabled 字段</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 搜索和筛选 */}
      {!loading && !error && tools.length > 0 && (
        <div className="px-5 py-3 border-b border-bg-tertiary flex-shrink-0 space-y-2">
          <input
            type="text"
            placeholder="搜索工具名称或描述..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-bg-tertiary rounded text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent"
          />

          <div className="flex gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="flex-1 px-2 py-1 text-xs bg-bg-secondary border border-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="all">所有类别</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            <select
              value={filterEnabled}
              onChange={(e) => setFilterEnabled(e.target.value)}
              className="flex-1 px-2 py-1 text-xs bg-bg-secondary border border-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="all">所有状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已禁用</option>
            </select>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-secondary text-sm">
            加载中...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={loadTools}
              className="px-3 py-1.5 text-sm bg-accent text-white rounded hover:opacity-90"
            >
              重试
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-secondary text-sm">
            {search || filterCategory !== 'all' || filterEnabled !== 'all'
              ? '没有匹配的工具'
              : '暂无可用工具'}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedTools).map(([category, categoryTools]) => (
              <div key={category}>
                <h3 className="text-sm font-medium text-text-primary mb-2 px-2">
                  {category} ({categoryTools.length})
                </h3>
                <div className="space-y-2">
                  {categoryTools.map((tool) => (
                    <ToolCard key={tool.name} tool={tool} />
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
