// ============================================================
// PromptManager - Prompt 管理面板
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw, Info, AlertCircle } from 'lucide-react';

interface PromptManagerProps {
  onClose: () => void;
}

type TabType = 'scene-match' | 'load-matrix' | 'components' | 'l3-config';

interface SceneMatchRule {
  scene: 'coding' | 'life';
  keywords: string;
  description: string;
}

interface LoadMatrixConfig {
  simple: string[];
  standard: string[];
  complex: string[];
}

interface PromptComponentConfig {
  content: string;
  requiredTools?: string[];
}

interface ComponentInfo {
  id: string;
  name: string;
  layer: string;
  editable: boolean;
  estimatedTokens: number | string;
  description: string;
}

interface L3Config {
  enabled: boolean;
  maxFiles: number;
  maxSymbols: number;
  directories: string[];
}

export default function PromptManager({ onClose }: PromptManagerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('scene-match');
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  // Scene Match Rules
  const [sceneRules, setSceneRules] = useState<SceneMatchRule[]>([
    {
      scene: 'coding',
      keywords: '代码|编程|函数|类|接口|模块|组件|重构|bug|修复|测试|部署|构建|编译|调试|code|program|function|class|interface|module|component|refactor|fix|test|deploy|build|compile|debug|npm|git|api|typescript|python|java',
      description: '编程领域专家 — 文件操作、代码搜索、大文件处理、多代理协作',
    },
    {
      scene: 'life',
      keywords: '约会|餐厅|推荐|生日|礼物|提醒|日程|天气|旅行|电影|音乐|购物|健康|运动|食谱|date|restaurant|birthday|gift|remind|schedule|weather|travel|movie|music|shopping|health|recipe',
      description: '生活秘书 — 记忆驱动的约会规划、餐厅推荐、日程管理、礼物建议',
    },
  ]);

  // Load Matrix
  const [loadMatrix, setLoadMatrix] = useState<LoadMatrixConfig>({
    simple: ['L0'],
    standard: ['L0', 'L1'],
    complex: ['L0', 'L1', 'L2'],
  });

  // Prompt Components
  const [components, setComponents] = useState<Record<string, PromptComponentConfig>>({});
  const [selectedComponentId, setSelectedComponentId] = useState<string>('l0-identity');
  const [allTools, setAllTools] = useState<string[]>([]);

  const componentList: ComponentInfo[] = [
    { id: 'l0-identity', name: 'Core Identity', layer: 'L0', editable: true, estimatedTokens: 400, description: '璇玑核心人设' },
    { id: 'l0-safety', name: 'Security Baseline', layer: 'L0', editable: true, estimatedTokens: 200, description: '安全底线' },
    { id: 'l1-coding', name: 'Coding Guide', layer: 'L1', editable: true, estimatedTokens: 800, description: '编程场景指南' },
    { id: 'l1-life', name: 'Life Secretary Guide', layer: 'L1', editable: true, estimatedTokens: 700, description: '生活秘书指南' },
    { id: 'l2-planning', name: 'Planning & Confirmation', layer: 'L2', editable: true, estimatedTokens: 400, description: '计划与确认' },
    { id: 'l2-agent-rules', name: 'Agent Behavior Rules', layer: 'L2', editable: true, estimatedTokens: 300, description: 'Agent 行为规则' },
    { id: 'l2-safety', name: 'Extended Security Rules', layer: 'L2', editable: true, estimatedTokens: 200, description: '完整安全规则' },
    { id: 'l3-project', name: 'Project Context', layer: 'L3', editable: false, estimatedTokens: '动态', description: '项目上下文（动态生成）' },
  ];

  // L3 Config
  const [l3Config, setL3Config] = useState<L3Config>({
    enabled: true,
    maxFiles: 100,
    maxSymbols: 20,
    directories: ['src'],
  });

  // 加载配置
  useEffect(() => {
    loadConfig();
    loadTools();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const result = await window.electron.promptGetConfig();
      if (result.success && result.config) {
        setSceneRules(result.config.sceneRules || sceneRules);
        setLoadMatrix(result.config.loadMatrix || loadMatrix);
        setL3Config(result.config.l3Config || l3Config);
        setComponents(result.config.components || {});
      }
    } catch (err) {
      console.error('Failed to load prompt config:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTools = async () => {
    try {
      const result = await window.electron.toolsList();
      if (result.success && result.tools) {
        setAllTools(result.tools.map((t) => t.name));
      }
    } catch (err) {
      console.error('Failed to load tools:', err);
    }
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      const result = await window.electron.promptSaveConfig({
        sceneRules,
        loadMatrix,
        l3Config,
        components,
      });
      if (result.success) {
        setSaveStatus('success');
      } else {
        setSaveStatus('error');
      }
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to save prompt config:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  const handleReset = async () => {
    if (!confirm('确定要重置为默认配置吗？')) return;
    await loadConfig();
  };

  return (
    <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-bg-tertiary">
        <div>
          <h2 className="text-xl font-semibold">System Prompt</h2>
          <p className="text-sm text-text-secondary mt-1">配置场景匹配规则、加载矩阵、Prompt 组件和 L3 上下文</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded hover:bg-bg-tertiary transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className="inline mr-1" />
            重置
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saveStatus === 'saving'}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saveStatus === 'saving' ? (
              <>
                <RefreshCw size={14} className="inline mr-1 animate-spin" />
                保存中...
              </>
            ) : saveStatus === 'success' ? (
              '✓ 已保存'
            ) : saveStatus === 'error' ? (
              '✗ 保存失败'
            ) : (
              <>
                <Save size={14} className="inline mr-1" />
                保存
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-tertiary rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex border-b border-bg-tertiary px-6">
        <button
          onClick={() => setActiveTab('scene-match')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'scene-match'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          场景匹配规则
        </button>
        <button
          onClick={() => setActiveTab('load-matrix')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'load-matrix'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          加载矩阵
        </button>
        <button
          onClick={() => setActiveTab('components')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'components'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Prompt 组件
        </button>
        <button
          onClick={() => setActiveTab('l3-config')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'l3-config'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          L3 配置
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'scene-match' && (
          <SceneMatchTab rules={sceneRules} onChange={setSceneRules} />
        )}
        {activeTab === 'load-matrix' && (
          <LoadMatrixTab config={loadMatrix} onChange={setLoadMatrix} />
        )}
        {activeTab === 'components' && (
          <ComponentsTab
            components={components}
            componentList={componentList}
            selectedId={selectedComponentId}
            allTools={allTools}
            onSelectComponent={setSelectedComponentId}
            onChange={setComponents}
          />
        )}
        {activeTab === 'l3-config' && (
          <L3ConfigTab config={l3Config} onChange={setL3Config} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Tab 1: 场景匹配规则
// ============================================================

interface SceneMatchTabProps {
  rules: SceneMatchRule[];
  onChange: (rules: SceneMatchRule[]) => void;
}

function SceneMatchTab({ rules, onChange }: SceneMatchTabProps) {
  const handleUpdate = (index: number, field: keyof SceneMatchRule, value: string) => {
    const newRules = [...rules];
    newRules[index] = { ...newRules[index], [field]: value };
    onChange(newRules);
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-start gap-3">
        <Info size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-blue-500 mb-1">场景匹配流程</p>
          <p className="text-text-secondary">
            1. 规则匹配（关键词正则，&lt;1ms）→ 2. Embedding 匹配（语义相似度，降级）→ 3. 默认 coding
          </p>
        </div>
      </div>

      {rules.map((rule, index) => (
        <div key={rule.scene} className="bg-bg-secondary rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium capitalize">{rule.scene} 场景</h3>
            <span className="text-xs text-text-secondary">L1 组件</span>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">关键词正则（用 | 分隔）</label>
            <textarea
              value={rule.keywords}
              onChange={(e) => handleUpdate(index, 'keywords', e.target.value)}
              className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary transition-colors"
              rows={3}
            />
            <p className="text-xs text-text-secondary mt-1">
              示例：代码|编程|函数|code|function
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">场景描述（用于 Embedding 匹配）</label>
            <input
              type="text"
              value={rule.description}
              onChange={(e) => handleUpdate(index, 'description', e.target.value)}
              className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Tab 2: 加载矩阵
// ============================================================

interface LoadMatrixTabProps {
  config: LoadMatrixConfig;
  onChange: (config: LoadMatrixConfig) => void;
}

function LoadMatrixTab({ config, onChange }: LoadMatrixTabProps) {
  const layerInfo = {
    L0: { name: '核心层', tokens: '~600', desc: '身份 + 安全底线' },
    L1: { name: '能力层', tokens: '~800', desc: '按场景选一个（coding/life）' },
    L2: { name: '行为层', tokens: '~900', desc: 'Planning + 循环控制 + 完整安全规则' },
    L3: { name: '上下文层', tokens: '动态', desc: '项目上下文（始终加载）' },
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-start gap-3">
        <Info size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-blue-500 mb-1">加载策略</p>
          <p className="text-text-secondary">
            根据意图复杂度选择性加载组件，L3 始终加载。复杂度判断：消息长度 + 关键词（&lt;1ms）
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {(['simple', 'standard', 'complex'] as const).map((complexity) => (
          <div key={complexity} className="bg-bg-secondary rounded-lg p-4">
            <h3 className="text-lg font-medium capitalize mb-4">{complexity}</h3>
            <div className="space-y-2">
              {(['L0', 'L1', 'L2', 'L3'] as const).map((layer) => {
                const isEnabled = config[complexity].includes(layer);
                const info = layerInfo[layer];
                return (
                  <label
                    key={layer}
                    className={`flex items-start gap-2 p-2 rounded cursor-pointer transition-colors ${
                      isEnabled ? 'bg-primary/10' : 'hover:bg-bg-tertiary'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      disabled={layer === 'L3'} // L3 始终加载
                      onChange={(e) => {
                        const newLayers = e.target.checked
                          ? [...config[complexity], layer]
                          : config[complexity].filter((l) => l !== layer);
                        onChange({ ...config, [complexity]: newLayers });
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{layer}</span>
                        <span className="text-xs text-text-secondary">{info.tokens}</span>
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5">{info.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-bg-tertiary text-sm text-text-secondary">
              预估 tokens: ~
              {config[complexity].reduce((sum, layer) => {
                const tokens = layerInfo[layer as keyof typeof layerInfo].tokens;
                return sum + (tokens === '动态' ? 0 : parseInt(tokens.replace(/[~,]/g, '')));
              }, 0)}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-yellow-500 mb-1">注意</p>
          <p className="text-text-secondary">
            L3 始终加载（项目上下文），不可禁用。修改加载矩阵后需重启会话生效。
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 3: Prompt 组件编辑
// ============================================================

interface ComponentsTabProps {
  components: Record<string, PromptComponentConfig>;
  componentList: ComponentInfo[];
  selectedId: string;
  allTools: string[];
  onSelectComponent: (id: string) => void;
  onChange: (components: Record<string, PromptComponentConfig>) => void;
}

function ComponentsTab({ components, componentList, selectedId, allTools, onSelectComponent, onChange }: ComponentsTabProps) {
  const selected = componentList.find((c) => c.id === selectedId);
  const componentData = components[selectedId];

  const handleContentChange = (content: string) => {
    onChange({
      ...components,
      [selectedId]: { ...componentData, content },
    });
  };

  const handleToolToggle = (tool: string) => {
    const current = componentData?.requiredTools || [];
    const updated = current.includes(tool)
      ? current.filter((t) => t !== tool)
      : [...current, tool];
    onChange({
      ...components,
      [selectedId]: { ...componentData, requiredTools: updated },
    });
  };

  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* 左侧组件列表 */}
      <div className="w-56 flex-shrink-0 space-y-1">
        {componentList.map((comp) => (
          <button
            key={comp.id}
            onClick={() => onSelectComponent(comp.id)}
            className={`w-full text-left px-3 py-2.5 rounded transition-colors ${
              selectedId === comp.id
                ? 'bg-primary/15 border border-primary/30'
                : 'hover:bg-bg-tertiary border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary">
                {comp.layer}
              </span>
              <span className="text-sm font-medium truncate">{comp.name}</span>
            </div>
            <p className="text-xs text-text-secondary mt-1 truncate">{comp.description}</p>
          </button>
        ))}
      </div>

      {/* 右侧编辑区 */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selected && (
          <div className="space-y-4">
            {/* 组件信息头 */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">{selected.name}</h3>
                <p className="text-sm text-text-secondary">{selected.description}</p>
              </div>
              <div className="flex items-center gap-3 text-sm text-text-secondary">
                <span>~{typeof selected.estimatedTokens === 'number' ? selected.estimatedTokens : selected.estimatedTokens} tokens</span>
                {componentData?.content && (
                  <span className="text-xs">实际: ~{estimateTokens(componentData.content)} tokens</span>
                )}
              </div>
            </div>

            {!selected.editable ? (
              /* L3 不可编辑 */
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-500 mb-1">动态生成，不可编辑</p>
                  <p className="text-text-secondary">
                    L3 组件根据项目上下文动态生成，包括 XUANJI.md、规则文件、文件索引等。可在 "L3 配置" tab 中调整参数。
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Prompt 内容编辑器 */}
                <div>
                  <label className="block text-sm font-medium mb-2">Prompt 内容（Markdown）</label>
                  <textarea
                    value={componentData?.content || ''}
                    onChange={(e) => handleContentChange(e.target.value)}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary transition-colors resize-y"
                    rows={16}
                    placeholder="输入 prompt 内容..."
                  />
                </div>

                {/* L1 组件显示 requiredTools */}
                {selected.layer === 'L1' && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      关联工具（requiredTools）
                      <span className="text-text-secondary font-normal ml-2">— 该场景激活时加载的工具</span>
                    </label>
                    <div className="bg-bg-secondary rounded-lg p-3">
                      <div className="flex flex-wrap gap-2">
                        {allTools.map((tool) => {
                          const isSelected = componentData?.requiredTools?.includes(tool) ?? false;
                          return (
                            <button
                              key={tool}
                              onClick={() => handleToolToggle(tool)}
                              className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                                isSelected
                                  ? 'bg-primary/20 text-primary border border-primary/30'
                                  : 'bg-bg-primary text-text-secondary border border-bg-tertiary hover:border-primary/30'
                              }`}
                            >
                              {tool}
                            </button>
                          );
                        })}
                      </div>
                      {allTools.length === 0 && (
                        <p className="text-xs text-text-secondary">加载工具列表中...</p>
                      )}
                    </div>
                  </div>
                )}

                {/* 重置按钮 */}
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      if (!confirm(`确定要将 ${selected.name} 重置为默认内容吗？`)) return;
                      const updated = { ...components };
                      delete updated[selectedId];
                      onChange(updated);
                    }}
                    className="px-3 py-1.5 text-sm text-yellow-500 hover:bg-yellow-500/10 rounded transition-colors"
                  >
                    <RefreshCw size={14} className="inline mr-1" />
                    重置为默认
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Tab 4: L3 配置
// ============================================================

interface L3ConfigTabProps {
  config: L3Config;
  onChange: (config: L3Config) => void;
}

function L3ConfigTab({ config, onChange }: L3ConfigTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-start gap-3">
        <Info size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-blue-500 mb-1">L3 组件职责</p>
          <p className="text-text-secondary">
            加载项目上下文：元数据、规则文件（XUANJI.md、.xuanji/rules.md）、文件索引、依赖分析。
          </p>
        </div>
      </div>

      <div className="bg-bg-secondary rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">启用 L3 组件</label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
            className="w-4 h-4"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">最大文件索引数</label>
          <input
            type="number"
            value={config.maxFiles}
            onChange={(e) => onChange({ ...config, maxFiles: parseInt(e.target.value) })}
            disabled={!config.enabled}
            className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
          />
          <p className="text-xs text-text-secondary mt-1">
            FileIndexer 最多索引的文件数（默认 100）
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">最大符号数</label>
          <input
            type="number"
            value={config.maxSymbols}
            onChange={(e) => onChange({ ...config, maxSymbols: parseInt(e.target.value) })}
            disabled={!config.enabled}
            className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
          />
          <p className="text-xs text-text-secondary mt-1">
            显示在 prompt 中的 Top N 文件（默认 20）
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">索引目录（逗号分隔）</label>
          <input
            type="text"
            value={config.directories.join(', ')}
            onChange={(e) =>
              onChange({
                ...config,
                directories: e.target.value.split(',').map((d) => d.trim()),
              })
            }
            disabled={!config.enabled}
            className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
          />
          <p className="text-xs text-text-secondary mt-1">
            默认：src（可添加多个目录，如 src, lib, packages）
          </p>
        </div>
      </div>

      <div className="bg-bg-secondary rounded-lg p-4">
        <h3 className="text-lg font-medium mb-3">规则文件加载顺序</h3>
        <ol className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <span className="text-primary font-medium">1.</span>
            <div>
              <code className="bg-bg-primary px-1 rounded">XUANJI.md</code>
              <span className="text-text-secondary ml-2">— 项目根目录</span>
            </div>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary font-medium">2.</span>
            <div>
              <code className="bg-bg-primary px-1 rounded">.xuanji/rules.md</code>
              <span className="text-text-secondary ml-2">— 项目级规则</span>
            </div>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary font-medium">3.</span>
            <div>
              <code className="bg-bg-primary px-1 rounded">~/.xuanji/rules.md</code>
              <span className="text-text-secondary ml-2">— 全局规则</span>
            </div>
          </li>
        </ol>
        <p className="text-xs text-text-secondary mt-3">
          文件不存在时自动跳过，最大 500KB（超出截断）
        </p>
      </div>
    </div>
  );
}
