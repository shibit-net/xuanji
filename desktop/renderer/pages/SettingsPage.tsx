// ============================================================
// SettingsPage - 设置页面（所有配置动态生效）
// ============================================================

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Settings, X, Save, Database, Wrench,
  Palette, CheckCircle, AlertCircle, Zap,
  Brain,
} from 'lucide-react';
import { useConfigStore } from '../stores/configStore';
import { getDesktopLabel } from '../i18n';
import { setLanguage } from '@/core/i18n';

interface SettingsPageProps {
  onClose: () => void;
}

type TabType = 'tools' | 'ui' | 'embedding' | 'features' | 'memory';

// ============================================================
// 通用工具
// ============================================================

interface TabProps {
  config: any;
  loading: boolean;
  onSave: (section: string, data: any) => Promise<void>;
}

function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, type = 'text', disabled = false, hint }: {
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
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function NumberField({ label, value, onChange, min, placeholder, hint }: {
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
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, options, hint }: {
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
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function ToggleField({ label, value, onChange, hint }: {
  label: string; value: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-sm text-foreground">{label}</span>
        {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
      </div>
      <Button
        onClick={() => onChange(!value)}
        variant="ghost"
        size="icon"
        className={`relative w-10 h-5 rounded-full ${value ? 'bg-primary' : 'bg-muted border border-text-tertiary'}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${value ? 'left-5' : 'left-0.5'}`} />
      </Button>
    </div>
  );
}

function SaveButton({ saving }: { saving: boolean }) {
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

function MessageBanner({ message }: { message: { type: 'success' | 'error'; text: string } | null }) {
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

// ============================================================
// Tab: 工具配置
// ============================================================
function ToolsTab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    timeoutBash: 120000,
    timeoutWebFetch: 30000,
    timeoutDefault: 300000,
    maxBackgroundTasks: 3,
    maxParallelTools: 5,
    toolOutput: 50000,
    toolResult: 20000,
    grepMaxMatches: 1000,
    grepMaxMatchesPerFile: 200,
    grepMaxContextLines: 10,
    globMaxFiles: 5000,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (config?.tools) {
      const t = config.tools;
      setForm({
        timeoutBash: t.timeouts?.bash ?? 120000,
        timeoutWebFetch: t.timeouts?.webFetch ?? 30000,
        timeoutDefault: t.timeouts?.default ?? 300000,
        maxBackgroundTasks: t.concurrency?.maxBackgroundTasks ?? 3,
        maxParallelTools: t.concurrency?.maxParallel ?? 5,
        toolOutput: t.outputLimits?.toolOutput ?? 50000,
        toolResult: t.outputLimits?.toolResult ?? 20000,
        grepMaxMatches: t.grep?.maxMatches ?? 1000,
        grepMaxMatchesPerFile: t.grep?.maxMatchesPerFile ?? 200,
        grepMaxContextLines: t.grep?.maxContextLines ?? 10,
        globMaxFiles: t.glob?.maxFiles ?? 5000,
      });
    }
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave('tools', {
        timeouts: {
          bash: form.timeoutBash,
          webFetch: form.timeoutWebFetch,
          default: form.timeoutDefault,
        },
        concurrency: {
          maxBackgroundTasks: form.maxBackgroundTasks,
          maxParallel: form.maxParallelTools,
        },
        outputLimits: {
          toolOutput: form.toolOutput,
          toolResult: form.toolResult,
        },
        grep: {
          maxMatches: form.grepMaxMatches,
          maxMatchesPerFile: form.grepMaxMatchesPerFile,
          maxContextLines: form.grepMaxContextLines,
        },
        glob: {
          maxFiles: form.globMaxFiles,
        },
      });
      setMessage({ type: 'success', text: getDesktopLabel('settings.tools.saved', currentLang) });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.save_failed', currentLang) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground text-sm">{getDesktopLabel('settings.loading', currentLang)}</div>;

  return (
    <form onSubmit={handleSave} className="p-6 space-y-5">
      <MessageBanner message={message} />

      <SectionHeader title="超时设置 (毫秒)" desc="工具执行超时时间，修改后下次调用立即生效" />
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="Bash" value={form.timeoutBash} onChange={(v) => setForm({ ...form, timeoutBash: v })} min={1000} hint="默认 120s" />
        <NumberField label="Web Fetch" value={form.timeoutWebFetch} onChange={(v) => setForm({ ...form, timeoutWebFetch: v })} min={1000} hint="默认 30s" />
        <NumberField label="默认超时" value={form.timeoutDefault} onChange={(v) => setForm({ ...form, timeoutDefault: v })} min={1000} hint="其他工具默认超时" />
      </div>

      <SectionHeader title="并发限制" desc="控制同时执行的任务和工具数量" />
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="最大后台任务数" value={form.maxBackgroundTasks} onChange={(v) => setForm({ ...form, maxBackgroundTasks: v })} min={1} />
        <NumberField label="最大并行工具数" value={form.maxParallelTools} onChange={(v) => setForm({ ...form, maxParallelTools: v })} min={1} />
      </div>

      <SectionHeader title="输出限制" desc="工具输出截断阈值" />
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="最大工具输出长度" value={form.toolOutput} onChange={(v) => setForm({ ...form, toolOutput: v })} min={100} hint="超出后截断" />
        <NumberField label="最大结果长度" value={form.toolResult} onChange={(v) => setForm({ ...form, toolResult: v })} min={100} hint="传入 LLM 的最大长度" />
      </div>

      <SectionHeader title="Grep / Glob 配置" />
      <div className="grid grid-cols-3 gap-4">
        <NumberField label="Grep 最大匹配" value={form.grepMaxMatches} onChange={(v) => setForm({ ...form, grepMaxMatches: v })} min={1} />
        <NumberField label="每文件最大匹配" value={form.grepMaxMatchesPerFile} onChange={(v) => setForm({ ...form, grepMaxMatchesPerFile: v })} min={1} />
        <NumberField label="最大上下文行数" value={form.grepMaxContextLines} onChange={(v) => setForm({ ...form, grepMaxContextLines: v })} min={1} />
        <NumberField label="Glob 最大文件数" value={form.globMaxFiles} onChange={(v) => setForm({ ...form, globMaxFiles: v })} min={1} />
      </div>

      <SaveButton saving={saving} />
    </form>
  );
}

// ============================================================
// Tab: 功能特性
// ============================================================
function FeaturesTab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    enableIntentAnalysis: true,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (config?.features) {
      setForm({
        enableIntentAnalysis: config.features.enableIntentAnalysis ?? true,
      });
    }
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave('features', {
        enableIntentAnalysis: form.enableIntentAnalysis,
      });
      setMessage({ type: 'success', text: getDesktopLabel('settings.features.saved', currentLang) });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.save_failed', currentLang) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground text-sm">{getDesktopLabel('settings.loading', currentLang)}</div>;

  return (
    <form onSubmit={handleSave} className="p-6 space-y-5">
      <MessageBanner message={message} />
      <SectionHeader title="意图路由" desc="控制消息到达时是否先用 LLM + 向量进行意图分析再选择 Agent" />
      <ToggleField
        label="启用意图分析"
        value={form.enableIntentAnalysis}
        onChange={(v) => setForm({ ...form, enableIntentAnalysis: v })}
        hint="开启后使用三级路由（LLM → 向量 → 默认）；关闭后所有消息直接使用 xuanji 兜底"
      />
      <SaveButton saving={saving} />
    </form>
  );
}

// ============================================================
// Tab: 界面配置
// ============================================================
function UITab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    theme: 'auto',
    language: 'en',
    showTokenUsage: true,
    showCost: true,
    showThinking: false,
    workspacePath: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (config) {
      setForm(prev => ({
        ...prev,
        theme: config.ui?.theme || 'auto',
        language: config.ui?.language || 'en',
        showTokenUsage: config.ui?.showTokenUsage ?? true,
        showCost: config.ui?.showCost ?? true,
        showThinking: config.ui?.showThinking ?? false,
        workspacePath: config.workspacePath || '',
      }));
    }
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave('ui', {
        theme: form.theme,
        language: form.language,
        showTokenUsage: form.showTokenUsage,
        showCost: form.showCost,
        showThinking: form.showThinking,
        workspacePath: form.workspacePath,
      });
      setMessage({ type: 'success', text: getDesktopLabel('settings.ui.saved', currentLang) });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.save_failed', currentLang) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground text-sm">{getDesktopLabel('settings.loading', currentLang)}</div>;

  return (
    <form onSubmit={handleSave} className="p-6 space-y-5">
      <MessageBanner message={message} />

      <SectionHeader title={getDesktopLabel('settings.ui.appearance', currentLang)} />
      <SelectField
        label={getDesktopLabel('settings.ui.theme', currentLang)}
        value={form.theme}
        onChange={(v) => setForm({ ...form, theme: v })}
        options={[
          { value: 'auto', label: getDesktopLabel('settings.ui.theme_auto', currentLang) },
          { value: 'dark', label: getDesktopLabel('settings.ui.theme_dark', currentLang) },
          { value: 'light', label: getDesktopLabel('settings.ui.theme_light', currentLang) },
        ]}
      />

      <SelectField
        label={getDesktopLabel('settings.ui.language', currentLang)}
        value={form.language}
        onChange={(v) => setForm({ ...form, language: v })}
        options={[
          { value: 'en', label: 'English' },
          { value: 'zh', label: '中文' },
        ]}
      />

      <TextField
        label={getDesktopLabel('settings.ui.workspace_dir', currentLang)}
        value={form.workspacePath}
        onChange={(v) => setForm({ ...form, workspacePath: v })}
        placeholder={getDesktopLabel('settings.ui.workspace_dir_hint', currentLang)}
        hint={getDesktopLabel('settings.ui.workspace_dir_restart', currentLang)}
      />

      <SectionHeader title={getDesktopLabel('settings.ui.display_options', currentLang)} desc={getDesktopLabel('settings.ui.display_options_desc', currentLang)} />
      <ToggleField label={getDesktopLabel('settings.ui.show_token_usage', currentLang)} value={form.showTokenUsage} onChange={(v) => setForm({ ...form, showTokenUsage: v })} />
      <ToggleField label={getDesktopLabel('settings.ui.show_cost', currentLang)} value={form.showCost} onChange={(v) => setForm({ ...form, showCost: v })} />
      <ToggleField label={getDesktopLabel('settings.ui.show_thinking', currentLang)} value={form.showThinking} onChange={(v) => setForm({ ...form, showThinking: v })} hint={getDesktopLabel('settings.ui.show_thinking_hint', currentLang)} />

      <SaveButton saving={saving} />
    </form>
  );
}

// ============================================================
// Tab: Embedding 配置 (保持原有逻辑)
// ============================================================
function EmbeddingTab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    dimensions: 384,
    cacheEnabled: true,
    cacheMaxSize: 100,
    hfMirror: 'https://hf-mirror.com',
  });
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);
  const [checkingModel, setCheckingModel] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (config?.embedding) {
      setForm({
        model: config.embedding.model || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        dimensions: config.embedding.dimensions || 384,
        cacheEnabled: config.embedding.cacheEnabled ?? true,
        cacheMaxSize: config.embedding.cacheMaxSize || 100,
        hfMirror: config.embedding.hfMirror || 'https://hf-mirror.com',
      });
    }
  }, [config]);

  useEffect(() => { checkModelInstallation(); }, [form.model]);

  const checkModelInstallation = async () => {
    if (!form.model) return;
    setCheckingModel(true);
    try {
      const result = await window.electron.downloadCheckEmbeddingModel(form.model);
      if (result.success) setModelInstalled(result.installed || false);
    } catch (err) {
      console.error('检查模型安装状态失败:', err);
    } finally {
      setCheckingModel(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave('embedding', form);
      setMessage({ type: 'success', text: getDesktopLabel('settings.embedding.saved', currentLang) });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.save_failed', currentLang) });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadModel = async () => {
    setDownloading(true);
    setMessage(null);
    try {
      const dirResult = await window.electron.downloadGetEmbeddingModelDir();
      if (!dirResult.success || !dirResult.dir) throw new Error('无法获取 embedding 模型目录');
      const embeddingDir = dirResult.dir;
      const modelId = form.model;
      const hfMirror = form.hfMirror || 'https://hf-mirror.com';
      const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];
      const baseUrl = `${hfMirror}/${modelId}/resolve/main`;
      for (const file of files) {
        const url = `${baseUrl}/${file}`;
        const dest = `${embeddingDir}/${modelId}/${file}`;
        const result = await window.electron.downloadCreate({ url, dest, name: `Embedding: ${modelId}/${file}`, category: 'model' });
        if (!result.success) throw new Error(`创建下载任务失败: ${file}`);
      }
      setMessage({ type: 'success', text: '已创建下载任务，请在下载中心查看进度' });
      setTimeout(() => { setMessage(null); checkModelInstallation(); }, 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '创建下载任务失败' });
    } finally {
      setDownloading(false);
    }
  };

  const handleUninstallModel = async () => {
    if (!confirm(getDesktopLabel('settings.embedding.uninstall_confirm', currentLang))) return;
    setUninstalling(true);
    setMessage(null);
    try {
      const result = await window.electron.downloadUninstallEmbeddingModel(form.model);
      if (result.success) {
        setMessage({ type: 'success', text: getDesktopLabel('settings.embedding.uninstalled', currentLang) });
        setTimeout(() => setMessage(null), 3000);
        checkModelInstallation();
      } else {
        throw new Error(result.error || getDesktopLabel('settings.embedding.uninstall_failed', currentLang));
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '卸载失败' });
    } finally {
      setUninstalling(false);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground text-sm">{getDesktopLabel('settings.loading', currentLang)}</div>;

  return (
    <form onSubmit={handleSave} className="p-6 space-y-5">
      <MessageBanner message={message} />

      <SectionHeader title="Embedding 模型" desc="用于语义搜索和意图分析的向量模型" />
      <div className="flex gap-2">
        <input
          type="text"
          value={form.model}
          readOnly
          className="flex-1 px-3 py-2 bg-muted border border-border rounded text-sm text-muted-foreground cursor-not-allowed"
        />
        {modelInstalled ? (
          <Button type="button" onClick={handleUninstallModel} disabled={uninstalling}
            variant="destructive" size="sm" className="whitespace-nowrap">
            {uninstalling ? '卸载中...' : '卸载'}
          </Button>
        ) : (
          <Button type="button" onClick={handleDownloadModel} disabled={downloading || !form.model}
            variant="default" size="sm" className="whitespace-nowrap">
            {downloading ? '下载中...' : '下载模型'}
          </Button>
        )}
      </div>
      {checkingModel && <p className="text-xs text-muted-foreground">检查安装状态...</p>}
      {!checkingModel && modelInstalled === true && <p className="text-xs text-green-400">模型已安装</p>}
      {!checkingModel && modelInstalled === false && <p className="text-xs text-yellow-400">模型未安装，请点击下载</p>}

      <NumberField label="向量维度" value={form.dimensions} onChange={(v) => setForm({ ...form, dimensions: v })} min={1} hint="需要与模型匹配" />

      <TextField label="HuggingFace 镜像" value={form.hfMirror || ''} onChange={(v) => setForm({ ...form, hfMirror: v })} placeholder="https://hf-mirror.com" hint="国内用户可使用镜像加速" />

      <ToggleField label="启用缓存" value={form.cacheEnabled} onChange={(v) => setForm({ ...form, cacheEnabled: v })} />

      {form.cacheEnabled && (
        <NumberField label="缓存最大条数" value={form.cacheMaxSize} onChange={(v) => setForm({ ...form, cacheMaxSize: v })} min={1} hint="超过后自动删除最早条目" />
      )}

      <SaveButton saving={saving} />
    </form>
  );
}

// ============================================================
// Tab: 记忆配置
// ============================================================
function MemoryTab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    enabled: true,
    shortTermMaxEntries: 100,
    longTermMaxEntries: 1000,
    compactionThreshold: 500,
    retrieveMaxResults: 10,
    maxEntryLength: 500,
    maxPromptLength: 5000,
    decayHalfLifeDays: 30,
    extractorModel: '',
    extractorTemperature: 0.3,
    extractorTimeout: 60000,
    extractorMinConfidence: 0.6,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (config?.memory) {
      const m = config.memory;
      setForm({
        enabled: m.enabled ?? true,
        shortTermMaxEntries: m.shortTermMaxEntries ?? 100,
        longTermMaxEntries: m.longTermMaxEntries ?? 1000,
        compactionThreshold: m.compactionThreshold ?? 500,
        retrieveMaxResults: m.retrieveMaxResults ?? 10,
        maxEntryLength: m.maxEntryLength ?? 500,
        maxPromptLength: m.maxPromptLength ?? 5000,
        decayHalfLifeDays: m.decayHalfLifeDays ?? 30,
        extractorModel: m.extractorModel || '',
        extractorTemperature: m.extractorTemperature ?? 0.3,
        extractorTimeout: m.extractorTimeout ?? 60000,
        extractorMinConfidence: m.extractorMinConfidence ?? 0.6,
      });
    }
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave('memory', form);
      setMessage({ type: 'success', text: getDesktopLabel('settings.memory.saved', currentLang) });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.save_failed', currentLang) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground text-sm">{getDesktopLabel('settings.loading', currentLang)}</div>;

  return (
    <form onSubmit={handleSave} className="p-6 space-y-5">
      <MessageBanner message={message} />

      <SectionHeader title="基础设置" desc="控制记忆系统的开关和总体行为" />
      <ToggleField
        label="启用记忆系统"
        value={form.enabled}
        onChange={(v) => setForm({ ...form, enabled: v })}
        hint="关闭后不再自动提取和存储记忆"
      />

      <SectionHeader title="容量控制" desc="管理短期和长期记忆的存储容量" />
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="短期记忆上限 (条)"
          value={form.shortTermMaxEntries}
          onChange={(v) => setForm({ ...form, shortTermMaxEntries: v })}
          min={10}
          hint="会话缓存，默认 100"
        />
        <NumberField
          label="长期记忆上限 (条)"
          value={form.longTermMaxEntries}
          onChange={(v) => setForm({ ...form, longTermMaxEntries: v })}
          min={100}
          hint="持久化存储，默认 1000"
        />
        <NumberField
          label="压缩触发阈值 (条)"
          value={form.compactionThreshold}
          onChange={(v) => setForm({ ...form, compactionThreshold: v })}
          min={50}
          hint="超过此数量触发记忆压缩"
        />
        <NumberField
          label="衰减半衰期 (天)"
          value={form.decayHalfLifeDays}
          onChange={(v) => setForm({ ...form, decayHalfLifeDays: v })}
          min={1}
          hint="记忆重要性自然衰减周期"
        />
      </div>

      <SectionHeader title="检索参数" desc="控制记忆检索的范围和精度" />
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="最大返回结果"
          value={form.retrieveMaxResults}
          onChange={(v) => setForm({ ...form, retrieveMaxResults: v })}
          min={1}
          hint="每次查询返回的最大记忆条数"
        />
        <NumberField
          label="单条最大长度 (字符)"
          value={form.maxEntryLength}
          onChange={(v) => setForm({ ...form, maxEntryLength: v })}
          min={50}
          hint="超出截断"
        />
        <NumberField
          label="Prompt 最大长度 (字符)"
          value={form.maxPromptLength}
          onChange={(v) => setForm({ ...form, maxPromptLength: v })}
          min={500}
          hint="注入提示的最大上下文长度"
        />
      </div>

      <SectionHeader title="提取模型" desc="用于从对话中提取记忆的 LLM 配置" />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="模型名称"
          value={form.extractorModel}
          onChange={(v) => setForm({ ...form, extractorModel: v })}
          placeholder="留空使用默认模型"
          hint="可使用本地小模型 (如 qwen2.5-1.5b) 节省成本"
        />
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">提取温度</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={form.extractorTemperature}
            onChange={(e) => setForm({ ...form, extractorTemperature: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
          />
          <p className="text-xs text-muted-foreground/70">0-1，越低越精确</p>
        </div>
        <NumberField
          label="提取超时 (毫秒)"
          value={form.extractorTimeout}
          onChange={(v) => setForm({ ...form, extractorTimeout: v })}
          min={5000}
          hint="默认 60s"
        />
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">最低置信度</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={form.extractorMinConfidence}
            onChange={(e) => setForm({ ...form, extractorMinConfidence: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
          />
          <p className="text-xs text-muted-foreground/70">0.6-1.0，低于此值不存储</p>
        </div>
      </div>

      <SaveButton saving={saving} />
    </form>
  );
}

// ============================================================
// 设置页面主组件
// ============================================================
export default function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('tools');
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const language = useConfigStore((s) => s.settings.language);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const result = await window.electron.settingsGetFullConfig?.();
      if (result?.success && result.config) {
        setConfig(result.config);
      }
    } catch (err) {
      console.error('加载配置失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (section: string, data: any) => {
    // 使用 section-based 增量更新
    const result = await window.electron.settingsUpdateConfig?.({
      section,
      sectionData: data,
      ...(section === 'embedding' ? { embedding: data } : {}),
    });

    if (result && !result.success) {
      throw new Error(result.error || getDesktopLabel('settings.save_failed', language));
    }

    // 同步 UI 配置到 configStore，确保组件实时响应
    if (section === 'ui') {
      // 同步核心 i18n 模块（用于 CLI 端输出）
      if (data.language) {
        setLanguage(data.language as 'zh' | 'en');
      }
      useConfigStore.getState().updateSettings({
        theme: data.theme,
        language: data.language,
        showTokenUsage: data.showTokenUsage,
        showCost: data.showCost,
        showThinking: data.showThinking,
      });
    }

    // 刷新本地配置缓存
    await loadConfig();
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'tools', label: getDesktopLabel('settings.tools', language), icon: <Wrench size={16} /> },
    { id: 'features', label: getDesktopLabel('settings.features', language), icon: <Zap size={16} /> },
    { id: 'ui', label: getDesktopLabel('settings.ui', language), icon: <Palette size={16} /> },
    { id: 'embedding', label: getDesktopLabel('settings.embedding', language), icon: <Database size={16} /> },
    { id: 'memory', label: getDesktopLabel('settings.memory', language), icon: <Brain size={16} /> },
  ];

  const tabProps: TabProps = { config, loading, onSave: handleSave };

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* 顶部栏 */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Settings size={18} />
          <h1 className="text-base font-semibold">{getDesktopLabel('settings.title', language)}</h1>
        </div>
        <Button onClick={onClose} variant="ghost" size="icon" className="h-7 w-7" title={getDesktopLabel('settings.close', language)}>
          <X size={16} />
        </Button>
      </div>

      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-48 border-r border-border bg-card p-3 space-y-1 shrink-0">
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

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'tools' && <ToolsTab {...tabProps} />}
          {activeTab === 'features' && <FeaturesTab {...tabProps} />}
          {activeTab === 'ui' && <UITab {...tabProps} />}
          {activeTab === 'embedding' && <EmbeddingTab {...tabProps} />}
          {activeTab === 'memory' && <MemoryTab {...tabProps} />}
        </div>
      </div>
    </div>
  );
}
