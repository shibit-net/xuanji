// ============================================================
// PermissionsPage - 权限管理页面
// ============================================================

import { useState, useEffect, memo } from 'react';
import { RefreshCw, Trash2, Search, X, Save, Shield, FileText, Terminal, AlertTriangle, List, Sliders, BarChart3 } from 'lucide-react';
import { t } from '@/core/i18n';

interface PermissionsPageProps {
  onClose: () => void;
}

type TabType = 'decisions' | 'denied' | 'config' | 'audit';

interface Decision {
  cacheKey: string;
  toolName: string;
  allowed: boolean;
  timestamp: string;
  expiresAt?: string;
}

interface DeniedOp {
  key: string;
  tool: string;
  category: string;
  pattern: string;
  reason: string;
  timestamp: string;
  sessionOnly: boolean;
}

interface AuditLog {
  id: number;
  eventType: string;
  toolName: string;
  category?: string;
  riskLevel?: string;
  decision: string;
  reason?: string;
  target?: string;
  userAction?: string;
  timestamp: number;
  sessionId?: string;
}

interface AuditStats {
  totalChecks: number;
  allowedCount: number;
  deniedCount: number;
  allowRate: number;
}

interface PermissionConfig {
  fileRead: boolean;
  fileWrite: boolean;
  bashExec: boolean;
  warnLevel: 'auto-allow' | 'ask';
  confirmWrite: boolean;
  allowedPaths?: string[];
  deniedPaths?: string[];
  allowedCommands?: string[];
  deniedCommands?: string[];
}

// ─── 子组件 — 空状态 ──────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
      <List size={32} className="opacity-20" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ─── 子组件 — 加载状态 ──────────────────────────────────
function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <RefreshCw size={16} className="animate-spin mr-2" /> {t('permissions.loading')}
    </div>
  );
}

// ============================================================
// Tab: 决策记录
// ============================================================
function DecisionsTab() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'allow' | 'deny'>('all');

  const load = async () => {
    setLoading(true);
    try {
      const res = await window.electron.permissionListRules();
      if (res.success) setDecisions(res.rules || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (cacheKey: string) => {
    await window.electron.permissionDeleteRule({ cacheKey });
    load();
  };

  const handleClear = async () => {
    if (!confirm(t('permissions.confirm_clear_decisions'))) return;
    await window.electron.permissionClearRules();
    load();
  };

  const filtered = decisions.filter(d => {
    const matchSearch = !search || d.toolName.includes(search) || d.cacheKey.includes(search);
    const matchFilter = filter === 'all' || (filter === 'allow' ? d.allowed : !d.allowed);
    return matchSearch && matchFilter;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-white/[0.08]">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('permissions.decisions.search_placeholder')}
            className="w-full h-8 pl-9 pr-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-sm text-foreground placeholder:text-white/30 backdrop-blur-xl focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex bg-white/[0.06] rounded-xl border border-white/[0.08] backdrop-blur-xl p-0.5">
          {(['all', 'allow', 'deny'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`px-3 py-1 text-xs rounded-lg transition-all ${
                filter === v
                  ? 'bg-white/[0.12] text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v === 'all' ? t('permissions.decisions.filter_all') : v === 'allow' ? t('permissions.decisions.filter_allow') : t('permissions.decisions.filter_deny')}
            </button>
          ))}
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button onClick={handleClear} className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors">
          <Trash2 size={12} /> {t('permissions.decisions.btn_clear')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {loading ? <LoadingState /> : filtered.length === 0 ? <EmptyState text={t('permissions.decisions.empty')} /> : (
          filtered.map(d => (
            <div key={d.cacheKey} className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 hover:bg-white/[0.06] transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-semibold">{d.toolName}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-md ${
                      d.allowed
                        ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                        : 'bg-red-500/15 text-red-400 border border-red-500/20'
                    }`}>
                      {d.allowed ? t('permissions.decisions.badge_always_allow') : t('permissions.decisions.badge_always_deny')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate" title={d.cacheKey}>{d.cacheKey}</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">{new Date(d.timestamp).toLocaleString()}</p>
                </div>
                <button onClick={() => handleDelete(d.cacheKey)} className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors shrink-0">
                  <Trash2 size={14} className="text-muted-foreground/60 hover:text-red-400" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// Tab: 拒绝记录
// ============================================================
function DeniedTab() {
  const [deniedOps, setDeniedOps] = useState<DeniedOp[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    try {
      const res = await window.electron.permissionDeniedList();
      if (res.success) setDeniedOps(res.deniedOps || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (key: string) => {
    await window.electron.permissionDeniedDelete({ key });
    load();
  };

  const handleClear = async () => {
    if (!confirm(t('permissions.confirm_clear_denied'))) return;
    await window.electron.permissionDeniedClear();
    load();
  };

  const filtered = filter === 'all' ? deniedOps : deniedOps.filter(d => d.category === filter);

  const categories = [
    { key: 'all', label: t('permissions.denied.title_all'), icon: List },
    { key: 'fileRead', label: t('permissions.denied.category_file_read'), icon: FileText },
    { key: 'fileWrite', label: t('permissions.denied.category_file_write'), icon: FileText },
    { key: 'bashExec', label: t('permissions.denied.category_bash_exec'), icon: Terminal },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
        <div className="flex bg-white/[0.06] rounded-xl border border-white/[0.08] backdrop-blur-xl p-0.5">
          {categories.map(f => {
            const Icon = f.icon;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1 px-3 py-1 text-xs rounded-lg transition-all ${
                  filter === f.key
                    ? 'bg-white/[0.12] text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={12} /> {f.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={handleClear}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
        >
          <Trash2 size={12} /> {t('permissions.denied.btn_clear')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {loading ? <LoadingState /> : filtered.length === 0 ? <EmptyState text={t('permissions.denied.empty')} /> : (
          filtered.map(d => (
            <div key={d.key} className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 hover:bg-white/[0.06] transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-semibold">{d.pattern.split(':')[0] || d.pattern}</span>
                    <span className={`px-2 py-0.5 rounded-md text-xs border ${
                      d.category.includes('file')
                        ? 'bg-blue-500/15 text-blue-400 border-blue-500/20'
                        : 'bg-purple-500/15 text-purple-400 border-purple-500/20'
                    }`}>
                      {d.category}
                    </span>
                    {d.sessionOnly && (
                      <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-md">{t('permissions.denied.badge_session')}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mb-0.5">
                    <span className="font-semibold">{t('permissions.denied.label_target')}</span> <span className="font-mono">{d.pattern}</span>
                  </div>
                  {d.reason && (
                    <div className="text-xs text-muted-foreground mb-0.5">
                      <span className="font-semibold">{t('permissions.denied.label_reason')}</span> {d.reason}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground/50 mt-1">{new Date(d.timestamp).toLocaleString('zh-CN')}</div>
                </div>
                <button
                  onClick={() => handleDelete(d.key)}
                  className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors shrink-0"
                  title={t('permissions.denied.title_delete')}
                >
                  <Trash2 size={14} className="text-muted-foreground/60 hover:text-red-400" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// Tab: 权限配置
// ============================================================
const ConfigTab: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const [config, setConfig] = useState<PermissionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await window.electron.permissionConfigGet();
      if (res.success && res.config) {
        setConfig(res.config as any);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfig(); }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await window.electron.permissionConfigUpdate({ updates: config });
      setSaveMsg({ type: 'success', text: t('permissions.config.save_success') });
      setTimeout(() => setSaveMsg(null), 3000);
      onRefresh();
    } catch (err) {
      setSaveMsg({ type: 'error', text: t('permissions.config.save_failed') });
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!config) return <EmptyState text={t('permissions.config.load_failed')} />;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {saveMsg && (
        <div className={`px-4 py-2 text-xs flex items-center gap-2 border-b ${
          saveMsg.type === 'success'
            ? 'bg-green-500/15 text-green-400 border-green-500/20'
            : 'bg-red-500/15 text-red-400 border-red-500/20'
        }`}>
          {saveMsg.type === 'success' ? <AlertTriangle size={12} /> : <X size={12} />}
          {saveMsg.text}
        </div>
      )}

      <div className="flex-1 p-6 space-y-6 max-w-2xl">
        {/* 基础权限 */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-3">
            <Shield size={14} /> {t('permissions.config.title_basic')}
          </h3>
          <div className="space-y-2 bg-white/[0.04] border border-white/[0.06] rounded-xl p-4">
            {[
              { key: 'fileRead' as const, label: t('permissions.config.label_file_read'), icon: FileText },
              { key: 'fileWrite' as const, label: t('permissions.config.label_file_write'), icon: FileText },
              { key: 'bashExec' as const, label: t('permissions.config.label_bash_exec'), icon: Terminal },
            ].map(({ key, label, icon: Icon }) => (
              <label key={key} className="flex items-center gap-3 py-1 cursor-pointer group">
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                  config[key]
                    ? 'bg-primary/80 border-primary/80'
                    : 'border-white/[0.2] group-hover:border-white/[0.3]'
                }`}>
                  {config[key] && <span className="text-white text-xs leading-none">✓</span>}
                </div>
                <input
                  type="checkbox"
                  checked={config[key]}
                  onChange={e => setConfig({ ...config, [key]: e.target.checked })}
                  className="sr-only"
                />
                <Icon size={14} className="text-muted-foreground" />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* 策略设置 */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-3">
            <Sliders size={14} /> {t('permissions.config.title_strategy')}
          </h3>
          <div className="space-y-3 bg-white/[0.04] border border-white/[0.06] rounded-xl p-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t('permissions.config.label_warn_level')}</label>
              <select
                value={config.warnLevel}
                onChange={e => setConfig({ ...config, warnLevel: e.target.value as any })}
                className="w-full h-8 px-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-sm text-foreground backdrop-blur-xl focus:outline-none focus:border-primary/50"
              >
                <option value="ask">{t('permissions.config.warn_ask')}</option>
                <option value="auto-allow">{t('permissions.config.warn_auto_allow')}</option>
              </select>
            </div>
            <label className="flex items-center gap-3 py-1 cursor-pointer group">
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                config.confirmWrite
                  ? 'bg-primary/80 border-primary/80'
                  : 'border-white/[0.2] group-hover:border-white/[0.3]'
              }`}>
                {config.confirmWrite && <span className="text-white text-xs leading-none">✓</span>}
              </div>
              <input
                type="checkbox"
                checked={config.confirmWrite}
                onChange={e => setConfig({ ...config, confirmWrite: e.target.checked })}
                className="sr-only"
              />
              <span className="text-sm">{t('permissions.config.label_confirm_write')}</span>
            </label>
          </div>
        </section>

        {/* 路径白名单 */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-3">
            <FileText size={14} /> {t('permissions.config.title_allow_paths')}
          </h3>
          <textarea
            value={config.allowedPaths?.join('\n') || ''}
            onChange={e => setConfig({ ...config, allowedPaths: e.target.value.split('\n').filter(Boolean) })}
            className="w-full h-24 px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-xs font-mono text-foreground placeholder:text-white/20 backdrop-blur-xl focus:outline-none focus:border-primary/50 resize-none"
            placeholder={t('permissions.config.placeholder_path')}
          />
        </section>

        {/* 路径黑名单 */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-3">
            <FileText size={14} /> {t('permissions.config.title_deny_paths')}
          </h3>
          <textarea
            value={config.deniedPaths?.join('\n') || ''}
            onChange={e => setConfig({ ...config, deniedPaths: e.target.value.split('\n').filter(Boolean) })}
            className="w-full h-24 px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-xs font-mono text-foreground placeholder:text-white/20 backdrop-blur-xl focus:outline-none focus:border-primary/50 resize-none"
            placeholder={t('permissions.config.placeholder_path')}
          />
        </section>

        {/* 命令白名单 */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-3">
            <Terminal size={14} /> {t('permissions.config.title_allow_commands')}
          </h3>
          <textarea
            value={config.allowedCommands?.join('\n') || ''}
            onChange={e => setConfig({ ...config, allowedCommands: e.target.value.split('\n').filter(Boolean) })}
            className="w-full h-24 px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-xs font-mono text-foreground placeholder:text-white/20 backdrop-blur-xl focus:outline-none focus:border-primary/50 resize-none"
            placeholder={t('permissions.config.placeholder_command')}
          />
        </section>

        {/* 命令黑名单 */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-3">
            <Terminal size={14} /> {t('permissions.config.title_deny_commands')}
          </h3>
          <textarea
            value={config.deniedCommands?.join('\n') || ''}
            onChange={e => setConfig({ ...config, deniedCommands: e.target.value.split('\n').filter(Boolean) })}
            className="w-full h-24 px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-xs font-mono text-foreground placeholder:text-white/20 backdrop-blur-xl focus:outline-none focus:border-primary/50 resize-none"
            placeholder={t('permissions.config.placeholder_command')}
          />
        </section>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2.5 bg-primary/80 text-white rounded-xl hover:bg-primary transition-colors text-sm disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          {t('permissions.config.btn_save')}
        </button>
      </div>
    </div>
  );
};

// ============================================================
// Tab: 审计日志
// ============================================================
const AuditTab: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [toolFilter, setToolFilter] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const [logsRes, statsRes] = await Promise.all([
        window.electron.permissionAuditList({}),
        window.electron.permissionAuditStats()
      ]);
      if (logsRes.success) setLogs(logsRes.logs || []);
      if (statsRes.success) setStats(statsRes.stats as any);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleClear = async () => {
    if (!confirm(t('permissions.confirm_clear_audit'))) return;
    await window.electron.permissionAuditClear();
    load();
  };

  const filtered = logs.filter(log => {
    if (toolFilter && !log.toolName.includes(toolFilter)) return false;
    if (decisionFilter !== 'all' && log.decision !== decisionFilter) return false;
    if (riskFilter !== 'all' && log.riskLevel !== riskFilter) return false;
    return true;
  });

  const riskColor = (level?: string) => {
    switch (level) {
      case 'high': return 'bg-red-500/15 text-red-400 border-red-500/20';
      case 'medium': return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20';
      case 'low': return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
      default: return 'bg-white/[0.06] text-muted-foreground border-white/[0.08]';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 p-4 border-b border-white/[0.08]">
          <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4 backdrop-blur-xl">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{t('permissions.audit.card_total')}</div>
            <div className="text-2xl font-semibold">{stats.totalChecks}</div>
          </div>
          <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4 backdrop-blur-xl">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{t('permissions.audit.card_allow_rate')}</div>
            <div className="text-2xl font-semibold text-green-400">{(stats.allowRate * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4 backdrop-blur-xl">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{t('permissions.audit.card_denied')}</div>
            <div className="text-2xl font-semibold text-red-400">{stats.deniedCount}</div>
          </div>
        </div>
      )}

      {/* 过滤栏 */}
      <div className="p-4 border-b border-white/[0.08] space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('permissions.audit.search_placeholder')}
            value={toolFilter}
            onChange={e => setToolFilter(e.target.value)}
            className="w-full h-8 pl-9 pr-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-sm text-foreground placeholder:text-white/30 backdrop-blur-xl focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={decisionFilter}
            onChange={e => setDecisionFilter(e.target.value)}
            className="flex-1 h-8 px-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-sm text-foreground backdrop-blur-xl focus:outline-none focus:border-primary/50"
          >
            <option value="all">{t('permissions.audit.filter_decision')}</option>
            <option value="allow">{t('permissions.audit.filter_allow')}</option>
            <option value="deny">{t('permissions.audit.filter_deny')}</option>
          </select>
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
            className="flex-1 h-8 px-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-sm text-foreground backdrop-blur-xl focus:outline-none focus:border-primary/50"
          >
            <option value="all">{t('permissions.audit.filter_risk')}</option>
            <option value="low">{t('permissions.audit.filter_low')}</option>
            <option value="medium">{t('permissions.audit.filter_medium')}</option>
            <option value="high">{t('permissions.audit.filter_high')}</option>
          </select>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors shrink-0"
          >
            <Trash2 size={12} /> {t('permissions.audit.btn_clear')}
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {loading ? <LoadingState /> : filtered.length === 0 ? <EmptyState text={t('permissions.audit.empty')} /> : (
          filtered.map((log, idx) => (
            <div key={idx} className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 hover:bg-white/[0.06] transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs font-semibold">{log.toolName}</span>
                <span className={`px-2 py-0.5 rounded-md text-xs border ${
                  log.decision === 'allow'
                    ? 'bg-green-500/15 text-green-400 border-green-500/20'
                    : 'bg-red-500/15 text-red-400 border-red-500/20'
                }`}>
                  {log.decision}
                </span>
                {log.riskLevel && (
                  <span className={`px-2 py-0.5 rounded-md text-xs border ${riskColor(log.riskLevel)}`}>
                    {log.riskLevel}
                  </span>
                )}
              </div>
              {log.target && (
                <div className="text-xs text-muted-foreground mb-0.5">
                  <span className="font-semibold">{t('permissions.audit.label_target')}</span> <span className="font-mono">{log.target}</span>
                </div>
              )}
              {log.reason && (
                <div className="text-xs text-muted-foreground mb-0.5">
                  <span className="font-semibold">{t('permissions.audit.label_reason')}</span> {log.reason}
                </div>
              )}
              <div className="text-xs text-muted-foreground/50">{new Date(log.timestamp).toLocaleString('zh-CN')}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================
function PermissionsPage({ onClose }: PermissionsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('decisions');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => setRefreshKey(k => k + 1);

  const tabs = [
    { key: 'decisions' as TabType, label: t('permissions.tab.decisions'), icon: Shield },
    { key: 'denied' as TabType, label: t('permissions.tab.denied'), icon: List },
    { key: 'config' as TabType, label: t('permissions.tab.config'), icon: Sliders },
    { key: 'audit' as TabType, label: t('permissions.tab.audit'), icon: BarChart3 },
  ];

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-white/[0.08] bg-white/[0.02] backdrop-blur-xl shrink-0">
        <h1 className="text-base font-semibold flex items-center gap-2">
          <Shield size={16} className="text-muted-foreground" />
          {t('permissions.title')}
        </h1>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors"
            title={t('permissions.title_refresh')}
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors"
            title={t('permissions.title_close')}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="flex border-b border-white/[0.08] px-2 bg-white/[0.02]">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs transition-all border-b-2 -mb-px ${
                isActive
                  ? 'text-foreground border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-white/[0.1]'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      <div key={refreshKey} className="flex-1 overflow-hidden">
        {activeTab === 'decisions' && <DecisionsTab />}
        {activeTab === 'denied' && <DeniedTab />}
        {activeTab === 'config' && <ConfigTab onRefresh={handleRefresh} />}
        {activeTab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
}

export default memo(PermissionsPage);
