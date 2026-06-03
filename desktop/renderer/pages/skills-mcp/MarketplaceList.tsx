// ============================================================
// MarketplaceList - 天工坊市场 MCP/Skill 双列表组件
// ============================================================

import { Wrench, Puzzle, Trash2, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n';

export interface MarketPackage {
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

export type FilterType = 'all' | 'mcp' | 'skill';

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
      <div className="h-7 flex items-center gap-1.5 px-3 bg-white/[0.03] border-b border-white/[0.06] shrink-0">
        {icon}
        <span className="text-[11px] font-semibold text-foreground/80">{label}</span>
        <span className="text-[10px] text-muted-foreground/50">({totalItems})</span>
      </div>

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

export default function MarketplaceList({
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
