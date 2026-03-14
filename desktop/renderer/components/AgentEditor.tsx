// ============================================================
// AgentEditor - Agent 编辑器组件（完整版）
// ============================================================

import { useState, useMemo } from 'react';
import { Save, X, FileCode, Settings, Zap, Shield, Database, ChevronDown, ChevronRight, Plus, Trash2, AlertCircle } from 'lucide-react';
import { useToast } from './Toast';

interface AgentEditorProps {
  agent: any | null;
  builtinAgents: any[];
  onSave: (config: any) => void;
  onCancel: () => void;
}

type EditorMode = 'form' | 'json5';
type ExpandedSections = Set<string>;

// 默认配置模板
const DEFAULT_CONFIG = {
  id: '',
  name: '',
  description: '',
  version: '1.0.0',
  enabled: true,
  tags: [],
  capabilities: [],

  systemPrompt: `你是一个 AI 助手。

## 核心职责
- 描述你的主要职责

## 工作原则
- 描述工作原则
`,

  model: {
    primary: 'claude-3-5-sonnet-20241022',
    temperature: 0.7,
  },

  tools: [
    { name: 'read', enabled: true },
    { name: 'write', enabled: true },
  ],

  skills: {
    builtin: [],
    custom: [],
  },

  execution: {
    maxSteps: 20,
    timeout: 300000,
    retryOnError: false,
  },

  permissions: {
    allowedTools: ['read', 'write'],
    allowedPaths: ['**/*'],
    deniedPaths: ['node_modules/**', '.git/**'],
  },
};

// 可用的内置 Skills（8 个 prompt 类 + 2 个 workflow 类）
const BUILTIN_SKILLS = [
  // Prompt 类
  'xuanji-assistant',
  'project-rules',
  'memory-context',
  'code-assistant',
  'life-secretary',
  'tool-guidance',
  'security-rules',
  'agent-rules',
  // Workflow 类
  'commit',
  'review-pr',
];

// 可用的工具
const AVAILABLE_TOOLS = [
  'read', 'write', 'edit', 'bash', 'grep', 'glob',
  'memory_search', 'memory_store', 'web_search', 'web_fetch',
];

// 模型选项
const MODEL_OPTIONS = [
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
];

export default function AgentEditor({ agent, builtinAgents, onSave, onCancel }: AgentEditorProps) {
  const toast = useToast();
  const [mode, setMode] = useState<EditorMode>('form');
  const [config, setConfig] = useState(agent || DEFAULT_CONFIG);
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>(
    new Set(['basic', 'systemPrompt'])
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  const isCreating = !agent;

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
      'skills',
      'permissions',
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
  const validateConfig = (): boolean => {
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

    // 工具验证
    if (!config.tools || config.tools.length === 0) {
      newErrors.tools = '至少需要配置一个工具';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 保存处理
  const handleSave = () => {
    if (!validateConfig()) {
      toast.error('配置验证失败，请检查错误提示');
      return;
    }

    onSave(config);
  };

  // 添加工具
  const handleAddTool = () => {
    setConfig({
      ...config,
      tools: [...(config.tools || []), { name: '', enabled: true }],
    });
  };

  // 删除工具
  const handleRemoveTool = (index: number) => {
    const newTools = [...config.tools];
    newTools.splice(index, 1);
    setConfig({ ...config, tools: newTools });
  };

  // 更新工具
  const handleUpdateTool = (index: number, field: string, value: any) => {
    const newTools = [...config.tools];
    newTools[index] = { ...newTools[index], [field]: value };
    setConfig({ ...config, tools: newTools });
  };

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

    return (
      <div>
        <label className="block text-sm font-medium mb-1">
          {label}
          {error && <span className="text-red-400 ml-2 text-xs">⚠️ {error}</span>}
        </label>
        {type === 'textarea' ? (
          <textarea
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            rows={field === 'systemPrompt' ? 12 : 3}
            className={`w-full bg-bg-primary border ${error ? 'border-red-500' : 'border-bg-tertiary'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono`}
          />
        ) : type === 'select' ? (
          <select
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            className={`w-full bg-bg-primary border ${error ? 'border-red-500' : 'border-bg-tertiary'} rounded px-3 py-2 text-sm focus:outline-none focus:border-primary`}
          >
            {options?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
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
            配置 Agent 的行为、工具和权限
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
            <textarea
              value={json5Preview}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  setConfig(parsed);
                  setErrors({});
                } catch (err) {
                  // 解析错误，保持不变
                }
              }}
              className="w-full bg-black/20 p-4 rounded text-sm font-mono h-[600px] focus:outline-none focus:ring-2 focus:ring-primary"
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
              <div>
                <label className="block text-sm font-medium mb-1">标签（逗号分隔）</label>
                <input
                  type="text"
                  value={config.tags?.join(', ') || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="商务, 餐饮, 会议"
                  className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">能力描述</label>
                {(config.capabilities || []).map((cap: string, index: number) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={cap}
                      onChange={(e) => {
                        const newCapabilities = [...config.capabilities];
                        newCapabilities[index] = e.target.value;
                        setConfig({ ...config, capabilities: newCapabilities });
                      }}
                      placeholder="能力描述"
                      className="flex-1 bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => handleRemoveCapability(index)}
                      className="p-2 text-red-400 hover:bg-red-500/10 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={handleAddCapability}
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  <Plus size={14} />
                  添加能力
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={config.enabled !== false}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="enabled" className="text-sm">启用此 Agent</label>
              </div>
            </>
          )}

          {/* 系统提示词 */}
          {renderSection(
            'systemPrompt',
            '系统提示词',
            <FileCode size={18} className="text-green-500" />,
            <>
              {renderFormField('系统提示词 *', 'systemPrompt', 'textarea')}
              <p className="text-xs text-text-secondary">
                定义 Agent 的角色、职责和行为准则。支持 Markdown 格式。
              </p>
            </>
          )}

          {/* 模型配置 */}
          {renderSection(
            'model',
            '模型配置',
            <Zap size={18} className="text-yellow-500" />,
            <div className="grid grid-cols-2 gap-4">
              {renderFormField('主模型', 'model.primary', 'select', MODEL_OPTIONS)}
              {renderFormField('温度 (0-1)', 'model.temperature', 'number')}
            </div>
          )}

          {/* 工具配置 */}
          {renderSection(
            'tools',
            '工具配置',
            <Database size={18} className="text-blue-500" />,
            <>
              <div className="space-y-2">
                {(config.tools || []).map((tool: any, index: number) => (
                  <div key={index} className="flex gap-2 items-center">
                    <select
                      value={tool.name}
                      onChange={(e) => handleUpdateTool(index, 'name', e.target.value)}
                      className="flex-1 bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="">选择工具</option>
                      {AVAILABLE_TOOLS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={tool.enabled !== false}
                        onChange={(e) => handleUpdateTool(index, 'enabled', e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm">启用</span>
                    </label>
                    <button
                      onClick={() => handleRemoveTool(index)}
                      className="p-2 text-red-400 hover:bg-red-500/10 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={handleAddTool}
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                <Plus size={14} />
                添加工具
              </button>
              {errors.tools && (
                <p className="text-xs text-red-400">⚠️ {errors.tools}</p>
              )}
            </>
          )}

          {/* Skills 配置 */}
          {renderSection(
            'skills',
            'Skills 配置',
            <Zap size={18} className="text-purple-500" />,
            <>
              <div>
                <label className="block text-sm font-medium mb-2">内置 Skills</label>
                <div className="space-y-2">
                  {BUILTIN_SKILLS.map((skill) => (
                    <label key={skill} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(config.skills?.builtin || []).includes(skill)}
                        onChange={(e) => {
                          const builtin = config.skills?.builtin || [];
                          setConfig({
                            ...config,
                            skills: {
                              ...config.skills,
                              builtin: e.target.checked
                                ? [...builtin, skill]
                                : builtin.filter((s: string) => s !== skill),
                            },
                          });
                        }}
                        className="rounded"
                      />
                      <span className="text-sm">{skill}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 权限配置 */}
          {renderSection(
            'permissions',
            '权限配置',
            <Shield size={18} className="text-red-500" />,
            <>
              <div>
                <label className="block text-sm font-medium mb-1">允许的路径（每行一个）</label>
                <textarea
                  value={(config.permissions?.allowedPaths || []).join('\n')}
                  onChange={(e) => setConfig({
                    ...config,
                    permissions: {
                      ...config.permissions,
                      allowedPaths: e.target.value.split('\n').filter(Boolean),
                    },
                  })}
                  rows={3}
                  placeholder="**/*&#10;src/**"
                  className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">禁止的路径（每行一个）</label>
                <textarea
                  value={(config.permissions?.deniedPaths || []).join('\n')}
                  onChange={(e) => setConfig({
                    ...config,
                    permissions: {
                      ...config.permissions,
                      deniedPaths: e.target.value.split('\n').filter(Boolean),
                    },
                  })}
                  rows={3}
                  placeholder="node_modules/**&#10;.git/**"
                  className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>
            </>
          )}

          {/* 执行配置 */}
          {renderSection(
            'execution',
            '执行配置',
            <Settings size={18} className="text-gray-500" />,
            <div className="grid grid-cols-2 gap-4">
              {renderFormField('最大步骤数', 'execution.maxSteps', 'number')}
              {renderFormField('超时时间 (ms)', 'execution.timeout', 'number')}
              <div className="col-span-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.execution?.retryOnError !== false}
                    onChange={(e) => setConfig({
                      ...config,
                      execution: {
                        ...config.execution,
                        retryOnError: e.target.checked,
                      },
                    })}
                    className="rounded"
                  />
                  <span className="text-sm">错误时自动重试</span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
