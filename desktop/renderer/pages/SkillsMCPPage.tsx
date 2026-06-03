// ============================================================
// SkillsMCPPage - Skills & MCP 管理页面（天工坊市场）
// ============================================================

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Search, Download, Trash2, Upload, Star, RefreshCw, Package, X, Check, Loader2, Wrench, Puzzle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { t } from '@/core/i18n';

interface SkillsMCPPageProps {
  onClose: () => void;
}

// ─── 市场包类型 ────────────────────────────────────────
interface MarketPackage {
  id: number;
  packageId: string;
  name: string;
  type: 'mcp' | 'skill';
  description: string;
  authorName: string;
  categoryName: string;
  totalDownloads: number;
  ratingAvg: number;
  ratingCount: number;
  recommendCount: number;
  commentCount: number;
  qualityScore: number;
  securityScore: number;
  tags: string[];
  transport?: string;
  currentVersion: string;
  pricingModel: number;
  unitPrice?: number;
  subscriptionPriceMonthly?: number;
  subscriptionPriceYearly?: number;
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
  packageId?: string;
  tags: string[];
  enabled: boolean;
  requiredTools: string[];
  content: string;
}

type FilterType = 'all' | 'mcp' | 'skill';
type ViewMode = 'marketplace' | 'installed';

function SkillsMCPPage({ onClose }: SkillsMCPPageProps) {
  // ─── 状态 ────────────────────────────────────────────
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('marketplace');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // 市场数据 — MCP / Skill 各自独立分页
  const [mcpItems, setMcpItems] = useState<MarketPackage[]>([]);
  const [mcpPage, setMcpPage] = useState(1);
  const [mcpTotalPages, setMcpTotalPages] = useState(1);
  const [mcpTotalItems, setMcpTotalItems] = useState(0);

  const [skillItems, setSkillItems] = useState<MarketPackage[]>([]);
  const [skillPage, setSkillPage] = useState(1);
  const [skillTotalPages, setSkillTotalPages] = useState(1);
  const [skillTotalItems, setSkillTotalItems] = useState(0);

  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);

  // 本地数据
  const [localMcps, setLocalMcps] = useState<LocalMCP[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [installedMcpIds, setInstalledMcpIds] = useState<Set<string>>(new Set());
  const [installedSkillIds, setInstalledSkillIds] = useState<Set<string>>(new Set());
  const [subscribedPackageIds, setSubscribedPackageIds] = useState<Set<string>>(new Set());

  // UI 状态
  const [selectedPkg, setSelectedPkg] = useState<MarketPackage | null>(null);
  const [detailData, setDetailData] = useState<MarketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 分类
  const [categories, setCategories] = useState<Array<{ id: number; name: string; slug: string; description: string; icon: string }>>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>(undefined);

  // ─── 数据加载 ────────────────────────────────────────
  const loadInstalled = useCallback(async () => {
    try {
      const [mcpRes, skillRes, idsRes, subsRes] = await Promise.all([
        window.electron.mcpList(),
        window.electron.skillList(),
        window.electron.tiangongInstalledIds(),
        window.electron.tiangongSubscriptions().catch(() => ({ success: false })),
      ]);
      if (mcpRes.success) setLocalMcps(mcpRes.servers || []);
      if (skillRes.success) setLocalSkills(skillRes.skills || []);
      if (idsRes.success) {
        setInstalledMcpIds(new Set(idsRes.mcpIds || []));
        setInstalledSkillIds(new Set(idsRes.skillIds || []));
      }
      if (subsRes.success && subsRes.data) {
        setSubscribedPackageIds(new Set(subsRes.data.filter(s => s.status === 1).map(s => s.packageId)));
      }
    } catch { /* 静默失败 */ }
  }, []);

  const loadMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    const makeCall = (type: 'mcp' | 'skill', pg: number) =>
      window.electron.tiangongSearch({
        type,
        query: searchQuery || undefined,
        categoryId: selectedCategoryId,
        page: pg,
        pageSize: 20,
        sort: 'recommend_score',
      });

    try {
      if (filterType === 'all') {
        const [mcpRes, skillRes] = await Promise.all([
          makeCall('mcp', mcpPage),
          makeCall('skill', skillPage),
        ]);
        const mcpData = mcpRes.success ? mcpRes.data?.mcp : null;
        const skillData = skillRes.success ? skillRes.data?.skill : null;
        if (!mcpRes.success && !skillRes.success) {
          setMarketError(mcpRes.error || skillRes.error || t('skills.search_failed'));
        }
        if (mcpData) {
          setMcpItems(mcpData.items); setMcpTotalPages(mcpData.pages); setMcpTotalItems(mcpData.total);
        }
        if (skillData) {
          setSkillItems(skillData.items); setSkillTotalPages(skillData.pages); setSkillTotalItems(skillData.total);
        }
      } else if (filterType === 'mcp') {
        setSkillItems([]);
        const res = await makeCall('mcp', mcpPage);
        const data = res.success ? res.data?.mcp : null;
        if (data) {
          setMcpItems(data.items); setMcpTotalPages(data.pages); setMcpTotalItems(data.total);
        } else {
          setMarketError(res.error || t('skills.search_failed'));
        }
      } else {
        setMcpItems([]);
        const res = await makeCall('skill', skillPage);
        const data = res.success ? res.data?.skill : null;
        if (data) {
          setSkillItems(data.items); setSkillTotalPages(data.pages); setSkillTotalItems(data.total);
        } else {
          setMarketError(res.error || t('skills.search_failed'));
        }
      }
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : t('skills.search_failed'));
    } finally {
      setMarketLoading(false);
    }
  }, [filterType, searchQuery, mcpPage, skillPage, selectedCategoryId]);

  useEffect(() => { loadInstalled(); loadMarket(); }, [loadInstalled, loadMarket]);

  // 加载分类列表
  useEffect(() => {
    window.electron.tiangongCategories().then((res) => {
      if (res.success && res.data) setCategories(res.data);
    }).catch(() => {});
  }, []);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      setMcpPage(1); setSkillPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Skill / MCP 状态变更推送：LLM 工具层安装/卸载后自动刷新 UI
  useEffect(() => {
    const unsubSkill = window.electron.onSkillStateChanged(() => loadInstalled());
    const unsubMcp = window.electron.onMcpStateChanged(() => loadInstalled());
    return () => { unsubSkill(); unsubMcp(); };
  }, [loadInstalled]);

  // ─── 排序+过滤：已安装排前面，订阅制需已订阅才显示 ───
  const isMarketInstalled = useCallback((item: MarketPackage): boolean => {
    if (item.type === 'mcp') {
      if (installedMcpIds.has(item.packageId)) return true;
      return localMcps.some(m => m.packageId === item.packageId || m.name === item.packageId || m.name === item.name);
    }
    if (installedSkillIds.has(item.packageId)) return true;
    return localSkills.some(s =>
      s.packageId === item.packageId ||
      s.id === item.packageId ||
      s.name === item.packageId ||
      s.packageId === item.name ||
      s.id === item.name
    );
  }, [installedMcpIds, installedSkillIds, localMcps, localSkills]);

  const sortAndFilter = (items: MarketPackage[]): MarketPackage[] => {
    const visible = items.filter((item) => {
      if (item.pricingModel === 2 && item.type === 'mcp') {
        return subscribedPackageIds.has(item.packageId);
      }
      return true;
    });
    const withVersion = visible.filter((item) => item.currentVersion);
    const withoutVersion = visible.filter((item) => !item.currentVersion);
    const installed = withVersion.filter((item) => isMarketInstalled(item));
    const notInstalled = withVersion.filter((item) => !isMarketInstalled(item));
    return [...installed, ...notInstalled, ...withoutVersion];
  };

  const sortedMcpItems = useMemo(() => sortAndFilter(mcpItems), [mcpItems, subscribedPackageIds, isMarketInstalled]);
  const sortedSkillItems = useMemo(() => sortAndFilter(skillItems), [skillItems, subscribedPackageIds, isMarketInstalled]);

  // packageId → 市场显示名（用于 bundle 命名）
  const marketNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of [...mcpItems, ...skillItems]) {
      if (item.packageId && item.name) map.set(item.packageId, item.name);
    }
    return map;
  }, [mcpItems, skillItems]);

  const formatPkgId = (pkgId: string): string =>
    pkgId.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // 已安装的本地列表（用于 installed 视图）
  // 同一 packageId 的 marketplace skills 聚合为单条 bundle
  const installedItems = useMemo(() => {
    const items: Array<{ type: 'mcp' | 'skill'; id: string; name: string; description: string; version: string; source: string; enabled: boolean; tags: string[]; extra: string; bundleSkills?: LocalSkill[] }> = [];
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
        extra: t('skills.tools_count', { count: m.toolCount }),
      });
    }
    // 按 packageId 分组 marketplace skills，跳过非 marketplace 的
    const bundled: Map<string, LocalSkill[]> = new Map();
    const standalone: LocalSkill[] = [];
    for (const s of localSkills) {
      if (s.source !== 'marketplace') continue;
      if (s.packageId) {
        const existing = bundled.get(s.packageId);
        if (existing) existing.push(s);
        else bundled.set(s.packageId, [s]);
      } else {
        standalone.push(s);
      }
    }
    // 输出 bundle 条目
    for (const [pkgId, skills] of bundled) {
      const first = skills[0];
      const displayName = marketNameMap.get(pkgId) || formatPkgId(pkgId);
      items.push({
        type: 'skill',
        id: pkgId,
        name: displayName,
        description: `${skills.length} 个技能 · ${skills.map(s => s.name).join(', ')}`,
        version: first.version,
        source: 'marketplace',
        enabled: skills.some(s => s.enabled),
        tags: [first.category || 'bundle'],
        extra: `${skills.length} 个技能 · v${first.version}`,
        bundleSkills: skills,
      });
    }
    // 独立 skills
    for (const s of standalone) {
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
  }, [localMcps, localSkills, marketNameMap]);

  // ─── 操作 ────────────────────────────────────────────
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const isInstalled = isMarketInstalled;

  const handleInstall = async (item: MarketPackage) => {
    // ── 付费包预检 ──────────────────────────────────────
    if (item.pricingModel > 0 && item.type === 'mcp') {
      try {
        const permRes = await window.electron.tiangongCheckInstallPermission({ packageId: item.packageId });
        if (permRes.success && permRes.data && !permRes.data.canInstall) {
          showMessage('error', permRes.data.reason || t('skills.install_permission_denied'));
          return;
        }
      } catch {
        // 权限检查失败不阻塞安装（可能未登录）
      }
    }

    setInstalling(item.packageId);
    try {
      let versionId = 0;
      // 获取 versionId 用于记录下载
      try {
        const detailRes = await window.electron.tiangongDetail({ packageId: item.packageId });
        if (detailRes.success && detailRes.data?.versions?.length > 0) {
          versionId = detailRes.data.versions[0].id;
        }
      } catch { /* 非关键 */ }

      if (item.type === 'mcp') {
        const res = await window.electron.mcpInstall({ packageId: item.packageId });
        if (res.success) {
          setInstalledMcpIds(prev => new Set(prev).add(item.packageId));
          showMessage('success', t('skills.install_success_mcp', { name: item.name }));
          window.electron.tiangongRecordDownload({ packageId: item.id, versionId }).catch(() => {});
        } else {
          showMessage('error', res.error || t('skills.install_failed'));
        }
      } else {
        const res = await window.electron.skillInstall({ packageId: item.packageId });
        if (res.success) {
          setInstalledSkillIds(prev => new Set(prev).add(item.packageId));
          showMessage('success', t('skills.install_success_skill', { name: item.name }));
          window.electron.tiangongRecordDownload({ packageId: item.id, versionId }).catch(() => {});
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
          setInstalledMcpIds(prev => { const next = new Set(prev); next.delete(item.packageId); return next; });
          showMessage('success', t('skills.uninstall_success_mcp', { name: item.name }));
        } else {
          showMessage('error', res.error || t('skills.uninstall_failed'));
        }
      } else {
        const res = await window.electron.skillUninstall({ skillId: item.packageId });
        if (res.success) {
          setInstalledSkillIds(prev => { const next = new Set(prev); next.delete(item.packageId); return next; });
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
        // 对于 bundle，用包内第一个 skill 的真实 ID 卸载
        const targetItems = installedItems.find(it => it.type === 'skill' && it.id === id);
        const uninstallId = targetItems?.bundleSkills?.[0]?.id || id;
        const res = await window.electron.skillUninstall({ skillId: uninstallId });
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
        const targetItems = installedItems.find(it => it.type === 'skill' && it.id === id);
        const publishId = targetItems?.bundleSkills?.[0]?.id || id;
        const res = await window.electron.skillPublish({ skillId: publishId });
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

        {/* 分类过滤 */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto max-w-[300px] no-scrollbar">
            <button
              onClick={() => { setSelectedCategoryId(undefined); setMcpPage(1); setSkillPage(1); }}
              className={`px-2.5 py-1 text-xs rounded-lg whitespace-nowrap transition-all shrink-0 ${
                !selectedCategoryId
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-white/[0.04] text-muted-foreground border border-white/[0.06] hover:text-foreground'
              }`}
            >
              {t('skills.all_categories')}
            </button>
            {categories.slice(0, 8).map((cat) => (
              <button
                key={cat.id}
                onClick={() => { setSelectedCategoryId(cat.id); setMcpPage(1); setSkillPage(1); }}
                className={`px-2.5 py-1 text-xs rounded-lg whitespace-nowrap transition-all shrink-0 ${
                  selectedCategoryId === cat.id
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'bg-white/[0.04] text-muted-foreground border border-white/[0.06] hover:text-foreground'
                }`}
                title={cat.description}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* 类型过滤 */}
        <div className="flex bg-white/[0.06] rounded-xl border border-white/[0.08] backdrop-blur-xl p-0.5">
          {(['all', 'mcp', 'skill'] as FilterType[]).map((ft) => (
            <button
              key={ft}
              onClick={() => { setFilterType(ft); setMcpPage(1); setSkillPage(1); }}
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
            <Download size={12} /> {t('skills.view_installed', { count: installedItems.length })}
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
            <MarketplaceList
              loading={marketLoading}
              error={marketError}
              filterType={filterType}
              isInstalled={isInstalled}
              mcpItems={sortedMcpItems} mcpTotalItems={mcpTotalItems} mcpPage={mcpPage} mcpTotalPages={mcpTotalPages}
              skillItems={sortedSkillItems} skillTotalItems={skillTotalItems} skillPage={skillPage} skillTotalPages={skillTotalPages}
              selectedPkg={selectedPkg}
              installing={installing} uninstalling={uninstalling}
              onSelect={handleSelectPackage}
              onInstall={handleInstall} onUninstall={handleUninstall}
              onMcpPageChange={setMcpPage} onSkillPageChange={setSkillPage}
            />
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
                        <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden">
                          <span className="text-sm font-medium truncate">{item.name}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">{item.type}</Badge>
                          {item.enabled ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0 bg-green-500/15 text-green-400 border-green-500/20">{t('skills.badge_enabled')}</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0 bg-yellow-500/15 text-yellow-400 border-yellow-500/20">{t('skills.badge_disabled')}</Badge>
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
                        {selectedPkg.recommendCount > 0 && (
                          <span className="text-xs flex items-center gap-1 text-orange-400">
                            <Star size={12} /> {t('skills.recommend_label', { count: selectedPkg.recommendCount })}
                          </span>
                        )}
                        {selectedPkg.commentCount > 0 && (
                          <span className="text-xs text-muted-foreground">{t('skills.comment_label', { count: selectedPkg.commentCount })}</span>
                        )}
                        {selectedPkg.ratingAvg > 0 && (
                          <span className="text-xs flex items-center gap-1 text-yellow-400">
                            <Star size={12} /> {selectedPkg.ratingAvg.toFixed(1)} ({selectedPkg.ratingCount})
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{t('skills.downloads_label', { count: selectedPkg.totalDownloads })}</span>
                        {selectedPkg.transport && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            selectedPkg.transport === 'stdio' ? 'bg-blue-500/15 text-blue-400' :
                            selectedPkg.transport === 'sse' ? 'bg-green-500/15 text-green-400' :
                            selectedPkg.transport === 'http' ? 'bg-yellow-500/15 text-yellow-400' :
                            'bg-white/[0.08] text-muted-foreground'
                          }`}>{selectedPkg.transport}</span>
                        )}
                      </div>
                      {selectedPkg.pricingModel === 1 && selectedPkg.unitPrice != null && (
                        <div className="mt-2 px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-lg inline-block">
                          <span className="text-xs text-orange-400">{t('skills.pricing_per_call', { price: selectedPkg.unitPrice })}</span>
                        </div>
                      )}
                      {selectedPkg.pricingModel === 2 && (
                        <div className="mt-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg inline-block">
                          <span className="text-xs text-purple-400">
                            {t('skills.pricing_subscription')}
                            {selectedPkg.subscriptionPriceMonthly != null && ` · ${t('skills.pricing_monthly', { price: selectedPkg.subscriptionPriceMonthly })}`}
                            {selectedPkg.subscriptionPriceYearly != null && ` · ${t('skills.pricing_yearly', { price: selectedPkg.subscriptionPriceYearly })}`}
                          </span>
                        </div>
                      )}
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
                            ? <><Loader2 size={14} className="animate-spin" /> {t('skills.uninstalling')}</>
                            : <><Trash2 size={14} /> {t('skills.uninstall')}</>}
                        </Button>
                      ) : selectedPkg.currentVersion ? (
                        <Button
                          variant="default" size="sm"
                          onClick={() => handleInstall(selectedPkg)}
                          disabled={installing === selectedPkg.packageId}
                          className="flex items-center gap-1.5 h-8"
                        >
                          {installing === selectedPkg.packageId
                            ? <><Loader2 size={14} className="animate-spin" /> {t('skills.installing')}</>
                            : <><Download size={14} /> {t('skills.install')}</>}
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

// ─── 市场列表子组件（MCP / Skill 双列表） ──────────────

interface SectionProps {
  type: 'mcp' | 'skill';
  items: MarketPackage[];
  totalItems: number;
  page: number;
  totalPages: number;
  selectedPkg: MarketPackage | null;
  installing: string | null;
  uninstalling: string | null;
  isInstalled: (item: MarketPackage) => boolean;
  onSelect: (item: MarketPackage) => void;
  onInstall: (item: MarketPackage) => void;
  onUninstall: (item: MarketPackage) => void;
  onPageChange: (p: number) => void;
}

function PackageListSection({
  type, items, totalItems, page, totalPages,
  selectedPkg, installing, uninstalling,
  isInstalled, onSelect, onInstall, onUninstall, onPageChange,
}: SectionProps) {
  const icon = type === 'mcp' ? <Wrench size={12} className="text-blue-400" /> : <Puzzle size={12} className="text-purple-400" />;
  const label = type === 'mcp' ? 'MCP' : 'Skill';

  return (
    <div className="flex flex-col border-b border-white/[0.08] last:border-b-0" style={{ maxHeight: '50%' }}>
      {/* 段头 */}
      <div className="h-7 flex items-center gap-1.5 px-3 bg-white/[0.03] border-b border-white/[0.06] shrink-0">
        {icon}
        <span className="text-[11px] font-semibold text-foreground/80">{label}</span>
        <span className="text-[10px] text-muted-foreground/50">({totalItems})</span>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="py-8 text-center text-[11px] text-muted-foreground/50">
            {type === 'mcp' ? t('skills.no_mcp_tools') : t('skills.no_skills')}
          </div>
        ) : (
          items.map((item) => {
            const installed = isInstalled(item);
            const isSelected = selectedPkg?.packageId === item.packageId;
            return (
              <div
                key={item.packageId}
                onClick={() => onSelect(item)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item); }}}
                role="button"
                tabIndex={0}
                className={`w-full text-left px-3 py-2 border-b border-white/[0.03] transition-all hover:bg-white/[0.04] cursor-pointer ${
                  isSelected ? 'bg-white/[0.06] border-l-2 border-l-primary' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[12px] font-medium truncate">{item.name}</span>
                      {installed && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 bg-green-500/15 text-green-400 border-green-500/20">
                          {t('skills.installed_badge')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
                    <div className="flex items-center gap-1.5 mt-1 text-[9px] text-muted-foreground/60">
                      {(item.recommendCount > 0 || item.commentCount > 0) && (
                        <>
                          {item.recommendCount > 0 && (
                            <span className="text-orange-400/80">{t('skills.recommend_label', { count: item.recommendCount })}</span>
                          )}
                          {item.commentCount > 0 && (
                            <span>{t('skills.comment_label', { count: item.commentCount })}</span>
                          )}
                          <span className="opacity-30">·</span>
                        </>
                      )}
                      <span>{item.authorName}</span>
                      {item.transport && (
                        <span className={`px-1 py-0.5 rounded text-[8px] font-medium ${
                          item.transport === 'stdio' ? 'bg-blue-500/15 text-blue-400' :
                          item.transport === 'sse' ? 'bg-green-500/15 text-green-400' :
                          item.transport === 'http' ? 'bg-yellow-500/15 text-yellow-400' :
                          'bg-white/[0.08] text-muted-foreground'
                        }`}>{item.transport}</span>
                      )}
                      {item.pricingModel > 0 && (
                        <span className="px-1 py-0.5 rounded text-[8px] font-medium bg-orange-500/15 text-orange-400">
                          {item.pricingModel === 1 ? t('skills.pricing_pay_per_use') : t('skills.pricing_subscription')}
                        </span>
                      )}
                      {item.currentVersion && <span>v{item.currentVersion}</span>}
                    </div>
                  </div>
                  {installed && (
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost" size="icon" className="h-5 w-5 text-red-400/70 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => onUninstall(item)}
                        disabled={uninstalling === item.packageId}
                        title={t('skills.uninstall')}
                      >
                        {uninstalling === item.packageId
                          ? <Loader2 size={10} className="animate-spin" />
                          : <Trash2 size={10} />}
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
      {totalPages > 1 && (
        <div className="h-7 border-t border-white/[0.06] flex items-center justify-between px-2 shrink-0 bg-white/[0.01]">
          <span className="text-[9px] text-muted-foreground/40">{page}/{totalPages}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={10} />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <ChevronRight size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface MarketplaceListProps {
  loading: boolean;
  error: string | null;
  filterType: FilterType;
  mcpItems: MarketPackage[]; mcpTotalItems: number; mcpPage: number; mcpTotalPages: number;
  skillItems: MarketPackage[]; skillTotalItems: number; skillPage: number; skillTotalPages: number;
  selectedPkg: MarketPackage | null;
  installing: string | null;
  uninstalling: string | null;
  onSelect: (item: MarketPackage) => void;
  onInstall: (item: MarketPackage) => void;
  onUninstall: (item: MarketPackage) => void;
  isInstalled: (item: MarketPackage) => boolean;
  onMcpPageChange: (p: number) => void;
  onSkillPageChange: (p: number) => void;
}

function MarketplaceList({
  loading, error, filterType, isInstalled,
  mcpItems, mcpTotalItems, mcpPage, mcpTotalPages,
  skillItems, skillTotalItems, skillPage, skillTotalPages,
  selectedPkg, installing, uninstalling,
  onSelect, onInstall, onUninstall,
  onMcpPageChange, onSkillPageChange,
}: MarketplaceListProps) {

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 size={20} className="animate-spin mr-2" /> {t('skills.loading')}
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-red-400 text-sm">{error}</div>;
  }

  const showMcp = filterType === 'all' || filterType === 'mcp';
  const showSkill = filterType === 'all' || filterType === 'skill';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {showMcp && (
        <PackageListSection
          type="mcp"
          items={mcpItems} totalItems={mcpTotalItems} page={mcpPage} totalPages={mcpTotalPages}
          selectedPkg={selectedPkg} installing={installing} uninstalling={uninstalling}
          isInstalled={isInstalled}
          onSelect={onSelect} onInstall={onInstall} onUninstall={onUninstall}
          onPageChange={onMcpPageChange}
        />
      )}
      {showSkill && (
        <PackageListSection
          type="skill"
          items={skillItems} totalItems={skillTotalItems} page={skillPage} totalPages={skillTotalPages}
          selectedPkg={selectedPkg} installing={installing} uninstalling={uninstalling}
          isInstalled={isInstalled}
          onSelect={onSelect} onInstall={onInstall} onUninstall={onUninstall}
          onPageChange={onSkillPageChange}
        />
      )}
    </div>
  );
}

export default memo(SkillsMCPPage);
