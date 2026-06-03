// ============================================================
// SettingsPage - 设置页面（所有配置动态生效）
// ============================================================

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Settings, X, Wrench,
  Palette, Zap,
  Download, Sparkles, Trash2, Loader2, FolderOpen,
} from 'lucide-react';
import { useConfigStore } from '../stores/configStore';
import { getDesktopLabel } from '../i18n';
import { setLanguage } from '@/core/i18n';
import {
  SectionHeader, TextField, NumberField, SelectField,
  ToggleField, SaveButton, MessageBanner,
} from './settings/components';

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
// Tab: Embedding 配置
// ============================================================
function EmbeddingTab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
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
      console.error('Failed to check model install status:', err);
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
      if (!dirResult.success || !dirResult.dir) throw new Error(getDesktopLabel('settings.embedding.dir_failed', currentLang));
      const embeddingDir = dirResult.dir;
      const modelId = form.model;
      const source = config?.download?.source || 'modelscope';
      const customMirror = config?.download?.hfMirror;
      let baseUrl: string;
      switch (source) {
        case 'huggingface':
          baseUrl = `https://huggingface.co/${modelId}/resolve/main`; break;
        case 'modelscope':
          baseUrl = `https://www.modelscope.cn/models/${modelId}/resolve/master`; break;
        case 'custom':
          baseUrl = `${customMirror || 'https://huggingface.co'}/${modelId}/resolve/main`; break;
        case 'hf-mirror':
        default:
          baseUrl = `https://hf-mirror.com/${modelId}/resolve/main`; break;
      }
      const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];
      for (const file of files) {
        const url = `${baseUrl}/${file}`;
        const dest = `${embeddingDir}/${modelId}/${file}`;
        const result = await window.electron.downloadCreate({ url, dest, name: `Embedding: ${modelId}/${file}`, category: 'model' });
        if (!result.success) throw new Error(`${getDesktopLabel('settings.embedding.download_failed', currentLang)}: ${file}`);
      }
      setMessage({ type: 'success', text: getDesktopLabel('settings.embedding.download_task_created', currentLang) });
      setTimeout(() => { setMessage(null); checkModelInstallation(); }, 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.embedding.download_failed', currentLang) });
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
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.embedding.uninstall_failed', currentLang) });
    } finally {
      setUninstalling(false);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground text-sm">{getDesktopLabel('settings.loading', currentLang)}</div>;

  return (
    <form onSubmit={handleSave} className="p-6 space-y-5">
      <MessageBanner message={message} />

      <SectionHeader title={getDesktopLabel('settings.embedding.model', currentLang)} desc={getDesktopLabel('settings.embedding.model_desc', currentLang)} />
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
            {uninstalling ? getDesktopLabel('settings.embedding.uninstalling', currentLang) : getDesktopLabel('settings.embedding.uninstall', currentLang)}
          </Button>
        ) : (
          <Button type="button" onClick={handleDownloadModel} disabled={downloading || !form.model}
            variant="default" size="sm" className="whitespace-nowrap">
            {downloading ? getDesktopLabel('settings.embedding.installing', currentLang) : getDesktopLabel('settings.embedding.install', currentLang)}
          </Button>
        )}
      </div>
      {checkingModel && <p className="text-xs text-muted-foreground">{getDesktopLabel('settings.embedding.checking', currentLang)}</p>}
      {!checkingModel && modelInstalled === true && <p className="text-xs text-green-400">{getDesktopLabel('settings.embedding.installed', currentLang)}</p>}
      {!checkingModel && modelInstalled === false && <p className="text-xs text-yellow-400">{getDesktopLabel('settings.embedding.not_installed', currentLang)}</p>}

      <SaveButton saving={saving} />
    </form>
  );
}

// ============================================================
// Tab: 模型配置（向量 + 兜底 + 媒体生成）
// ============================================================

const FALLBACK_PROVIDER_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic Claude', baseURL: 'https://api.anthropic.com/v1' },
  { value: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  { value: 'zai', label: '智谱 AI', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { value: 'alibaba', label: '阿里云 DashScope', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'moonshot', label: 'Moonshot (Kimi)', baseURL: 'https://api.moonshot.cn/v1' },
  { value: 'ollama', label: 'Ollama (本地)', baseURL: 'http://localhost:11434/v1' },
  { value: 'vllm', label: 'vLLM (本地)', baseURL: 'http://localhost:8000/v1' },
  { value: 'lmstudio', label: 'LM Studio (本地)', baseURL: 'http://localhost:1234/v1' },
];

function ModelProvidersTab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    // Embedding
    emb_provider: 'xenova',
    embModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    emb_apiKey: '',
    emb_baseURL: '',
    // Fallback Provider
    fbAdapter: '',
    fbModel: '',
    fbApiKey: '',
    fbBaseURL: '',
    // Media
    genImg_provider: 'ark',
    genImg_model: '',
    genImg_apiKey: '',
    genImg_baseURL: '',
    editImg_provider: 'ark',
    editImg_model: '',
    editImg_apiKey: '',
    editImg_baseURL: '',
    genVideo_provider: 'ark',
    genVideo_model: '',
    genVideo_apiKey: '',
    genVideo_baseURL: '',
    genAudio_provider: 'ark',
    genAudio_model: '',
    genAudio_apiKey: '',
    genAudio_baseURL: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Embedding model list (presets + directory)
  interface EmbeddingModelItem {
    id: string;
    name: string;
    description: string;
    installed: boolean;
  }
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelItem[]>([]);
  const [loadingEmbeddingModels, setLoadingEmbeddingModels] = useState(false);
  const [embeddingDownloading, setEmbeddingDownloading] = useState<Record<string, boolean>>({});
  const [embeddingUninstalling, setEmbeddingUninstalling] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const emb = config?.modelProviders?.embedding || config?.embedding || {};
    const media = config?.modelProviders?.media || {};
    const genImg = media.generate_image || {};
    const editImg = media.edit_image || {};
    const fb = config?.fallbackProvider || {};
    setForm({
      emb_provider: emb.provider === 'local' ? 'xenova' : (emb.provider || 'xenova'),
      embModel: emb.model || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      emb_apiKey: emb.apiKey || '',
      emb_baseURL: emb.baseURL || '',
      fbAdapter: fb.adapter || '',
      fbModel: fb.model || '',
      fbApiKey: fb.apiKey || '',
      fbBaseURL: fb.baseURL || '',
      genImg_provider: genImg.provider || 'ark',
      genImg_model: genImg.model || '',
      genImg_apiKey: genImg.apiKey || '',
      genImg_baseURL: genImg.baseURL || '',
      editImg_provider: editImg.provider || 'ark',
      editImg_model: editImg.model || '',
      editImg_apiKey: editImg.apiKey || '',
      editImg_baseURL: editImg.baseURL || '',
      genVideo_provider: (media.generate_video || {} as any).provider || 'ark',
      genVideo_model: (media.generate_video || {} as any).model || '',
      genVideo_apiKey: (media.generate_video || {} as any).apiKey || '',
      genVideo_baseURL: (media.generate_video || {} as any).baseURL || '',
      genAudio_provider: (media.generate_audio || {} as any).provider || 'ark',
      genAudio_model: (media.generate_audio || {} as any).model || '',
      genAudio_apiKey: (media.generate_audio || {} as any).apiKey || '',
      genAudio_baseURL: (media.generate_audio || {} as any).baseURL || '',
    });
  }, [config]);

  // Load embedding model list
  const loadEmbeddingModels = useCallback(async () => {
    setLoadingEmbeddingModels(true);
    try {
      const result = await window.electron.downloadListEmbeddingModels();
      if (result.success && result.models) {
        setEmbeddingModels(result.models);
      }
    } catch { /* ignore */ }
    finally { setLoadingEmbeddingModels(false); }
  }, []);

  // Ref to avoid stale closure on embeddingDownloading in polling interval
  const embeddingDownloadingRef = useRef(embeddingDownloading);
  embeddingDownloadingRef.current = embeddingDownloading;

  useEffect(() => {
    if (form.emb_provider === 'xenova') {
      loadEmbeddingModels();
      // Poll download tasks to update install status
      const interval = setInterval(async () => {
        try {
          const tasksResult = await window.electron.downloadGetTasks();
          if (tasksResult.success && tasksResult.tasks) {
            const hasActiveEmbeddingTask = tasksResult.tasks.some(
              (t) => t.category === 'model' && t.name.startsWith('Embedding:')
            );
            if (hasActiveEmbeddingTask || Object.values(embeddingDownloadingRef.current).some(Boolean)) {
              loadEmbeddingModels();
            }
          }
        } catch { /* ignore */ }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [form.emb_provider, loadEmbeddingModels]);

  // Handle model selection — triggers auto-download if not installed
  const handleEmbeddingModelSelect = async (modelId: string) => {
    setForm((prev) => ({ ...prev, embModel: modelId }));
    const model = embeddingModels.find((m) => m.id === modelId);
    if (model && !model.installed) {
      await handleEmbeddingModelDownload(modelId);
    }
  };

  const handleEmbeddingModelDownload = async (modelId: string) => {
    setEmbeddingDownloading((prev) => ({ ...prev, [modelId]: true }));
    setMessage(null);
    try {
      const dirResult = await window.electron.downloadGetEmbeddingModelDir();
      if (!dirResult.success || !dirResult.dir) throw new Error(getDesktopLabel('settings.embedding.dir_failed', currentLang));
      const source = config?.download?.source || 'modelscope';
      const customMirror = config?.download?.hfMirror;
      let baseUrl: string;
      switch (source) {
        case 'huggingface': baseUrl = `https://huggingface.co/${modelId}/resolve/main`; break;
        case 'modelscope': baseUrl = `https://www.modelscope.cn/models/${modelId}/resolve/master`; break;
        case 'custom': baseUrl = `${customMirror || 'https://huggingface.co'}/${modelId}/resolve/main`; break;
        default: baseUrl = `https://hf-mirror.com/${modelId}/resolve/main`; break;
      }
      const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];
      for (const file of files) {
        await window.electron.downloadCreate({
          url: `${baseUrl}/${file}`,
          dest: `${dirResult.dir}/${modelId}/${file}`,
          name: `Embedding: ${modelId}/${file}`,
          category: 'model',
        });
      }
      const modelName = embeddingModels.find((m) => m.id === modelId)?.name || modelId;
      setMessage({ type: 'success', text: getDesktopLabel('settings.embedding.toast.download_start', currentLang).replace('{name}', modelName) });
      setTimeout(() => { setMessage(null); loadEmbeddingModels(); }, 3000);
    } catch (err) {
      const modelName = embeddingModels.find((m) => m.id === modelId)?.name || modelId;
      setMessage({ type: 'error', text: getDesktopLabel('settings.embedding.toast.download_failed', currentLang).replace('{name}', modelName) });
    } finally {
      setEmbeddingDownloading((prev) => ({ ...prev, [modelId]: false }));
    }
  };

  const handleEmbeddingModelUninstall = async (modelId: string) => {
    const modelName = embeddingModels.find((m) => m.id === modelId)?.name || modelId;
    if (!confirm(getDesktopLabel('settings.embedding.uninstall_confirm', currentLang))) return;
    setEmbeddingUninstalling((prev) => ({ ...prev, [modelId]: true }));
    setMessage(null);
    try {
      const result = await window.electron.downloadUninstallEmbeddingModel(modelId);
      if (result.success) {
        setMessage({ type: 'success', text: getDesktopLabel('settings.embedding.toast.delete_success', currentLang).replace('{name}', modelName) });
        setTimeout(() => { setMessage(null); loadEmbeddingModels(); }, 3000);
      } else throw new Error(result.error || getDesktopLabel('settings.embedding.toast.delete_failed', currentLang));
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.embedding.toast.delete_failed', currentLang) });
    } finally {
      setEmbeddingUninstalling((prev) => ({ ...prev, [modelId]: false }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      // Save modelProviders (embedding + media)
      await onSave('modelProviders', {
        embedding: {
          provider: form.emb_provider,
          model: form.embModel,
          apiKey: form.emb_apiKey || undefined,
          baseURL: form.emb_baseURL || undefined,
        },
        media: {
          generate_image: {
            provider: form.genImg_provider,
            model: form.genImg_model,
            apiKey: form.genImg_apiKey,
            baseURL: form.genImg_baseURL || undefined,
          },
          edit_image: {
            provider: form.editImg_provider,
            model: form.editImg_model,
            apiKey: form.editImg_apiKey,
            baseURL: form.editImg_baseURL || undefined,
          },
          generate_video: {
            provider: form.genVideo_provider,
            model: form.genVideo_model,
            apiKey: form.genVideo_apiKey,
            baseURL: form.genVideo_baseURL || undefined,
          },
          generate_audio: {
            provider: form.genAudio_provider,
            model: form.genAudio_model,
            apiKey: form.genAudio_apiKey,
            baseURL: form.genAudio_baseURL || undefined,
          },
        },
      });
      // Save fallbackProvider
      await onSave('fallbackProvider', {
        adapter: form.fbAdapter,
        model: form.fbModel,
        apiKey: form.fbApiKey,
        baseURL: form.fbBaseURL,
      });
      setMessage({ type: 'success', text: getDesktopLabel('settings.model_providers.saved', currentLang) });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : getDesktopLabel('settings.save_failed', currentLang) });
    } finally { setSaving(false); }
  };

  const mediaProviderOptions = [
    { value: 'ark', label: '火山引擎方舟 (Ark)' },
    { value: 'bailian', label: '阿里百炼 (Bailian)' },
  ];

  const EMBEDDING_PRESET_IDS = [
    'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    'Xenova/all-MiniLM-L6-v2',
    'Xenova/bge-small-en-v1.5',
  ];

  const embeddingProviderOptions = [
    { value: 'xenova', label: '本地模型 (Xenova)' },
    { value: 'ark', label: '火山引擎方舟 (Ark)' },
    { value: 'bailian', label: '阿里百炼 (Bailian)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'ollama', label: 'Ollama' },
  ];

  if (loading) return <div className="p-6 text-muted-foreground text-sm">{getDesktopLabel('settings.loading', currentLang)}</div>;

  const renderMediaToolSection = (label: string, prefix: string) => (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">{label}</h4>
      <div className="grid grid-cols-2 gap-4">
        <SelectField label={getDesktopLabel('settings.model_providers.provider', currentLang)} value={(form as any)[`${prefix}_provider`]} onChange={(v) => setForm({ ...form, [`${prefix}_provider`]: v })} options={mediaProviderOptions} />
        <TextField label={getDesktopLabel('settings.model_providers.model', currentLang)} value={(form as any)[`${prefix}_model`]} onChange={(v) => setForm({ ...form, [`${prefix}_model`]: v })} placeholder="doubao-seedream-4.0" />
        <TextField label={getDesktopLabel('settings.model_providers.api_key', currentLang)} value={(form as any)[`${prefix}_apiKey`]} onChange={(v) => setForm({ ...form, [`${prefix}_apiKey`]: v })} type="password" placeholder="sk-..." />
        <TextField label={getDesktopLabel('settings.model_providers.base_url', currentLang)} value={(form as any)[`${prefix}_baseURL`]} onChange={(v) => setForm({ ...form, [`${prefix}_baseURL`]: v })} placeholder="https://ark.cn-beijing.volces.com/api/v3" hint={getDesktopLabel('settings.model_providers.base_url_hint', currentLang)} />
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSave} className="p-6 space-y-6">
      <MessageBanner message={message} />

      {/* ===== Section 1: 向量模型 ===== */}
      <SectionHeader title={getDesktopLabel('settings.model_providers.embedding_title', currentLang)} desc={getDesktopLabel('settings.model_providers.embedding_desc', currentLang)} />
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label={getDesktopLabel('settings.model_providers.provider', currentLang)}
          value={form.emb_provider}
          onChange={(v) => setForm({ ...form, emb_provider: v })}
          options={embeddingProviderOptions}
        />
        {form.emb_provider !== 'xenova' && (
          <>
            <TextField
              label={getDesktopLabel('settings.model_providers.model', currentLang)}
              value={form.embModel}
              onChange={(v) => setForm({ ...form, embModel: v })}
              placeholder="doubao-embedding-vision"
              hint={getDesktopLabel('settings.model_providers.model_hint', currentLang)}
            />
            <TextField label={getDesktopLabel('settings.model_providers.api_key', currentLang)} value={form.emb_apiKey} onChange={(v) => setForm({ ...form, emb_apiKey: v })} type="password" placeholder="sk-..." />
            <TextField label={getDesktopLabel('settings.model_providers.base_url', currentLang)} value={form.emb_baseURL} onChange={(v) => setForm({ ...form, emb_baseURL: v })} placeholder="https://api.example.com/v1" hint={getDesktopLabel('settings.model_providers.base_url_hint', currentLang)} />
          </>
        )}
      </div>
      {form.emb_provider === 'xenova' && (
        <div className="space-y-2">
          {loadingEmbeddingModels ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 size={14} className="animate-spin" />
              {getDesktopLabel('settings.loading', currentLang)}
            </div>
          ) : (
            <>
              <select
                value={form.embModel}
                onChange={(e) => handleEmbeddingModelSelect(e.target.value)}
                className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
              >
                {embeddingModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {model.description}{model.installed ? ` [${getDesktopLabel('settings.embedding.model_installed', currentLang)}]` : ''}
                  </option>
                ))}
                {embeddingModels.length === 0 && (
                  <option value="" disabled>{getDesktopLabel('settings.model_providers.no_models', currentLang)}</option>
                )}
              </select>
              {/* 选中模型的操作按钮 */}
              {(() => {
                const selectedModel = embeddingModels.find((m) => m.id === form.embModel);
                if (!selectedModel) return null;
                const isDownloading = embeddingDownloading[selectedModel.id];
                const isUninstalling = embeddingUninstalling[selectedModel.id];
                return (
                  <div className="flex items-center gap-2">
                    {isDownloading ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" />
                        {getDesktopLabel('settings.embedding.installing', currentLang)}
                      </span>
                    ) : isUninstalling ? (
                      <span className="text-xs text-muted-foreground">{getDesktopLabel('settings.embedding.uninstalling', currentLang)}</span>
                    ) : selectedModel.installed ? (
                      <>
                        <span className="text-xs text-green-400">{getDesktopLabel('settings.embedding.model_installed', currentLang)}</span>
                        <Button type="button" onClick={() => handleEmbeddingModelUninstall(selectedModel.id)}
                          variant="destructive" size="sm" className="h-7 text-xs">
                          <Trash2 size={12} className="mr-1" />
                          {getDesktopLabel('settings.embedding.uninstall', currentLang)}
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-yellow-400">{getDesktopLabel('settings.embedding.model_not_installed', currentLang)}</span>
                        <Button type="button" onClick={() => handleEmbeddingModelDownload(selectedModel.id)}
                          variant="default" size="sm" className="h-7 text-xs">
                          <Download size={12} className="mr-1" />
                          {getDesktopLabel('settings.embedding.download', currentLang)}
                        </Button>
                      </>
                    )}
                  </div>
                );
              })()}
            </>
          )}
          <div className="text-xs">
            <button
              type="button"
              onClick={async () => {
                try {
                  const result = await window.electron.downloadOpenEmbeddingModelDir();
                  if (!result.success) {
                    setMessage({ type: 'error', text: getDesktopLabel('settings.embedding.open_dir_failed', currentLang) });
                  }
                } catch {
                  setMessage({ type: 'error', text: getDesktopLabel('settings.embedding.open_dir_failed', currentLang) });
                }
              }}
              className="text-primary hover:underline cursor-pointer"
            >
              <FolderOpen size={12} className="inline mr-1" />
              {getDesktopLabel('settings.embedding.open_dir', currentLang)}
            </button>
          </div>
        </div>
      )}

      {/* ===== Section 2: 兜底模型 ===== */}
      <SectionHeader title={getDesktopLabel('settings.model_providers.fallback_title', currentLang)} desc={getDesktopLabel('settings.model_providers.fallback_desc', currentLang)} />
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label={getDesktopLabel('settings.model_providers.provider', currentLang)}
          value={form.fbAdapter}
          onChange={(v) => {
            const opt = FALLBACK_PROVIDER_OPTIONS.find(o => o.value === v);
            setForm({ ...form, fbAdapter: v, fbBaseURL: opt ? opt.baseURL : form.fbBaseURL });
          }}
          options={FALLBACK_PROVIDER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
        />
        <TextField label={getDesktopLabel('settings.model_providers.model', currentLang)} value={form.fbModel} onChange={(v) => setForm({ ...form, fbModel: v })} placeholder="deepseek-v4-pro" />
        <TextField label={getDesktopLabel('settings.model_providers.api_key', currentLang)} value={form.fbApiKey} onChange={(v) => setForm({ ...form, fbApiKey: v })} type="password" placeholder="sk-..." />
        <TextField label={getDesktopLabel('settings.model_providers.base_url', currentLang)} value={form.fbBaseURL} onChange={(v) => setForm({ ...form, fbBaseURL: v })} placeholder={getDesktopLabel('settings.model_providers.fallback_placeholder', currentLang)} hint={getDesktopLabel('settings.model_providers.fallback_base_url_hint', currentLang)} />
      </div>

      {/* ===== Section 3: 媒体生成 ===== */}
      <SectionHeader title={getDesktopLabel('settings.model_providers.media_title', currentLang)} desc={getDesktopLabel('settings.model_providers.media_desc', currentLang)} />
      {renderMediaToolSection(getDesktopLabel('settings.model_providers.generate_image', currentLang), 'genImg')}
      {renderMediaToolSection(getDesktopLabel('settings.model_providers.edit_image', currentLang), 'editImg')}
      {renderMediaToolSection(getDesktopLabel('settings.model_providers.video_gen', currentLang), 'genVideo')}
      {renderMediaToolSection(getDesktopLabel('settings.model_providers.audio_gen', currentLang), 'genAudio')}

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
// ============================================================
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
        <aside className="w-48 border-r border-border p-3 space-y-1 shrink-0">
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
          {activeTab === 'modelProviders' && <ModelProvidersTab {...tabProps} />}
          {activeTab === 'download' && <DownloadTab {...tabProps} />}
        </div>
      </div>
    </div>
  );
}

export default memo(SettingsPage);