// ============================================================
// SettingsPage - 设置页面（所有配置动态生效）
// ============================================================

import { useState, useEffect, memo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Settings, X, Wrench,
  Palette, Zap,
  Download, Sparkles,
} from 'lucide-react';
import { useConfigStore } from '../stores/configStore';
import { getDesktopLabel } from '../i18n';
import { setLanguage } from '@/i18n';
import {
  SectionHeader, TextField, NumberField, SelectField,
  ToggleField, SaveButton, MessageBanner,
} from './settings/components';
import ModelProvidersTab from './settings/ModelProvidersTab';

interface SettingsPageProps {
  onClose: () => void;
}

type TabType = 'tools' | 'ui' | 'features' | 'download' | 'modelProviders';

interface TabProps {
  config: any;
  loading: boolean;
  onSave: (section: string, data: any) => Promise<void>;
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
    toolOutput: 50000,
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
        toolOutput: t.outputLimits?.toolOutput ?? 50000,
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
        },
        outputLimits: {
          toolOutput: form.toolOutput,
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

      <SectionHeader title={getDesktopLabel('settings.tools.timeout', currentLang)} desc={getDesktopLabel('settings.tools.timeout_desc', currentLang)} />
      <div className="grid grid-cols-2 gap-4">
        <NumberField label={getDesktopLabel('settings.tools.bash', currentLang)} value={form.timeoutBash} onChange={(v) => setForm({ ...form, timeoutBash: v })} min={1000} hint={getDesktopLabel('settings.tools.bash_hint', currentLang)} />
        <NumberField label={getDesktopLabel('settings.tools.web_fetch', currentLang)} value={form.timeoutWebFetch} onChange={(v) => setForm({ ...form, timeoutWebFetch: v })} min={1000} hint={getDesktopLabel('settings.tools.web_fetch_hint', currentLang)} />
        <NumberField label={getDesktopLabel('settings.tools.default_timeout', currentLang)} value={form.timeoutDefault} onChange={(v) => setForm({ ...form, timeoutDefault: v })} min={1000} hint={getDesktopLabel('settings.tools.default_timeout_hint', currentLang)} />
      </div>

      <SectionHeader title={getDesktopLabel('settings.tools.concurrency', currentLang)} desc={getDesktopLabel('settings.tools.concurrency_desc', currentLang)} />
      <div className="grid grid-cols-2 gap-4">
        <NumberField label={getDesktopLabel('settings.tools.max_bg_tasks', currentLang)} value={form.maxBackgroundTasks} onChange={(v) => setForm({ ...form, maxBackgroundTasks: v })} min={1} />
      </div>

      <SectionHeader title={getDesktopLabel('settings.tools.output_limit', currentLang)} desc={getDesktopLabel('settings.tools.output_limit_desc', currentLang)} />
      <div className="grid grid-cols-2 gap-4">
        <NumberField label={getDesktopLabel('settings.tools.max_output', currentLang)} value={form.toolOutput} onChange={(v) => setForm({ ...form, toolOutput: v })} min={100} hint={getDesktopLabel('settings.tools.max_output_hint', currentLang)} />
      </div>

      <SectionHeader title={getDesktopLabel('settings.tools.grep_glob', currentLang)} />
      <div className="grid grid-cols-3 gap-4">
        <NumberField label={getDesktopLabel('settings.tools.grep_max_matches', currentLang)} value={form.grepMaxMatches} onChange={(v) => setForm({ ...form, grepMaxMatches: v })} min={1} />
        <NumberField label={getDesktopLabel('settings.tools.grep_max_per_file', currentLang)} value={form.grepMaxMatchesPerFile} onChange={(v) => setForm({ ...form, grepMaxMatchesPerFile: v })} min={1} />
        <NumberField label={getDesktopLabel('settings.tools.max_context_lines', currentLang)} value={form.grepMaxContextLines} onChange={(v) => setForm({ ...form, grepMaxContextLines: v })} min={1} />
        <NumberField label={getDesktopLabel('settings.tools.glob_max_files', currentLang)} value={form.globMaxFiles} onChange={(v) => setForm({ ...form, globMaxFiles: v })} min={1} />
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
      <SectionHeader title={getDesktopLabel('settings.features.intent_routing', currentLang)} desc={getDesktopLabel('settings.features.intent_routing_desc', currentLang)} />
      <ToggleField
        label={getDesktopLabel('settings.features.enable_intent', currentLang)}
        value={form.enableIntentAnalysis}
        onChange={(v) => setForm({ ...form, enableIntentAnalysis: v })}
        hint={getDesktopLabel('settings.features.enable_intent_hint', currentLang)}
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
    showThinking: true,
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
        showThinking: config.ui?.showThinking ?? true,
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
          { value: 'en', label: getDesktopLabel('settings.ui.lang_en', currentLang) },
          { value: 'zh', label: getDesktopLabel('settings.ui.lang_zh', currentLang) },
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
      <ToggleField label={getDesktopLabel('settings.ui.show_thinking', currentLang)} value={form.showThinking} onChange={(v) => setForm({ ...form, showThinking: v })} hint={getDesktopLabel('settings.ui.show_thinking_hint', currentLang)} />

      <SaveButton saving={saving} />
    </form>
  );
}
// ============================================================
// Tab: 下载配置
// ============================================================
function DownloadTab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    source: 'modelscope' as string,
    hfMirror: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (config?.download) {
      setForm({
        source: config.download.source || 'modelscope',
        hfMirror: config.download.hfMirror || '',
      });
    }
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave('download', form);
      setMessage({ type: 'success', text: getDesktopLabel('settings.download.saved', currentLang) });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.save_failed', currentLang) });
    } finally {
      setSaving(false);
    }
  };

  const sourceOptions: { value: string; label: string }[] = [
    { value: 'hf-mirror', label: 'hf-mirror.com（国内社区镜像）' },
    { value: 'huggingface', label: 'huggingface.co（官方）' },
    { value: 'modelscope', label: 'ModelScope 魔搭（阿里云国内）' },
    { value: 'custom', label: '自定义地址' },
  ];

  if (loading) return <div className="p-6 text-muted-foreground text-sm">{getDesktopLabel('settings.loading', currentLang)}</div>;

  return (
    <form onSubmit={handleSave} className="p-6 space-y-5">
      <MessageBanner message={message} />

      <SectionHeader title={getDesktopLabel('settings.download.title', currentLang)} desc={getDesktopLabel('settings.download.desc', currentLang)} />

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{getDesktopLabel('settings.download.source', currentLang)}</label>
        <select
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
          className="w-full px-3 py-2 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {sourceOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{getDesktopLabel('settings.download.source_hint', currentLang)}</p>
      </div>

      {form.source === 'custom' && (
        <TextField label={getDesktopLabel('settings.download.hf_mirror', currentLang)} value={form.hfMirror} onChange={(v) => setForm({ ...form, hfMirror: v })} placeholder="https://your-mirror.com" hint={getDesktopLabel('settings.download.hf_mirror_hint', currentLang)} />
      )}

      <SaveButton saving={saving} />
    </form>
  );
}

// ============================================================
// 设置页面主组件

function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('tools');
  const language = useConfigStore((s) => s.settings.language);
  const config = useConfigStore((s) => s.fullConfig);
  const loading = useConfigStore((s) => s.loading);
  const loadConfig = useConfigStore((s) => s.loadConfig);


  // 如果配置还没加载（理论上不会，App.tsx 已初始化），触发一次加载
  useEffect(() => {
    if (!config) {
      loadConfig();
    }
  }, [config, loadConfig]);

  const handleSave = async (section: string, data: any) => {
    const result = await window.electron.settingsUpdateConfig?.({
      section,
      sectionData: data,
      ...(section === 'embedding' ? { embedding: data } : {}),
    });

    if (result && !result.success) {
      throw new Error(result.error || getDesktopLabel('settings.save_failed', language));
    }

    if (section === 'ui') {
      if (data.language) {
        setLanguage(data.language as 'zh' | 'en');
      }
      // 直接更新内存状态，不重复持久化（上面已保存到磁盘）
      useConfigStore.getState().initSettings({
        theme: data.theme,
        language: data.language,
        showTokenUsage: data.showTokenUsage,
        showThinking: data.showThinking,
      });
    }

    // 保存后更新本地 fullConfig，让表单反映最新值
    useConfigStore.setState((s) => ({
      fullConfig: { ...s.fullConfig, [section]: { ...(s.fullConfig?.[section] || {}), ...data } },
    }));
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'tools', label: getDesktopLabel('settings.tools', language), icon: <Wrench size={16} /> },
    { id: 'features', label: getDesktopLabel('settings.features', language), icon: <Zap size={16} /> },
    { id: 'ui', label: getDesktopLabel('settings.ui', language), icon: <Palette size={16} /> },
    { id: 'modelProviders', label: getDesktopLabel('settings.model_providers', language), icon: <Sparkles size={16} /> },
    { id: 'download', label: getDesktopLabel('settings.download', language), icon: <Download size={16} /> },
  ];

  const tabProps: TabProps = { config, loading, onSave: handleSave };

  return (
    <div className="h-full flex flex-col text-foreground">
      <div className="flex flex-col h-full">
        {/* 顶部栏 */}
        <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0 bg-background">
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
          <aside className="w-48 border-r border-border p-3 space-y-1 shrink-0 bg-background">
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

          <div className="flex-1 overflow-y-auto bg-background">
            {activeTab === 'tools' && <ToolsTab {...tabProps} />}
            {activeTab === 'features' && <FeaturesTab {...tabProps} />}
            {activeTab === 'ui' && <UITab {...tabProps} />}
            {activeTab === 'modelProviders' && <ModelProvidersTab {...tabProps} />}
            {activeTab === 'download' && <DownloadTab {...tabProps} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(SettingsPage);