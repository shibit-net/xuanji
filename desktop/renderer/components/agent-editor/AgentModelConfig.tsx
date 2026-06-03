// ============================================================
// AgentModelConfig - Agent 模型与 Provider 配置区块
// ============================================================

import { memo } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { t } from '@/i18n';
import { useToast } from '../Toast';
import type { ModelOption } from './shared/constants';

interface LocalModelStatus {
  installed: boolean;
  downloading: boolean;
  progress: number;
}

interface ScannedModel {
  filename: string;
  path: string;
  size: number;
  modifiedAt: string;
}

interface AgentModelConfigProps {
  config: any;
  setConfig: (config: any) => void;
  errors: Record<string, string>;
  canEdit: (field: string) => boolean;
  renderFormField: (label: string, field: string, type?: 'text' | 'textarea' | 'number' | 'select', options?: string[], disabled?: boolean, placeholder?: string) => React.ReactNode;
  models: ModelOption[];
  modelsLoading: boolean;
  loadModels: (adapter?: string, searchName?: string) => Promise<void>;
  localModelStatuses: Record<string, LocalModelStatus>;
  scannedModels: ScannedModel[];
  downloadLocalModel: (modelId: string) => void;
  deleteLocalModel: (filename: string) => void;
}

function AgentModelConfig({
  config,
  setConfig,
  errors,
  canEdit,
  renderFormField,
  models,
  modelsLoading,
  loadModels,
  localModelStatuses,
  scannedModels,
  downloadLocalModel,
  deleteLocalModel,
}: AgentModelConfigProps) {
  const toast = useToast();

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('agent.editor.field.provider')}</label>
          <select
            value={config.provider?.adapter || 'anthropic'}
            onChange={(e) => {
              const newAdapter = e.target.value;
              setConfig({
                ...config,
                provider: { ...config.provider, adapter: newAdapter },
              });
              // 切换 adapter 时重新加载模型列表
              loadModels(newAdapter);
            }}
            disabled={!canEdit('provider.adapter')}
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="anthropic">Anthropic Claude</option>
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
            <option value="openai-response">OpenAI Responses (Image Gen)</option>
            <option value="gemini">Google Gemini</option>
            <option value="openrouter">OpenRouter</option>
            <option value="zai">智谱 GLM (Z.ai)</option>
            <option value="alibaba">阿里 DashScope (Qwen)</option>
            <option value="moonshot">Moonshot (Kimi)</option>
            <option value="xai">xAI (Grok)</option>
            <option value="nvidia">NVIDIA NIM</option>
            <option value="minimax">MiniMax</option>
            <option value="hunyuan">腾讯混元</option>
            <option value="baidu">百度文心</option>
            <option value="together">Together AI</option>
            <option value="fireworks">Fireworks AI</option>
            <option value="groq">Groq</option>
            <option value="perplexity">Perplexity</option>
            <option value="mistral">Mistral AI</option>
            <option value="cohere">Cohere</option>
            <option value="huggingface">Hugging Face</option>
            <option value="ollama">Ollama (Local)</option>
            <option value="vllm">vLLM (Local)</option>
            <option value="lmstudio">LM Studio (Local)</option>
            <option value="local-llama">{t('agent.editor.provider_local')}</option>
          </select>
        </div>
        {config.provider?.adapter === 'local-llama' ? (
          <div>
            <label className="block text-sm font-medium mb-2">{t('agent.editor.field.primary_model')}{t('agent.editor.provider_local_suffix')}</label>
            <div className="space-y-2 max-h-80 overflow-y-auto border border-border rounded-lg p-2">
              {[
                { id: 'qwen2.5-0.5b-q4', name: 'Qwen2.5-0.5B Q4', desc: t('agent.editor.local_model_desc_fast'), filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf' },
                { id: 'qwen2.5-1.5b-q4', name: 'Qwen2.5-1.5B Q4', desc: t('agent.editor.local_model_desc_balanced'), filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf' },
                { id: 'chatglm3-6b-q4', name: 'ChatGLM3-6B Q4', desc: t('agent.editor.local_model_desc_recommended'), filename: 'chatglm3-6b.Q4_K_M.gguf' },
                { id: 'chatglm3-6b-q3', name: 'ChatGLM3-6B Q3', desc: t('agent.editor.local_model_desc_faster'), filename: 'chatglm3-6b.Q3_K_M.gguf' },
                { id: 'glm4-9b-q4', name: 'GLM-4-9B Q4', desc: t('agent.editor.local_model_desc_high_precision'), filename: 'glm-4-9b-chat.Q4_K_M.gguf' },
              ].map((preset) => {
                const installed = localModelStatuses[preset.id]?.installed;
                const downloading = localModelStatuses[preset.id]?.downloading;
                return (
                  <label key={preset.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background cursor-pointer hover:border-primary/40">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="local-model"
                        checked={(config.model?.primary || 'qwen2.5-0.5b-q4') === preset.id}
                        onChange={() => setConfig({
                          ...config,
                          model: { ...config.model, primary: preset.id },
                        })}
                        className="text-primary"
                      />
                      <div>
                        <p className="text-sm font-medium">{preset.name}</p>
                        <p className="text-xs text-muted-foreground">{preset.desc}</p>
                      </div>
                    </div>
                    {!installed && !downloading && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          downloadLocalModel(preset.id);
                        }}
                        className="text-xs px-2 py-1 bg-primary/20 text-primary rounded hover:bg-primary/30 transition-colors flex items-center gap-1"
                      >
                        <Download size={12} />
                        {t('agent.editor.local_model_download')}
                      </button>
                    )}
                    {installed && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          if (confirm(t('agent.editor.local_model_confirm_uninstall', { name: preset.name }))) {
                            deleteLocalModel(preset.filename);
                          }
                        }}
                        className="text-xs px-2 py-1 text-red-500 hover:bg-red-500/10 rounded transition-colors flex items-center gap-1"
                      >
                        <Trash2 size={12} />
                        {t('agent.editor.local_model_uninstall')}
                      </button>
                    )}
                  </label>
                );
              })}

              {scannedModels.length > 0 && (
                <>
                  <div className="text-xs text-muted-foreground px-2 py-1 border-t border-border mt-2 pt-2">
                    {t('agent.editor.local_models_title')}
                  </div>
                  {scannedModels.map((item) => {
                    const modelId = item.filename;
                    const isSelected = config.model?.primary === modelId;
                    return (
                      <label key={item.filename} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background cursor-pointer hover:border-primary/40">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <input
                            type="radio"
                            name="local-model"
                            checked={isSelected}
                            onChange={() => setConfig({
                              ...config,
                              model: { ...config.model, primary: modelId },
                            })}
                            className="text-primary flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{item.filename}</p>
                            <p className="text-xs text-muted-foreground">
                              {(item.size / 1024 / 1024 / 1024).toFixed(2)} GB
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            if (confirm(t('agent.editor.local_model_confirm_uninstall', { name: item.filename }))) {
                              deleteLocalModel(item.filename);
                            }
                          }}
                          className="text-xs px-2 py-1 text-red-500 hover:bg-red-500/10 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                        >
                          <Trash2 size={12} />
                          {t('agent.editor.local_model_uninstall')}
                        </button>
                      </label>
                    );
                  })}
                </>
              )}
            </div>
            {errors.model && (
              <p className="text-xs text-red-400 mt-2">⚠️ {errors.model}</p>
            )}
          </div>
        ) : (
          renderFormField(t('agent.editor.field.primary_model'), 'model.primary', 'select')
        )}
      </div>
      {config.provider?.adapter !== 'local-llama' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('agent.editor.api_key')}</label>
            <input
              type="password"
              value={config.provider?.apiKey || ''}
              onChange={(e) => setConfig({
                ...config,
                provider: { ...config.provider, apiKey: e.target.value },
              })}
              placeholder={t('agent.editor.api_key_placeholder')}
              disabled={!canEdit('provider.apiKey')}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('agent.editor.base_url')}</label>
            <input
              type="text"
              value={config.provider?.baseURL || ''}
              onChange={(e) => setConfig({
                ...config,
                provider: { ...config.provider, baseURL: e.target.value },
              })}
              placeholder={t('agent.editor.base_url_placeholder')}
              disabled={!canEdit('provider.baseURL')}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      )}
      {config.provider?.adapter === 'local-llama' && (
        <div className="text-xs">
          <button
            type="button"
            onClick={async () => {
              try {
                const result = await window.electron.localModelOpenDir();
                if (!result.success) {
                  toast.error(result.error || t('agent.editor.toast.open_dir_failed'));
                }
              } catch (err: any) {
                toast.error(err.message || t('agent.editor.toast.open_dir_failed'));
              }
            }}
            className="text-primary hover:underline cursor-pointer"
          >
            {t('agent.editor.local_model_open_dir')}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {renderFormField(t('agent.editor.field.temperature'), 'model.temperature', 'number', undefined, undefined, '0.3')}
        {renderFormField(t('agent.editor.field.max_tokens'), 'model.maxTokens', 'number', undefined, undefined, '8192')}
      </div>
      {config.provider?.adapter === 'local-llama' && (
        <div className="mt-3">
          {renderFormField(t('agent.editor.field.context_window'), 'model.contextSize', 'number', undefined, undefined, '200000')}
        </div>
      )}
    </>
  );
}

export default memo(AgentModelConfig);
