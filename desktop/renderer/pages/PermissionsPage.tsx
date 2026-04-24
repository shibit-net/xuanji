// ============================================================
// PermissionsPage - 权限管理页面
// ============================================================

import { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, Trash2, Search, X } from 'lucide-react';

interface PermissionsPageProps {
  onClose: () => void;
}

type TabType = 'decisions' | 'denied' | 'config' | 'audit';

interface Decision {
  key: string;
  tool: string;
  category: string;
  target: string;
  decision: 'always' | 'never';
  timestamp: number;
}

interface DeniedOp {
  key: string;
  tool: string;
  category: string;
  target: string;
  reason: string;
  timestamp: number;
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
    if (!confirm('确认清空所有决策记录？')) return;
    await window.electron.permissionClearRules();
    load();
  };

  const filtered = decisions.filter(d => {
    const matchSearch = !search || d.tool.includes(search) || d.target?.includes(search);
    const matchFilter = filter === 'all' || (filter === 'allow' ? d.decision === 'always' : d.decision === 'never');
    return matchSearch && matchFilter;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索工具或目标..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-bg-tertiary border border-bg-tertiary rounded focus:outline-none focus:border-primary"
          />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as any)} className="px-2 py-1.5 text-sm bg-bg-tertiary border border-bg-tertiary rounded">
          <option value="all">全部</option>
          <option value="allow">允许</option>
          <option value="deny">拒绝</option>
        </select>
        <button onClick={load} disabled={loading} className="p-1.5 hover:bg-bg-tertiary rounded">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button onClick={handleClear} className="px-2 py-1.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded">
          清空
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {filtered.map(d => (
          <div key={d.key} className="bg-bg-secondary rounded border border-bg-tertiary p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-semibold">{d.tool}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${d.decision === 'always' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    {d.decision === 'always' ? '总是允许' : '总是拒绝'}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">{d.category}</span>
                </div>
                <p className="text-xs text-text-secondary truncate">{d.target}</p>
                <p className="text-xs text-text-tertiary mt-1">{new Date(d.timestamp).toLocaleString()}</p>
              </div>
              <button onClick={() => handleDelete(d.key)} className="p-1 hover:bg-bg-tertiary rounded">
                <Trash2 size={14} className="text-text-secondary" />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-text-secondary text-sm py-8">暂无决策记录</p>}
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
    if (!confirm('确认清空所有拒绝记录？')) return;
    await window.electron.permissionDeniedClear();
    load();
  };

  const filtered = filter === 'all' ? deniedOps : deniedOps.filter(d => d.category === filter);

  if (loading) return <div className="p-4 text-text-secondary">加载中...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex gap-2">
          {['all', 'file', 'command'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-sm transition-colors ${filter === f ? 'bg-accent text-white' : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'}`}
            >
              {f === 'all' ? '全部' : f === 'file' ? '文件' : '命令'}
            </button>
          ))}
        </div>
        <button
          onClick={handleClear}
          className="px-3 py-1 bg-red-500/20 text-red-400 rounded text-sm hover:bg-red-500/30 transition-colors"
        >
          清空
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 p-4">
        {filtered.map(d => (
          <div key={d.key} className="bg-bg-secondary rounded border border-bg-tertiary p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-semibold">{d.tool}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${d.category === 'file' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                    {d.category}
                  </span>
                </div>
                <div className="text-xs text-text-secondary mb-1">
                  <span className="font-semibold">目标:</span> {d.target}
                </div>
                {d.reason && (
                  <div className="text-xs text-text-secondary">
                    <span className="font-semibold">原因:</span> {d.reason}
                  </div>
                )}
                <div className="text-xs text-text-tertiary mt-1">
                  {new Date(d.timestamp).toLocaleString('zh-CN')}
                </div>
              </div>
              <button
                onClick={() => handleDelete(d.key)}
                className="p-1 hover:bg-bg-tertiary rounded transition-colors"
                title="删除"
              >
                <Trash2 size={14} className="text-text-secondary" />
              </button>
            </div>
          </div>
        ))}
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

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await window.electron.permissionConfigGet();
      if (res.success && res.config) {
        setConfig(res.config);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    if (!config) return;
    try {
      await window.electron.permissionConfigUpdate({ updates: config });
      alert('配置已保存');
      onRefresh();
    } catch (err) {
      console.error('Failed to save config:', err);
      alert('保存失败');
    }
  };

  if (loading) return <div className="p-4 text-text-secondary">加载中...</div>;
  if (!config) return <div className="p-4 text-text-secondary">无法加载配置</div>;

  return (
    <div className="flex flex-col h-full p-4 space-y-4 overflow-y-auto">
      <div className="space-y-3">
        <div className="text-sm font-semibold text-text-primary">基础权限</div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.fileRead}
            onChange={e => setConfig({ ...config, fileRead: e.target.checked })}
          />
          <span className="text-sm">文件读取</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.fileWrite}
            onChange={e => setConfig({ ...config, fileWrite: e.target.checked })}
          />
          <span className="text-sm">文件写入</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.bashExec}
            onChange={e => setConfig({ ...config, bashExec: e.target.checked })}
          />
          <span className="text-sm">命令执行</span>
        </label>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-semibold text-text-primary">策略设置</div>
        <div>
          <label className="text-xs text-text-secondary">警告级别处理</label>
          <select
            value={config.warnLevel}
            onChange={e => setConfig({ ...config, warnLevel: e.target.value as any })}
            className="w-full mt-1 px-2 py-1 bg-bg-secondary border border-bg-tertiary rounded text-sm"
          >
            <option value="ask">询问确认</option>
            <option value="auto-allow">自动允许</option>
          </select>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.confirmWrite}
            onChange={e => setConfig({ ...config, confirmWrite: e.target.checked })}
          />
          <span className="text-sm">写入前确认</span>
        </label>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-semibold text-text-primary">路径白名单</div>
        <textarea
          value={config.allowedPaths?.join('\n') || ''}
          onChange={e => setConfig({ ...config, allowedPaths: e.target.value.split('\n').filter(Boolean) })}
          className="w-full h-20 px-2 py-1 bg-bg-secondary border border-bg-tertiary rounded text-xs font-mono"
          placeholder="每行一个路径"
        />
      </div>

      <div className="space-y-3">
        <div className="text-sm font-semibold text-text-primary">路径黑名单</div>
        <textarea
          value={config.deniedPaths?.join('\n') || ''}
          onChange={e => setConfig({ ...config, deniedPaths: e.target.value.split('\n').filter(Boolean) })}
          className="w-full h-20 px-2 py-1 bg-bg-secondary border border-bg-tertiary rounded text-xs font-mono"
          placeholder="每行一个路径"
        />
      </div>

      <div className="space-y-3">
        <div className="text-sm font-semibold text-text-primary">命令白名单</div>
        <textarea
          value={config.allowedCommands?.join('\n') || ''}
          onChange={e => setConfig({ ...config, allowedCommands: e.target.value.split('\n').filter(Boolean) })}
          className="w-full h-20 px-2 py-1 bg-bg-secondary border border-bg-tertiary rounded text-xs font-mono"
          placeholder="每行一个命令"
        />
      </div>

      <div className="space-y-3">
        <div className="text-sm font-semibold text-text-primary">命令黑名单</div>
        <textarea
          value={config.deniedCommands?.join('\n') || ''}
          onChange={e => setConfig({ ...config, deniedCommands: e.target.value.split('\n').filter(Boolean) })}
          className="w-full h-20 px-2 py-1 bg-bg-secondary border border-bg-tertiary rounded text-xs font-mono"
          placeholder="每行一个命令"
        />
      </div>

      <button
        onClick={handleSave}
        className="px-4 py-2 bg-accent text-white rounded hover:bg-accent/80 transition-colors"
      >
        保存配置
      </button>
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
      if (statsRes.success) setStats(statsRes.stats);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleClear = async () => {
    if (!confirm('确认清空所有审计日志？')) return;
    await window.electron.permissionAuditClear();
    load();
  };

  const filtered = logs.filter(log => {
    if (toolFilter && !log.toolName.includes(toolFilter)) return false;
    if (decisionFilter !== 'all' && log.decision !== decisionFilter) return false;
    if (riskFilter !== 'all' && log.riskLevel !== riskFilter) return false;
    return true;
  });

  if (loading) return <div className="p-4 text-text-secondary">加载中...</div>;

  return (
    <div className="flex flex-col h-full">
      {stats && (
        <div className="p-4 grid grid-cols-3 gap-3 border-b border-bg-tertiary">
          <div className="bg-bg-secondary rounded p-3">
            <div className="text-xs text-text-secondary">总检查次数</div>
            <div className="text-xl font-semibold text-text-primary">{stats.totalChecks}</div>
          </div>
          <div className="bg-bg-secondary rounded p-3">
            <div className="text-xs text-text-secondary">允许率</div>
            <div className="text-xl font-semibold text-green-400">{(stats.allowRate * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-bg-secondary rounded p-3">
            <div className="text-xs text-text-secondary">拒绝次数</div>
            <div className="text-xl font-semibold text-red-400">{stats.deniedCount}</div>
          </div>
        </div>
      )}

      <div className="p-4 border-b border-bg-tertiary space-y-2">
        <input
          type="text"
          placeholder="搜索工具名..."
          value={toolFilter}
          onChange={e => setToolFilter(e.target.value)}
          className="w-full px-2 py-1 bg-bg-secondary border border-bg-tertiary rounded text-sm"
        />
        <div className="flex gap-2">
          <select
            value={decisionFilter}
            onChange={e => setDecisionFilter(e.target.value)}
            className="flex-1 px-2 py-1 bg-bg-secondary border border-bg-tertiary rounded text-sm"
          >
            <option value="all">所有决策</option>
            <option value="allow">允许</option>
            <option value="deny">拒绝</option>
          </select>
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
            className="flex-1 px-2 py-1 bg-bg-secondary border border-bg-tertiary rounded text-sm"
          >
            <option value="all">所有风险</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
          <button
            onClick={handleClear}
            className="px-3 py-1 bg-red-500/20 text-red-400 rounded text-sm hover:bg-red-500/30 transition-colors"
          >
            清空
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filtered.map((log, idx) => (
          <div key={idx} className="bg-bg-secondary rounded border border-bg-tertiary p-3 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono font-semibold">{log.toolName}</span>
              <span className={`px-2 py-0.5 rounded ${log.decision === 'allow' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {log.decision}
              </span>
              {log.riskLevel && (
                <span className={`px-2 py-0.5 rounded ${log.riskLevel === 'high' ? 'bg-red-500/20 text-red-400' : log.riskLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>
                  {log.riskLevel}
                </span>
              )}
            </div>
            {log.target && (
              <div className="text-text-secondary mb-1">
                <span className="font-semibold">目标:</span> {log.target}
              </div>
            )}
            {log.reason && (
              <div className="text-text-secondary mb-1">
                <span className="font-semibold">原因:</span> {log.reason}
              </div>
            )}
            <div className="text-text-tertiary">
              {new Date(log.timestamp).toLocaleString('zh-CN')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================
export default function PermissionsPage({ onClose }: PermissionsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('decisions');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => setRefreshKey(k => k + 1);

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-tertiary">
        <h1 className="text-lg font-semibold">权限管理</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
            title="刷新"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex border-b border-bg-tertiary">
        {[
          { key: 'decisions' as TabType, label: '📋 决策记录' },
          { key: 'denied' as TabType, label: '🚫 拒绝记录' },
          { key: 'config' as TabType, label: '⚙️ 配置' },
          { key: 'audit' as TabType, label: '📊 审计日志' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm transition-colors ${activeTab === tab.key ? 'bg-bg-secondary text-text-primary border-b-2 border-accent' : 'text-text-secondary hover:bg-bg-tertiary'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div key={refreshKey} className="flex-1 overflow-hidden">
        {activeTab === 'decisions' && <DecisionsTab />}
        {activeTab === 'denied' && <DeniedTab />}
        {activeTab === 'config' && <ConfigTab onRefresh={handleRefresh} />}
        {activeTab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
}
