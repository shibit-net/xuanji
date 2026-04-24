// ============================================================
// SystemPromptManager - System Prompt 管理器组件
// ============================================================

import { useState, useEffect } from 'react';
import { FileText, X, RefreshCw, Eye, EyeOff, Edit, Save, ChevronDown, ChevronRight, Layers, Info } from 'lucide-react';
import { useToast } from './Toast';
import CodeEditor from './CodeEditor';

interface SystemPromptManagerProps {
  onClose: () => void;
}

interface PromptComponent {
  id: string;
  name: string;
  layer: string;
  priority: number;
  estimatedTokens: number;
  enabled: boolean;
  scenes?: string[];
  complexity?: string[];
  content: string;
  dynamic?: boolean;
  match?: {
    keywords: string;
    description: string;
  };
}

type LayerType = 'L0' | 'L1' | 'L2' | 'L3' | 'all';
type TabType = 'complexity' | 'prompts' | 'projects';

export default function SystemPromptManager({ onClose }: SystemPromptManagerProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('complexity');
  const [components, setComponents] = useState<PromptComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<LayerType>('all');
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
  const [editingComponent, setEditingComponent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editingKeywords, setEditingKeywords] = useState<string | null>(null);
  const [editKeywordsValue, setEditKeywordsValue] = useState('');
  const [previewPrompt, setPreviewPrompt] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // 任务复杂度配置
  const [defaultComplexity, setDefaultComplexity] = useState<'simple' | 'standard' | 'complex'>('standard');
  const [defaultScene, setDefaultScene] = useState<string>('');
  const [configLoading, setConfigLoading] = useState(false);

  // 项目规则管理
  const [projects, setProjects] = useState<Array<{ path: string; name: string; hasRules: boolean }>>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projectDocs, setProjectDocs] = useState<Array<{ name: string; path: string; relativePath: string }>>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [projectRules, setProjectRules] = useState<string>('');
  const [editingRules, setEditingRules] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // 加载 Prompt 配置
  const loadPromptConfig = async () => {
    try {
      const result = await window.electron.getPromptConfig();
      if (result.success && result.config) {
        setDefaultComplexity(result.config.defaultComplexity || 'standard');
        setDefaultScene(result.config.defaultScene || '');
      }
    } catch (err) {
      console.error('加载 Prompt 配置失败:', err);
    }
  };

  // 保存 Prompt 配置
  const savePromptConfig = async () => {
    setConfigLoading(true);
    try {
      const result = await window.electron.setPromptConfig({
        defaultComplexity,
        defaultScene: defaultScene || undefined,
      });
      if (result.success) {
        toast.success('配置已保存');
      } else {
        toast.error(result.error || '保存失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setConfigLoading(false);
    }
  };

  // 加载 Prompt 组件列表
  const loadComponents = async () => {
    setLoading(true);
    try {
      const result = await window.electron.promptGetComponents();
      if (result.success) {
        setComponents(result.components || []);
      } else {
        toast.error(result.error || '加载失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComponents();
    loadPromptConfig();
  }, []);

  // 当切换到项目 tab 时加载项目列表
  useEffect(() => {
    if (activeTab === 'projects' && projects.length === 0) {
      loadProjectsList();
    }
  }, [activeTab]);

  // 加载项目列表
  const loadProjectsList = async () => {
    console.log('[SystemPromptManager] 开始加载项目列表');
    setLoadingProjects(true);
    try {
      const result = await window.electron.projectsList();
      console.log('[SystemPromptManager] 项目列表结果:', result);
      if (result.success) {
        setProjects(result.projects || []);
        console.log('[SystemPromptManager] 项目列表已设置:', result.projects);
      } else {
        console.error('[SystemPromptManager] 加载项目列表失败:', result.error);
        toast.error(result.error || '加载项目列表失败');
      }
    } catch (err) {
      console.error('[SystemPromptManager] 加载项目列表异常:', err);
      toast.error(err instanceof Error ? err.message : '加载项目列表失败');
    } finally {
      setLoadingProjects(false);
    }
  };

  // 保存项目规则
  const saveProjectRules = async () => {
    if (!selectedProject || !selectedDoc) return;

    try {
      const result = await window.electron.projectsSaveRules({
        projectPath: selectedProject,
        rules: projectRules,
        filePath: selectedDoc,
      });
      if (result.success) {
        toast.success('文档已保存');
        setEditingRules(false);
      } else {
        toast.error(result.error || '保存失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  // 加载项目文档列表
  const loadProjectDocs = async (projectPath: string) => {
    setLoadingDocs(true);
    try {
      const result = await window.electron.projectsGetDocs({ projectPath });
      if (result.success) {
        setProjectDocs(result.docs || []);
        // 如果有文档，自动选择第一个
        if (result.docs && result.docs.length > 0) {
          selectDoc(result.docs[0].path);
        } else {
          setSelectedDoc(null);
          setProjectRules('');
        }
      } else {
        toast.error(result.error || '加载文档列表失败');
        setProjectDocs([]);
        setSelectedDoc(null);
        setProjectRules('');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载文档列表失败');
      setProjectDocs([]);
      setSelectedDoc(null);
      setProjectRules('');
    } finally {
      setLoadingDocs(false);
    }
  };

  // 选择项目
  const selectProject = (projectPath: string) => {
    setSelectedProject(projectPath);
    setSelectedDoc(null);
    setEditingRules(false);
    loadProjectDocs(projectPath);
  };

  // 选择文档
  const selectDoc = async (docPath: string) => {
    setSelectedDoc(docPath);
    setEditingRules(false);
    // 读取文档内容
    try {
      const result = await window.electron.projectsReadDoc({ filePath: docPath });
      if (result.success) {
        setProjectRules(result.content || '');
      } else {
        toast.error(result.error || '读取文档失败');
        setProjectRules('');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取文档失败');
      setProjectRules('');
    }
  };

  // 切换组件展开/折叠
  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedComponents);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedComponents(newExpanded);
  };

  // 切换组件启用/禁用
  const toggleEnabled = async (component: PromptComponent) => {
    try {
      const result = await window.electron.promptToggleComponent({
        id: component.id,
        enabled: !component.enabled,
      });
      if (result.success) {
        toast.success(component.enabled ? '已禁用' : '已启用');
        await loadComponents();
      } else {
        toast.error(result.error || '操作失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 开始编辑
  const startEdit = (component: PromptComponent) => {
    setEditingComponent(component.id);
    setEditContent(component.content);
  };

  // 保存编辑
  const saveEdit = async () => {
    if (!editingComponent) return;

    try {
      const result = await window.electron.promptUpdateComponent({
        id: editingComponent,
        content: editContent,
      });
      if (result.success) {
        toast.success('保存成功');
        setEditingComponent(null);
        await loadComponents();
      } else {
        toast.error(result.error || '保存失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  // 开始编辑 keywords
  const startEditKeywords = (component: PromptComponent) => {
    setEditingKeywords(component.id);
    setEditKeywordsValue(component.match?.keywords || '');
  };

  // 保存 keywords
  const saveKeywords = async () => {
    if (!editingKeywords) return;

    try {
      const result = await window.electron.promptUpdateComponent({
        id: editingKeywords,
        keywords: editKeywordsValue,
      });
      if (result.success) {
        toast.success('Keywords 已保存');
        setEditingKeywords(null);
        await loadComponents();
      } else {
        toast.error(result.error || '保存失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  // 预览完整 Prompt
  const handlePreview = async () => {
    try {
      const result = await window.electron.promptPreview({
        scene: 'coding',
        complexity: 'standard',
      });
      if (result.success) {
        setPreviewPrompt(result.prompt || '');
        setShowPreview(true);
      } else {
        toast.error(result.error || '预览失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '预览失败');
    }
  };

  // 过滤组件
  const filteredComponents = components.filter(comp => {
    if (selectedLayer === 'all') return true;
    return comp.layer === selectedLayer;
  });

  // 按层级分组
  const groupedComponents = filteredComponents.reduce((acc, comp) => {
    const layer = comp.layer || 'Unknown';
    if (!acc[layer]) acc[layer] = [];
    acc[layer].push(comp);
    return acc;
  }, {} as Record<string, PromptComponent[]>);

  // 排序层级
  const sortedLayers = Object.keys(groupedComponents).sort((a, b) => {
    const order = ['L0', 'L1', 'L2', 'L3'];
    return order.indexOf(a) - order.indexOf(b);
  });

  // 计算总 token 数
  const totalTokens = components
    .filter(c => c.enabled)
    .reduce((sum, c) => sum + c.estimatedTokens, 0);

  // 层级说明
  const layerInfo: Record<string, { title: string; description: string; loadRule: string; color: string }> = {
    L0: {
      title: 'L0 - 全局基础层',
      description: '系统身份、核心原则、响应风格',
      loadRule: '始终加载（所有 Agent）',
      color: 'text-red-400',
    },
    L1: {
      title: 'L1 - 场景指导层',
      description: '场景化的思维框架和工作流程（explore, plan, write-code, debug, test, refactor, review, deploy, monitor, requirement, user-research, product-plan, interaction, ui-design, design-system）',
      loadRule: '根据场景动态加载',
      color: 'text-blue-400',
    },
    L2: {
      title: 'L2 - 复杂任务层',
      description: 'Agent 协作规则、规划策略、团队协调',
      loadRule: '复杂任务时加载',
      color: 'text-purple-400',
    },
    L3: {
      title: 'L3 - 项目上下文层',
      description: '项目元数据、代码结构、依赖关系（动态生成）',
      loadRule: '项目环境时自动加载',
      color: 'text-green-400',
    },
  };

  // 渲染 Prompt 管理 Tab
  const renderPromptsTab = () => (
    <div className="flex flex-1 overflow-hidden">
      {/* 左侧：层级筛选 */}
      <div className="w-64 border-r border-bg-tertiary flex flex-col overflow-hidden">
        {/* 层级筛选 - 排除 L3 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <h3 className="text-xs font-medium text-text-secondary mb-2 px-2">层级筛选</h3>
          {(['all', 'L0', 'L1', 'L2'] as LayerType[]).map(layer => {
            const count = layer === 'all'
              ? components.filter(c => c.layer !== 'L3').length
              : components.filter(c => c.layer === layer).length;

            return (
              <button
                key={layer}
                onClick={() => setSelectedLayer(layer)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  selectedLayer === layer
                    ? 'bg-primary/20 text-primary border-l-2 border-primary'
                    : 'hover:bg-bg-tertiary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{layer === 'all' ? '全部' : layer}</span>
                  <span className="text-xs text-text-secondary">{count}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧：组件列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <RefreshCw size={32} className="animate-spin text-primary mx-auto mb-2" />
              <p className="text-sm text-text-secondary">加载中...</p>
            </div>
          </div>
        ) : filteredComponents.filter(c => c.layer !== 'L3').length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-text-secondary">
              <Layers size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">暂无组件</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedLayers.filter(layer => layer !== 'L3').map(layer => {
              if (!groupedComponents[layer]) return null;
              const info = layerInfo[layer];
              return (
                <div key={layer}>
                  <div className="mb-3 bg-bg-secondary rounded-lg p-3 border border-bg-tertiary">
                    <div className="flex items-center gap-2 mb-1">
                      <Layers size={16} className={info?.color || 'text-text-secondary'} />
                      <h3 className={`text-sm font-medium ${info?.color || 'text-text-secondary'}`}>
                        {info?.title || layer}
                      </h3>
                      <span className="text-xs text-text-secondary">
                        ({groupedComponents[layer].length} 个组件)
                      </span>
                    </div>
                    {info && (
                      <div className="ml-6 space-y-1">
                        <p className="text-xs text-text-secondary">{info.description}</p>
                        <p className="text-xs text-primary">📋 {info.loadRule}</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                  {groupedComponents[layer]
                    .sort((a, b) => b.priority - a.priority)
                    .map(component => {
                      const isExpanded = expandedComponents.has(component.id);
                      const isEditing = editingComponent === component.id;

                      return (
                        <div
                          key={component.id}
                          className="bg-bg-secondary rounded-lg border border-bg-tertiary overflow-hidden"
                        >
                          {/* 组件头部 */}
                          <div className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <button
                                    onClick={() => toggleExpand(component.id)}
                                    className="p-0.5 hover:bg-bg-tertiary rounded"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={16} />
                                    ) : (
                                      <ChevronRight size={16} />
                                    )}
                                  </button>
                                  <h4 className="font-medium">{component.name}</h4>
                                  {component.dynamic && (
                                    <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                                      动态
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-text-secondary ml-6">
                                  <span>ID: {component.id}</span>
                                  <span>优先级: {component.priority}</span>
                                  <span>~{component.estimatedTokens} tokens</span>
                                  {component.scenes && component.scenes.length > 0 && (
                                    <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">
                                      场景: {component.scenes.join(', ')}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => toggleEnabled(component)}
                                  className={`p-1.5 rounded transition-colors ${
                                    component.enabled
                                      ? 'text-green-500 hover:bg-green-500/10'
                                      : 'text-gray-500 hover:bg-gray-500/10'
                                  }`}
                                  title={component.enabled ? '禁用' : '启用'}
                                >
                                  {component.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                                </button>
                                {!component.dynamic && (
                                  <button
                                    onClick={() => isEditing ? saveEdit() : startEdit(component)}
                                    className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
                                    title={isEditing ? '保存' : '编辑'}
                                  >
                                    {isEditing ? <Save size={16} /> : <Edit size={16} />}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 组件内容 */}
                          {isExpanded && (
                            <div className="border-t border-bg-tertiary p-3 space-y-3">
                              {/* L1 组件显示 keywords 编辑区域 */}
                              {component.layer === 'L1' && component.match && (
                                <div className="bg-bg-primary rounded-lg p-3 border border-bg-tertiary">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <Info size={14} className="text-primary" />
                                      <h5 className="text-sm font-medium">场景匹配关键词</h5>
                                    </div>
                                    {editingKeywords !== component.id && (
                                      <button
                                        onClick={() => startEditKeywords(component)}
                                        className="p-1 hover:bg-bg-tertiary rounded transition-colors"
                                        title="编辑关键词"
                                      >
                                        <Edit size={14} />
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-xs text-text-tertiary mb-2">
                                    用于快速匹配用户输入的场景。支持正则表达式（不区分大小写）。
                                  </p>
                                  {editingKeywords === component.id ? (
                                    <div className="space-y-2">
                                      <input
                                        type="text"
                                        value={editKeywordsValue}
                                        onChange={(e) => setEditKeywordsValue(e.target.value)}
                                        className="w-full bg-bg-secondary border border-bg-tertiary rounded px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-primary"
                                        placeholder="例如: 写|实现|添加|修改|删除"
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          onClick={saveKeywords}
                                          className="px-3 py-1.5 bg-primary text-white rounded text-sm hover:bg-primary/80 transition-colors"
                                        >
                                          保存
                                        </button>
                                        <button
                                          onClick={() => setEditingKeywords(null)}
                                          className="px-3 py-1.5 bg-bg-tertiary rounded text-sm hover:bg-bg-secondary transition-colors"
                                        >
                                          取消
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="bg-bg-secondary rounded p-2">
                                      <code className="text-xs font-mono text-green-400">
                                        {component.match.keywords || '(未设置)'}
                                      </code>
                                    </div>
                                  )}
                                  {component.match.description && (
                                    <div className="mt-2 text-xs text-text-secondary">
                                      <span className="font-medium">场景描述：</span>
                                      {component.match.description}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Prompt 内容 */}
                              <div>
                                <h5 className="text-sm font-medium mb-2">Prompt 内容</h5>
                                {isEditing ? (
                                  <CodeEditor
                                    value={editContent}
                                    onChange={setEditContent}
                                    language="markdown"
                                    height="400px"
                                  />
                                ) : (
                                  <pre className="text-xs font-mono whitespace-pre-wrap bg-black/20 p-3 rounded max-h-64 overflow-auto">
                                    {component.content}
                                  </pre>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // 渲染任务复杂度管理 Tab
  const renderComplexityTab = () => (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* 标题 */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-2">任务复杂度配置</h3>
            <p className="text-sm text-text-secondary">
              配置默认的任务复杂度和场景，影响 Prompt 组件的加载策略
            </p>
          </div>

          {/* 复杂度说明 */}
          <div className="mb-6 bg-bg-secondary rounded-lg p-4 border border-bg-tertiary">
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Info size={16} className="text-primary" />
              复杂度级别说明
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-bg-primary rounded p-3">
                <div className="font-medium text-green-400 mb-2">Simple (~600 tokens)</div>
                <div className="text-xs text-text-secondary mb-2">加载层级: L0 + L3</div>
                <div className="text-xs text-text-tertiary">
                  适用场景：简单问答、信息查询、基础操作
                </div>
              </div>
              <div className="bg-bg-primary rounded p-3">
                <div className="font-medium text-blue-400 mb-2">Standard (~1400 tokens)</div>
                <div className="text-xs text-text-secondary mb-2">加载层级: L0 + L1 + L3</div>
                <div className="text-xs text-text-tertiary">
                  适用场景：编码、调试、文件修改、常规开发任务
                </div>
              </div>
              <div className="bg-bg-primary rounded p-3">
                <div className="font-medium text-purple-400 mb-2">Complex (~2400 tokens)</div>
                <div className="text-xs text-text-secondary mb-2">加载层级: L0 + L1 + L2 + L3</div>
                <div className="text-xs text-text-tertiary">
                  适用场景：架构设计、大规模重构、多文件协同、复杂问题
                </div>
              </div>
            </div>
          </div>

          {/* 配置表单 */}
          <div className="bg-bg-secondary rounded-lg p-6 border border-bg-tertiary">
            <div className="space-y-6">
              {/* 默认复杂度 */}
              <div>
                <label className="block text-sm font-medium mb-2">默认任务复杂度</label>
                <select
                  value={defaultComplexity}
                  onChange={(e) => setDefaultComplexity(e.target.value as any)}
                  className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
                >
                  <option value="simple">Simple - 简单任务</option>
                  <option value="standard">Standard - 标准任务（推荐）</option>
                  <option value="complex">Complex - 复杂任务</option>
                </select>
                <p className="text-xs text-text-tertiary mt-2">
                  设置新对话的默认复杂度级别，影响加载的 Prompt 组件数量
                </p>
              </div>

              {/* 默认场景 */}
              <div>
                <label className="block text-sm font-medium mb-2">默认场景（可选）</label>
                <input
                  type="text"
                  value={defaultScene}
                  onChange={(e) => setDefaultScene(e.target.value)}
                  placeholder="留空则自动分析场景"
                  className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary"
                />
                <p className="text-xs text-text-tertiary mt-2">
                  指定默认场景（如 coding, life），留空则根据对话内容自动识别
                </p>
              </div>

              {/* 保存按钮 */}
              <div className="flex justify-end pt-4 border-t border-bg-tertiary">
                <button
                  onClick={savePromptConfig}
                  disabled={configLoading}
                  className="px-6 py-2 bg-primary/20 text-primary rounded hover:bg-primary/30 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <Save size={16} />
                  {configLoading ? '保存中...' : '保存配置'}
                </button>
              </div>
            </div>
          </div>

          {/* 提示信息 */}
          <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="flex gap-3">
              <Info size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-400">
                <p className="font-medium mb-1">配置说明</p>
                <ul className="text-xs space-y-1 text-blue-300">
                  <li>• 复杂度配置会影响每次对话加载的 Prompt 组件数量和 token 消耗</li>
                  <li>• 建议根据实际任务类型选择合适的复杂度，避免不必要的 token 浪费</li>
                  <li>• 场景配置可以让 Agent 更好地理解任务上下文，提供更精准的响应</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染项目规则管理 Tab
  const renderProjectsTab = () => {
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：项目列表 */}
        <div className="w-56 border-r border-bg-tertiary flex flex-col overflow-hidden">
          <div className="p-3 border-b border-bg-tertiary bg-bg-secondary">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-text-secondary">项目列表</h3>
              <button
                onClick={loadProjectsList}
                disabled={loadingProjects}
                className="p-1 hover:bg-bg-tertiary rounded transition-colors disabled:opacity-50"
                title="刷新"
              >
                <RefreshCw size={14} className={loadingProjects ? 'animate-spin' : ''} />
              </button>
            </div>
            <p className="text-xs text-text-tertiary">
              所有 xuanji 操作过的项目
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loadingProjects ? (
              <div className="text-center py-4">
                <RefreshCw size={20} className="animate-spin text-primary mx-auto" />
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-4 text-xs text-text-secondary">
                暂无项目
              </div>
            ) : (
              <div className="space-y-1">
                {projects.map(project => (
                  <button
                    key={project.path}
                    onClick={() => selectProject(project.path)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      selectedProject === project.path
                        ? 'bg-primary/20 text-primary border-l-2 border-primary'
                        : 'hover:bg-bg-tertiary'
                    }`}
                  >
                    <div className="font-medium truncate">{project.name}</div>
                    <div className="text-xs text-text-secondary truncate">{project.path}</div>
                    {project.hasRules && (
                      <div className="text-xs text-green-400 mt-1">✓ 有规则文件</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 中间：文档列表 */}
        {selectedProject && (
          <div className="w-56 border-r border-bg-tertiary flex flex-col overflow-hidden">
            <div className="p-3 border-b border-bg-tertiary bg-bg-secondary">
              <h3 className="text-xs font-medium text-text-secondary mb-2">文档列表</h3>
              <p className="text-xs text-text-tertiary">
                项目相关文档
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loadingDocs ? (
                <div className="text-center py-4">
                  <RefreshCw size={20} className="animate-spin text-primary mx-auto" />
                </div>
              ) : projectDocs.length === 0 ? (
                <div className="text-center py-4 text-xs text-text-secondary">
                  暂无文档
                </div>
              ) : (
                <div className="space-y-1">
                  {projectDocs.map(doc => (
                    <button
                      key={doc.path}
                      onClick={() => selectDoc(doc.path)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        selectedDoc === doc.path
                          ? 'bg-primary/20 text-primary border-l-2 border-primary'
                          : 'hover:bg-bg-tertiary'
                      }`}
                    >
                      <div className="font-medium truncate">{doc.name}</div>
                      <div className="text-xs text-text-secondary truncate">{doc.relativePath}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 右侧：文档编辑器 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedDoc ? (
            <>
              <div className="p-3 border-b border-bg-tertiary bg-bg-secondary flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">
                    {projectDocs.find(d => d.path === selectedDoc)?.name || '文档'}
                  </h3>
                  <p className="text-xs text-text-secondary mt-1">
                    {projectDocs.find(d => d.path === selectedDoc)?.relativePath}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {editingRules ? (
                    <>
                      <button
                        onClick={() => setEditingRules(false)}
                        className="px-3 py-1.5 bg-bg-tertiary text-text-primary rounded hover:bg-bg-tertiary/80 transition-colors text-sm"
                      >
                        取消
                      </button>
                      <button
                        onClick={saveProjectRules}
                        className="px-3 py-1.5 bg-primary/20 text-primary rounded hover:bg-primary/30 transition-colors text-sm flex items-center gap-2"
                      >
                        <Save size={14} />
                        保存
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setEditingRules(true)}
                      className="px-3 py-1.5 bg-primary/20 text-primary rounded hover:bg-primary/30 transition-colors text-sm flex items-center gap-2"
                    >
                      <Edit size={14} />
                      编辑
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-hidden p-4">
                {editingRules ? (
                  <CodeEditor
                    value={projectRules}
                    onChange={setProjectRules}
                    language="markdown"
                    height="100%"
                  />
                ) : (
                  <pre className="text-sm font-mono whitespace-pre-wrap bg-bg-secondary p-4 rounded h-full overflow-auto">
                    {projectRules || '暂无内容'}
                  </pre>
                )}
              </div>
            </>
          ) : selectedProject ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-text-secondary">
                <FileText size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">请从左侧选择一个文档</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-text-secondary">
                <FileText size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">请从左侧选择一个项目</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg-primary overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-primary" />
          <div>
            <h2 className="text-lg font-bold">System Prompt 管理</h2>
            <p className="text-xs text-text-secondary">
              管理分层 Prompt 组件 · 总计 {components.length} 个组件 · ~{totalTokens} tokens
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'prompts' && (
            <button
              onClick={handlePreview}
              className="px-3 py-1.5 bg-primary/20 text-primary rounded hover:bg-primary/30 transition-colors text-sm flex items-center gap-2"
            >
              <Eye size={16} />
              预览完整 Prompt
            </button>
          )}
          <button
            onClick={loadComponents}
            disabled={loading}
            className="p-1.5 hover:bg-bg-tertiary rounded transition-colors disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-bg-tertiary bg-bg-secondary">
        <button
          onClick={() => setActiveTab('complexity')}
          className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'complexity'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          任务复杂度
        </button>
        <button
          onClick={() => setActiveTab('prompts')}
          className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'prompts'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          System Prompt
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'projects'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          项目相关
        </button>
      </div>

      {/* Tab 内容 */}
      {activeTab === 'complexity' && renderComplexityTab()}
      {activeTab === 'prompts' && renderPromptsTab()}
      {activeTab === 'projects' && renderProjectsTab()}

      {/* 预览对话框 */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-secondary rounded-lg shadow-xl w-[90%] h-[90%] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
              <h3 className="font-medium">完整 System Prompt 预览</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <CodeEditor
                value={previewPrompt}
                onChange={() => {}}
                language="markdown"
                height="calc(90vh - 120px)"
                readOnly
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
