// ============================================================
// ToolsPage - 工具列表页面
// ============================================================

import { useState, useEffect } from 'react';
import { Wrench, RefreshCw, Info } from 'lucide-react';
import { t } from '@/core/i18n';
import { Button } from '@/components/ui/button';


interface Tool {
  name: string;
  description: string;
  category?: string;
  enabled?: boolean;
  config?: Record<string, any>;
}

// 后端工具 Schema 没有 category 字段，根据工具名前缀推断分类
function inferCategory(name: string): string {
  // 文件操作
  if (/^(read_file|write_file|edit_file|multi_edit|glob|grep|list_directory|change_directory|docx_edit|xlsx_edit|pdf|doc_to_docx|notebook_edit|send_file_to_user)$/.test(name)) return 'file';
  // 代码 / 终端
  if (/^(bash|ssh_exec|ssh_list|ssh_read|ssh_write|enter_worktree|exit_plan_mode|enter_plan_mode|task$|task_control|task_output|plan_review)$/.test(name)) return 'code';
  // 系统工具
  if (/^(sleep|scheduler|install|uninstall|mcp_settings|todo_)/.test(name)) return 'system';
  // 网络请求
  if (/^(web_fetch|web_search)$/.test(name)) return 'network';
  // 元认知 / Agent 管理 / 媒体生成
  return 'meta';
}

interface ToolsPageProps {
  onClose: () => void;
}

function ToolCard({ tool }: { tool: Tool }) {
  const cat = tool.category || 'other';

  // Tailwind JIT 需要静态类名，不能动态拼接
  const cardClass = (() => {
    const base = 'rounded-2xl border backdrop-blur-xl shadow-glass-sm hover:border-primary/30 transition-colors';
    switch (cat) {
      case 'file': return `${base} border-blue-500/20 bg-blue-500/10`;
      case 'code': return `${base} border-green-500/20 bg-green-500/10`;
      case 'system': return `${base} border-purple-500/20 bg-purple-500/10`;
      case 'network': return `${base} border-orange-500/20 bg-orange-500/10`;
      case 'meta': return `${base} border-pink-500/20 bg-pink-500/10`;
      default: return `${base} border-border bg-card`;
    }
  })();

  const badgeClass = (() => {
    switch (cat) {
      case 'file': return 'bg-blue-500/10 text-blue-400';
      case 'code': return 'bg-green-500/10 text-green-400';
      case 'system': return 'bg-purple-500/10 text-purple-400';
      case 'network': return 'bg-orange-500/10 text-orange-400';
      case 'meta': return 'bg-pink-500/10 text-pink-400';
      default: return 'bg-gray-500/10 text-gray-400';
    }
  })();

  return (
    <div className={cardClass}>
      <div className="flex items-start gap-3 p-4">
        <Wrench size={16} className="text-accent mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-sm font-semibold text-foreground">{tool.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${badgeClass}`}>
              {cat}
            </span>
            {tool.enabled !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                tool.enabled
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-gray-500/10 text-gray-400'
              }`}>
                {tool.enabled ? t('tools.page.badge_enabled') : t('tools.page.badge_disabled')}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{tool.description || t('tools.page.no_description')}</p>

          {/* 配置信息 */}
          {tool.config && Object.keys(tool.config).length > 0 && (
            <div className="mt-2 p-2 bg-background rounded text-xs">
              <div className="text-muted-foreground/70 mb-1">配置:</div>
              <pre className="text-muted-foreground font-mono">
                {JSON.stringify(tool.config, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ToolsPage({ onClose: _onClose }: ToolsPageProps) {
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
      const response = await window.electron.toolsList();

      // 处理响应格式 { success: true, tools: [...] } 或 { success: false, error: '...' }
      if (response && typeof response === 'object') {
        if ('success' in response && !response.success) {
          console.error('[ToolsPage] 加载失败:', response.error);
          setError(response.error || '加载工具列表失败');
          setTools([]);
        } else if ('tools' in response) {
          const raw = (response.tools || []) as Tool[];
          setTools(raw.map(t => ({ ...t, category: t.category || inferCategory(t.name) })));
        } else {
          // 兼容直接返回数组的情况
          const raw = Array.isArray(response) ? response : [];
          setTools(raw.map(t => ({ ...t, category: t.category || inferCategory(t.name) })));
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
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-base font-semibold text-foreground">{t('tools.page.title')}</h1>
          {!loading && !error && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('tools.page.count_info', { total: tools.length, enabled: tools.filter(t => t.enabled !== false).length })}
            </p>
          )}
        </div>
        <Button
          onClick={loadTools}
          disabled={loading}
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-50"
          title={t('tools.page.refresh')}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* 说明 */}
      <div className="px-5 py-3 bg-blue-500/10 border-b border-blue-500/20 flex-shrink-0">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-400">
            <p className="font-medium mb-1">{t('tools.page.hint_title')}</p>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>{t('tools.page.hint_item1')}</li>
              <li>{t('tools.page.hint_item2')}</li>
              <li>{t('tools.page.hint_item3')}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 搜索和筛选 */}
      {!loading && !error && tools.length > 0 && (
        <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
          <input
            type="text"
            placeholder={t('tools.page.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-card border border-border rounded text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-accent"
          />

          <div className="flex gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="flex-1 px-2 py-1 text-xs bg-card border border-border rounded text-foreground focus:outline-none focus:border-accent"
            >
              <option value="all">{t('tools.page.filter_category_all')}</option>
              {categories.filter(Boolean).map(cat => (
                <option key={cat} value={cat!}>{cat}</option>
              ))}
            </select>

            <select
              value={filterEnabled}
              onChange={(e) => setFilterEnabled(e.target.value)}
              className="flex-1 px-2 py-1 text-xs bg-card border border-border rounded text-foreground focus:outline-none focus:border-accent"
            >
              <option value="all">{t('tools.page.filter_status_all')}</option>
              <option value="enabled">{t('tools.page.filter_status_enabled')}</option>
              <option value="disabled">{t('tools.page.filter_status_disabled')}</option>
            </select>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {t('tools.page.loading')}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="text-red-400 text-sm">{error}</p>
            <Button
              onClick={loadTools}
              variant="default"
              size="sm"
            >
              {t('tools.page.retry')}
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {search || filterCategory !== 'all' || filterEnabled !== 'all'
              ? t('tools.page.empty_no_match')
              : t('tools.page.empty_no_tools')}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedTools).map(([category, categoryTools]) => (
              <div key={category}>
                <h3 className="text-sm font-medium text-foreground mb-2 px-2">
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
