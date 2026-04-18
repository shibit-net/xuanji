// ============================================================
// SettingsPanel - 设置面板组件
// ============================================================

import { useState, useEffect } from 'react';
import { X, Save, Eye, EyeOff, Loader2, Check, Settings } from 'lucide-react';

interface SettingsPanelProps {
  onClose: () => void;
}

interface ProviderConfig {
  model: string;
  adapter: string;
  apiKey: string;
  hasApiKey: boolean;
  baseURL: string;
  maxTokens: number;
  temperature: number;
  lightModel: string;
}

type TabId = 'general';

interface ModelOption {
  id: number;
  name: string;
  model: string;
  adapter: string;
  vendor?: string;
}

const ADAPTERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'ollama', label: 'Ollama (本地)' },
];

// 作为备选的硬编码模型列表（如果 API 不可用）
const FALLBACK_MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'],
  ollama: ['llama3.1', 'codellama', 'mistral', 'qwen2.5'],
};

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // 表单状态
  const [adapter, setAdapter] = useState('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');

  // 模型列表状态
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // 加载当前配置
  useEffect(() => {
    loadConfig();
    loadModels();
  }, []);

  // 当适配器变化时，重新加载模型列表
  useEffect(() => {
    loadModels();
  }, [adapter]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const result = await window.electron.settingsGetConfig();
      if (result.success && result.config) {
        const p = result.config.provider as ProviderConfig;
        setAdapter(p.adapter || 'anthropic');
        setModel(p.model || '');
        setApiKey(p.apiKey || '');
        setBaseURL(p.baseURL || '');
      }
    } catch (err) {
      setError('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const loadModels = async () => {
    setModelsLoading(true);
    try {
      // 尝试从 API 获取模型列表
      const result = await window.electron.modelsListMarketplace({ vendor: adapter });
      if (result.success && result.data?.list) {
        const modelList: ModelOption[] = result.data.list.map((item: any) => ({
          id: item.id,
          name: item.name,
          model: item.model,
          adapter: item.adapter,
          vendor: item.vendor
        }));
        setModels(modelList);
      } else {
        // API 不可用，使用硬编码的备选列表
        const fallbackModels = FALLBACK_MODELS[adapter] || [];
        setModels(fallbackModels.map((modelName, index) => ({
          id: index,
          name: modelName,
          model: modelName,
          adapter: adapter
        })));
      }
    } catch (err) {
      console.error('加载模型列表失败:', err);
      // 出错时使用硬编码的备选列表
      const fallbackModels = FALLBACK_MODELS[adapter] || [];
      setModels(fallbackModels.map((modelName, index) => ({
        id: index,
        name: modelName,
        model: modelName,
        adapter: adapter
      })));
    } finally {
      setModelsLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);

    try {
      const data: any = { adapter, model };
      if (apiKey && !apiKey.startsWith('***')) {
        data.apiKey = apiKey;
      }
      if (baseURL) {
        data.baseURL = baseURL;
      }

      const result = await window.electron.settingsUpdateConfig(data);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError(result.error || '保存失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const availableModels = models.map(m => m.model);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-bg-tertiary bg-bg-secondary">
        <h2 className="text-lg font-semibold">设置</h2>
        <button
          onClick={onClose}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
        >
          <X size={20} className="text-text-secondary" />
        </button>
      </div>

      {/* 标签页导航 */}
      <div className="flex border-b border-bg-tertiary bg-bg-secondary px-4">
        <button
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors ${
            activeTab === 'general'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          <Settings size={14} />
          通用
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* 通用设置 */}
        {activeTab === 'general' && (
        loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={24} className="animate-spin text-primary" />
            <span className="ml-2 text-text-secondary">加载配置中...</span>
          </div>
        ) : (
          <div className="max-w-lg space-y-6">
            {/* Provider */}
            <div>
              <label className="block text-sm font-semibold mb-2">Provider</label>
              <select
                value={adapter}
                onChange={(e) => {
                  setAdapter(e.target.value);
                  const models = MODELS[e.target.value];
                  if (models && models.length > 0) {
                    setModel(models[0]);
                  }
                }}
                className="w-full bg-bg-secondary border border-bg-tertiary rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              >
                {ADAPTERS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-semibold mb-2">模型</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-bg-secondary border border-bg-tertiary rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                {!availableModels.includes(model) && model && (
                  <option value={model}>{model} (当前)</option>
                )}
              </select>
              <p className="text-xs text-text-secondary mt-1">
                也可以直接输入自定义模型名称
              </p>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="或输入自定义模型..."
                className="w-full mt-1 bg-bg-secondary border border-bg-tertiary rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-semibold mb-2">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={adapter === 'ollama' ? '本地模型无需 API Key' : '输入 API Key...'}
                  className="w-full bg-bg-secondary border border-bg-tertiary rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-bg-tertiary rounded"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                {apiKey.startsWith('***') ? '已配置（显示为脱敏值）' : '配置后保存生效'}
              </p>
            </div>

            {/* Base URL */}
            <div>
              <label className="block text-sm font-semibold mb-2">
                Base URL <span className="font-normal text-text-secondary">(可选)</span>
              </label>
              <input
                type="text"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://api.anthropic.com"
                className="w-full bg-bg-secondary border border-bg-tertiary rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              <p className="text-xs text-text-secondary mt-1">
                自定义 API 端点（代理、自部署等场景）
              </p>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-sm text-error">
                {error}
              </div>
            )}

            {/* 保存按钮 */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : saved ? (
                <Check size={16} />
              ) : (
                <Save size={16} />
              )}
              <span>{saving ? '保存中...' : saved ? '已保存' : '保存配置'}</span>
            </button>
          </div>
        )
        )}
      </div>
    </div>
  );
}
