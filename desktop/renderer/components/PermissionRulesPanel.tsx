// ============================================================
// PermissionRulesPanel - 权限规则管理面板
// ============================================================
// 展示所有持久化的"始终允许"/"永远拒绝"规则，支持删除和清空。
// 删除后，下次遇到同类操作会重新询问用户。
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldCheck, ShieldX, Trash2, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import type { PermissionRule } from '../global';
import { t } from '@/core/i18n';

/** 格式化 cacheKey 为可读描述（去掉 hash 部分） */
function formatCacheKey(cacheKey: string): string {
  // cacheKey 通常是 toolName:description 格式或带截断的内容
  // 显示时最多 80 字符
  if (cacheKey.length > 80) {
    return cacheKey.slice(0, 77) + '...';
  }
  return cacheKey;
}

/** 格式化时间戳 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function PermissionRulesPanel() {
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  // 加载规则列表
  const loadRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.electron.permissionListRules();
      if (result.success) {
        // 按时间倒序排列
        const sorted = [...(result.rules ?? [])].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setRules(sorted);
      } else {
        setError(result.error ?? t('permrules.load_failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('permrules.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // 删除单条规则
  const handleDelete = async (cacheKey: string) => {
    setDeletingKeys((prev) => new Set([...prev, cacheKey]));
    try {
      const result = await window.electron.permissionDeleteRule({ cacheKey });
      if (result.success) {
        setRules((prev) => prev.filter((r) => r.cacheKey !== cacheKey));
      } else {
        setError(result.error ?? t('permrules.delete_failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('permrules.delete_failed'));
    } finally {
      setDeletingKeys((prev) => {
        const next = new Set(prev);
        next.delete(cacheKey);
        return next;
      });
    }
  };

  // 清空所有规则
  const handleClearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setClearing(true);
    setConfirmClear(false);
    try {
      const result = await window.electron.permissionClearRules();
      if (result.success) {
        setRules([]);
      } else {
        setError(result.error ?? t('permrules.clear_failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('permrules.clear_failed'));
    } finally {
      setClearing(false);
    }
  };

  // 按工具分组
  const rulesByTool = rules.reduce<Record<string, PermissionRule[]>>((acc, rule) => {
    const tool = rule.toolName || t('permrules.unknown_tool');
    if (!acc[tool]) acc[tool] = [];
    acc[tool].push(rule);
    return acc;
  }, {});

  const allowedCount = rules.filter((r) => r.allowed).length;
  const deniedCount = rules.filter((r) => !r.allowed).length;

  return (
    <div className="space-y-4">
      {/* 头部统计 + 操作 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield size={18} className="text-primary" />
          <span className="text-sm font-semibold">{t('permrules.title')}</span>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            {allowedCount > 0 && (
              <span className="flex items-center gap-1 text-green-500">
                <ShieldCheck size={12} />
                {t('permrules.always_allow', { count: allowedCount })}
              </span>
            )}
            {deniedCount > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <ShieldX size={12} />
                {t('permrules.never_deny', { count: deniedCount })}
              </span>
            )}
            {rules.length === 0 && !loading && (
              <span className="text-text-secondary">{t('permrules.no_rules')}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 刷新 */}
          <button
            onClick={loadRules}
            disabled={loading}
            className="p-1.5 hover:bg-bg-tertiary rounded transition-colors text-text-secondary hover:text-text-primary disabled:opacity-50"
            title={t('permrules.refresh')}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          {/* 清空全部 */}
          {rules.length > 0 && (
            <button
              onClick={handleClearAll}
              disabled={clearing}
              className={`px-2 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                confirmClear
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'text-text-secondary hover:text-red-500 hover:bg-bg-tertiary'
              }`}
            >
              {clearing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              {confirmClear ? t('permrules.confirm_clear') : t('permrules.clear_all')}
            </button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">
          <AlertTriangle size={14} />
          {error}
          <button onClick={() => setError('')} className="ml-auto hover:text-red-700">×</button>
        </div>
      )}

      {/* 提示文字 */}
      <p className="text-xs text-text-secondary">
        {t('permrules.hint')}
      </p>

      {/* 规则列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-text-secondary">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-sm">{t('permrules.loading')}</span>
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-text-secondary">
          <Shield size={32} className="mb-2 opacity-30" />
          <p className="text-sm">{t('permrules.empty_title')}</p>
          <p className="text-xs mt-1 opacity-60">{t('permrules.empty_hint')}</p>
        </div>
      ) : (
        <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
          {Object.entries(rulesByTool).map(([toolName, toolRules]) => (
            <div key={toolName}>
              {/* 工具名称分组标题 */}
              <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1.5 px-1">
                {toolName}
              </div>
              <div className="space-y-1">
                {toolRules.map((rule) => (
                  <div
                    key={rule.cacheKey}
                    className="flex items-start gap-2 p-2.5 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors group"
                  >
                    {/* 状态图标 */}
                    <div className="flex-shrink-0 mt-0.5">
                      {rule.allowed ? (
                        <ShieldCheck size={15} className="text-green-500" />
                      ) : (
                        <ShieldX size={15} className="text-red-500" />
                      )}
                    </div>

                    {/* 内容 */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium ${rule.allowed ? 'text-green-500' : 'text-red-500'}`}>
                        {rule.allowed ? t('permrules.rule_always_allow') : t('permrules.rule_never_deny')}
                      </div>
                      <div
                        className="text-xs text-text-secondary mt-0.5 font-mono break-all"
                        title={rule.cacheKey}
                      >
                        {formatCacheKey(rule.cacheKey)}
                      </div>
                      <div className="text-xs text-text-secondary opacity-60 mt-1">
                        {formatTime(String(rule.timestamp))}
                        {rule.expiresAt && (
                          <span className="ml-2 text-yellow-500">
                            {t('permrules.label_expires', { date: formatTime(String(rule.expiresAt)) })}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 删除按钮 */}
                    <button
                      onClick={() => handleDelete(rule.cacheKey)}
                      disabled={deletingKeys.has(rule.cacheKey)}
                      className="flex-shrink-0 p-1 rounded hover:bg-red-500/10 hover:text-red-500 text-text-secondary opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      title={t('permrules.delete_rule')}
                    >
                      {deletingKeys.has(rule.cacheKey) ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
