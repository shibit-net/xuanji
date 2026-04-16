// ============================================================
// Xuanji Desktop - ToolRegistry 组件
// ============================================================
// 职责：
// - 工具注册表视图（配置域）
// - 展示所有工具（核心 + MCP）
// - 按分类展示（core, search, meta, task, memory, reminder, network, mcp, special）
// - 支持查看详情、搜索、筛选
// - 使用 configStore 管理数据
// - 只读展示
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { Search, X, Wrench, Lock, Unlock, Shield, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { useConfigStore } from '../stores';
import type { ToolDefinition } from '../types/models';

interface ToolRegistryProps {
  onClose: () => void;
}

type ToolCategory = 'all' | 'core' | 'search' | 'meta' | 'task' | 'memory' | 'reminder' | 'network' | 'mcp' | 'special';

const CATEGORY_LABELS: Record<string, string> = {
  core: '🔴 核心工具',
  search: '🔍 搜索工具',
  meta: '🎯 元能力',
  task: '📋 任务管理',
  memory: '💾 记忆系统',
  reminder: '⏰ 提醒系统',
  network: '🌐 网络工具',
  mcp: '🔌 MCP 工具',
  special: '⚡ 特殊工具',
};

export default function ToolRegistry({ onClose }: ToolRegistryProps) {
  // ========== Store 数据 ==========
  const { tools, loading, error, loadTools } = useConfigStore();

  // ========== 本地状态 ==========
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<ToolCategory>('all');
  const [selectedTool, setSelectedTool] = useState<ToolDefinition | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['core', 'search'])
  );

  // ========== 初始化加载 ==========
  useEffect(() => {
    loadTools();
  }, []);

  // ========== 过滤 ==========
  const filteredTools = useMemo(() => {
    let result = [...tools];

    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (tool) =>
          tool.name?.toLowerCase().includes(query) ||
          tool.description?.toLowerCase().includes(query)
      );
    }

    // 分类过滤
    if (filterCategory !== 'all') {
      result = result.filter((tool) => tool.category === filterCategory);
    }

    return result;
  }, [tools, searchQuery, filterCategory]);

  // ========== 分组 ==========
  const groupedTools = useMemo(() => {
    const groups: Record<string, ToolDefinition[]> = {};

    for (const tool of filteredTools) {
      const category = tool.category || 'special';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(tool);
    }

    return groups;
  }, [filteredTools]);

  // ========== 事件处理 ==========
  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-2">
          <Wrench size={24} className="text-primary" />
          <div>
            <h1 className="text-xl font-bold">工具注册表</h1>
            <p className="text-sm text-text-secondary">{filteredTools.length} 个工具</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadTools()}
            className="p-2 hover:bg-bg-tertiary rounded transition-colors"
            title="刷新"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
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

      {/* 搜索栏 */}
      <div className="p-4 border-b border-bg-tertiary space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="搜索工具（名称、描述）"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-bg-secondary border border-bg-tertiary rounded pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value as ToolCategory)}
            className="bg-bg-secondary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
          >
            <option value="all">全部分类</option>
            <option value="core">核心工具</option>
            <option value="search">搜索工具</option>
            <option value="meta">元能力</option>
            <option value="task">任务管理</option>
            <option value="memory">记忆系统</option>
            <option value="reminder">提醒系统</option>
            <option value="network">网络工具</option>
            <option value="mcp">MCP 工具</option>
            <option value="special">特殊工具</option>
          </select>
        </div>
      </div>

      {/* 工具列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && tools.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw size={24} className="animate-spin text-text-secondary" />
          </div>
        ) : error ? (
          <div className="text-center text-sm text-error py-8">{error}</div>
        ) : filteredTools.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">
            {searchQuery || filterCategory !== 'all' ? '没有找到匹配的工具' : '暂无工具'}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedTools).map(([category, categoryTools]) => (
              <div key={category} className="bg-bg-secondary rounded-lg overflow-hidden">
                {/* 分类标题 */}
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center justify-between p-3 hover:bg-bg-tertiary transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {expandedCategories.has(category) ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    <span className="font-semibold">
                      {CATEGORY_LABELS[category] || category}
                    </span>
                    <span className="text-sm text-text-secondary">({categoryTools.length})</span>
                  </div>
                </button>

                {/* 工具列表 */}
                {expandedCategories.has(category) && (
                  <div className="p-2 space-y-2 border-t border-bg-tertiary">
                    {categoryTools.map((tool) => (
                      <ToolCard
                        key={tool.name}
                        tool={tool}
                        onClick={() => setSelectedTool(tool)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 工具详情对话框 */}
      {selectedTool && (
        <ToolDetailDialog tool={selectedTool} onClose={() => setSelectedTool(null)} />
      )}
    </div>
  );
}

// ========== 工具卡片组件 ==========
interface ToolCardProps {
  tool: ToolDefinition;
  onClick: () => void;
}

function ToolCard({ tool, onClick }: ToolCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 bg-bg-primary border border-bg-tertiary rounded hover:border-primary/50 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{tool.name}</h3>
          <p className="text-sm text-text-secondary line-clamp-2">{tool.description}</p>
        </div>
        <div className="flex gap-1 ml-2 flex-shrink-0">
          {tool.required && (
            <span className="text-xs bg-error/20 text-error px-2 py-0.5 rounded flex items-center gap-1">
              <Shield size={10} /> 必备
            </span>
          )}
          {tool.readonly ? (
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded flex items-center gap-1">
              <Lock size={10} /> 只读
            </span>
          ) : (
            <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded flex items-center gap-1">
              <Unlock size={10} /> 可写
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ========== 工具详情对话框 ==========
interface ToolDetailDialogProps {
  tool: ToolDefinition;
  onClose: () => void;
}

function ToolDetailDialog({ tool, onClose }: ToolDetailDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary w-full max-w-2xl max-h-[80vh] rounded-lg shadow-xl flex flex-col">
        {/* 标题 */}
        <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
          <div className="flex items-center gap-2">
            <Wrench size={20} className="text-primary" />
            <h2 className="text-lg font-bold">{tool.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-tertiary rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 属性 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs bg-bg-primary px-2 py-1 rounded">
              分类: {CATEGORY_LABELS[tool.category] || tool.category}
            </span>
            {tool.required && (
              <span className="text-xs bg-error/20 text-error px-2 py-1 rounded flex items-center gap-1">
                <Shield size={12} /> 必备工具
              </span>
            )}
            {tool.readonly ? (
              <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded flex items-center gap-1">
                <Lock size={12} /> 只读（无副作用）
              </span>
            ) : (
              <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded flex items-center gap-1">
                <Unlock size={12} /> 可写（有副作用）
              </span>
            )}
          </div>

          {/* 描述 */}
          <div>
            <p className="text-sm font-semibold mb-2">描述</p>
            <p className="text-sm text-text-secondary">{tool.description}</p>
          </div>

          {/* 输入参数 */}
          {tool.inputSchema && (
            <div>
              <p className="text-sm font-semibold mb-2">输入参数</p>
              <div className="bg-bg-primary rounded p-3 overflow-x-auto">
                <pre className="text-xs font-mono">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* 使用说明 */}
          <div className="bg-primary/10 border border-primary/30 rounded p-3">
            <p className="text-sm font-semibold mb-2">📝 使用说明</p>
            <ul className="text-sm text-text-secondary space-y-1 list-disc list-inside">
              {tool.required && <li>此工具为必备工具，不可禁用</li>}
              {tool.readonly ? (
                <li>只读工具，执行不会修改系统状态，可安全并行调用</li>
              ) : (
                <li>可写工具，执行可能修改系统状态，需要权限确认</li>
              )}
              {tool.category === 'mcp' && <li>此工具由 MCP 服务器提供</li>}
            </ul>
          </div>
        </div>

        {/* 底部 */}
        <div className="p-4 border-t border-bg-tertiary flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bg-tertiary rounded hover:bg-bg-primary transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
