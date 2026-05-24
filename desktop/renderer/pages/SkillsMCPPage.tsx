// ============================================================
// SkillsMCPPage - Skills & MCP 管理页面（天工坊市场）
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Download, Trash2, Upload, Star, RefreshCw, Package, X, Check, Loader2, Wrench, Puzzle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { t } from '@/core/i18n';

interface SkillsMCPPageProps {
  onClose: () => void;
}

// ─── 市场包类型 ────────────────────────────────────────
interface MarketPackage {
  packageId: string;
  name: string;
  type: 'mcp' | 'skill';
  description: string;
  authorName: string;
  categoryName: string;
  totalDownloads: number;
  ratingAvg: number;
  ratingCount: number;
  qualityScore: number;
  securityScore: number;
  tags: string[];
  transport?: string;
  currentVersion: string;
}

interface MarketDetail extends MarketPackage {
  homepageUrl?: string;
  repositoryUrl?: string;
  license?: string;
  versions?: Array<{
    id: number;
    version: string;
    changelog?: string;
    downloads: number;
    createdAt: string;
  }>;
}

// ─── 本地安装类型 ──────────────────────────────────────
interface LocalMCP {
  name: string;
  transport: string;
  enabled: boolean;
  toolCount: number;
  source: string;
  packageId: string;
}

interface LocalSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  source: string;
  tags: string[];
  enabled: boolean;
  requiredTools: string[];
  content: string;
}

type FilterType = 'all' | 'mcp' | 'skill';
type ViewMode = 'marketplace' | 'installed';

export default function SkillsMCPPage({ onClose }: SkillsMCPPageProps) {
  // ─── 状态 ────────────────────────────────────────────
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('marketplace');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // 市场数据
  const [marketItems, setMarketItems] = useState<MarketPackage[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // 本地数据
  const [localMcps, setLocalMcps] = useState<LocalMCP[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [installedMcpIds, setInstalledMcpIds] = useState<Set<string>>(new Set());
  const [installedSkillIds, setInstalledSkillIds] = useState<Set<string>>(new Set());

  // UI 状态
  const [selectedPkg, setSelectedPkg] = useState<MarketPackage | null>(null);
  const [detailData, setDetailData] = useState<MarketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ─── 数据加载 ────────────────────────────────────────
  const loadInstalled = useCallback(async () => {
    try {
      const [mcpRes, skillRes, idsRes] = await Promise.all([
        window.electron.mcpList(),
        window.electron.skillList(),
        window.electron.tiangongInstalledIds(),
      ]);
      if (mcpRes.success) setLocalMcps(mcpRes.servers || []);
      if (skillRes.success) setLocalSkills(skillRes.skills || []);
      if (idsRes.success) {
        setInstalledMcpIds(new Set(idsRes.mcpIds || []));
        setInstalledSkillIds(new Set(idsRes.skillIds || []));
      }
    } catch { /* 静默失败 */ }
  }, []);

  const loadMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      const typeParam = filterType === 'all' ? undefined : filterType;
      const res = await window.electron.tiangongSearch({
        type: typeParam,
        query: searchQuery || undefined,
        page,
        pageSize: 20,
        sort: 'downloads',
      });
      if (res.success && res.data) {
        setMarketItems(res.data.items);
        setTotalPages(res.data.pages);
        setTotalItems(res.data.total);
      } else {
        setMarketError(res.error || t('skills.search_failed'));
      }
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : t('skills.search_failed'));
    } finally {
      setMarketLoading(false);
    }
  }, [filterType, searchQuery, page]);

  useEffect(() => { loadInstalled(); loadMarket(); }, [loadInstalled, loadMarket]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ─── 排序：已安装的排前面，隐藏草稿包 ──────────────
  const sortedItems = useMemo(() => {
    // 仅展示已发布且有版本号的包（currentVersion 非空）
    const visible = marketItems.filter((item) => item.currentVersion);
    const installed = visible.filter((item) => {
      if (item.type === 'mcp') return installedMcpIds.has(item.packageId);
      return installedSkillIds.has(item.packageId);
    });
    const notInstalled = visible.filter((item) => {
      if (item.type === 'mcp') return !installedMcpIds.has(item.packageId);
      return !installedSkillIds.has(item.packageId);
    });
    return [...installed, ...notInstalled];
  }, [marketItems, installedMcpIds, installedSkillIds]);

  // 已安装的本地列表（用于 installed 视图）
  const installedItems = useMemo(() => {
    const items: Array<{ type: 'mcp' | 'skill'; id: string; name: string; description: string; version: string; source: string; enabled: boolean; tags: string[]; extra: string }> = [];
    for (const m of localMcps) {
      items.push({
        type: 'mcp',
        id: m.name,
        name: m.name,
        description: `${m.transport} · ${m.toolCount} tools`,
        version: '',
        source: m.source,
        enabled: m.enabled,
        tags: [m.transport],
        extra: `工具数: ${m.toolCount}`,
      });
    }
    for (const s of localSkills) {
      items.push({
        type: 'skill',
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        source: s.source,
        enabled: s.enabled,
        tags: [s.category, ...s.tags],
        extra: `v${s.version} · ${s.category}`,
      });
    }
    return items;
  }, [localMcps, localSkills]);

  // ─── 操作 ────────────────────────────────────────────
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const isInstalled = (item: MarketPackage): boolean => {
    if (item.type === 'mcp') return installedMcpIds.has(item.packageId);
    return installedSkillIds.has(item.packageId);
  };

  const handleInstall = async (item: MarketPackage) => {
    setInstalling(item.packageId);
    try {
      if (item.type === 'mcp') {
        const res = await window.electron.mcpInstall({ packageId: item.packageId });
        if (res.success) {
          setInstalledMcpIds((prev) => new Set(prev).add(item.packageId));
          showMessage('success', t('skills.install_success_mcp', { name: item.name }));
        } else {
          showMessage('error', res.error || t('skills.install_failed'));
        }
      } else {
        const res = await window.electron.skillInstall({ packageId: item.packageId });
        if (res.success) {
          setInstalledSkillIds((prev) => new Set(prev).add(item.packageId));
          showMessage('success', t('skills.install_success_skill', { name: item.name }));
        } else {
          showMessage('error', res.error || t('skills.install_failed'));
        }
      }
      await loadInstalled();
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('skills.install_failed'));
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (item: MarketPackage) => {
    setUninstalling(item.packageId);
    try {
      if (item.type === 'mcp') {
        const res = await window.electron.mcpUninstall({ packageId: item.packageId });
        if (res.success) {
          setInstalledMcpIds((prev) => { const next = new Set(prev); next.delete(item.packageId); return next; });
          showMessage('success', t('skills.uninstall_success_mcp', { name: item.name }));
        } else {
          showMessage('error', res.error || t('skills.uninstall_failed'));
        }
      } else {
        const skillId = item.packageId.replace('skill-', '');
        const res = await window.electron.skillUninstall({ skillId });
        if (res.success) {
          setInstalledSkillIds((prev) => { const next = new Set(prev); next.delete(item.packageId); return next; });
          showMessage('success', t('skills.uninstall_success_skill', { name: item.name }));
        } else {
          showMessage('error', res.error || t('skills.uninstall_failed'));
        }
      }
      await loadInstalled();
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('skills.uninstall_failed'));
    } finally {
      setUninstalling(null);
    }
  };

  const handleUninstallLocal = async (type: 'mcp' | 'skill', id: string) => {
    setUninstalling(id);
    try {
      if (type === 'mcp') {
        const res = await window.electron.mcpUninstall({ serverName: id });
        if (res.success) showMessage('success', t('skills.uninstall_success_mcp', { name: id }));
        else showMessage('error', res.error || t('skills.uninstall_failed'));
      } else {
        const res = await window.electron.skillUninstall({ skillId: id });
        if (res.success) showMessage('success', t('skills.uninstall_success_skill', { name: id }));
        else showMessage('error', res.error || t('skills.uninstall_failed'));
      }
      await loadInstalled();
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('skills.uninstall_failed'));
    } finally {
      setUninstalling(null);
    }
  };

  const handlePublishLocal = async (type: 'mcp' | 'skill', id: string) => {
    setPublishing(id);
    try {
      if (type === 'mcp') {
        const res = await window.electron.mcpPublish({ serverName: id });
        if (res.success) showMessage('success', t('skills.publish_success_mcp', { id }));
        else showMessage('error', res.error || t('skills.publish_failed'));
      } else {
        const res = await window.electron.skillPublish({ skillId: id });
        if (res.success) showMessage('success', t('skills.publish_success_skill', { id }));
        else showMessage('error', res.error || t('skills.publish_failed'));
      }
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('skills.publish_failed'));
    } finally {
      setPublishing(null);
    }
  };

  const handleSelectPackage = async (item: MarketPackage) => {
    setSelectedPkg(item);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await window.electron.tiangongDetail({ packageId: item.packageId });
      if (res.success && res.data) {
        setDetailData(res.data);
      }
    } catch { /* 静默失败 */ } finally {
      setDetailLoading(false);
    }
  };

  // ─── 渲染 ────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* 顶部栏 */}
      <div className="h-12 border-b border-white/[0.08] flex items-center justify-between px-4 shrink-0 bg-white/[0.02] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Package size={18} className="text-muted-foreground" />
          <h1 className="text-base font-semibold">{t('skills.title')}</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={() => { loadInstalled(); loadMarket(); }} variant="ghost" size="icon" className="h-7 w-7" title={t('skills.refresh')}>
            <RefreshCw size={14} />
          </Button>
          <Button onClick={onClose} variant="ghost" size="icon" className="h-7 w-7">
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* 搜索 + 过滤栏 */}
      <div className="h-12 border-b border-white/[0.08] flex items-center gap-3 px-4 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('skills.search_placeholder')}
            className="w-full h-8 pl-9 pr-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-sm text-foreground placeholder:text-white/30 backdrop-blur-xl focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* 类型过滤 */}
        <div className="flex bg-white/[0.06] rounded-xl border border-white/[0.08] backdrop-blur-xl p-0.5">
          {(['all', 'mcp', 'skill'] as FilterType[]).map((ft) => (
            <button
              key={ft}
              onClick={() => { setFilterType(ft); setPage(1); }}
              className={`px-3 py-1 text-xs rounded-lg transition-all ${
                filterType === ft
                  ? 'bg-white/[0.12] text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {ft === 'all' ? t('skills.filter_all') : ft === 'mcp' ? t('skills.filter_mcp') : t('skills.filter_skills')}
            </button>
          ))}
        </div>

        {/* 视图切换 */}
        <div className="flex bg-white/[0.06] rounded-xl border border-white/[0.08] backdrop-blur-xl p-0.5">
          <button
            onClick={() => setViewMode('marketplace')}
            className={`px-3 py-1 text-xs rounded-lg transition-all flex items-center gap-1 ${
              viewMode === 'marketplace'
                ? 'bg-white/[0.12] text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Package size={12} /> {t('skills.view_marketplace')}
          </button>
          <button
            onClick={() => setViewMode('installed')}
            className={`px-3 py-1 text-xs rounded-lg transition-all flex items-center gap-1 ${
              viewMode === 'installed'
                ? 'bg-white/[0.12] text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Download size={12} /> {t('skills.view_installed', { count: localMcps.length + localSkills.length })}
          </button>
        </div>
      </div>

      {/* 消息横幅 */}
      {message && (
        <div className={`px-4 py-2 text-xs flex items-center gap-2 shrink-0 backdrop-blur-xl ${
          message.type === 'success'
            ? 'bg-green-500/15 text-green-400 border-b border-green-500/20'
            : 'bg-red-500/15 text-red-400 border-b border-red-500/20'
        }`}>
          {message.type === 'success' ? <Check size={14} /> : <X size={14} />}
          {message.text}
        </div>
      )}

      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧列表 */}
        <div className="w-80 border-r border-white/[0.08] flex flex-col shrink-0">
          {viewMode === 'marketplace' ? (
            <>
              {/* 市场列表 */}
              <div className="flex-1 overflow-y-auto">
                {marketLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 size={20} className="animate-spin mr-2" /> {t('skills.loading')}
                  </div>
                ) : marketError ? (
                  <div className="p-4 text-red-400 text-sm">{marketError}</div>
                ) : sortedItems.length === 0 ? (
                  <div className="p-4 text-muted-foreground text-sm text-center py-12">{t('skills.no_results')}</div>
                ) : (
                  sortedItems.map((item) => {
                    const itemInstalled = isInstalled(item);
                    const isSelected = selectedPkg?.packageId === item.packageId;
                    return (
                      <div
                        key={item.packageId}
                        onClick={() => handleSelectPackage(item)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectPackage(item); }}}
                        role="button"
                        tabIndex={0}
                        className={`w-full text-left px-3 py-3 border-b border-white/[0.04] transition-all hover:bg-white/[0.04] cursor-pointer ${
                          isSelected ? 'bg-white/[0.06] border-l-2 border-l-primary' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                            {item.type === 'mcp'
                              ? <Wrench size={14} className="text-blue-400" />
                              : <Puzzle size={14} className="text-purple-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium truncate">{item.name}</span>
                              {itemInstalled && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-green-500/15 text-green-400 border-green-500/20">
                                  {t('skills.installed_badge')}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/70">
                              <span>{item.authorName}</span>
                              {item.currentVersion && <span>v{item.currentVersion}</span>}
                              {item.ratingAvg > 0 && (
                                <span className="flex items-center gap-0.5 text-yellow-400/70">
                                  <Star size={9} /> {item.ratingAvg.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                          {itemInstalled && (
                            <div className="shrink-0 self-start mt-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost" size="icon" className="h-6 w-6 text-red-400/70 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => handleUninstall(item)}
                                disabled={uninstalling === item.packageId}
                                title={t('skills.uninstall')}
                              >
                                {uninstalling === item.packageId
                                  ? <Loader2 size={12} className="animate-spin" />
                                  : <Trash2 size={12} />}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 分页 */}
              <div className="h-10 border-t border-white/[0.08] flex items-center justify-between px-3 shrink-0 bg-white/[0.02]">
                <span className="text-[10px] text-muted-foreground/50">
                  {t('skills.pagination_info', { total: totalItems, visible: sortedItems.length })}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPage(page - 1)}
                      disabled={page <= 1}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft size={12} /> {t('skills.prev_page')}
                    </button>
                    <span className="text-xs text-muted-foreground/70">{page} / {totalPages}</span>
                    <button
                      onClick={() => setPage(page + 1)}
                      disabled={page >= totalPages}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('skills.next_page')} <ChevronRight size={12} />
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* 已安装列表 */
            <div className="flex-1 overflow-y-auto">
              {installedItems.length === 0 ? (
                <div className="p-4 text-muted-foreground text-sm text-center py-12">{t('skills.no_installed')}</div>
              ) : (
                installedItems.map((item) => (
                  <div key={`${item.type}-${item.id}`} className="px-3 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                        {item.type === 'mcp'
                          ? <Wrench size={14} className="text-blue-400" />
                          : <Puzzle size={14} className="text-purple-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{item.name}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{item.type}</Badge>
                          {item.enabled ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-green-500/15 text-green-400 border-green-500/20">{t('skills.badge_enabled')}</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-yellow-500/15 text-yellow-400 border-yellow-500/20">{t('skills.badge_disabled')}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/70">
                          <span>{item.extra}</span>
                          <span>{t('skills.source_label', { source: item.source })}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 self-start mt-1">
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/60 hover:text-foreground"
                          onClick={() => handlePublishLocal(item.type, item.id)}
                          disabled={publishing === item.id}
                          title={t('skills.publish')}
                        >
                          {publishing === item.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6 text-red-400/70 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => handleUninstallLocal(item.type, item.id)}
                          disabled={uninstalling === item.id}
                          title={t('skills.uninstall')}
                        >
                          {uninstalling === item.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 右侧详情面板 */}
        <div className="flex-1 overflow-y-auto">
          {!selectedPkg && !detailData && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <Package size={48} className="opacity-20" />
              <p className="text-sm">{t('skills.select_hint')}</p>
              <p className="text-xs opacity-50">{t('skills.select_hint_desc')}</p>
            </div>
          )}

          {selectedPkg && (
            <div className="p-8 max-w-2xl">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 size={20} className="animate-spin mr-2" /> {t('skills.load_detail')}
                </div>
              ) : (
                <>
                  {/* 头部 */}
                  <div className="flex items-start gap-5 mb-8">
                    <div className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 backdrop-blur-xl">
                      {selectedPkg.type === 'mcp'
                        ? <Wrench size={28} className="text-blue-400" />
                        : <Puzzle size={28} className="text-purple-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold truncate">{selectedPkg.name}</h2>
                        <Badge variant="secondary" className="text-xs">{selectedPkg.type === 'mcp' ? 'MCP' : 'Skill'}</Badge>
                        {isInstalled(selectedPkg) && (
                          <Badge variant="secondary" className="text-xs bg-green-500/15 text-green-400 border-green-500/20">{t('skills.installed_badge')}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {selectedPkg.authorName}
                        {selectedPkg.currentVersion && <span> · v{selectedPkg.currentVersion}</span>}
                        {selectedPkg.categoryName && <span> · {selectedPkg.categoryName}</span>}
                      </p>
                      <div className="flex items-center gap-4 mt-2">
                        {selectedPkg.ratingAvg > 0 && (
                          <span className="text-xs flex items-center gap-1 text-yellow-400">
                            <Star size={12} /> {selectedPkg.ratingAvg.toFixed(1)} ({selectedPkg.ratingCount})
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{t('skills.downloads_label', { count: selectedPkg.totalDownloads })}</span>
                        {selectedPkg.transport && <span className="text-xs text-muted-foreground">{selectedPkg.transport}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isInstalled(selectedPkg) ? (
                        <Button
                          variant="destructive" size="sm"
                          onClick={() => handleUninstall(selectedPkg)}
                          disabled={uninstalling === selectedPkg.packageId}
                          className="flex items-center gap-1.5 h-8"
                        >
                          {uninstalling === selectedPkg.packageId
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Trash2 size={14} />}
                          {t('skills.uninstall')}
                        </Button>
                      ) : selectedPkg.currentVersion ? (
                        <Button
                          variant="default" size="sm"
                          onClick={() => handleInstall(selectedPkg)}
                          disabled={installing === selectedPkg.packageId}
                          className="flex items-center gap-1.5 h-8"
                        >
                          {installing === selectedPkg.packageId
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Download size={14} />}
                          {t('skills.install')}
                        </Button>
                      ) : (
                        <Button variant="secondary" size="sm" disabled className="flex items-center gap-1.5 h-8">
                          {t('skills.pending_publish')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* 描述 */}
                  <section className="mb-8">
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t('skills.description_section')}</h3>
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                      <p className="text-sm text-foreground/80 leading-relaxed">{selectedPkg.description || t('skills.no_description')}</p>
                    </div>
                  </section>

                  {/* 标签 */}
                  {selectedPkg.tags.length > 0 && (
                    <section className="mb-8">
                      <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t('skills.tags_section')}</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedPkg.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs bg-white/[0.04]">{tag}</Badge>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 详情 */}
                  {detailData && (
                    <>
                      {/* 版本历史 */}
                      {detailData.versions && detailData.versions.length > 0 && (
                        <section className="mb-8">
                          <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t('skills.versions_section')}</h3>
                          <div className="space-y-1.5">
                            {detailData.versions.slice(0, 5).map((v) => (
                              <div key={v.id} className="flex items-center justify-between text-xs px-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                                <span className="font-medium">v{v.version}</span>
                                <span className="text-muted-foreground">{t('skills.downloads_label', { count: v.downloads })}</span>
                                <span className="text-muted-foreground/70">{new Date(v.createdAt).toLocaleDateString()}</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {/* 信息 */}
                      <section className="mb-8">
                        <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t('skills.info_section')}</h3>
                        <div className="space-y-1.5 text-sm">
                          {detailData.license && (
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                              <span className="text-muted-foreground">{t('skills.license')}</span>
                              <span className="text-foreground/80">{detailData.license}</span>
                            </div>
                          )}
                          {detailData.homepageUrl && (
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                              <span className="text-muted-foreground">{t('skills.homepage')}</span>
                              <a href={detailData.homepageUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{detailData.homepageUrl}</a>
                            </div>
                          )}
                          {detailData.repositoryUrl && (
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                              <span className="text-muted-foreground">{t('skills.repository')}</span>
                              <a href={detailData.repositoryUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{detailData.repositoryUrl}</a>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                              <span className="text-muted-foreground">{t('skills.security_score')}</span>
                              <span className={selectedPkg.securityScore >= 80 ? 'text-green-400' : selectedPkg.securityScore >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                                {selectedPkg.securityScore}
                              </span>
                            </div>
                            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                              <span className="text-muted-foreground">{t('skills.quality_score')}</span>
                              <span className={selectedPkg.qualityScore >= 80 ? 'text-green-400' : selectedPkg.qualityScore >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                                {selectedPkg.qualityScore}
                              </span>
                            </div>
                          </div>
                        </div>
                      </section>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
