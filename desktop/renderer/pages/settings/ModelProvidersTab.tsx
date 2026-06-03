// ============================================================
// ModelProvidersTab - 模型配置（向量 + 兜底 + 媒体生成）
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Trash2, Loader2, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfigStore } from '../../stores/configStore';
import { getDesktopLabel } from '../../i18n';
import {
  SectionHeader, SelectField, TextField, SaveButton, MessageBanner,
} from './components';

interface TabProps {
  config: any;
  loading: boolean;
  onSave: (section: string, data: any) => Promise<void>;
}

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

const mediaProviderOptions = [
  { value: 'ark', label: '火山引擎方舟 (Ark)' },
  { value: 'bailian', label: '阿里百炼 (Bailian)' },
];

const embeddingProviderOptions = [
  { value: 'xenova', label: '本地模型 (Xenova)' },
  { value: 'ark', label: '火山引擎方舟 (Ark)' },
  { value: 'bailian', label: '阿里百炼 (Bailian)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'ollama', label: 'Ollama' },
];

interface EmbeddingModelItem {
  id: string;
  name: string;
  description: string;
  installed: boolean;
}

export default function ModelProvidersTab({ config, loading, onSave }: TabProps) {
  const currentLang = useConfigStore((s) => s.settings.language);
  const [form, setForm] = useState({
    emb_provider: 'xenova',
    embModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    emb_apiKey: '',
    emb_baseURL: '',
    fbAdapter: '',
    fbModel: '',
    fbApiKey: '',
    fbBaseURL: '',
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

  const embeddingDownloadingRef = useRef(embeddingDownloading);
  embeddingDownloadingRef.current = embeddingDownloading;

  useEffect(() => {
    if (form.emb_provider === 'xenova') {
      loadEmbeddingModels();
      const interval = setInterval(async () => {
        try {
          const tasksResult = await window.electron.downloadGetTasks();
          if (tasksResult.success && tasksResult.tasks) {
            const hasActiveEmbeddingTask = tasksResult.tasks.some(
              (t: any) => t.category === 'model' && t.name.startsWith('Embedding:')
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
      await onSave('modelProviders', {
        embedding: {
          provider: form.emb_provider,
          model: form.embModel,
          apiKey: form.emb_apiKey || undefined,
          baseURL: form.emb_baseURL || undefined,
        },
        media: {
          generate_image: { provider: form.genImg_provider, model: form.genImg_model, apiKey: form.genImg_apiKey, baseURL: form.genImg_baseURL || undefined },
          edit_image: { provider: form.editImg_provider, model: form.editImg_model, apiKey: form.editImg_apiKey, baseURL: form.editImg_baseURL || undefined },
          generate_video: { provider: form.genVideo_provider, model: form.genVideo_model, apiKey: form.genVideo_apiKey, baseURL: form.genVideo_baseURL || undefined },
          generate_audio: { provider: form.genAudio_provider, model: form.genAudio_model, apiKey: form.genAudio_apiKey, baseURL: form.genAudio_baseURL || undefined },
        },
      });
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
            <TextField label={getDesktopLabel('settings.model_providers.model', currentLang)} value={form.embModel} onChange={(v) => setForm({ ...form, embModel: v })} placeholder="doubao-embedding-vision" hint={getDesktopLabel('settings.model_providers.model_hint', currentLang)} />
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

      <SectionHeader title={getDesktopLabel('settings.model_providers.media_title', currentLang)} desc={getDesktopLabel('settings.model_providers.media_desc', currentLang)} />
      {renderMediaToolSection(getDesktopLabel('settings.model_providers.generate_image', currentLang), 'genImg')}
      {renderMediaToolSection(getDesktopLabel('settings.model_providers.edit_image', currentLang), 'editImg')}
      {renderMediaToolSection(getDesktopLabel('settings.model_providers.video_gen', currentLang), 'genVideo')}
      {renderMediaToolSection(getDesktopLabel('settings.model_providers.audio_gen', currentLang), 'genAudio')}

      <SaveButton saving={saving} />
    </form>
  );
}
