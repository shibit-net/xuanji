// ============================================================
// SchedulerPage - 定时任务管理页面
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Clock, X, Plus, Trash2, RefreshCw, AlertCircle,
  Power, Play, Calendar, Tag, CheckCircle, XCircle,
} from 'lucide-react';

interface SchedulerPageProps {
  onClose: () => void;
}

type TabType = 'jobs' | 'logs';

// ─── 类型 ──────────────────────────────────────────────────

interface CronJob {
  id: string;
  userId: string;
  type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once';
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  month?: number;
  scheduledAt?: number;
  action: 'learn' | 'custom';
  params?: Record<string, any>;
  prompt?: string;
  enabled?: boolean;
  executed?: boolean;
  description?: string;
  createdAt?: number;
  message?: string;
}

interface SchedulerLog {
  id: number;
  job_id: string;
  scheduled_at: number;
  executed_at: number;
  status: string;
}

// ─── 通用组件 ──────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-3 mx-4 mt-3 rounded border bg-red-500/10 text-red-400 border-red-500/20 flex items-center gap-2 text-sm">
      <AlertCircle size={16} />
      {message}
    </div>
  );
}

function formatTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function describeSchedule(job: CronJob): string {
  if (job.type === 'once') {
    return job.scheduledAt ? formatDate(job.scheduledAt) : '未设定';
  }
  const h = job.hour ?? 9;
  const m = job.minute ?? 0;
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (job.type === 'weekly') {
    const dow = job.dayOfWeek ?? 0;
    return `每${DAY_NAMES[dow]} ${time}`;
  }
  if (job.type === 'monthly') {
    return `每月${job.dayOfMonth ?? 1}号 ${time}`;
  }
  if (job.type === 'yearly') {
    return `每年${job.month ?? 1}月${job.dayOfMonth ?? 1}号 ${time}`;
  }
  return `每天 ${time}`;
}

// ─── 编辑弹窗 ──────────────────────────────────────────────

function JobEditDialog({
  job,
  onSave,
  onCancel,
}: {
  job: Partial<CronJob> & { id?: string };
  onSave: (job: CronJob) => void;
  onCancel: () => void;
}) {
  const isEdit = !!job.id;
  const [form, setForm] = useState({
    id: job.id || '',
    description: job.description || '',
    type: job.type || 'daily',
    hour: job.hour ?? 9,
    minute: job.minute ?? 0,
    dayOfWeek: job.dayOfWeek ?? 0,
    dayOfMonth: job.dayOfMonth ?? 1,
    month: job.month ?? 1,
    scheduledDate: job.scheduledAt ? new Date(job.scheduledAt).toISOString().slice(0, 10) : '',
    scheduledTime: job.scheduledAt
      ? `${String(new Date(job.scheduledAt).getHours()).padStart(2, '0')}:${String(new Date(job.scheduledAt).getMinutes()).padStart(2, '0')}`
      : '09:00',
    action: job.action || 'custom',
    handlerName: job.params?.handler || '',
    prompt: job.prompt || '',
    message: job.message || '',
    enabled: job.enabled !== false,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const built: CronJob = {
      id: form.id || `cron-${Date.now().toString(36)}`,
      userId: job.userId || '',
      type: form.type as 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once',
      action: form.action as 'learn' | 'custom',
      description: form.description || undefined,
      enabled: form.enabled,
      prompt: form.prompt || undefined,
      message: form.message || undefined,
      params: form.handlerName ? { handler: form.handlerName } : undefined,
      ...(job.createdAt ? { createdAt: job.createdAt } : {}),
    };

    if (form.type === 'once') {
      if (form.scheduledDate && form.scheduledTime) {
        built.scheduledAt = new Date(`${form.scheduledDate}T${form.scheduledTime}:00`).getTime();
      }
    } else {
      built.hour = form.hour;
      built.minute = form.minute;
      if (form.type === 'weekly') {
        built.dayOfWeek = form.dayOfWeek;
      }
      if (form.type === 'monthly') {
        built.dayOfMonth = form.dayOfMonth;
      }
      if (form.type === 'yearly') {
        built.month = form.month;
        built.dayOfMonth = form.dayOfMonth;
      }
    }

    onSave(built);
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-[480px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            {isEdit ? '编辑定时任务' : '新增定时任务'}
          </h3>
          <Button onClick={onCancel} variant="ghost" size="icon" className="h-6 w-6">
            <X size={14} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* ID */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">任务 ID</label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              disabled={isEdit}
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
              placeholder="自动生成"
            />
          </div>

          {/* 描述 */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">描述</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
              placeholder="任务用途说明"
            />
          </div>

          {/* 类型 */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">调度类型</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="yearly">每年</option>
              <option value="once">一次性</option>
            </select>
          </div>

          {/* 一次性：日期 + 时间 */}
          {form.type === 'once' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">日期</label>
                <input
                  type="date"
                  value={form.scheduledDate}
                  onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                  className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">时间</label>
                <input
                  type="time"
                  value={form.scheduledTime}
                  onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })}
                  className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          )}

          {/* 每日/每周：时:分 + 星期几 */}
          {form.type !== 'once' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">时</label>
                  <select
                    value={form.hour}
                    onChange={(e) => setForm({ ...form, hour: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    {hours.map(h => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">分</label>
                  <select
                    value={form.minute}
                    onChange={(e) => setForm({ ...form, minute: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    {[0, 1, 2, 3, 4, 5, 7, 10, 13, 15, 20, 23, 25, 30, 35, 40, 45, 50, 55, 59].map(m => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
              {form.type === 'weekly' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">星期几</label>
                  <select
                    value={form.dayOfWeek}
                    onChange={(e) => setForm({ ...form, dayOfWeek: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    {DAY_NAMES.map((name, i) => (
                      <option key={i} value={i}>{name}</option>
                    ))}
                  </select>
                </div>
              )}
              {form.type === 'monthly' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">每月几号</label>
                  <select
                    value={form.dayOfMonth}
                    onChange={(e) => setForm({ ...form, dayOfMonth: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d}号</option>
                    ))}
                  </select>
                </div>
              )}
              {form.type === 'yearly' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-muted-foreground">月份</label>
                    <select
                      value={form.month}
                      onChange={(e) => setForm({ ...form, month: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={m}>{m}月</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-muted-foreground">几号</label>
                    <select
                      value={form.dayOfMonth}
                      onChange={(e) => setForm({ ...form, dayOfMonth: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>{d}号</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Action */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">动作类型</label>
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="learn">知识学习 (learn)</option>
              <option value="custom">自定义 (custom)</option>
            </select>
          </div>

          {form.action === 'custom' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Handler 名称</label>
              <input
                type="text"
                value={form.handlerName}
                onChange={(e) => setForm({ ...form, handlerName: e.target.value })}
                className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="例如: daily-care"
              />
            </div>
          )}

          {form.action === 'learn' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">学习目标 (prompt)</label>
              <input
                type="text"
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="例如: daily learning"
              />
            </div>
          )}

          {/* 触发消息 */}
          {form.action === 'custom' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                触发消息 (message)
              </label>
              <input
                type="text"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="如: 帮我分析今天的 GitHub issues"
              />
              <p className="text-xs text-muted-foreground/70">
                填入后，定时任务触发时将此消息注入 agent 会话，启动完整对话循环。留空则仅执行 handler。
              </p>
            </div>
          )}

          {/* 启用 */}
          <div className="flex items-center justify-between py-2">
            <div>
              <span className="text-sm text-foreground">启用</span>
              <p className="text-xs text-muted-foreground/70">关闭后任务不会执行</p>
            </div>
            <Button
              type="button"
              onClick={() => setForm({ ...form, enabled: !form.enabled })}
              variant="ghost"
              size="icon"
              className={`relative w-10 h-5 rounded-full ${form.enabled ? 'bg-primary' : 'bg-muted border border-text-tertiary'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${form.enabled ? 'left-5' : 'left-0.5'}`} />
            </Button>
          </div>

          {/* 按钮 */}
          <div className="flex gap-2 justify-end pt-3 border-t border-border">
            <Button type="button" onClick={onCancel} variant="ghost" size="sm">取消</Button>
            <Button type="submit" disabled={saving} variant="default" size="sm">
              {saving ? '保存中...' : isEdit ? '更新' : '创建'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tab: 任务列表 ─────────────────────────────────────────

function JobsTab() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<CronJob | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electron.schedulerJobs();
      if (res.success) setJobs(res.jobs || []);
      else setError(res.error || '加载失败');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const handleToggle = async (job: CronJob) => {
    try {
      const res = await window.electron.schedulerUpdate({
        id: job.id,
        updates: { enabled: !job.enabled },
      });
      if (res.success) await loadJobs();
      else alert(`操作失败: ${res.error}`);
    } catch (err) {
      alert(`操作失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个定时任务吗？')) return;
    try {
      const res = await window.electron.schedulerRemove({ id });
      if (res.success) await loadJobs();
      else alert(`删除失败: ${res.error}`);
    } catch (err) {
      alert(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSave = async (job: CronJob) => {
    try {
      const isEdit = jobs.some(j => j.id === job.id);
      let res;
      if (isEdit) {
        res = await window.electron.schedulerUpdate({ id: job.id, updates: job });
      } else {
        res = await window.electron.schedulerAdd({ job });
      }
      if (res.success) {
        setShowCreate(false);
        setEditJob(null);
        await loadJobs();
      } else {
        alert(`保存失败: ${res.error}`);
      }
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 h-full flex flex-col">
      {error && <ErrorBanner message={error} />}

      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-4">
        <Button onClick={() => setShowCreate(true)} variant="default" size="sm" className="gap-1">
          <Plus size={14} /> 新增任务
        </Button>
        <Button onClick={loadJobs} variant="ghost" size="sm">
          <RefreshCw size={14} />
        </Button>
      </div>

      {/* 任务列表 */}
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
          <Clock size={40} className="mb-3 opacity-30" />
          <p className="text-sm">暂无定时任务</p>
          <p className="text-xs mt-1 opacity-60">点击"新增任务"创建</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2">
          {jobs.map(job => (
            <div
              key={job.id}
              className="p-3 rounded border border-border bg-card hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">{job.id}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${
                      job.type === 'once' ? 'bg-orange-500/15 text-orange-400 border-orange-500/25' :
                      job.type === 'monthly' ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25' :
                      job.type === 'yearly' ? 'bg-pink-500/15 text-pink-400 border-pink-500/25' :
                      job.type === 'weekly' ? 'bg-purple-500/15 text-purple-400 border-purple-500/25' :
                      'bg-blue-500/15 text-blue-400 border-blue-500/25'
                    }`}>
                      {job.type === 'once' ? '一次性' : job.type === 'monthly' ? '每月' : job.type === 'yearly' ? '每年' : job.type === 'weekly' ? '每周' : '每天'}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${
                      job.enabled !== false
                        ? 'bg-green-500/15 text-green-400 border-green-500/25'
                        : 'bg-gray-500/15 text-gray-400 border-gray-500/25'
                    }`}>
                      {job.enabled !== false ? '启用' : '禁用'}
                    </span>
                    {job.executed && (
                      <span className="text-xs px-1.5 py-0.5 rounded border bg-yellow-500/15 text-yellow-400 border-yellow-500/25">
                        已完成
                      </span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${
                      job.action === 'learn'
                        ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25'
                        : 'bg-pink-500/15 text-pink-400 border-pink-500/25'
                    }`}>
                      {job.action}
                    </span>
                  </div>
                  {job.description && (
                    <p className="text-xs text-muted-foreground mb-1">{job.description}</p>
                  )}
                  <div className="flex gap-3 text-xs text-muted-foreground/70">
                    <span className="flex items-center gap-1">
                      <Calendar size={10} /> {describeSchedule(job)}
                    </span>
                    {job.prompt && (
                      <span className="flex items-center gap-1">
                        <Tag size={10} /> {job.prompt.slice(0, 30)}
                      </span>
                    )}
                    {job.params?.handler && (
                      <span className="flex items-center gap-1">
                        <Play size={10} /> handler: {job.params.handler}
                      </span>
                    )}
                    {job.message && (
                      <span className="flex items-center gap-1 text-green-400">
                        <Play size={10} /> 触发: {job.message.slice(0, 30)}
                      </span>
                    )}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <Button
                    onClick={() => handleToggle(job)}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={job.enabled !== false ? '禁用' : '启用'}
                  >
                    <Power size={14} className={job.enabled !== false ? 'text-green-400' : 'text-gray-400'} />
                  </Button>
                  <Button
                    onClick={() => setEditJob(job)}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="编辑"
                  >
                    <Tag size={14} className="text-blue-400" />
                  </Button>
                  <Button
                    onClick={() => handleDelete(job.id)}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="删除"
                  >
                    <Trash2 size={14} className="text-red-400" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      {(showCreate || editJob) && (
        <JobEditDialog
          job={editJob || {}}
          onSave={handleSave}
          onCancel={() => { setShowCreate(false); setEditJob(null); }}
        />
      )}
    </div>
  );
}

// ─── Tab: 执行日志 ─────────────────────────────────────────

function LogsTab() {
  const [logs, setLogs] = useState<SchedulerLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electron.schedulerLogs({ limit: 100 });
      if (res.success) setLogs(res.logs || []);
      else setError(res.error || '加载失败');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 h-full flex flex-col">
      {error && <ErrorBanner message={error} />}

      <div className="flex items-center gap-2 mb-4">
        <Button onClick={loadLogs} variant="ghost" size="sm">
          <RefreshCw size={14} />
        </Button>
        <span className="text-xs text-muted-foreground">共 {logs.length} 条</span>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
          <Clock size={40} className="mb-3 opacity-30" />
          <p className="text-sm">暂无执行日志</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr>
                <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Job ID</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">计划时间</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">执行时间</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">状态</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-3 text-xs font-mono text-foreground">{log.job_id}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{formatTime(log.scheduled_at)}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{formatTime(log.executed_at)}</td>
                  <td className="py-2 px-3 text-xs">
                    {log.status === 'ok' ? (
                      <span className="flex items-center gap-1 text-green-400">
                        <CheckCircle size={12} /> 成功
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400">
                        <XCircle size={12} /> 失败
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 主页面 ────────────────────────────────────────────────

export default function SchedulerPage({ onClose }: SchedulerPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('jobs');

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'jobs', label: '任务列表', icon: <Clock size={16} /> },
    { id: 'logs', label: '执行日志', icon: <Calendar size={16} /> },
  ];

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* 顶部栏 */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Clock size={18} />
          <h1 className="text-base font-semibold">定时任务</h1>
        </div>
        <Button onClick={onClose} variant="ghost" size="icon" className="h-7 w-7" title="关闭">
          <X size={16} />
        </Button>
      </div>

      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-40 border-r border-border bg-card p-3 space-y-1 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </aside>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'jobs' && <JobsTab />}
          {activeTab === 'logs' && <LogsTab />}
        </div>
      </div>
    </div>
  );
}
