// ============================================================
// ToolsManager - Tools 管理面板
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { Search, X, Wrench, ChevronDown, ChevronRight, Lock, Unlock } from 'lucide-react';
import type { ToolInfo } from '../global';

interface ToolsManagerProps {
  onClose: () => void;
}

export default function ToolsManager({ onClose }: ToolsManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['core', 'meta']));

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await window.electron.toolsList();
      if (res.success && res.tools) setTools(res.tools);
    } catch (err) {
      console.error('Failed to load tools:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [tools, searchQuery]);

  const grouped = useMemo(() => {
    return filtered.reduce((g, tool) => {
      if (!g[tool.category]) g[tool.category] = [];
      g[tool.category].push(tool);
      return g;
    }, {} as Record<string, ToolInfo[]>);
  }, [filtered]);

  const getCategoryInfo = (category: string): { label: string; icon: string; description: string } => {
    const categories: Record<string, { label: string; icon: string; description: string }> = {
      core: {
        label: '核心工具',
        icon: '🎯',
        description: '所有场景都需要的基础工具（读取、搜索、命令）',
      },
      meta: {
        label: '元能力',
        icon: '🧠',
        description: '任务管理、计划审查、SubAgent 调度',
      },
      coding: {
        label: '编程工具',
        icon: '💻',
        description: '编程场景专用（文件编辑、Notebook、目录浏览）',
      },
      life: {
        label: '生活工具',
        icon: '🏠',
        description: '生活秘书场景（记忆、提醒、网络搜索）',
      },
      other: {
        label: '其他',
        icon: '📦',
        description: '未分类工具',
      },
    };
    return categories[category] || { label: category, icon: '❓', description: '' };
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(category) ? next.delete(category) : next.add(category);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-bg-primary">
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-3">
          <Wrench size={24} className="text-primary" />
          <h2 className="text-lg font-bold">Tools</h2>
          {!loading && (
            <span className="text-xs bg-bg-tertiary px-2 py-1 rounded">{filtered.length} Tools</span>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-bg-tertiary rounded transition-colors" title="关闭">
          <X size={20} />
        </button>
      </div>

      <div className="p-3 border-b border-bg-tertiary">
        <div className="relative">
          <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="搜索 Tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-bg-tertiary rounded px-8 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-sm text-text-secondary py-8">加载中...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">没有找到匹配的 Tool</div>
        ) : (
          <div className="space-y-2">
            {Object.entries(grouped).map(([category, categoryTools]) => {
              const categoryInfo = getCategoryInfo(category);
              return (
                <div key={category} className="border border-bg-tertiary rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full px-4 py-3 bg-bg-secondary hover:bg-bg-tertiary transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {expandedCategories.has(category) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className="text-lg">{categoryInfo.icon}</span>
                        <span className="text-sm font-medium">{categoryInfo.label}</span>
                        <span className="text-xs bg-bg-tertiary px-1.5 py-0.5 rounded">{categoryTools.length}</span>
                      </div>
                    </div>
                    {categoryInfo.description && (
                      <p className="text-xs text-text-secondary text-left ml-9">{categoryInfo.description}</p>
                    )}
                  </button>
                {expandedCategories.has(category) && (
                  <div className="divide-y divide-bg-tertiary">
                    {categoryTools.map((tool) => (
                      <div key={tool.name} className="px-4 py-3 hover:bg-bg-tertiary/50 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <code className="text-sm font-semibold font-mono">{tool.name}</code>
                              {tool.required && (
                                <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">必备</span>
                              )}
                              {tool.readonly ? (
                                <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <Lock size={10} /> 只读
                                </span>
                              ) : (
                                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <Unlock size={10} /> 可写
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-text-secondary">{tool.description}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
