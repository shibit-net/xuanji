import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { t } from '@/i18n';

export const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function JobEditDialog({
  job,
  onSave,
  onCancel,
}: {
  job: Partial<{ id: string; userId: string; type: string; description: string; enabled: boolean; action: string; prompt: string; message: string; createdAt: number; params: Record<string, any> }> & { id?: string };
  onSave: (job: any) => void;
  onCancel: () => void;
}) {
  const isEdit = !!job.id;
  const [form, setForm] = useState({
    id: job.id || '',
    description: job.description || '',
    type: job.type || 'daily',
    hour: (job as any).hour ?? 9,
    minute: (job as any).minute ?? 0,
    dayOfWeek: (job as any).dayOfWeek ?? 0,
    dayOfMonth: (job as any).dayOfMonth ?? 1,
    month: (job as any).month ?? 1,
    scheduledDate: (job as any).scheduledAt ? new Date((job as any).scheduledAt).toISOString().slice(0, 10) : '',
    scheduledTime: (job as any).scheduledAt
      ? `${String(new Date((job as any).scheduledAt).getHours()).padStart(2, '0')}:${String(new Date((job as any).scheduledAt).getMinutes()).padStart(2, '0')}`
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

    const built: any = {
      id: form.id || `cron-${Date.now().toString(36)}`,
      userId: job.userId || '',
      type: form.type as string,
      action: 'custom',
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
      if (form.type === 'weekly') built.dayOfWeek = form.dayOfWeek;
      if (form.type === 'monthly') built.dayOfMonth = form.dayOfMonth;
      if (form.type === 'yearly') { built.month = form.month; built.dayOfMonth = form.dayOfMonth; }
    }

    onSave(built);
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-[480px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            {isEdit ? t('scheduler.job_edit_title') : t('scheduler.job_create_title')}
          </h3>
          <Button onClick={onCancel} variant="ghost" size="icon" className="h-6 w-6">
            <X size={14} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_id')}</label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              disabled={isEdit}
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
              placeholder={t('scheduler.auto_generate')}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_description')}</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
              placeholder={t('scheduler.desc_placeholder')}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_type')}</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="daily">{t('scheduler.type_daily')}</option>
              <option value="weekly">{t('scheduler.type_weekly')}</option>
              <option value="monthly">{t('scheduler.type_monthly')}</option>
              <option value="yearly">{t('scheduler.type_yearly')}</option>
              <option value="once">{t('scheduler.type_once')}</option>
            </select>
          </div>

          {form.type === 'once' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_date')}</label>
                <input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                  className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_time')}</label>
                <input type="time" value={form.scheduledTime} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })}
                  className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary" />
              </div>
            </div>
          )}

          {form.type !== 'once' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_hour')}</label>
                  <select value={form.hour} onChange={(e) => setForm({ ...form, hour: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary">
                    {hours.map(h => (<option key={h} value={h}>{String(h).padStart(2, '0')}</option>))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_minute')}</label>
                  <select value={form.minute} onChange={(e) => setForm({ ...form, minute: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary">
                    {[0, 1, 2, 3, 4, 5, 7, 10, 13, 15, 20, 23, 25, 30, 35, 40, 45, 50, 55, 59].map(m => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
              {form.type === 'weekly' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_day_of_week')}</label>
                  <select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary">
                    {DAY_NAMES.map((name, i) => (<option key={i} value={i}>{name}</option>))}
                  </select>
                </div>
              )}
              {form.type === 'monthly' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_day_of_month')}</label>
                  <select value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (<option key={d} value={d}>{d}{t('scheduler.day_unit')}</option>))}
                  </select>
                </div>
              )}
              {form.type === 'yearly' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_month')}</label>
                    <select value={form.month} onChange={(e) => setForm({ ...form, month: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (<option key={m} value={m}>{m}{t('scheduler.month_unit')}</option>))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_day')}</label>
                    <select value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (<option key={d} value={d}>{d}{t('scheduler.day_unit')}</option>))}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {form.action === 'custom' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_handler')}</label>
              <input type="text" value={form.handlerName} onChange={(e) => setForm({ ...form, handlerName: e.target.value })}
                className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder={t('scheduler.handler_placeholder')} />
            </div>
          )}

          {form.action === 'custom' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">{t('scheduler.field_trigger_message')}</label>
              <input type="text" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder={t('scheduler.message_placeholder')} />
              <p className="text-xs text-muted-foreground/70">{t('scheduler.message_hint')}</p>
            </div>
          )}

          <div className="flex items-center justify-between py-2">
            <div>
              <span className="text-sm text-foreground">{t('scheduler.enabled')}</span>
              <p className="text-xs text-muted-foreground/70">{t('scheduler.disabled_hint')}</p>
            </div>
            <Button type="button" onClick={() => setForm({ ...form, enabled: !form.enabled })} variant="ghost" size="icon"
              className={`relative w-10 h-5 rounded-full ${form.enabled ? 'bg-primary' : 'bg-muted border border-text-tertiary'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${form.enabled ? 'left-5' : 'left-0.5'}`} />
            </Button>
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t border-border">
            <Button type="button" onClick={onCancel} variant="ghost" size="sm">{t('scheduler.cancel')}</Button>
            <Button type="submit" disabled={saving} variant="default" size="sm">
              {saving ? t('scheduler.saving') : isEdit ? t('scheduler.update') : t('scheduler.create')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
