import { Button } from '@/components/ui/button';
import { Save, CheckCircle, AlertCircle } from 'lucide-react';
import { useConfigStore } from '../../stores/configStore';
import { getDesktopLabel } from '../../i18n';

export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
    </div>
  );
}

export function TextField({ label, value, onChange, placeholder, type = 'text', disabled = false, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; disabled?: boolean; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
        placeholder={placeholder}
      />
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function NumberField({ label, value, onChange, min, placeholder, hint }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; placeholder?: string; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(isNaN(v) ? 0 : v);
        }}
        min={min}
        className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
        placeholder={placeholder}
      />
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function ToggleField({ label, value, onChange, hint }: {
  label: string; value: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-sm text-foreground">{label}</span>
        {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
      </div>
      <Button
        onClick={() => onChange(!value)}
        variant="ghost"
        size="icon"
        className={`relative w-10 h-5 rounded-full ${value ? 'bg-primary' : 'bg-muted border border-border'}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${value ? 'left-5' : 'left-0.5'}`} />
      </Button>
    </div>
  );
}

export function SaveButton({ saving }: { saving: boolean }) {
  const language = useConfigStore((s) => s.settings.language);
  return (
    <div className="pt-4 border-t border-border">
      <Button
        type="submit"
        disabled={saving}
        variant="default"
        size="sm"
        className="flex items-center gap-2"
      >
        <Save size={16} />
        <span>{saving ? getDesktopLabel('settings.saving', language) : getDesktopLabel('settings.save', language)}</span>
      </Button>
    </div>
  );
}

export function MessageBanner({ message }: { message: { type: 'success' | 'error'; text: string } | null }) {
  if (!message) return null;
  const Icon = message.type === 'success' ? CheckCircle : AlertCircle;
  const colorClass = message.type === 'success'
    ? 'bg-green-500/10 text-green-400 border-green-500/20'
    : 'bg-red-500/10 text-red-400 border-red-500/20';
  return (
    <div className={`p-3 rounded border flex items-center gap-2 text-sm ${colorClass}`}>
      <Icon size={16} />
      {message.text}
    </div>
  );
}
