// ============================================================
// ProjectRulesTab - 项目规则管理 Tab
// ============================================================

import { useState, useEffect } from 'react';
import { FileText, RefreshCw, Save, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '../Toast';
import MilkdownEditor from '../MilkdownEditor';
import { t } from '@/i18n';

export default function ProjectRulesTab() {
  const toast = useToast();

  const [projects, setProjects] = useState<Array<{ path: string; name: string; hasRules: boolean }>>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projectDocs, setProjectDocs] = useState<Array<{ name: string; path: string; relativePath: string }>>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [projectRules, setProjectRules] = useState<string>('');
  const [editingRules, setEditingRules] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);

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

  const loadProjectDocs = async (projectPath: string) => {
    setLoadingDocs(true);
    try {
      const result = await window.electron.projectsGetDocs({ projectPath });
      if (result.success) {
        setProjectDocs(result.docs || []);
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

  const selectProject = (projectPath: string) => {
    setSelectedProject(projectPath);
    setSelectedDoc(null);
    setEditingRules(false);
    loadProjectDocs(projectPath);
  };

  const selectDoc = async (docPath: string) => {
    setSelectedDoc(docPath);
    setEditingRules(false);
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

  const createRulesFile = async () => {
    if (!selectedProject) return;
    try {
      const result = await window.electron.projectsCreateRules({ projectPath: selectedProject });
      if (result.success) {
        toast.success(t('sysprompt.doc_created'));
        loadProjectDocs(selectedProject);
      } else {
        toast.error(result.error || t('sysprompt.doc_create_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sysprompt.doc_create_failed'));
    }
  };

  useEffect(() => {
    loadProjectsList();
  }, []);

  useEffect(() => {
    const onProjectInfo = () => { loadProjectsList(); };
    const onProjectRegistered = () => { loadProjectsList(); };
    window.electron.onProjectInfo(onProjectInfo);
    window.electron.onProjectRegistered(onProjectRegistered);
    return () => {
      window.electron.off('project-info' as any, onProjectInfo);
      window.electron.off('project-registered' as any, onProjectRegistered);
    };
  }, []);

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
              <p className="text-sm">{t('sysprompt.doc_select_hint')}</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <FileText size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">{t('sysprompt.project_select_hint')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
