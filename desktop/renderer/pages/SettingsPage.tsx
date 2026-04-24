// ============================================================
// SettingsPage - 设置页面
// ============================================================

import { useState, useEffect } from 'react';
import { Settings, X, Save, Sparkles, Database } from 'lucide-react';

interface SettingsPageProps {
  onClose: () => void;
}

type TabType = 'embedding' | 'general';

interface EmbeddingConfig {
  model: string;
  dimensions: number;
  cacheEnabled: boolean;
  cacheMaxSize: number;
  hfMirror?: string;
}

// ============================================================
// Tab: Embedding 配置
// ============================================================
function EmbeddingTab() {
  const [config, setConfig] = useState<EmbeddingConfig>({
    model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    dimensions: 384,
    cacheEnabled: true,
    cacheMaxSize: 100,
    hfMirror: 'https://hf-mirror.com',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const result = await window.electron.settingsGetConfig();
      if (result.success && result.config?.embedding) {
        setConfig(result.config.embedding);
      }
    } catch (err) {
      console.error('加载 Embedding 配置失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await window.electron.settingsUpdateConfig({
        embedding: config,
      });
      if (result.success) {
        setMessage({ type: 'success', text: '保存成功' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: result.error || '保存失败' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-text-secondary">加载中...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* 消息提示 */}
      {message && (
        <div className={`p-3 rounded ${message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {message.text}
        </div>
      )}

      {/* 模型配置 */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-text-primary">
          Embedding 模型
        </label>
        <input
          type="text"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          className="w-full px-3 py-2 bg-bg-tertiary border border-bg-tertiary rounded text-text-primary focus:outline-none focus:border-primary"
          placeholder="Xenova/paraphrase-multilingual-MiniLM-L12-v2"
        />
        <p className="text-xs text-text-secondary">
          使用 @xenova/transformers 的本地模型，例如 Xenova/paraphrase-multilingual-MiniLM-L12-v2
        </p>
      </div>

      {/* 向量维度 */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-text-primary">
          向量维度
        </label>
        <input
          type="number"
          value={config.dimensions}
          onChange={(e) => setConfig({ ...config, dimensions: parseInt(e.target.value, 10) || 384 })}
          className="w-full px-3 py-2 bg-bg-tertiary border border-bg-tertiary rounded text-text-primary focus:outline-none focus:border-primary"
          min="1"
        />
        <p className="text-xs text-text-secondary">
          Embedding 向量的维度，需要与模型匹配
        </p>
      </div>

      {/* HuggingFace 镜像 */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-text-primary">
          HuggingFace 镜像地址
        </label>
        <input
          type="text"
          value={config.hfMirror || ''}
          onChange={(e) => setConfig({ ...config, hfMirror: e.target.value })}
          className="w-full px-3 py-2 bg-bg-tertiary border border-bg-tertiary rounded text-text-primary focus:outline-none focus:border-primary"
          placeholder="https://hf-mirror.com"
        />
        <p className="text-xs text-text-secondary">
          国内用户可使用镜像加速模型下载，留空则使用默认地址
        </p>
      </div>

      {/* 缓存最大条数 */}
      {config.cacheEnabled && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-text-primary">
            缓存最大条数
          </label>
          <input
            type="number"
            value={config.cacheMaxSize}
            onChange={(e) => setConfig({ ...config, cacheMaxSize: parseInt(e.target.value, 10) || 100 })}
            className="w-full px-3 py-2 bg-bg-tertiary border border-bg-tertiary rounded text-text-primary focus:outline-none focus:border-primary"
            min="1"
          />
          <p className="text-xs text-text-secondary">
            超过该数量时会自动删除最早的缓存条目
          </p>
        </div>
      )}

      {/* 保存按钮 */}
      <div className="pt-4 border-t border-bg-tertiary">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Save size={16} />
          <span>{saving ? '保存中...' : '保存配置'}</span>
        </button>
      </div>
    </div>
  );
}

function GeneralTab() {
  return (
    <div className="p-6">
      <div className="text-text-secondary">通用设置开发中...</div>
    </div>
  );
}

export default function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('embedding');

  return (
    <div className="h-full flex flex-col bg-bg-primary text-text-primary">
      {/* 顶部栏 */}
      <div className="h-12 border-b border-bg-tertiary flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Settings size={18} />
          <h1 className="text-base font-semibold">设置</h1>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>

      {/* 主体区域：左侧分类 + 右侧内容 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧分类标签 */}
        <aside className="w-48 border-r border-bg-tertiary bg-bg-secondary p-3 space-y-2">
          <button
            onClick={() => setActiveTab('general')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              activeTab === 'general'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }`}
          >
            <Sparkles size={16} />
            <span>通用配置</span>
          </button>

          <button
            onClick={() => setActiveTab('embedding')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              activeTab === 'embedding'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }`}
          >
            <Database size={16} />
            <span>向量配置</span>
          </button>
        </aside>

        {/* 右侧内容区域 */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'embedding' && <EmbeddingTab />}
          {activeTab === 'general' && <GeneralTab />}
        </div>
      </div>
    </div>
  );
}

