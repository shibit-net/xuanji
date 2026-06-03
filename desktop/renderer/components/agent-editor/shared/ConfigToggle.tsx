// ============================================================
// ConfigToggle - 启用/禁用开关
// ============================================================

interface ConfigToggleProps {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}

export default function ConfigToggle({ enabled, onChange, disabled, label }: ConfigToggleProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium">{label}</span>
      <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          enabled ? 'bg-primary' : 'bg-border'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
