import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfigStore } from '../stores/configStore';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { getDesktopLabel } from '../i18n';

const PROVIDER_OPTIONS: Array<{ value: string; label: string; baseURL: string }> = [
  { value: 'anthropic', label: 'Anthropic Claude', baseURL: 'https://api.anthropic.com/v1' },
  { value: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  { value: 'zai', label: '智谱 AI (Z.ai)', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { value: 'alibaba', label: '阿里云 (DashScope)', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'moonshot', label: 'Moonshot (Kimi)', baseURL: 'https://api.moonshot.cn/v1' },
  { value: 'xai', label: 'xAI (Grok)', baseURL: 'https://api.x.ai/v1' },
  { value: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
  { value: 'together', label: 'Together AI', baseURL: 'https://api.together.xyz/v1' },
  { value: 'groq', label: 'Groq', baseURL: 'https://api.groq.com/openai/v1' },
  { value: 'mistral', label: 'Mistral AI', baseURL: 'https://api.mistral.ai/v1' },
  { value: 'gemini', label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com' },
  { value: 'nvidia', label: 'NVIDIA NIM', baseURL: 'https://integrate.api.nvidia.com/v1' },
  { value: 'hunyuan', label: '腾讯混元', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { value: 'fireworks', label: 'Fireworks AI', baseURL: 'https://api.fireworks.ai/inference/v1' },
  { value: 'perplexity', label: 'Perplexity', baseURL: 'https://api.perplexity.ai' },
  { value: 'ollama', label: 'Ollama (本地)', baseURL: 'http://localhost:11434/v1' },
  { value: 'vllm', label: 'vLLM (本地)', baseURL: 'http://localhost:8000/v1' },
  { value: 'lmstudio', label: 'LM Studio (本地)', baseURL: 'http://localhost:1234/v1' },
  { value: 'local-llama', label: 'Local LLama', baseURL: '' },
  { value: 'minimax', label: 'MiniMax', baseURL: 'https://api.minimax.chat/v1' },
  { value: 'cohere', label: 'Cohere', baseURL: 'https://api.cohere.ai/v1' },
];

const LOCAL_PROVIDERS = new Set(['ollama', 'vllm', 'lmstudio', 'local-llama']);

export default function FallbackProviderSetupPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const fallbackProvider = useConfigStore((s) => s.fallbackProvider);
  const language = useConfigStore((s) => s.settings.language) || 'en';
  const t = (key: string) => getDesktopLabel(key, language);

  const [adapter, setAdapter] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (fallbackProvider) {
      setAdapter(fallbackProvider.adapter || '');
      setApiKey(fallbackProvider.apiKey || '');
      setBaseURL(fallbackProvider.baseURL || '');
      setModel(fallbackProvider.model || '');
    }
  }, [fallbackProvider]);

  const handleAdapterChange = useCallback((value: string) => {
    setAdapter(value);
    const option = PROVIDER_OPTIONS.find((o) => o.value === value);
    if (option) {
      setBaseURL(option.baseURL);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!adapter) {
      setError(t('setup.error_select_provider'));
      return;
    }
    if (!LOCAL_PROVIDERS.has(adapter) && !apiKey) {
      setError(t('setup.error_api_key'));
      return;
    }
    if (!model) {
      setError(t('setup.error_model'));
      return;
    }

    setSaving(true);
    try {
      const userId = useAuthStore.getState().user?.userId;
      const result = await window.electron.settingsUpdateConfig({
        section: 'fallbackProvider',
        sectionData: {
          adapter,
          apiKey: apiKey || undefined,
          baseURL: baseURL || undefined,
          model,
        },
        userId,
      });

      if (result?.success) {
        // 落盘成功后，读取磁盘验证确实写入了
        const uid = useAuthStore.getState().user?.userId;
        console.log(`[DIAG] setup save success, uid=${uid}, fallbackProvider=`, JSON.stringify({ adapter, apiKey: apiKey ? '***' : undefined, baseURL, model }));
        const verify = await window.electron.settingsReadDiskConfig?.(uid);
        if (!verify?.config?.fallbackProvider?.adapter) {
          setError('配置写入磁盘后读取不到，请重试');
          return;
        }
        console.log(`[DIAG] setup verify pass, disk fallbackProvider=`, JSON.stringify(verify?.config?.fallbackProvider));

        // 验证通过 → 更新 store，全量重载到首页重新初始化
        useConfigStore.setState({
          fallbackProvider: verify.config.fallbackProvider,
        });
        toast.success(t('setup.save_success'));
        window.location.hash = '#/';
      } else {
        setError(result?.error || t('setup.save_failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('setup.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center overflow-hidden">
      <div className="fixed top-[-15%] left-[-5%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px]" />
      <div className="fixed bottom-[-15%] right-[-5%] w-[40%] h-[40%] rounded-full bg-accent/10 blur-[100px]" />

      <div className="relative w-full max-w-md px-6">
        <Card className="shadow-glass-xl">
          <CardHeader className="text-center pt-10 pb-2">
            <div className="mx-auto mb-6 w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center shadow-glass-sm">
              <svg className="w-10 h-10 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            </div>
            <CardTitle className="text-2xl font-display font-semibold tracking-tight">
              {t('setup.title')}
            </CardTitle>
            <CardDescription className="text-sm mt-1.5">
              {t('setup.desc')}
            </CardDescription>
          </CardHeader>

          <CardContent className="px-8 pb-10 pt-2">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                  <p className="text-destructive text-xs font-medium">{error}</p>
                </div>
              )}

              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">{t('setup.provider_label')}</Label>
                <Select value={adapter} onValueChange={handleAdapterChange} disabled={saving}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('setup.provider_placeholder')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {PROVIDER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  {t('setup.api_key_label')}{LOCAL_PROVIDERS.has(adapter) ? t('setup.api_key_optional') : ''}
                </Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={LOCAL_PROVIDERS.has(adapter) ? t('setup.api_key_placeholder_local') : t('setup.api_key_placeholder')}
                  disabled={saving}
                />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">{t('setup.base_url_label')}</Label>
                <Input
                  type="text"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder={t('setup.base_url_placeholder')}
                  disabled={saving}
                />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">{t('setup.model_label')}</Label>
                <Input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t('setup.model_placeholder')}
                  disabled={saving}
                />
              </div>

              <Button
                type="submit"
                disabled={saving || !adapter || !model}
                className="w-full h-10 rounded-xl font-medium text-sm active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {t('setup.saving')}
                  </>
                ) : t('setup.save_button')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
