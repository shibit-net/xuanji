// ============================================================
// AgentEditor - Agent 编辑器组件（完整版）
// ============================================================

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Save, X, FileCode, Settings, Zap, Database, ChevronDown, ChevronRight, Plus, Trash2, AlertCircle, Loader2, Search, Download } from 'lucide-react';
import { useToast } from './Toast';
import CodeEditor from './CodeEditor';
import MilkdownEditor from './MilkdownEditor';

interface AgentEditorProps {
  agent: any | null;
  builtinAgents: any[];
  onSave: (config: any) => void;
  onCancel: () => void;
}

type EditorMode = 'form' | 'json5';
type ExpandedSections = Set<string>;

interface ModelOption {
  id: number;
  name: string;
  model: string;
  adapter: string;
  vendor?: string;
  inputPrice?: number;  // 输入价格（每百万 token）
  outputPrice?: number; // 输出价格（每百万 token）
  priceUnit?: string;   // 价格单位
}

// 默认配置（创建新 Agent 时使用）
const DEFAULT_CONFIG = {
  id: '',
  name: '',
  description: '',
  avatar: '🤖',
  color: 'from-blue-500 to-purple-600',
  enabled: true,
  capabilities: [],
  skills: [],

  systemPrompt: '',

  model: {
    primary: 'claude-sonnet-4-6',
    maxTokens: 8000,
    temperature: 0.7,
    thinking: {
      type: 'adaptive',
      effort: 'medium',
    },
  },

  provider: {
    adapter: 'anthropic',
  },

  tools: [
    { name: 'read_file', enabled: true },
    { name: 'write_file', enabled: true },
    { name: 'edit_file', enabled: true },
    { name: 'bash', enabled: true },
    { name: 'glob', enabled: true },
    { name: 'grep', enabled: true },
  ],

  execution: {
    mode: 'react',
    maxIterations: 20,
    timeout: 300000,
    streaming: true,
    parallelTools: true,
  },

  permissions: {
    fileRead: 'always',
    fileWrite: 'ask',
    bashExec: 'ask',
    network: 'ask',
  },

  metadata: {
    category: 'custom',
  },
};

export default function AgentEditor({ agent, builtinAgents, onSave, onCancel }: AgentEditorProps) {
  const toast = useToast();
  const [mode, setMode] = useState<EditorMode>('form');
  const [config, setConfig] = useState(agent || DEFAULT_CONFIG);
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>(
    new Set(['basic', 'systemPrompt'])
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  // 模型列表状态
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // 模型搜索状态
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 防抖搜索函数
  const debouncedSearchModels = useCallback((searchQuery: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      const currentAdapter = config.provider?.adapter || 'anthropic';
      loadModels(currentAdapter, searchQuery.trim() || undefined);
    }, 300); // 300ms 防抖
  }, [config.provider?.adapter]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // 动态加载的 Tools 列表
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolSearchQuery, setToolSearchQuery] = useState('');

  const isCreating = !agent;

  // 本地模型状态管理
  const [localModelStatuses, setLocalModelStatuses] = useState<Record<string, { installed: boolean; downloading: boolean; progress: number }>>({});
  const [scannedModels, setScannedModels] = useState<Array<{ filename: string; path: string; size: number; modifiedAt: string }>>([]);

  // 扫描本地模型目录
  useEffect(() => {
    if (config.provider?.adapter === 'local-llama') {
      const scanModels = async () => {
        try {
          const result = await window.electron.localModelList();
          if (result.success && result.models) {
            // 过滤掉预置模型对应的文件名
            const presetFilenames = [
              'qwen2.5-0.5b-instruct-q4_k_m.gguf',
              'qwen2.5-1.5b-instruct-q4_k_m.gguf',
              'chatglm3-6b.Q4_K_M.gguf',
              'chatglm3-6b.Q3_K_M.gguf',
              'glm-4-9b-chat.Q4_K_M.gguf',
            ];
            const filtered = result.models.filter(
              (item) => !presetFilenames.includes(item.filename)
            );
            setScannedModels(filtered);
          }
        } catch (err) {
          console.error('Failed to scan local models:', err);
        }
      };
      scanModels();
    }
  }, [config.provider?.adapter]);

  // 检查本地模型状态
  useEffect(() => {
    if (config.provider?.adapter === 'local-llama') {
      const checkModels = async () => {
        const modelIds = ['qwen2.5-0.5b-q4', 'qwen2.5-1.5b-q4', 'chatglm3-6b-q4', 'chatglm3-6b-q3', 'glm4-9b-q4'];
        for (const modelId of modelIds) {
          try {
            const result = await window.electron.localModelCheck(modelId);
            if (result.success) {
              setLocalModelStatuses(prev => ({
                ...prev,
                [modelId]: { installed: result.installed || false, downloading: false, progress: 0 },
              }));
            }
          } catch (err) {
            console.error(`Failed to check model ${modelId}:`, err);
          }
        }
      };
      checkModels();
    }
  }, [config.provider?.adapter]);

  // 下载本地模型
  const downloadLocalModel = async (modelId: string) => {
    try {
      const result = await window.electron.localModelDownload(modelId);
      if (result.success) {
        setLocalModelStatuses(prev => ({
          ...prev,
          [modelId]: { ...prev[modelId], downloading: true, progress: 0 },
        }));
        toast.success(`开始下载 ${modelId}`);
      } else {
        toast.error(result.error || '下载失败');
      }
    } catch (err: any) {
      toast.error(err.message || '下载失败');
    }
  };

  const deleteLocalModel = async (filename: string) => {
    try {
      const result = await window.electron.localModelDelete(filename);
      if (result.success) {
        setScannedModels(prev => prev.filter((item) => item.filename !== filename));

        // 如果是预置模型，更新状态
        const presetMap: Record<string, string> = {
          'qwen2.5-0.5b-instruct-q4_k_m.gguf': 'qwen2.5-0.5b-q4',
          'qwen2.5-1.5b-instruct-q4_k_m.gguf': 'qwen2.5-1.5b-q4',
          'chatglm3-6b.Q4_K_M.gguf': 'chatglm3-6b-q4',
          'chatglm3-6b.Q3_K_M.gguf': 'chatglm3-6b-q3',
          'glm-4-9b-chat.Q4_K_M.gguf': 'glm4-9b-q4',
        };
        const presetId = presetMap[filename];
        if (presetId) {
          setLocalModelStatuses(prev => ({
            ...prev,
            [presetId]: { installed: false, downloading: false, progress: 0 },
          }));
        }

        toast.success(`已删除 ${filename}`);
      } else {
        toast.error(result.error || '删除失败');
      }
    } catch (err: any) {
      toast.error(err.message || '删除失败');
    }
  };

  // 加载模型列表
  useEffect(() => {
    loadModels();
    loadTools();
  }, []);

  // 加载模型列表（根据 adapter 和搜索关键词动态加载）
  const loadModels = async (adapter?: string, searchName?: string) => {
    const currentAdapter = adapter || config.provider?.adapter || 'anthropic';

    // 本地模型不需要加载列表
    if (currentAdapter === 'local-llama') {
      setModels([]);
      return;
    }

    setModelsLoading(true);
    try {
      // 从 starship 获取模型列表，使用 vendor 和 name 参数
      const result = await window.electron.modelsListMarketplace({
        size: 200,
        vendor: currentAdapter,
        name: searchName || undefined,
      });


      if (result.success && result.data?.list) {

        const modelList: ModelOption[] = result.data.list.map((item: any) => ({
          id: item.id,
          name: item.name,
          model: item.model,
          adapter: item.adapter || item.vendor,
          vendor: item.vendor,
          inputPrice: item.unitPriceReminder || item.inputPrice || item.input_price || item.priceInput,
          outputPrice: item.unitPriceComplete || item.outputPrice || item.output_price || item.priceOutput,
          priceUnit: item.priceUnit || item.price_unit || '¥/M tokens',
        }));

        setModels(modelList);
      } else {
        setModels([]);
      }
    } catch (err) {
      console.error('加载模型列表失败:', err);
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  // 加载 Tools 列表
  const loadTools = async () => {
    setToolsLoading(true);
    try {
      const result = await window.electron.toolsList();
      if (result.success && result.tools) {
        setAvailableTools(result.tools);
      }
    } catch (err) {
      console.error('加载 Tools 列表失败:', err);
    } finally {
      setToolsLoading(false);
    }
  };

  // 应用模板
  const applyTemplate = (templateId: string) => {
    if (!templateId) {
      setConfig(DEFAULT_CONFIG);
      return;
    }

    const template = builtinAgents.find((a) => a.id === templateId);
    if (!template) return;

    // 复制模板配置，移除 metadata，生成新的 id 和 name
    const { metadata, id, name, ...templateConfig } = template;
    setConfig({
      ...DEFAULT_CONFIG,
      ...templateConfig,
      id: '',  // 用户需要填写新的 ID
      name: `${name}（副本）`,
    });

    // 展开所有配置区块，方便用户查看
    setExpandedSections(new Set([
      'basic',
      'systemPrompt',
      'model',
      'tools',
      'execution',
    ]));

    setErrors({});
    toast.info(`已应用模板：${name}`);
  };

  // 切换折叠状态
  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  // JSON5 预览
  const json5Preview = useMemo(() => {
    try {
      // 移除 metadata 字段
      const { metadata, ...configToSave } = config;
      return JSON.stringify(configToSave, null, 2);
    } catch (err) {
      return '// 配置格式错误';
    }
  }, [config]);

  // 验证配置
  const validateConfig = async (): Promise<Record<string, string>> => {
    const newErrors: Record<string, string> = {};

    // ID 验证
    if (!config.id) {
      newErrors.id = 'ID 不能为空';
    } else if (!/^[a-z0-9-]+$/.test(config.id)) {
      newErrors.id = 'ID 只能包含小写字母、数字和连字符';
    }

    // 名称验证
    if (!config.name) {
      newErrors.name = '名称不能为空';
    }

    // 描述验证
    if (!config.description) {
      newErrors.description = '描述不能为空';
    }

    // 系统提示词验证
    if (!config.systemPrompt || config.systemPrompt.trim().length < 10) {
      newErrors.systemPrompt = '系统提示词至少需要 10 个字符';
    }

    // 本地模型验证
    if (config.provider?.adapter === 'local-llama' && config.model?.primary) {
      const modelPrimary = config.model.primary;
      const isLocalFileModel = modelPrimary.endsWith('.gguf');
      if (!isLocalFileModel) {
        try {
          const result = await window.electron.localModelCheck(modelPrimary);
          if (result.success && !result.installed) {
            newErrors.model = `本地模型 ${modelPrimary} 尚未下载，请先下载后再保存`;
          }
        } catch (err) {
          console.error('Failed to check local model:', err);
        }
      }
    }

    return newErrors;
  };

  // 保存处理
  const handleSave = async () => {
    const newErrors = await validateConfig();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);

      const firstError = Object.entries(newErrors)[0];
      const sectionMap: Record<string, string> = {
        id: 'basic',
        name: 'basic',
        description: 'basic',
        systemPrompt: 'systemPrompt',
        model: 'model',
      };

      if (firstError) {
        const section = sectionMap[firstError[0]];
        if (section) {
          setExpandedSections((prev) => new Set([...prev, section]));
        }
        toast.error(`${firstError[1]}`);
      } else {
        toast.error('配置验证失败，请检查表单');
      }
      return;
    }

    onSave(config);
  };

  // 工具选择辅助函数
  const isToolSelected = (toolName: string) => {
    return (config.tools || []).some((t: any) => t.name === toolName && t.enabled !== false);
  };

  const toggleTool = (toolName: string) => {
    const tools = config.tools || [];
    const existingIndex = tools.findIndex((t: any) => t.name === toolName);

    if (existingIndex >= 0) {
      // 工具已存在，切换启用状态或移除
      const newTools = [...tools];
      if (newTools[existingIndex].enabled !== false) {
        newTools.splice(existingIndex, 1); // 移除
      } else {
        newTools[existingIndex].enabled = true; // 启用
      }
      setConfig({ ...config, tools: newTools });
    } else {
      // 添加新工具
      setConfig({
        ...config,
        tools: [...tools, { name: toolName, enabled: true }],
      });
    }
  };

  const selectAllTools = () => {
    const allTools = availableTools.map(t => ({ name: t.name, enabled: true }));
    setConfig({ ...config, tools: allTools });
  };

  const deselectAllTools = () => {
    setConfig({ ...config, tools: [] });
  };

  // 过滤和分组工具
  const filteredTools = useMemo(() => {
    const query = toolSearchQuery.toLowerCase();
    return availableTools.filter(tool =>
      tool.name.toLowerCase().includes(query) ||
      tool.description?.toLowerCase().includes(query) ||
      tool.category?.toLowerCase().includes(query)
    );
  }, [availableTools, toolSearchQuery]);

  const groupedTools = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredTools.forEach(tool => {
      const category = tool.category || '其他';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(tool);
    });
    return groups;
  }, [filteredTools]);

  // 添加能力
  const handleAddCapability = () => {
    setConfig({
      ...config,
      capabilities: [...(config.capabilities || []), ''],
    });
  };

  // 删除能力
  const handleRemoveCapability = (index: number) => {
    const newCapabilities = [...config.capabilities];
    newCapabilities.splice(index, 1);
    setConfig({ ...config, capabilities: newCapabilities });
  };

  // 渲染表单字段
  const renderFormField = (
    label: string,
    field: string,
    type: 'text' | 'textarea' | 'number' | 'select' = 'text',
    options?: string[]
  ) => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], config);
    const error = errors[field];

    const handleChange = (newValue: any) => {
      const keys = field.split('.');
      const newConfig = { ...config };
      let current: any = newConfig;

      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = newValue;
      setConfig(newConfig);
    };

    const isModelSelect = field === 'model.primary';
    const currentOptions = isModelSelect ? models.map(m => m.model) : options;

    // 后端已经处理了搜索，直接使用 models
    const filteredModels = models;

    // 获取当前选中模型的显示名称（现在保存的就是 name，直接显示）
    const currentModelName = value;

    // 调试信息
    if (isModelSelect) {
    }

    return (
      <div>
        <label className="block text-sm font-medium mb-1">
          {label}
          {error && <span className="text-red-400 ml-2 text-xs">⚠️ {error}</span>}
        </label>
        {type === 'textarea' ? (
          field === 'systemPrompt' ? (
            <MilkdownEditor
              value={value || ''}
              onChange={handleChange}
              mode="wysiwyg"
              height="300px"
            />
          ) : (
            <textarea
              value={value || ''}
              onChange={(e) => handleChange(e.target.value)}
              rows={3}
              className={`w-full bg-bg-primary border ${error ? 'border-red-500' : 'border-bg-tertiary'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono`}
            />
          )
        ) : type === 'select' ? (
          isModelSelect ? (
            // 模型选择：支持搜索和手动输入
            <div className="relative">
              <div className="relative">
                <input
                  type="text"
                  value={showModelDropdown ? modelSearchQuery : (currentModelName || '')}
                  onChange={(e) => {
                    const query = e.target.value;
                    setModelSearchQuery(query);
                    setShowModelDropdown(true);
                    // 触发防抖搜索
                    debouncedSearchModels(query);
                  }}
                  onFocus={() => {
                    setModelSearchQuery('');
                    setShowModelDropdown(true);
                    // 聚焦时加载全部模型
                    const currentAdapter = config.provider?.adapter || 'anthropic';
                    loadModels(currentAdapter, undefined);
                  }}
                  onBlur={() => {
                    // 延迟关闭，让点击事件先触发
                    setTimeout(() => {
                      setShowModelDropdown(false);
                      setModelSearchQuery('');
                    }, 200);
                  }}
                  placeholder="搜索或输入模型名..."
                  className={`w-full bg-bg-primary border ${error ? 'border-red-500' : 'border-bg-tertiary'} rounded px-3 py-2 pr-10 text-sm focus:outline-none focus:border-primary`}
                  disabled={modelsLoading}
                />
                {modelsLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 size={16} className="animate-spin text-text-secondary" />
                  </div>
                )}
                {!modelsLoading && (
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                )}
              </div>

              {/* 下拉列表 */}
              {showModelDropdown && !modelsLoading && (
                <div className="absolute z-50 w-full mt-1 bg-bg-primary border border-bg-tertiary rounded shadow-lg max-h-60 overflow-y-auto">
                  {filteredModels.length > 0 ? (
                    filteredModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          handleChange(model.name);
                          setModelSearchQuery('');
                          setShowModelDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{model.name}</div>
                            <div className="text-xs text-text-secondary truncate">{model.model}</div>
                          </div>
                          {(model.inputPrice !== undefined || model.outputPrice !== undefined) && (
                            <div className="ml-2 text-xs text-text-tertiary whitespace-nowrap">
                              {model.inputPrice !== undefined && model.outputPrice !== undefined ? (
                                <span>
                                  ¥{model.inputPrice}/{model.outputPrice}
                                </span>
                              ) : model.inputPrice !== undefined ? (
                                <span>¥{model.inputPrice}</span>
                              ) : (
                                <span>¥{model.outputPrice}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    ))
                  ) : modelSearchQuery ? (
                    // 没有搜索结果，显示"使用输入的值"
                    <button
                      type="button"
                      onClick={() => {
                        handleChange(modelSearchQuery);
                        setModelSearchQuery('');
                        setShowModelDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                    >
                      <div className="text-primary">使用: {modelSearchQuery}</div>
                      <div className="text-xs text-text-secondary">手动输入的模型名</div>
                    </button>
                  ) : (
                    <div className="px-3 py-2 text-sm text-text-secondary">
                      暂无模型
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            // 普通 select
            <select
              value={value || ''}
              onChange={(e) => handleChange(e.target.value)}
              className={`w-full bg-bg-primary border ${error ? 'border-red-500' : 'border-bg-tertiary'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary`}
            >
              {currentOptions?.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )
        ) : (
          <input
            type={type}
            value={value || ''}
            onChange={(e) => handleChange(type === 'number' ? Number(e.target.value) : e.target.value)}
            className={`w-full bg-bg-primary border ${error ? 'border-red-500' : 'border-bg-tertiary'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary`}
          />
        )}
      </div>
    );
  };

  // 渲染折叠区块
  const renderSection = (
    id: string,
    title: string,
    icon: React.ReactNode,
    content: React.ReactNode
  ) => {
    const isExpanded = expandedSections.has(id);

    return (
      <div className="bg-bg-secondary rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(id)}
          className="w-full flex items-center gap-3 p-4 hover:bg-bg-tertiary/50 transition-colors"
        >
          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          {icon}
          <span className="font-medium flex-1 text-left">{title}</span>
        </button>
        {isExpanded && (
          <div className="px-4 pb-4 space-y-4">
            {content}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold">
            {agent ? '编辑 Agent' : '创建 Agent'}
          </h3>
          <p className="text-sm text-text-secondary mt-1">
            配置 Agent 的行为和工具
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode(mode === 'form' ? 'json5' : 'form')}
            className="px-4 py-2 border border-bg-tertiary rounded hover:bg-bg-tertiary transition-colors text-sm flex items-center gap-2"
          >
            <FileCode size={16} />
            {mode === 'form' ? 'JSON5 代码' : '表单编辑'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-bg-tertiary rounded hover:bg-bg-tertiary transition-colors text-sm flex items-center gap-2"
          >
            <X size={16} />
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
          >
            <Save size={16} />
            保存
          </button>
        </div>
      </div>

      {mode === 'json5' ? (
        /* JSON5 代码编辑模式 */
        <div className="space-y-4">
          <div className="bg-bg-secondary rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium">JSON5 配置</h4>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(json5Preview);
                  toast.success('已复制到剪贴板');
                }}
                className="text-xs text-primary hover:underline"
              >
                复制
              </button>
            </div>
            <CodeEditor
              value={json5Preview}
              onChange={(newValue) => {
                try {
                  const parsed = JSON.parse(newValue);
                  setConfig(parsed);
                  setErrors({});
                } catch (err) {
                  // 解析错误，保持不变
                }
              }}
              language="json"
              height="600px"
            />
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-yellow-400">
                直接编辑 JSON5 代码时，请确保格式正确。建议使用表单模式进行编辑。
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* 表单编辑模式 */
        <div className="space-y-4">
          {/* 模板选择（仅创建时显示） */}
          {isCreating && builtinAgents.length > 0 && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <label className="block text-sm font-medium mb-2 text-blue-300">
                🎯 从模板开始（可选）
              </label>
              <select
                value={selectedTemplate}
                onChange={(e) => {
                  setSelectedTemplate(e.target.value);
                  applyTemplate(e.target.value);
                }}
                className="w-full bg-bg-primary border border-blue-500/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
              >
                <option value="">从空白配置开始</option>
                {builtinAgents.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} - {template.description}
                  </option>
                ))}
              </select>
              <p className="text-xs text-blue-300 mt-2">
                💡 选择一个内置 Agent 作为起点，自动填充配置后您可以根据需要修改
              </p>
            </div>
          )}

          {/* 基础信息 */}
          {renderSection(
            'basic',
            '基础信息',
            <Settings size={18} className="text-primary" />,
            <>
              <div className="grid grid-cols-2 gap-4">
                {renderFormField('Agent ID *', 'id')}
                {renderFormField('名称 *', 'name')}
              </div>
              {renderFormField('描述 *', 'description', 'textarea')}

              {/* Avatar 和 Color */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Avatar（Emoji）</label>
                  <input
                    type="text"
                    value={config.avatar || '🤖'}
                    onChange={(e) => setConfig({ ...config, avatar: e.target.value })}
                    placeholder="🤖"
                    maxLength={2}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                  <p className="text-xs text-text-secondary mt-1">
                    使用 Emoji 作为头像，例如：🚀 📋 🎨
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Color（Tailwind 渐变）</label>
                  <select
                    value={config.color || 'from-blue-500 to-purple-600'}
                    onChange={(e) => setConfig({ ...config, color: e.target.value })}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="from-blue-500 to-purple-600">蓝紫渐变</option>
                    <option value="from-green-500 to-teal-600">绿青渐变</option>
                    <option value="from-pink-500 to-purple-600">粉紫渐变</option>
                    <option value="from-orange-500 to-red-600">橙红渐变</option>
                    <option value="from-purple-500 to-pink-600">紫粉渐变</option>
                    <option value="from-yellow-500 to-orange-600">黄橙渐变</option>
                  </select>
                  {/* 预览 */}
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className={`w-10 h-10 rounded flex items-center justify-center bg-gradient-to-br ${config.color || 'from-blue-500 to-purple-600'}`}
                    >
                      <span className="text-xl">{config.avatar || '🤖'}</span>
                    </div>
                    <span className="text-xs text-text-secondary">预览</span>
                  </div>
                </div>
              </div>

              {/* Capabilities */}
              <div>
                <label className="block text-sm font-medium mb-1">能力清单（每行一个）</label>
                <textarea
                  value={config.capabilities?.join('\n') || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    capabilities: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="代码编写和实现&#10;代码调试和修复&#10;代码重构和优化"
                  rows={5}
                  className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                />
                <p className="text-xs text-text-secondary mt-1">
                  定义 Agent 的能力范围，用于匹配和选择
                </p>
              </div>

              {/* Skills（未来支持） */}
              <div>
                <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                  <span>Skills（未来支持）</span>
                  <span className="text-xs bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded">预留</span>
                </label>
                <input
                  type="text"
                  value={config.skills?.join(', ') || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="implement_feature, debug_code"
                  disabled
                  className="w-full bg-bg-tertiary border border-bg-tertiary rounded px-3 py-2 text-sm text-text-secondary cursor-not-allowed"
                />
                <p className="text-xs text-text-secondary mt-1">
                  未来用于定义可复用的任务模板和工作流程
                </p>
              </div>
            </>
          )}

          {/* 系统提示词 */}
          {renderSection(
            'systemPrompt',
            '系统提示词',
            <FileCode size={18} className="text-green-500" />,
            <>
              <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-xs text-blue-400 mb-2">
                  💡 <strong>提示</strong>：System Prompt 定义 Agent 的角色身份和基础原则
                </p>
                <ul className="text-xs text-text-secondary space-y-1 ml-4">
                  <li>• 定义"我是谁"（角色身份）</li>
                  <li>• 定义"我能做什么"（能力范围）</li>
                  <li>• 定义"我的工作原则"（基础准则）</li>
                  <li>• 具体的场景指导会通过 Scene 动态加载</li>
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">System Prompt</label>
                <textarea
                  value={config.systemPrompt || ''}
                  onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
                  placeholder={`你是一位经验丰富的软件工程师。

## 核心原则
- 代码质量优先
- 简洁清晰
- 最佳实践
- 安全意识

## 工作方式
你会根据不同的任务场景，采用不同的思维方式：
- 探索场景：理解代码库结构
- 规划场景：设计架构方案
- 编码场景：编写高质量代码
...

具体的场景指导会通过 Scene 动态加载。`}
                  rows={15}
                  className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                />
                <p className="text-xs text-text-secondary mt-1">
                  支持 Markdown 格式。留空则使用默认的通用 Agent 身份。
                </p>
              </div>
            </>
          )}

          {/* 模型 & Provider 配置 */}
          {renderSection(
            'model',
            '模型配置',
            <Zap size={18} className="text-yellow-500" />,
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Provider 适配器</label>
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
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="local-llama">本地模型</option>
                  </select>
                </div>
                {config.provider?.adapter === 'local-llama' ? (
                  <div>
                    <label className="block text-sm font-medium mb-2">本地模型</label>
                    <div className="space-y-2 max-h-80 overflow-y-auto border border-bg-tertiary rounded-lg p-2">
                      {[
                        { id: 'qwen2.5-0.5b-q4', name: 'Qwen2.5-0.5B Q4', desc: '~400MB, 极速', filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf' },
                        { id: 'qwen2.5-1.5b-q4', name: 'Qwen2.5-1.5B Q4', desc: '~1GB, 均衡', filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf' },
                        { id: 'chatglm3-6b-q4', name: 'ChatGLM3-6B Q4', desc: '~3.5GB, 高精度分类，推荐', filename: 'chatglm3-6b.Q4_K_M.gguf' },
                        { id: 'chatglm3-6b-q3', name: 'ChatGLM3-6B Q3', desc: '~2.7GB, 更快，精度略降', filename: 'chatglm3-6b.Q3_K_M.gguf' },
                        { id: 'glm4-9b-q4', name: 'GLM-4-9B Q4', desc: '~5.4GB, 最高精度，资源需求高', filename: 'glm-4-9b-chat.Q4_K_M.gguf' },
                      ].map((preset) => {
                        const installed = localModelStatuses[preset.id]?.installed;
                        const downloading = localModelStatuses[preset.id]?.downloading;
                        return (
                          <label key={preset.id} className="flex items-center justify-between p-3 rounded-lg border border-bg-tertiary bg-bg-primary cursor-pointer hover:border-primary/40">
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
                                <p className="text-xs text-text-secondary">{preset.desc}</p>
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
                                下载
                              </button>
                            )}
                            {installed && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (confirm(`确定卸载 ${preset.name}？`)) {
                                    deleteLocalModel(preset.filename);
                                  }
                                }}
                                className="text-xs px-2 py-1 text-red-500 hover:bg-red-500/10 rounded transition-colors flex items-center gap-1"
                              >
                                <Trash2 size={12} />
                                卸载
                              </button>
                            )}
                          </label>
                        );
                      })}

                      {scannedModels.length > 0 && (
                        <>
                          <div className="text-xs text-text-secondary px-2 py-1 border-t border-bg-tertiary mt-2 pt-2">
                            本地已下载模型
                          </div>
                          {scannedModels.map((item) => {
                            const modelId = item.filename;
                            const isSelected = config.model?.primary === modelId;
                            return (
                              <label key={item.filename} className="flex items-center justify-between p-3 rounded-lg border border-bg-tertiary bg-bg-primary cursor-pointer hover:border-primary/40">
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
                                    <p className="text-xs text-text-secondary">
                                      {(item.size / 1024 / 1024 / 1024).toFixed(2)} GB
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (confirm(`确定卸载 ${item.filename}？`)) {
                                      deleteLocalModel(item.filename);
                                    }
                                  }}
                                  className="text-xs px-2 py-1 text-red-500 hover:bg-red-500/10 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                                >
                                  <Trash2 size={12} />
                                  卸载
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
                  renderFormField('主模型', 'model.primary', 'select')
                )}
              </div>
              {config.provider?.adapter !== 'local-llama' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">API Key</label>
                    <input
                      type="password"
                      value={config.provider?.apiKey || ''}
                      onChange={(e) => setConfig({
                        ...config,
                        provider: { ...config.provider, apiKey: e.target.value },
                      })}
                      placeholder="留空使用全局配置"
                      className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Base URL</label>
                    <input
                      type="text"
                      value={config.provider?.baseURL || ''}
                      onChange={(e) => setConfig({
                        ...config,
                        provider: { ...config.provider, baseURL: e.target.value },
                      })}
                      placeholder="留空使用默认地址"
                      className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
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
                          toast.error(result.error || '打开目录失败');
                        }
                      } catch (err: any) {
                        toast.error(err.message || '打开目录失败');
                      }
                    }}
                    className="text-primary hover:underline cursor-pointer"
                  >
                    打开模型目录 (.xuanji/models/)
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {renderFormField('温度 (0-1)', 'model.temperature', 'number')}
              </div>
            </>
          )}

          {/* 工具配置 */}
          {renderSection(
            'tools',
            '工具配置',
            <Database size={18} className="text-blue-500" />,
            <>
              <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-xs text-blue-400 mb-2">
                  💡 <strong>提示</strong>：工具配置定义 Agent 可以使用的工具
                </p>
                <ul className="text-xs text-text-secondary space-y-1 ml-4">
                  <li>• 每个工具可以单独启用/禁用</li>
                  <li>• 可以为工具添加自定义描述和配置</li>
                  <li>• 常用工具：read_file, write_file, edit_file, bash, glob, grep</li>
                </ul>
              </div>

              {toolsLoading ? (
                <p className="text-sm text-text-secondary">加载工具列表中...</p>
              ) : (
                <>
                  {/* 搜索和批量操作 */}
                  <div className="space-y-3 mb-4">
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                      <input
                        type="text"
                        placeholder="搜索工具名称、描述或类别..."
                        value={toolSearchQuery}
                        onChange={(e) => setToolSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-3 py-2 bg-bg-primary border border-bg-tertiary rounded text-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllTools}
                        className="px-3 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded"
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        onClick={deselectAllTools}
                        className="px-3 py-1.5 text-xs bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80 rounded"
                      >
                        取消全选
                      </button>
                      <span className="ml-auto text-xs text-text-tertiary self-center">
                        已启用 {(config.tools || []).filter((t: any) => t.enabled !== false).length} / {(config.tools || []).length} 个工具
                      </span>
                    </div>
                  </div>

                  {/* 按类别分组的工具列表 */}
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {Object.entries(groupedTools).map(([category, tools]) => (
                      <div key={category}>
                        <h4 className="text-sm font-medium text-text-primary mb-2 sticky top-0 bg-bg-secondary py-1">
                          {category}
                        </h4>
                        <div className="space-y-2 pl-2">
                          {tools.map((tool: any) => {
                            const toolConfig = (config.tools || []).find((t: any) => t.name === tool.name);
                            const isEnabled = toolConfig ? toolConfig.enabled !== false : false;

                            return (
                              <div
                                key={tool.name}
                                className="p-2 hover:bg-bg-tertiary/50 rounded"
                              >
                                <label className="flex items-start gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isEnabled}
                                    onChange={() => toggleTool(tool.name)}
                                    className="mt-0.5 rounded"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-text-primary">{tool.name}</div>
                                    {tool.description && (
                                      <div className="text-xs text-text-tertiary mt-0.5">{tool.description}</div>
                                    )}
                                    {/* 自定义描述（可选） */}
                                    {isEnabled && toolConfig?.description && (
                                      <div className="text-xs text-primary mt-1">
                                        自定义描述: {toolConfig.description}
                                      </div>
                                    )}
                                  </div>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredTools.length === 0 && (
                    <p className="text-sm text-text-tertiary text-center py-4">
                      未找到匹配的工具
                    </p>
                  )}

                  {errors.tools && (
                    <p className="text-xs text-red-400 mt-2">⚠️ {errors.tools}</p>
                  )}
                </>
              )}
            </>
          )}

          {/* 执行配置 */}
          {renderSection(
            'execution',
            '执行配置',
            <Settings size={18} className="text-gray-500" />,
            <>
              <div className="grid grid-cols-2 gap-4">
                {/* 执行模式 */}
                <div>
                  <label className="block text-sm font-medium mb-1">执行模式</label>
                  <select
                    value={config.execution?.mode || 'react'}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, mode: e.target.value },
                    })}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="react">ReAct（推荐）</option>
                    <option value="plan">Plan（规划模式）</option>
                    <option value="chain">Chain（链式模式）</option>
                  </select>
                </div>

                {/* 最大迭代次数 */}
                <div>
                  <label className="block text-sm font-medium mb-1">最大迭代次数</label>
                  <input
                    type="number"
                    value={config.execution?.maxIterations || 20}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, maxIterations: parseInt(e.target.value) },
                    })}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>

                {/* 超时时间 */}
                <div>
                  <label className="block text-sm font-medium mb-1">超时时间 (ms)</label>
                  <input
                    type="number"
                    value={config.execution?.timeout || 300000}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, timeout: parseInt(e.target.value) },
                    })}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* 执行选项 */}
              <div className="space-y-2 mt-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.execution?.streaming !== false}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, streaming: e.target.checked },
                    })}
                    className="rounded"
                  />
                  <span className="text-sm">流式输出</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.execution?.parallelTools !== false}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, parallelTools: e.target.checked },
                    })}
                    className="rounded"
                  />
                  <span className="text-sm">并行工具调用</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.execution?.retryOnError === true}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, retryOnError: e.target.checked },
                    })}
                    className="rounded"
                  />
                  <span className="text-sm">错误时自动重试</span>
                </label>
              </div>
            </>
          )}

          {/* 权限配置 */}
          {renderSection(
            'permissions',
            '权限配置',
            <AlertCircle size={18} className="text-orange-500" />,
            <>
              <div className="mb-3 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                <p className="text-xs text-orange-400">
                  ⚠️ 权限配置控制 Agent 对系统资源的访问级别
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* 文件读取权限 */}
                <div>
                  <label className="block text-sm font-medium mb-1">文件读取</label>
                  <select
                    value={config.permissions?.fileRead || 'always'}
                    onChange={(e) => setConfig({
                      ...config,
                      permissions: { ...config.permissions, fileRead: e.target.value },
                    })}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="always">始终允许</option>
                    <option value="ask">询问用户</option>
                    <option value="never">禁止</option>
                  </select>
                </div>

                {/* 文件写入权限 */}
                <div>
                  <label className="block text-sm font-medium mb-1">文件写入</label>
                  <select
                    value={config.permissions?.fileWrite || 'ask'}
                    onChange={(e) => setConfig({
                      ...config,
                      permissions: { ...config.permissions, fileWrite: e.target.value },
                    })}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="always">始终允许</option>
                    <option value="ask">询问用户</option>
                    <option value="never">禁止</option>
                  </select>
                </div>

                {/* Bash 执行权限 */}
                <div>
                  <label className="block text-sm font-medium mb-1">Bash 执行</label>
                  <select
                    value={config.permissions?.bashExec || 'ask'}
                    onChange={(e) => setConfig({
                      ...config,
                      permissions: { ...config.permissions, bashExec: e.target.value },
                    })}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="always">始终允许</option>
                    <option value="ask">询问用户</option>
                    <option value="never">禁止</option>
                  </select>
                </div>

                {/* 网络访问权限 */}
                <div>
                  <label className="block text-sm font-medium mb-1">网络访问</label>
                  <select
                    value={config.permissions?.network || 'ask'}
                    onChange={(e) => setConfig({
                      ...config,
                      permissions: { ...config.permissions, network: e.target.value },
                    })}
                    className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="always">始终允许</option>
                    <option value="ask">询问用户</option>
                    <option value="never">禁止</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
