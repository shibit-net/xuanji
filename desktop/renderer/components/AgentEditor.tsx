// ============================================================
// AgentEditor - Agent 编辑器组件（完整版）
// ============================================================

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Save, X, FileCode, Settings, Zap, Database, ChevronDown, ChevronRight, Trash2, AlertCircle, Loader2, Search, Download, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useToast } from './Toast';
import CodeEditor from './CodeEditor';
import MilkdownEditor from './MilkdownEditor.lazy';
import { isFieldEditable, type AgentCategory } from '../utils/agentPermissions';
import { t } from '@/core/i18n';
import { useConfigStore } from '../stores/configStore';

// 根据工具名推断分类
function inferToolCategory(name: string): string {
  if (/^(read_file|write_file|edit_file|multi_edit|glob|grep|list_directory|change_directory|docx_edit|xlsx_edit|pdf|doc_to_docx|notebook_edit|send_file_to_user)$/.test(name)) return 'file';
  if (/^(bash|ssh_exec|ssh_list|ssh_read|ssh_write|enter_worktree|exit_plan_mode|enter_plan_mode|task$|task_control|task_output|plan_review)$/.test(name)) return 'code';
  if (/^(sleep|scheduler|install|uninstall|mcp_settings|todo_)/.test(name)) return 'system';
  if (/^(web_fetch|web_search)$/.test(name)) return 'network';
  return 'meta';
}

// 工具分类 → Tailwind 色系
const TOOL_CATEGORY_STYLE: Record<string, { bg: string; border: string; dot: string; text: string; label: string }> = {
  file: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', dot: 'bg-blue-400/60', text: 'text-blue-300/80', label: '文件' },
  code: { bg: 'bg-green-500/10', border: 'border-green-500/20', dot: 'bg-green-400/60', text: 'text-green-300/80', label: '代码' },
  system: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', dot: 'bg-purple-400/60', text: 'text-purple-300/80', label: '系统' },
  network: { bg: 'bg-orange-500/10', border: 'border-orange-500/20', dot: 'bg-orange-400/60', text: 'text-orange-300/80', label: '网络' },
  meta: { bg: 'bg-pink-500/10', border: 'border-pink-500/20', dot: 'bg-pink-400/60', text: 'text-pink-300/80', label: '元认知' },
};

// 媒体生成工具名称和默认配置
const MEDIA_TOOL_NAMES = new Set(['generate_image', 'edit_image', 'generate_video', 'generate_audio']);

const MEDIA_TOOL_DEFAULT_CONFIG: Record<string, Record<string, unknown>> = {
  generate_image: {
    defaultSize: '2K',
    watermark: false,
  },
  edit_image: {
    watermark: false,
  },
  generate_video: {
    defaultSize: '2K',
    defaultDuration: 5,
    pollInterval: 5000,
    pollTimeout: 600000,
  },
  generate_audio: {
    defaultDuration: 30,
  },
};

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
  enabled: true,
  capabilities: [],
  skills: [],

  systemPrompt: '',

  model: {
    primary: 'claude-sonnet-4-6',
    temperature: 0.3,
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
    maxIterations: 100,
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
  const [numberInputCache, setNumberInputCache] = useState<Record<string, string>>({});
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
  const category: AgentCategory = agent?.metadata?.category || 'custom';
  const canEdit = (field: string) => isFieldEditable(field, category, isCreating);

  // 本地模型不需要 API Key
  const LOCAL_PROVIDERS = new Set(['ollama', 'vllm', 'lmstudio', 'local-llama']);
  const canEnableAgent = (cfg: any): boolean => {
    const adapter = cfg.provider?.adapter || 'anthropic';
    if (LOCAL_PROVIDERS.has(adapter)) return true;
    return !!cfg.provider?.apiKey;
  };

  // 创建向导步骤
  const [creationStep, setCreationStep] = useState(1);
  const totalSteps = 4;

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

  // 下载本地模型（启动下载 + 轮询完成状态）
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const downloadSource = useConfigStore((s) => s.fullConfig?.download?.source);
  const hfMirror = useConfigStore((s) => s.fullConfig?.download?.hfMirror);

  const downloadLocalModel = async (modelId: string) => {
    try {
      const result = await window.electron.localModelDownload(modelId, downloadSource, hfMirror);
      if (result.success) {
        setLocalModelStatuses(prev => ({
          ...prev,
          [modelId]: { ...prev[modelId], downloading: true, progress: 0 },
        }));
        toast.success(t('agent.editor.toast.download_start', { name: modelId }));

        // 轮询检查下载是否完成
        const existing = pollTimersRef.current.get(modelId);
        if (existing) clearInterval(existing);

        const timer = setInterval(async () => {
          try {
            const check = await window.electron.localModelCheck(modelId);
            if (check.success && check.installed) {
              clearInterval(timer);
              pollTimersRef.current.delete(modelId);
              setLocalModelStatuses(prev => ({
                ...prev,
                [modelId]: { installed: true, downloading: false, progress: 0 },
              }));
              toast.success(t('agent.editor.toast.download_complete', { name: modelId }));
            }
          } catch {}
        }, 3000);
        pollTimersRef.current.set(modelId, timer);
      } else {
        toast.error(result.error || t('agent.editor.toast.download_failed'));
      }
    } catch (err: any) {
      toast.error(err.message || t('agent.editor.toast.download_failed'));
    }
  };

  // 组件卸载时清理轮询
  useEffect(() => {
    return () => {
      pollTimersRef.current.forEach((timer) => clearInterval(timer));
    };
  }, []);

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

        toast.success(t('agent.editor.toast.delete_success', { name: filename }));
      } else {
        toast.error(result.error || t('agent.editor.toast.delete_failed'));
      }
    } catch (err: any) {
      toast.error(err.message || t('agent.editor.toast.delete_failed'));
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
        const withCategory = result.tools.map((t: any) => ({
          ...t,
          category: t.category || inferToolCategory(t.name),
        }));
        setAvailableTools(withCategory);
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
    toast.info(t('agent.editor.template_applied', { name }));
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
      newErrors.id = t('agent.editor.error.id_empty');
    } else if (!/^[a-z0-9-]+$/.test(config.id)) {
      newErrors.id = t('agent.editor.error.id_invalid');
    }

    // 名称验证
    if (!config.name) {
      newErrors.name = t('agent.editor.error.name_empty');
    }

    // 描述验证
    if (!config.description) {
      newErrors.description = t('agent.editor.error.desc_empty');
    }

    // 系统提示词验证
    if (!config.systemPrompt || config.systemPrompt.trim().length < 10) {
      newErrors.systemPrompt = t('agent.editor.error.prompt_too_short');
    }

    // 本地模型验证
    if (config.provider?.adapter === 'local-llama' && config.model?.primary) {
      const modelPrimary = config.model.primary;
      const isLocalFileModel = modelPrimary.endsWith('.gguf');
      if (!isLocalFileModel) {
        try {
          const result = await window.electron.localModelCheck(modelPrimary);
          if (result.success && !result.installed) {
            newErrors.model = t('agent.editor.error.model_not_downloaded', { name: modelPrimary });
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
    // 已启用的 Agent 必须能通过启用校验（非本地模型须配置 API Key）
    if (config.enabled !== false && !canEnableAgent(config)) {
      toast.error(t('agent.editor.error.api_key_required'));
      setExpandedSections((prev) => new Set([...prev, 'model']));
      return;
    }

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
        toast.error(t('agent.editor.error.validation_failed'));
      }
      return;
    }

    onSave(config);
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
        // 媒体工具：初始化默认配置
        if (MEDIA_TOOL_NAMES.has(toolName) && !newTools[existingIndex].config) {
          newTools[existingIndex].config = { ...MEDIA_TOOL_DEFAULT_CONFIG[toolName] };
        }
      }
      setConfig({ ...config, tools: newTools });
    } else {
      // 添加新工具，媒体工具附带默认配置
      const tool: any = { name: toolName, enabled: true };
      if (MEDIA_TOOL_NAMES.has(toolName)) {
        tool.config = { ...MEDIA_TOOL_DEFAULT_CONFIG[toolName] };
      }
      setConfig({
        ...config,
        tools: [...tools, tool],
      });
    }
  };

  /** 更新某个工具的配置字段 */
  const updateToolConfig = (toolName: string, key: string, value: unknown) => {
    const tools = [...(config.tools || [])];
    const idx = tools.findIndex((t: any) => t.name === toolName);
    if (idx < 0) return;
    tools[idx] = {
      ...tools[idx],
      config: { ...(tools[idx].config || {}), [key]: value },
    };
    setConfig({ ...config, tools });
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
      const category = tool.category || t('agent.editor.unknown_category');
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(tool);
    });
    return groups;
  }, [filteredTools]);

  // 渲染表单字段
  const renderFormField = (
    label: string,
    field: string,
    type: 'text' | 'textarea' | 'number' | 'select' = 'text',
    options?: string[],
    disabled?: boolean,
    placeholder?: string
  ) => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], config);
    const error = errors[field];
    const isDisabled = disabled ?? !canEdit(field);

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
              disabled={isDisabled}
              rows={3}
              className={`w-full border ${error ? 'border-red-500' : 'border-border'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono ${isDisabled ? 'bg-muted/30 text-muted-foreground cursor-not-allowed' : 'bg-background'}`}
            />
          )
        ) : type === 'select' ? (
          isModelSelect ? (
            // 模型选择：可自由输入 + 下拉建议
            <div className="relative">
              <div className="relative">
                <input
                  type="text"
                  value={currentModelName || ''}
                  onChange={(e) => {
                    const query = e.target.value;
                    handleChange(query);
                    setModelSearchQuery(query);
                    setShowModelDropdown(true);
                    debouncedSearchModels(query);
                  }}
                  onFocus={() => {
                    setModelSearchQuery(currentModelName || '');
                    setShowModelDropdown(true);
                    const currentAdapter = config.provider?.adapter || 'anthropic';
                    loadModels(currentAdapter, undefined);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setShowModelDropdown(false);
                    }, 200);
                  }}
                  disabled={isDisabled}
                  placeholder={t('agent.editor.model_search_placeholder')}
                  className={`w-full border ${error ? 'border-red-500' : 'border-border'} rounded px-3 py-2 pr-10 text-sm focus:outline-none focus:border-primary ${isDisabled ? 'bg-muted/30 text-muted-foreground cursor-not-allowed' : 'bg-background'}`}
                />
                {modelsLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  </div>
                )}
                {!modelsLoading && (
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                )}
              </div>

              {/* 下拉建议列表 */}
              {showModelDropdown && !modelsLoading && filteredModels.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded shadow-lg max-h-60 overflow-y-auto">
                  {filteredModels.map((model, idx) => (
                    <button
                      key={model.id || `${model.model || 'model'}-${idx}`}
                      type="button"
                      onClick={() => {
                        handleChange(model.name);
                        setModelSearchQuery(model.name);
                        setShowModelDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-primary/10transition-colors text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{model.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{model.model}</div>
                        </div>
                        {(model.inputPrice !== undefined || model.outputPrice !== undefined) && (
                          <div className="ml-2 text-xs text-muted-foreground/50 whitespace-nowrap">
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
                  ))}
                </div>
              )}
            </div>
          ) : (
            // 普通 select
            <select
              value={value || ''}
              onChange={(e) => handleChange(e.target.value)}
              disabled={isDisabled}
              className={`w-full border ${error ? 'border-red-500' : 'border-border'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary ${isDisabled ? 'bg-muted/30 text-muted-foreground cursor-not-allowed' : 'bg-background'}`}
            >
              {currentOptions?.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )
        ) : type === 'number' ? (
          <input
            type="text"
            inputMode="decimal"
            disabled={isDisabled}
            value={field in numberInputCache ? numberInputCache[field] : (value != null ? String(value) : '')}
            placeholder={placeholder ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              setNumberInputCache(prev => ({ ...prev, [field]: raw }));
              const num = Number(raw);
              if (raw !== '' && !isNaN(num)) {
                handleChange(num);
              }
            }}
            onBlur={() => {
              setNumberInputCache(prev => {
                const next = { ...prev };
                delete next[field];
                return next;
              });
              const displayStr = field in numberInputCache ? numberInputCache[field] : (value != null ? String(value) : '');
              const num = Number(displayStr);
              if (displayStr !== '' && !isNaN(num)) {
                handleChange(num);
              } else {
                handleChange(0);
              }
            }}
            className={`w-full border ${error ? 'border-red-500' : 'border-border'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary ${isDisabled ? 'bg-muted/30 text-muted-foreground cursor-not-allowed' : 'bg-background'}`}
          />
        ) : (
          <input
            type={type}
            disabled={isDisabled}
            value={value != null ? String(value) : ''}
            onChange={(e) => handleChange(e.target.value)}
            className={`w-full border ${error ? 'border-red-500' : 'border-border'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary ${isDisabled ? 'bg-muted/30 text-muted-foreground cursor-not-allowed' : 'bg-background'}`}
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
      <div className="bg-card rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(id)}
          className="w-full flex items-center gap-3 p-4 hover:bg-primary/5 transition-colors"
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
            {agent ? t('agent.editor.title.edit') : t('agent.editor.title.create')}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t('agent.editor.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode(mode === 'form' ? 'json5' : 'form')}
            className="px-4 py-2 border border-border rounded hover:bg-primary/10transition-colors text-sm flex items-center gap-2"
          >
            <FileCode size={16} />
            {mode === 'form' ? t('agent.editor.json5_mode') : t('agent.editor.form_mode')}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-border rounded hover:bg-primary/10transition-colors text-sm flex items-center gap-2"
          >
            <X size={16} />
            {t('agent.editor.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
          >
            <Save size={16} />
            {t('agent.editor.save')}
          </button>
        </div>
      </div>

      {mode === 'json5' && category !== 'system' ? (
        /* JSON5 代码编辑模式 */
        <div className="space-y-4">
          <div className="bg-card rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium">{t('agent.editor.json5_title')}</h4>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(json5Preview);
                  toast.success(t('agent.editor.copied'));
                }}
                className="text-xs text-primary hover:underline"
              >
                {t('agent.editor.copy')}
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
                {t('agent.editor.json5_warning')}
              </p>
            </div>
          </div>
        </div>
      ) : isCreating ? (
        /* 创建向导 */
        <div className="space-y-6">
          {/* 进度指示器 */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  step < creationStep ? 'bg-primary text-white' :
                  step === creationStep ? 'bg-primary text-white ring-2 ring-primary/30' :
                  'bg-primary/10 text-muted-foreground/50'
                }`}>
                  {step < creationStep ? <Check size={14} /> : step}
                </div>
                <span className={`text-xs ${step <= creationStep ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                  {step === 1 ? t('agent.editor.wizard.step.identity') : step === 2 ? t('agent.editor.wizard.step.brain') : step === 3 ? t('agent.editor.wizard.step.tools') : t('agent.editor.wizard.step.review')}
                </span>
                {step < 4 && <div className={`w-8 h-0.5 ${step < creationStep ? 'bg-primary' : 'bg-primary/15'}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: 身份 */}
          {creationStep === 1 && (
            <div className="space-y-4">
              <div className="bg-card rounded-lg p-4">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Settings size={18} className="text-primary" />
                  {t('agent.editor.basic_info')}
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderFormField(t('agent.editor.field.id'), 'id')}
                  {renderFormField(t('agent.editor.field.name'), 'name')}
                </div>
                {renderFormField(t('agent.editor.field.description'), 'description', 'textarea')}
                <div className="grid grid-cols-2 gap-4 mt-2">
                  {renderFormField(t('agent.editor.field.avatar'), 'avatar')}
                  {renderFormField(t('agent.editor.field.color'), 'color')}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 大脑 */}
          {creationStep === 2 && (
            <div className="space-y-4">
              {/* 模板选择 */}
              {builtinAgents.length > 0 && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                  <label className="block text-sm font-medium mb-2 text-blue-300">
                    {t('agent.editor.template.start')}
                  </label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => {
                      setSelectedTemplate(e.target.value);
                      applyTemplate(e.target.value);
                    }}
                    className="w-full bg-background border border-blue-500/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="">{t('agent.editor.template.empty')}</option>
                    {builtinAgents.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} - {template.description}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="bg-card rounded-lg p-4">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Zap size={18} className="text-yellow-500" />
                  {t('agent.editor.model_section')}
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('agent.editor.field.provider')}</label>
                    <select
                      value={config.provider?.adapter || 'anthropic'}
                      onChange={(e) => {
                        setConfig({ ...config, provider: { ...config.provider, adapter: e.target.value } });
                        loadModels(e.target.value);
                      }}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </div>
                  {renderFormField(t('agent.editor.field.primary_model'), 'model.primary', 'select')}
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium mb-1">{t('agent.editor.field.system_prompt')}</label>
                  <textarea
                    value={config.systemPrompt || ''}
                    onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
                    placeholder={t('agent.editor.system_prompt_placeholder')}
                    rows={10}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 mt-3">
                  {renderFormField(t('agent.editor.field.temperature'), 'model.temperature', 'number', undefined, undefined, '0.3')}
                  {renderFormField(t('agent.editor.field.max_tokens'), 'model.maxTokens', 'number', undefined, undefined, '8192')}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: 工具与能力 */}
          {creationStep === 3 && (
            <div className="space-y-4">
              <div className="bg-card rounded-lg p-4">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <FileCode size={18} className="text-green-500" />
                  {t('agent.editor.capabilities_section')}
                </h4>
                <textarea
                  value={config.capabilities?.join('\n') || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    capabilities: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder={t('agent.editor.capabilities_placeholder')}
                  rows={4}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>

              <div className="bg-card rounded-lg p-4">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Database size={18} className="text-blue-500" />
                  {t('agent.editor.tools_section')}
                </h4>
                {/* 搜索和批量操作 */}
                <div className="space-y-3 mb-4">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                    <input
                      type="text"
                      placeholder={t('agent.editor.search_tools')}
                      value={toolSearchQuery}
                      onChange={(e) => setToolSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={selectAllTools} className="px-3 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded">{t('agent.editor.tools_select_all')}</button>
                    <button type="button" onClick={deselectAllTools} className="px-3 py-1.5 text-xs bg-accent/10 text-accent-foreground/60 hover:bg-primary/20 rounded">{t('agent.editor.tools_deselect_all')}</button>
                    <span className="ml-auto text-xs text-muted-foreground/50 self-center">
                      {t('agent.editor.tools_enabled_count', { enabled: (config.tools || []).filter((t: any) => t.enabled !== false).length, total: (config.tools || []).length })}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {Object.entries(groupedTools).map(([cat, tools]) => (
                    <div key={cat}>
                      {(() => {
                        const s = TOOL_CATEGORY_STYLE[cat] || { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: cat };
                        return (
                          <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
                            <span className="text-[10px] text-muted-foreground/40">{tools.length}</span>
                          </div>
                        );
                      })()}
                      <div className="space-y-1 pl-2">
                        {tools.map((tool: any) => {
                          const toolConfig = (config.tools || []).find((t: any) => t.name === tool.name);
                          const isEnabled = toolConfig ? toolConfig.enabled !== false : false;
                          const cat = tool.category || 'other';
                          const style = TOOL_CATEGORY_STYLE[cat] || { bg: 'bg-card', border: 'border-border' };
                          return (
                            <div key={tool.name} className={`p-2.5 rounded-lg border ${style.bg} ${style.border} mb-1.5`}>
                              <label className="flex items-start gap-3 cursor-pointer">
                                <input type="checkbox" checked={isEnabled} onChange={() => toggleTool(tool.name)} className="mt-0.5 rounded" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium">{tool.name}</div>
                                  {tool.description && <div className="text-xs text-muted-foreground/50 mt-0.5">{tool.description}</div>}
                                </div>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: 审核保存 */}
          {creationStep === 4 && (
            <div className="space-y-4">
              <div className="bg-card rounded-lg p-4">
                <h4 className="font-medium mb-3">{t('agent.editor.review_section')}</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground/50">{t('agent.editor.review.id')}</span><span className="font-mono">{config.id || t('agent.editor.review.not_filled')}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground/50">{t('agent.editor.review.name')}</span><span>{config.name || t('agent.editor.review.not_filled')}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground/50">{t('agent.editor.review.model')}</span><span className="font-mono">{config.model?.primary || '-'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground/50">{t('agent.editor.review.provider')}</span><span>{config.provider?.adapter || '-'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground/50">{t('agent.editor.review.system_prompt')}</span><span>{config.systemPrompt ? `${config.systemPrompt.substring(0, 50)}${t('agent.editor.review.ellipsis')}` : t('agent.editor.review.none')}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground/50">{t('agent.editor.review.tool_count')}</span><span>{(config.tools || []).filter((t: any) => t.enabled !== false).length} {t('agent.editor.tools_enabled_count_suffix').trim()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground/50">{t('agent.editor.review.capability_count')}</span><span>{(config.capabilities || []).length} {t('agent.editor.review.ellipsis')}</span></div>
                </div>
              </div>

              {/* 高级设置 */}
              <details className="bg-card rounded-lg p-4">
                <summary className="font-medium cursor-pointer">{t('agent.editor.advanced_settings')}</summary>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">{t('agent.editor.field.exec_mode')}</label>
                      <select value={config.execution?.mode || 'react'} onChange={(e) => setConfig({ ...config, execution: { ...config.execution, mode: e.target.value } })} className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary">
                        <option value="react">{t('agent.editor.execution_mode_react')}</option>
                        <option value="plan">{t('agent.editor.execution_mode_plan')}</option>
                        <option value="chain">{t('agent.editor.execution_mode_chain')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">{t('agent.editor.field.max_iterations_full')}</label>
                      <input type="number" value={Number.isFinite(config.execution?.maxIterations) ? config.execution.maxIterations : ''} placeholder="∞ 无限" onChange={(e) => { const v = e.target.value; setConfig({ ...config, execution: { ...config.execution, maxIterations: v === '' ? Infinity : parseInt(v) } }); }} className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.execution?.streaming !== false} onChange={(e) => setConfig({ ...config, execution: { ...config.execution, streaming: e.target.checked } })} className="rounded" />{t('agent.editor.field.streaming')}</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.execution?.parallelTools !== false} onChange={(e) => setConfig({ ...config, execution: { ...config.execution, parallelTools: e.target.checked } })} className="rounded" />{t('agent.editor.field.parallel_tools')}</label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">{t('agent.editor.field.file_read')}</label>
                      <select value={config.permissions?.fileRead || 'always'} onChange={(e) => setConfig({ ...config, permissions: { ...config.permissions, fileRead: e.target.value } })} className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary">
                        <option value="always">{t('agent.editor.perm_always')}</option><option value="ask">{t('agent.editor.perm_ask')}</option><option value="deny">{t('agent.editor.perm_deny')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">{t('agent.editor.field.file_write')}</label>
                      <select value={config.permissions?.fileWrite || 'ask'} onChange={(e) => setConfig({ ...config, permissions: { ...config.permissions, fileWrite: e.target.value } })} className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary">
                        <option value="always">{t('agent.editor.perm_always')}</option><option value="ask">{t('agent.editor.perm_ask')}</option><option value="deny">{t('agent.editor.perm_deny')}</option>
                      </select>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}

          {/* 导航按钮 */}
          <div className="flex justify-between pt-4 border-t border-border">
            {creationStep > 1 ? (
              <button type="button" onClick={() => setCreationStep(creationStep - 1)} className="px-4 py-2 border border-border rounded hover:bg-primary/10transition-colors text-sm flex items-center gap-2">
                <ArrowLeft size={16} />{t('agent.editor.prev_step')}
              </button>
            ) : <div />}
            {creationStep < 4 ? (
              <button type="button" onClick={() => setCreationStep(creationStep + 1)} className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm flex items-center gap-2">
                {t('agent.editor.next_step')}<ArrowRight size={16} />
              </button>
            ) : (
              <button type="button" onClick={handleSave} className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm flex items-center gap-2">
                <Save size={16} />{t('agent.editor.save_agent')}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* 编辑模式 — 折叠面板 */
        <div className="space-y-4">
          {/* 分类提示 */}
          {!isCreating && (
            <div className={`rounded-lg p-3 text-xs ${
              category === 'system' ? 'bg-red-500/10 border border-red-500/20 text-red-400' :
              category === 'app' ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400' :
              'bg-green-500/10 border border-green-500/20 text-green-400'
            }`}>
              {category === 'system' && t('agent.editor.cat_hint_system')}
              {category === 'app' && t('agent.editor.cat_hint_app')}
              {category === 'custom' && t('agent.editor.cat_hint_custom')}
            </div>
          )}

          {/* 基础信息 */}
          {renderSection(
            'basic',
            t('agent.editor.basic_info'),
            <Settings size={18} className="text-primary" />,
            <>
              <div className="grid grid-cols-2 gap-4">
                {renderFormField(t('agent.editor.field.id'), 'id')}
                {renderFormField(t('agent.editor.field.name'), 'name')}
              </div>
              {/* 启用/禁用开关 */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium">{t('agent.editor.field.enabled')}</span>
                <button
                  type="button"
                  onClick={() => {
                    const isEnabling = config.enabled === false;
                    if (isEnabling && !canEnableAgent(config)) {
                      toast.error(t('agent.editor.error.api_key_required'));
                      return;
                    }
                    setConfig({ ...config, enabled: !config.enabled });
                  }}
                  disabled={!canEdit('enabled')}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    config.enabled !== false ? 'bg-primary' : 'bg-border'
                  } ${!canEdit('enabled') ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      config.enabled !== false ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {renderFormField(t('agent.editor.field.description'), 'description', 'textarea')}

              {/* Capabilities */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('agent.editor.field.capabilities')}</label>
                <textarea
                  value={config.capabilities?.join('\n') || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    capabilities: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder={t('agent.editor.capabilities_placeholder')}
                  rows={5}
                  disabled={!canEdit('capabilities')}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('agent.editor.field.capabilities_hint')}
                </p>
              </div>
            </>
          )}

          {/* 系统提示词 */}
          {category !== 'system' && renderSection(
            'systemPrompt',
            t('agent.editor.field.system_prompt'),
            <FileCode size={18} className="text-green-500" />,
            <>
              <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-xs text-blue-400 mb-2">
                  {t('agent.editor.system_prompt_hint_title')}
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 ml-4">
                  <li>{t('agent.editor.system_prompt_hint_item1')}</li>
                  <li>{t('agent.editor.system_prompt_hint_item2')}</li>
                  <li>{t('agent.editor.system_prompt_hint_item3')}</li>
                  <li>{t('agent.editor.system_prompt_hint_item4')}</li>
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('agent.editor.field.system_prompt')}</label>
                <textarea
                  value={config.systemPrompt || ''}
                  onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
                  disabled={!canEdit('systemPrompt')}
                  placeholder={t('agent.editor.system_prompt_edit_placeholder')}
                  rows={15}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('agent.editor.system_prompt_footer')}
                </p>
              </div>
            </>
          )}

          {/* 模型 & Provider 配置 */}
          {renderSection(
            'model',
            t('agent.editor.field.primary_model') + ' & Provider',
            <Zap size={18} className="text-yellow-500" />,
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
          )}

          {/* 工具配置 */}
          {renderSection(
            'tools',
            t('agent.editor.tools_section'),
            <Database size={18} className="text-blue-500" />,
            <>
              <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-xs text-blue-400 mb-2">
                  {t('agent.editor.tools_hint_intro')}
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 ml-4">
                  <li>{t('agent.editor.tools_hint_item1')}</li>
                  <li>{t('agent.editor.tools_hint_item2')}</li>
                  <li>{t('agent.editor.tools_hint_item3')}</li>
                </ul>
              </div>

              {toolsLoading ? (
                <p className="text-sm text-muted-foreground">{t('agent.editor.loading_tools')}</p>
              ) : (
                <>
                  {/* 搜索和批量操作 */}
                  <div className="space-y-3 mb-4">
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                      <input
                        type="text"
                        placeholder={t('agent.editor.search_tools_ext')}
                        value={toolSearchQuery}
                        onChange={(e) => setToolSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllTools}
                        className="px-3 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded"
                      >
                      {t('agent.editor.tools_select_all')}
                      </button>
                      <button
                        type="button"
                        onClick={deselectAllTools}
                        className="px-3 py-1.5 text-xs bg-accent/10 text-accent-foreground/60 hover:bg-primary/20 rounded"
                      >
                        {t('agent.editor.tools_deselect_all')}
                      </button>
                      <span className="ml-auto text-xs text-muted-foreground/50 self-center">
                        {t('agent.editor.tools_enabled_count', { enabled: (config.tools || []).filter((t: any) => t.enabled !== false).length, total: (config.tools || []).length })}<span className="ml-0.5">{t('agent.editor.tools_enabled_count_suffix').trim()}</span>
                      </span>
                    </div>
                  </div>

                  {/* 按类别分组的工具列表 */}
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {Object.entries(groupedTools).map(([category, tools]) => (
                      <div key={category}>
                        {(() => {
                          const s = TOOL_CATEGORY_STYLE[category] || { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: category };
                          return (
                            <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                              <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
                              <span className="text-[10px] text-muted-foreground/40">{tools.length}</span>
                            </div>
                          );
                        })()}
                        <div className="space-y-2 pl-2">
                          {tools.map((tool: any) => {
                            const toolConfig = (config.tools || []).find((t: any) => t.name === tool.name);
                            const isEnabled = toolConfig ? toolConfig.enabled !== false : false;

                            const cat = tool.category || 'other';
                            const style = TOOL_CATEGORY_STYLE[cat] || { bg: 'bg-card', border: 'border-border' };
                            return (
                              <div
                                key={tool.name}
                                className={`p-2.5 rounded-lg border ${style.bg} ${style.border} mb-1.5`}
                              >
                                <label className={`flex items-start gap-3 ${canEdit('tools') ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                                  <input
                                    type="checkbox"
                                    checked={isEnabled}
                                    onChange={() => toggleTool(tool.name)}
                                    disabled={!canEdit('tools')}
                                    className="mt-0.5 rounded disabled:opacity-50"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-foreground">{tool.name}</div>
                                    {tool.description && (
                                      <div className="text-xs text-muted-foreground/50 mt-0.5">{tool.description}</div>
                                    )}
                                    {/* 自定义描述（可选） */}
                                    {isEnabled && toolConfig?.description && (
                                      <div className="text-xs text-primary mt-1">
                                        {t('agent.editor.tools_custom_desc', { desc: toolConfig.description })}
                                      </div>
                                    )}
                                    {/* 媒体工具：提示使用全局配置（生图/生视频无需配置） */}
                                    {isEnabled && MEDIA_TOOL_NAMES.has(tool.name) && tool.name !== 'generate_image' && tool.name !== 'generate_video' && (
                                      <div className="mt-2 p-2 bg-accent/5 rounded border border-border/50 space-y-2">
                                        <p className="text-xs text-muted-foreground">
                                          API 凭证使用全局配置，在设置 → 模型配置中统一管理
                                        </p>
                                        {tool.name === 'generate_image' && (
                                          <div className="grid grid-cols-2 gap-2">
                                            <div>
                                              <label className="text-xs text-muted-foreground">默认分辨率</label>
                                              <select
                                                value={(toolConfig?.config as any)?.defaultSize || '2K'}
                                                onChange={(e) => updateToolConfig(tool.name, 'defaultSize', e.target.value)}
                                                className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
                                              >
                                                <option value="1K">1K (1024²)</option>
                                                <option value="2K">2K (2048²)</option>
                                                <option value="4K">4K (4096²)</option>
                                              </select>
                                            </div>
                                            <div className="flex items-end pb-0.5">
                                              <label className="flex items-center gap-1 cursor-pointer">
                                                <input
                                                  type="checkbox"
                                                  checked={(toolConfig?.config as any)?.watermark === true}
                                                  onChange={(e) => updateToolConfig(tool.name, 'watermark', e.target.checked)}
                                                  className="rounded"
                                                />
                                                <span className="text-xs text-muted-foreground">水印</span>
                                              </label>
                                            </div>
                                          </div>
                                        )}
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
                    <p className="text-sm text-muted-foreground/50 text-center py-4">
                      {t('agent.editor.tools_no_match')}
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
            t('agent.editor.advanced_settings'),
            <Settings size={18} className="text-purple-400" />,
            <>
              <div className="grid grid-cols-2 gap-4">
                {/* 执行模式 */}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('agent.editor.field.exec_mode')}</label>
                  <select
                    value={config.execution?.mode || 'react'}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, mode: e.target.value },
                    })}
                    disabled={!canEdit('execution.mode')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="react">{t('agent.editor.execution_mode_react')}</option>
                    <option value="plan">{t('agent.editor.execution_mode_plan')}</option>
                    <option value="chain">{t('agent.editor.execution_mode_chain')}</option>
                  </select>
                </div>

                {/* 最大迭代次数 */}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('agent.editor.field.max_iterations_full')}</label>
                  <input
                    type="number"
                    value={Number.isFinite(config.execution?.maxIterations) ? config.execution.maxIterations : ''}
                    placeholder="∞ 无限"
                    onChange={(e) => { const v = e.target.value; setConfig({ ...config, execution: { ...config.execution, maxIterations: v === '' ? Infinity : parseInt(v) } }); }}
                    disabled={!canEdit('execution.maxIterations')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* 超时时间 */}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('agent.editor.field.timeout')}</label>
                  <input
                    type="number"
                    value={config.execution?.timeout || 300000}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, timeout: parseInt(e.target.value) },
                    })}
                    disabled={!canEdit('execution.timeout')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
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
                    disabled={!canEdit('execution.streaming')}
                    className="rounded disabled:opacity-50"
                  />
                  <span className="text-sm">{t('agent.editor.field.streaming')}</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.execution?.parallelTools !== false}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, parallelTools: e.target.checked },
                    })}
                    disabled={!canEdit('execution.parallelTools')}
                    className="rounded disabled:opacity-50"
                  />
                  <span className="text-sm">{t('agent.editor.field.parallel_tools')}</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.execution?.retryOnError === true}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: { ...config.execution, retryOnError: e.target.checked },
                    })}
                    disabled={!canEdit('execution.retryOnError')}
                    className="rounded disabled:opacity-50"
                  />
                  <span className="text-sm">{t('agent.editor.field.retry_on_error')}</span>
                </label>
              </div>
            </>
          )}

          {/* 权限配置 */}
          {category !== 'system' && renderSection(
            'permissions',
            t('agent.editor.field.file_read') + '/' + t('agent.editor.field.file_write') + '权限',
            <AlertCircle size={18} className="text-orange-500" />,
            <>
              <div className="mb-3 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                <p className="text-xs text-orange-400">
                  {t('agent.editor.perm_hint')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* 文件读取权限 */}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('agent.editor.field.file_read')}</label>
                  <select
                    value={config.permissions?.fileRead || 'always'}
                    onChange={(e) => setConfig({
                      ...config,
                      permissions: { ...config.permissions, fileRead: e.target.value },
                    })}
                    disabled={!canEdit('permissions.fileRead')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="always">{t('agent.editor.perm_always')}</option>
                    <option value="ask">{t('agent.editor.perm_ask')}</option>
                    <option value="deny">{t('agent.editor.perm_deny')}</option>
                  </select>
                </div>

                {/* 文件写入权限 */}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('agent.editor.field.file_write')}</label>
                  <select
                    value={config.permissions?.fileWrite || 'ask'}
                    onChange={(e) => setConfig({
                      ...config,
                      permissions: { ...config.permissions, fileWrite: e.target.value },
                    })}
                    disabled={!canEdit('permissions.fileWrite')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="always">{t('agent.editor.perm_always')}</option>
                    <option value="ask">{t('agent.editor.perm_ask')}</option>
                    <option value="deny">{t('agent.editor.perm_deny')}</option>
                  </select>
                </div>

                {/* Bash 执行权限 */}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('agent.editor.field.bash_exec')}</label>
                  <select
                    value={config.permissions?.bashExec || 'ask'}
                    onChange={(e) => setConfig({
                      ...config,
                      permissions: { ...config.permissions, bashExec: e.target.value },
                    })}
                    disabled={!canEdit('permissions.bashExec')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="always">{t('agent.editor.perm_always')}</option>
                    <option value="ask">{t('agent.editor.perm_ask')}</option>
                    <option value="deny">{t('agent.editor.perm_deny')}</option>
                  </select>
                </div>

                {/* 网络访问权限 */}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('agent.editor.field.network')}</label>
                  <select
                    value={config.permissions?.network || 'ask'}
                    onChange={(e) => setConfig({
                      ...config,
                      permissions: { ...config.permissions, network: e.target.value },
                    })}
                    disabled={!canEdit('permissions.network')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="always">{t('agent.editor.perm_always')}</option>
                    <option value="ask">{t('agent.editor.perm_ask')}</option>
                    <option value="deny">{t('agent.editor.perm_deny')}</option>
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
