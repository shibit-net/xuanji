// ============================================================
// SystemPromptManager - System Prompt 管理器组件
// ============================================================

import { useState, useEffect } from 'react';
import { FileText, X, RefreshCw, Eye, EyeOff, Edit, Save, ChevronDown, ChevronRight, Layers, Info, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from './Toast';
import MilkdownEditor from './MilkdownEditor';
import { t } from '@/core/i18n';

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
type TabType = 'prompts' | 'projects';

export default function SystemPromptManager({ onClose }: SystemPromptManagerProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('prompts');
  const [components, setComponents] = useState<PromptComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<LayerType>('all');
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
  const [editingComponent, setEditingComponent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editingKeywords, setEditingKeywords] = useState<string | null>(null);
  const [editKeywordsValue, setEditKeywordsValue] = useState('');
  const [editingScenes, setEditingScenes] = useState<string | null>(null);
  const [editScenesValue, setEditScenesValue] = useState('');
  const [previewPrompt, setPreviewPrompt] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewScene, setPreviewScene] = useState('coding');
  const [previewComplexity, setPreviewComplexity] = useState<'simple' | 'standard' | 'complex'>('standard');

  // 创建 Scene 对话框
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({
    id: '', name: '', priority: 75,
    keywords: '', description: '', content: '',
  });
  const [creating, setCreating] = useState(false);

  // 项目规则管理
  const [projects, setProjects] = useState<Array<{ path: string; name: string; hasRules: boolean }>>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projectDocs, setProjectDocs] = useState<Array<{ name: string; path: string; relativePath: string }>>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [projectRules, setProjectRules] = useState<string>('');
  const [editingRules, setEditingRules] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // 加载 Prompt 组件列表
  const loadComponents = async () => {
    setLoading(true);
    try {
      const result = await window.electron.promptGetComponents();
      if (result.success) {
        setComponents((result.components || []) as any);
      } else {
        toast.error(result.error || t('sysprompt.load_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComponents();
  }, []);

  // 当切换到项目 tab 时加载项目列表
  useEffect(() => {
    if (activeTab === 'projects' && projects.length === 0) {
      loadProjectsList();
    }
  }, [activeTab]);

  // 监听项目切换事件 + 新项目注册事件，自动刷新项目列表
  useEffect(() => {
    window.electron.onProjectInfo((_data) => {
      loadProjectsList();
    });
    window.electron.onProjectRegistered((_data) => {
      loadProjectsList();
    });
  }, []);

  // 加载项目列表
  const loadProjectsList = async () => {
    setLoadingProjects(true);
    try {
      const result = await window.electron.projectsList();
      if (result.success) {
        setProjects(result.projects || []);
      } else {
        console.error('[SystemPromptManager] 加载项目列表失败:', result.error);
        toast.error(result.error || t('sysprompt.project_list_load_failed'));
      }
    } catch (err) {
      console.error('[SystemPromptManager] 加载项目列表异常:', err);
      toast.error(err instanceof Error ? err.message : t('sysprompt.project_list_load_failed'));
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
        toast.success(t('sysprompt.doc_saved'));
        setEditingRules(false);
      } else {
        toast.error(result.error || t('sysprompt.save_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.save_failed'));
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
        toast.error(result.error || t('sysprompt.doc_list_load_failed'));
        setProjectDocs([]);
        setSelectedDoc(null);
        setProjectRules('');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.doc_list_load_failed'));
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
        toast.error(result.error || t('sysprompt.doc_load_failed'));
        setProjectRules('');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.doc_load_failed'));
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
        toast.success(component.enabled ? t('sysprompt.disabled') : t('sysprompt.enabled'));
        await loadComponents();
      } else {
        toast.error(result.error || t('sysprompt.operation_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.operation_failed'));
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
        toast.success(t('sysprompt.save_success'));
        setEditingComponent(null);
        await loadComponents();
      } else {
        toast.error(result.error || t('sysprompt.save_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.save_failed'));
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
        toast.success(t('sysprompt.keywords_saved'));
        setEditingKeywords(null);
        await loadComponents();
      } else {
        toast.error(result.error || t('sysprompt.save_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.save_failed'));
    }
  };

  // 保存 scenes（L2 场景过滤标签）
  const saveScenes = async () => {
    if (!editingScenes) return;
    try {
      const scenes = editScenesValue.split(',').map(s => s.trim()).filter(Boolean);
      const result = await window.electron.promptUpdateComponent({
        id: editingScenes,
        scenes,
      } as any);
      if (result.success) {
        toast.success(t('sysprompt.scenes_saved'));
        setEditingScenes(null);
        await loadComponents();
      } else {
        toast.error(result.error || t('sysprompt.save_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.save_failed'));
    }
  };

  // 删除组件
  const deleteComponent = async (component: PromptComponent) => {
    if (!confirm(t('sysprompt.confirm_delete', { name: component.name }))) return;
    try {
      const result = await window.electron.promptDeleteComponent({ id: component.id });
      if (result.success) {
        toast.success(t('sysprompt.delete_success'));
        await loadComponents();
      } else {
        toast.error(result.error || t('sysprompt.delete_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.delete_failed'));
    }
  };

  // 创建组件
  const createComponent = async () => {
    if (!createForm.id.trim() || !createForm.name.trim()) {
      toast.error(t('sysprompt.scene_id_required'));
      return;
    }
    setCreating(true);
    try {
      const payload: any = {
        id: createForm.id.trim(),
        name: createForm.name.trim(),
        layer: selectedLayer,
        priority: createForm.priority,
        estimatedTokens: Math.max(50, Math.round(createForm.content.length * 0.4)),
        content: createForm.content,
      };
      if (selectedLayer === 'L1') {
        payload.scenes = [createForm.id.trim()];
        payload.match = {
          keywords: createForm.keywords || createForm.name.trim(),
          description: createForm.description || createForm.name.trim(),
        };
      }
      const result = await window.electron.promptCreateComponent(payload);
      if (result.success) {
        toast.success(t('sysprompt.create_success'));
        setShowCreateDialog(false);
        setCreateForm({ id: '', name: '', priority: 75, keywords: '', description: '', content: '' });
        await loadComponents();
      } else {
        toast.error(result.error || t('sysprompt.create_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.create_failed'));
    } finally {
      setCreating(false);
    }
  };

  // 预览完整 Prompt
  const handlePreview = async () => {
    try {
      setPreviewPrompt('');
      setShowPreview(true);
      const result = await window.electron.promptPreview({
        scene: previewScene || undefined,
        complexity: previewComplexity,
      });
      if (result.success) {
        setPreviewPrompt(result.prompt || '');
        setShowPreview(true);
      } else {
        toast.error(result.error || t('sysprompt.preview_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.preview_failed'));
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
      title: t('sysprompt.l0_title'),
      description: t('sysprompt.l0_desc'),
      loadRule: t('sysprompt.l0_load_rule'),
      color: 'text-red-400',
    },
    L1: {
      title: t('sysprompt.l1_title'),
      description: t('sysprompt.l1_desc'),
      loadRule: t('sysprompt.l1_load_rule'),
      color: 'text-blue-400',
    },
    L2: {
      title: t('sysprompt.l2_title'),
      description: t('sysprompt.l2_desc'),
      loadRule: t('sysprompt.l2_load_rule'),
      color: 'text-purple-400',
    },
    L3: {
      title: t('sysprompt.l3_title'),
      description: t('sysprompt.l3_desc'),
      loadRule: t('sysprompt.l3_load_rule'),
      color: 'text-green-400',
    },
  };

  // 可用的 L1 场景列表（供 L2 选择过滤标签）
  const l1Scenes = components
    .filter(c => c.layer === 'L1' && c.scenes)
    .flatMap(c => c.scenes!)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  // 渲染 Prompt 管理 Tab
  const renderPromptsTab = () => (
    <div className="flex flex-1 overflow-hidden">
      {/* 左侧：层级筛选 */}
      <div className="w-64 border-r border-border flex flex-col overflow-hidden">
        {/* 层级筛选 - 排除 L3 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground mb-2 px-2">{t('sysprompt.layer_filter')}</h3>
          {(['all', 'L0', 'L1', 'L2'] as LayerType[]).map(layer => {
            const count = layer === 'all'
              ? components.filter(c => c.layer !== 'L3').length
              : components.filter(c => c.layer === layer).length;

            return (
              <Button
                key={layer}
                variant="ghost"
                onClick={() => setSelectedLayer(layer)}
                className={`w-full text-left px-3 py-2 rounded text-sm h-auto justify-start ${
                  selectedLayer === layer
                    ? 'bg-primary/20 text-primary border-l-2 border-primary'
                    : 'hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span>{layer === 'all' ? t('sysprompt.layer_all') : layer}</span>
                  <span className="text-xs text-muted-foreground">{count}</span>
                </div>
              </Button>
            );
          })}
        </div>
      </div>

      {/* 右侧：组件列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* 创建组件按钮（L1/L2） */}
        {(selectedLayer === 'L1' || selectedLayer === 'L2') && (
          <div className="mb-4">
            <Button
              onClick={() => setShowCreateDialog(true)}
              variant="ghost"
              className="bg-primary/20 text-primary hover:bg-primary/30 flex items-center gap-2 px-4 py-2"
            >
              <Plus size={16} />
              {selectedLayer === 'L1' ? t('sysprompt.create_scene') : t('sysprompt.create_l2')}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <RefreshCw size={32} className="animate-spin text-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t('sysprompt.loading')}</p>
            </div>
          </div>
        ) : filteredComponents.filter(c => c.layer !== 'L3').length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <Layers size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">{t('sysprompt.empty_components')}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedLayers.filter(layer => layer !== 'L3').map(layer => {
              if (!groupedComponents[layer]) return null;
              const info = layerInfo[layer];
              const layerBorderColor: Record<string, string> = {
                L0: 'border-l-red-500/60',
                L1: 'border-l-blue-500/60',
                L2: 'border-l-purple-500/60',
                L3: 'border-l-green-500/60',
              };

              return (
                <div key={layer}>
                  <div className={`mb-3 rounded-lg p-3 border border-border border-l-2 ${layerBorderColor[layer] || 'border-l-primary/60'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Layers size={16} className={info?.color || 'text-muted-foreground'} />
                      <h3 className={`text-sm font-medium ${info?.color || 'text-muted-foreground'}`}>
                        {info?.title || layer}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {t('sysprompt.component_count', { count: groupedComponents[layer].length })}
                      </span>
                    </div>
                    {info && (
                      <div className="ml-6 space-y-1">
                        <p className="text-xs text-muted-foreground">{info.description}</p>
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
                          className={`rounded-lg border border-border border-l-2 ${layerBorderColor[layer] || 'border-l-primary/60'} overflow-hidden hover:border-primary/30 transition-colors`}
                        >
                          {/* 组件头部 */}
                          <div className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Button
                                    onClick={() => toggleExpand(component.id)}
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={16} />
                                    ) : (
                                      <ChevronRight size={16} />
                                    )}
                                  </Button>
                                  <h4 className="font-medium">{component.name}</h4>
                                  {component.dynamic && (
                                    <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                                      {t('sysprompt.badge_dynamic')}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground ml-6">
                                  <span>{t('sysprompt.id_label', { id: component.id })}</span>
                                  <span>{t('sysprompt.priority_label', { val: component.priority })}</span>
                                  <span>{t('sysprompt.tokens_label', { tokens: component.estimatedTokens })}</span>
                                  {component.scenes && component.scenes.length > 0 && (
                                    <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">
                                      {t('sysprompt.scenes_label', { scenes: component.scenes.join(', ') })}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {component.layer !== 'L0' && (
                                  <Button
                                    onClick={() => toggleEnabled(component)}
                                    variant="ghost"
                                    size="icon"
                                    className={`h-7 w-7 ${
                                      component.enabled
                                        ? 'text-green-500 hover:bg-green-500/10'
                                        : 'text-muted-foreground hover:bg-muted'
                                    }`}
                                    title={component.enabled ? t('sysprompt.btn_disable') : t('sysprompt.btn_enable')}
                                  >
                                    {component.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                                  </Button>
                                )}
                                {component.layer !== 'L0' && !component.dynamic && (
                                  <Button
                                    onClick={() => isEditing ? saveEdit() : startEdit(component)}
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title={isEditing ? t('sysprompt.btn_save') : t('sysprompt.btn_edit')}
                                  >
                                    {isEditing ? <Save size={16} /> : <Edit size={16} />}
                                  </Button>
                                )}
                                {component.layer !== 'L0' && (
                                  <Button
                                    onClick={() => deleteComponent(component)}
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-red-400 hover:bg-red-500/10"
                                    title={t('sysprompt.btn_delete')}
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 组件内容 */}
                          {isExpanded && (
                            <div className="border-t border-border p-3 space-y-3">
                              {/* L1 组件显示 keywords 编辑区域 */}
                              {component.layer === 'L1' && component.match && (
                                <div className="bg-background rounded-lg p-3 border border-border">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <Info size={14} className="text-primary" />
                                      <h5 className="text-sm font-medium">{t('sysprompt.scene_match_keywords')}</h5>
                                    </div>
                                    {editingKeywords !== component.id && (
                                      <Button
                                        onClick={() => startEditKeywords(component)}
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        title={t('sysprompt.edit_keywords')}
                                      >
                                        <Edit size={14} />
                                      </Button>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground/70 mb-2">
                                    {t('sysprompt.keywords_hint')}
                                  </p>
                                  {editingKeywords === component.id ? (
                                    <div className="space-y-2">
                                      <input
                                        type="text"
                                        value={editKeywordsValue}
                                        onChange={(e) => setEditKeywordsValue(e.target.value)}
                                        className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary"
                                        placeholder={t('sysprompt.keywords_placeholder')}
                                      />
                                      <div className="flex gap-2">
                                        <Button
                                          onClick={saveKeywords}
                                          variant="default"
                                          size="sm"
                                          className="px-3 py-1.5"
                                        >
                                          {t('sysprompt.keywords_save')}
                                        </Button>
                                        <Button
                                          onClick={() => setEditingKeywords(null)}
                                          variant="secondary"
                                          size="sm"
                                          className="px-3 py-1.5"
                                        >
                                          {t('sysprompt.keywords_cancel')}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="border border-border rounded p-2">
                                      <code className="text-xs font-mono text-green-400">
                                        {typeof component.match.keywords === 'string'
                                          ? component.match.keywords
                                          : component.match.keywords?.source || t('sysprompt.keywords_not_set')}
                                      </code>
                                    </div>
                                  )}
                                  {component.match.description && (
                                    <div className="mt-2 text-xs text-muted-foreground">
                                      <span className="font-medium">{t('sysprompt.scene_desc_label')}</span>
                                      {component.match.description}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* L2 组件显示场景过滤编辑区域 */}
                              {component.layer === 'L2' && (
                                <div className="bg-background rounded-lg p-3 border border-border">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <Info size={14} className="text-primary" />
                                      <h5 className="text-sm font-medium">{t('sysprompt.scene_filter_label')}</h5>
                                    </div>
                                    {editingScenes !== component.id && (
                                      <Button
                                        onClick={() => { setEditingScenes(component.id); setEditScenesValue((component.scenes || []).join(', ')); }}
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        title={t('sysprompt.edit_scene_tags')}
                                      >
                                        <Edit size={14} />
                                      </Button>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground/70 mb-2">
                                    {t('sysprompt.scene_filter_hint')}
                                  </p>
                                  {editingScenes === component.id ? (
                                    <div className="space-y-2">
                                      <div className="max-h-40 overflow-y-auto border border-border rounded p-2 space-y-1">
                                        {l1Scenes.length === 0 ? (
                                          <p className="text-xs text-muted-foreground">{t('sysprompt.no_l1_scenes')}</p>
                                        ) : (
                                          l1Scenes.map(scene => {
                                            const selected = editScenesValue.split(',').map(s => s.trim()).includes(scene);
                                            return (
                                              <label key={scene} className="flex items-center gap-2 cursor-pointer hover:bg-background rounded px-1 py-0.5">
                                                <input
                                                  type="checkbox"
                                                  checked={selected}
                                                  onChange={() => {
                                                    const current = editScenesValue.split(',').map(s => s.trim()).filter(Boolean);
                                                    const next = selected
                                                      ? current.filter(s => s !== scene)
                                                      : [...current, scene];
                                                    setEditScenesValue(next.join(', '));
                                                  }}
                                                  className="rounded"
                                                />
                                                <span className="text-xs">{scene}</span>
                                              </label>
                                            );
                                          })
                                        )}
                                      </div>
                                      <div className="flex gap-2">
                                        <Button onClick={saveScenes} variant="default" size="sm" className="px-3 py-1.5">{t('sysprompt.scene_save')}</Button>
                                        <Button onClick={() => setEditingScenes(null)} variant="secondary" size="sm" className="px-3 py-1.5">{t('sysprompt.scene_cancel')}</Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {component.scenes && component.scenes.length > 0 ? (
                                        component.scenes.map(s => (
                                          <span key={s} className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">{s}</span>
                                        ))
                                      ) : (
                                        <span className="text-xs text-muted-foreground">{t('sysprompt.all_scenes')}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Prompt 内容 */}
                              <div>
                                <h5 className="text-sm font-medium mb-2">{t('sysprompt.prompt_content')}</h5>
                                {isEditing ? (
                                  <textarea
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    className="w-full bg-background border border-border rounded p-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary resize-y"
                                    rows={16}
                                    style={{ minHeight: '300px' }}
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

  // 渲染项目规则管理 Tab
  const renderProjectsTab = () => {
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：项目列表 */}
        <div className="w-56 border-r border-border flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-muted-foreground">{t('sysprompt.project_list')}</h3>
              <Button
                onClick={loadProjectsList}
                disabled={loadingProjects}
                variant="ghost"
                size="icon"
                className="h-7 w-7 disabled:opacity-50"
                title={t('sysprompt.refresh_btn')}
              >
                <RefreshCw size={14} className={loadingProjects ? 'animate-spin' : ''} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground/70">
              {t('sysprompt.project_hint')}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loadingProjects ? (
              <div className="text-center py-4">
                <RefreshCw size={20} className="animate-spin text-primary mx-auto" />
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground">
                {t('sysprompt.no_projects')}
              </div>
            ) : (
              <div className="space-y-1">
                {projects.map(project => (
                  <Button
                    key={project.path}
                    variant="ghost"
                    onClick={() => selectProject(project.path)}
                    className={`w-full text-left px-3 py-2 rounded text-sm h-auto justify-start ${
                      selectedProject === project.path
                        ? 'bg-primary/20 text-primary border-l-2 border-primary'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div className="font-medium truncate">{project.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{project.path}</div>
                    {project.hasRules && (
                      <div className="text-xs text-green-400 mt-1">{t('sysprompt.has_rules')}</div>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 中间：文档列表 */}
        {selectedProject && (
          <div className="w-56 border-r border-border flex flex-col overflow-hidden">
            <div className="p-3 border-b border-border bg-card">
              <h3 className="text-xs font-medium text-muted-foreground mb-2">{t('sysprompt.doc_list')}</h3>
              <p className="text-xs text-muted-foreground/70">
                {t('sysprompt.doc_hint')}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loadingDocs ? (
                <div className="text-center py-4">
                  <RefreshCw size={20} className="animate-spin text-primary mx-auto" />
                </div>
              ) : projectDocs.length === 0 ? (
                <div className="text-center py-4 text-xs text-muted-foreground">
                  {t('sysprompt.no_docs')}
                </div>
              ) : (
                <div className="space-y-1">
                  {projectDocs.map(doc => (
                    <Button
                      key={doc.path}
                      variant="ghost"
                      onClick={() => selectDoc(doc.path)}
                      className={`w-full text-left px-3 py-2 rounded text-sm h-auto justify-start ${
                        selectedDoc === doc.path
                          ? 'bg-primary/20 text-primary border-l-2 border-primary'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <div className="font-medium truncate">{doc.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{doc.relativePath}</div>
                    </Button>
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
              <div className="p-3 border-b border-border bg-card flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">
                    {projectDocs.find(d => d.path === selectedDoc)?.name || t('sysprompt.prompt_label')}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {projectDocs.find(d => d.path === selectedDoc)?.relativePath}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {editingRules ? (
                    <>
                      <Button
                        onClick={() => setEditingRules(false)}
                        variant="ghost"
                        size="sm"
                      >
                        {t('sysprompt.cancel_btn')}
                      </Button>
                      <Button
                        onClick={saveProjectRules}
                        variant="ghost"
                        size="sm"
                        className="bg-primary/20 text-primary hover:bg-primary/30 flex items-center gap-2"
                      >
                        <Save size={14} />
                        {t('sysprompt.btn_save')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => setEditingRules(true)}
                      variant="ghost"
                      size="sm"
                      className="bg-primary/20 text-primary hover:bg-primary/30 flex items-center gap-2"
                    >
                      <Edit size={14} />
                      {t('sysprompt.edit_btn')}
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-hidden p-4">
                {editingRules ? (
                  <MilkdownEditor
                    value={projectRules}
                    onChange={setProjectRules}
                    mode="wysiwyg"
                    height="100%"
                  />
                ) : (
                  <pre className="text-sm font-mono whitespace-pre-wrap bg-card p-4 rounded h-full overflow-auto">
                    {projectRules || t('sysprompt.no_content')}
                  </pre>
                )}
              </div>
            </>
          ) : selectedProject ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <FileText size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">请从左侧选择一个文档</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
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
    <div className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-primary" />
          <div>
            <h2 className="text-lg font-bold">System Prompt 管理</h2>
            <p className="text-xs text-muted-foreground">
              总计 {components.length} 个组件 · 已启用 {components.filter(c => c.enabled).length} 个 · ~{totalTokens} tokens
              <span className="mx-2">|</span>
              <span className="text-red-400">L0: {components.filter(c => c.layer === 'L0').length}</span>
              {' '}
              <span className="text-blue-400">L1: {components.filter(c => c.layer === 'L1').length}</span>
              {' '}
              <span className="text-purple-400">L2: {components.filter(c => c.layer === 'L2').length}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'prompts' && (
            <Button
              onClick={handlePreview}
              variant="ghost"
              size="sm"
              className="bg-primary/20 text-primary hover:bg-primary/30 flex items-center gap-2"
            >
              <Eye size={16} />
              预览完整 Prompt
            </Button>
          )}
          <Button
            onClick={loadComponents}
            disabled={loading}
            variant="ghost"
            size="icon"
            className="h-7 w-7 disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button
            onClick={onClose}
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="关闭"
          >
            <X size={20} />
          </Button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-border">
        <Button
          onClick={() => setActiveTab('prompts')}
          variant="ghost"
          size="sm"
          className={`px-6 py-3 rounded-none h-auto ${
            activeTab === 'prompts'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          style={{ borderBottomWidth: 2 }}
        >
          System Prompt
        </Button>
        <Button
          onClick={() => setActiveTab('projects')}
          variant="ghost"
          size="sm"
          className={`px-6 py-3 rounded-none h-auto ${
            activeTab === 'projects'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          style={{ borderBottomWidth: 2 }}
        >
          {t('sysprompt.tab_projects')}
        </Button>
      </div>

      {/* Tab 内容 */}
      {activeTab === 'prompts' && renderPromptsTab()}
      {activeTab === 'projects' && renderProjectsTab()}

      {/* 预览对话框 */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-xl w-[90%] h-[90%] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border gap-4">
              <h3 className="font-medium flex-shrink-0">完整 System Prompt 预览</h3>
              <div className="flex items-center gap-3">
                <select value={previewScene}
                  onChange={(e) => setPreviewScene(e.target.value)}
                  className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary">
                  {l1Scenes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={previewComplexity}
                  onChange={(e) => setPreviewComplexity(e.target.value as any)}
                  className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary">
                  <option value="simple">Simple</option>
                  <option value="standard">Standard</option>
                  <option value="complex">Complex</option>
                </select>
                <Button onClick={handlePreview} variant="ghost" size="sm" className="flex items-center gap-1 px-3 py-1.5">
                  <RefreshCw size={14} />
                  重新生成
                </Button>
                <Button onClick={() => setShowPreview(false)} variant="ghost" size="icon" className="h-7 w-7">
                  <X size={20} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {previewPrompt ? (
                <pre className="text-xs font-mono whitespace-pre-wrap bg-black/20 p-4 rounded h-full overflow-auto">
                  {previewPrompt}
                </pre>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw size={24} className="animate-spin text-primary" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 创建组件对话框 */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-xl border border-border w-[680px] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-medium">{selectedLayer === 'L1' ? '创建 Scene 组件' : '创建 L2 组件'}</h3>
              <Button onClick={() => setShowCreateDialog(false)} variant="ghost" size="icon" className="h-7 w-7">
                <X size={20} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Scene ID *</label>
                  <input type="text" value={createForm.id}
                    onChange={(e) => setCreateForm({ ...createForm, id: e.target.value })}
                    placeholder={t('sysprompt.create_placeholder_id')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">名称 *</label>
                  <input type="text" value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder={t('sysprompt.create_placeholder_name')}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">优先级</label>
                  <input type="number" value={createForm.priority}
                    onChange={(e) => setCreateForm({ ...createForm, priority: parseInt(e.target.value) || 75 })}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">预估 Tokens</label>
                  <div className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-muted-foreground">
                    {Math.max(50, Math.round(createForm.content.length * 0.4))}
                  </div>
                  <p className="text-xs text-muted-foreground/60 mt-1">根据内容长度自动计算，约 {Math.round(createForm.content.length * 0.4)} tokens</p>
                </div>
              </div>

              {/* L1 场景匹配配置 */}
              {selectedLayer === 'L1' && (
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium mb-3 text-primary">场景匹配配置</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">匹配关键词（自然语言，空格分隔）</label>
                    <input type="text" value={createForm.keywords}
                      onChange={(e) => setCreateForm({ ...createForm, keywords: e.target.value })}
                      placeholder={t('sysprompt.create_placeholder_keywords')}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">场景描述</label>
                    <input type="text" value={createForm.description}
                      onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                      placeholder={t('sysprompt.create_placeholder_match_desc')}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
                  </div>
                </div>
              </div>
              )}

              {/* Prompt 内容 */}
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium mb-3 text-primary">Prompt 内容</h4>
                <textarea value={createForm.content}
                  onChange={(e) => setCreateForm({ ...createForm, content: e.target.value })}
                  placeholder={t('sysprompt.create_placeholder_content')}
                  rows={12}
                  className="w-full bg-background border border-border rounded p-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary resize-y"
                  style={{ minHeight: '200px' }} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-border">
              <Button onClick={() => setShowCreateDialog(false)} variant="ghost" className="px-4 py-2">取消</Button>
              <Button onClick={createComponent} disabled={creating}
                variant="ghost"
                className="bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 px-4 py-2 flex items-center gap-2">
                <Plus size={16} />
                {creating ? t('sysprompt.creating') : t('sysprompt.create_btn')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
