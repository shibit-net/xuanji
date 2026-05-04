// ============================================================
  // Xuanji Desktop - Preload 脚本
  // ============================================================

  import { contextBridge, ipcRenderer } from 'electron';

  /**
   * 暴露到 window.electron
   */
  contextBridge.exposeInMainWorld('electron', {
    // 应用信息
    getVersion: () => ipcRenderer.invoke('app:version'),

    // 窗口控制
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),

    // ============================================================
  // 认证相关
  // ============================================================
  authLogin: (email: string, password: string) => ipcRenderer.invoke('auth:login', email, password),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authCheck: () => ipcRenderer.invoke('auth:check'),
  authGetSavedAccounts: () => ipcRenderer.invoke('auth:getSavedAccounts'),
  authSwitchAccount: (email: string) => ipcRenderer.invoke('auth:switchAccount', email),
  authRemoveAccount: (email: string) => ipcRenderer.invoke('auth:removeAccount', email),

  // ============================================================
  // 模型管理
  // ============================================================
  modelsListMarketplace: (options?: { vendor?: string, name?: string, routeId?: number, page?: number, size?: number }) =>
    ipcRenderer.invoke('models:list-marketplace', options),
  modelsListAll: () => ipcRenderer.invoke('models:list-all'),
  modelsListVendors: () => ipcRenderer.invoke('models:list-vendors'),
  modelsGetInfo: (id: number, routeId?: number) => ipcRenderer.invoke('models:get-info', id, routeId),
  modelsListUserConfig: () => ipcRenderer.invoke('models:list-user-config'),

  // Agent 操作
  agentInit: () => ipcRenderer.invoke('agent:init'),
  agentSendMessage: (message: string) => ipcRenderer.invoke('agent:send-message', message),
  agentInterrupt: (message?: string) => ipcRenderer.invoke('agent:interrupt', message),
  agentReset: () => ipcRenderer.invoke('agent:reset'),
  agentGetState: () => ipcRenderer.invoke('agent:get-state'),
  agentSendSupplment: (content: string) => ipcRenderer.invoke('agent:send-supplement', content),
  agentAppendMessage: (message: string) => ipcRenderer.invoke('agent:append-message', message),
  analyzeIntent: (prompt: string) => ipcRenderer.invoke('agent:analyze-intent', prompt),

  // 流式事件监听
  onAgentText: (callback: (text: string) => void) => {
    ipcRenderer.on('agent:text', (_event, text) => callback(text));
  },
  onAgentThinking: (callback: (thinking: string) => void) => {
    ipcRenderer.on('agent:thinking', (_event, thinking) => callback(thinking));
  },
  onAgentToolStart: (callback: (data: { id: string; name: string; input: Record<string, unknown> }) => void) => {
    ipcRenderer.on('agent:tool-start', (_event, data) => callback(data));
  },
  onAgentToolEnd: (callback: (data: { id: string; name: string; result: string; isError: boolean }) => void) => {
    ipcRenderer.on('agent:tool-end', (_event, data) => callback(data));
  },
  onAgentFileChanges: (callback: (data: { changes: any[] }) => void) => {
    ipcRenderer.on('agent:file-changes', (_event, data) => callback(data));
  },
  onAgentUsage: (callback: (usage: any) => void) => {
    ipcRenderer.on('agent:usage', (_event, usage) => callback(usage));
  },
  onAgentError: (callback: (error: string) => void) => {
    ipcRenderer.on('agent:error', (_event, error) => callback(error));
  },
  onAgentEnd: (callback: (state: { tokenUsage: any; cost: number; currentIteration: number }) => void) => {
    ipcRenderer.on('agent:end', (_event, state) => callback(state));
  },

  // Workspace 事件监听（MainAgent 执行流程可视化）
  onWorkspaceIntentAnalysisStart: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:intent-analysis-start', (_event, data) => callback(data));
  },
  onWorkspaceIntentAnalysisEnd: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:intent-analysis-end', (_event, data) => callback(data));
  },
  onWorkspaceModelClassifierStart: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:model-classifier-start', (_event, data) => callback(data));
  },
  onWorkspaceModelClassifierEnd: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:model-classifier-end', (_event, data) => callback(data));
  },
  onWorkspaceTaskPlanningStart: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:task-planning-start', (_event, data) => callback(data));
  },
  onWorkspaceTaskPlanningEnd: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:task-planning-end', (_event, data) => callback(data));
  },
  onWorkspaceTaskExecutionStart: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:task-execution-start', (_event, data) => callback(data));
  },
  onWorkspaceTaskExecutionEnd: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:task-execution-end', (_event, data) => callback(data));
  },
  onWorkspaceResultAggregationStart: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:result-aggregation-start', (_event, data) => callback(data));
  },
  onWorkspaceResultAggregationEnd: (callback: (data: any) => void) => {
    ipcRenderer.on('workspace:result-aggregation-end', (_event, data) => callback(data));
  },

  // 移除监听器
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // 设置操作
  settingsGetConfig: () => ipcRenderer.invoke('settings:get-config'),
  settingsGetFullConfig: () => ipcRenderer.invoke('settings:get-full-config'),
  settingsUpdateConfig: (data: any) => ipcRenderer.invoke('settings:update-config', data),

  // ============ 会话管理 ============
  sessionSave: (data: any) => ipcRenderer.invoke('session:save', data),
  sessionResume: (data: any) => ipcRenderer.invoke('session:resume', data),
  sessionList: () => ipcRenderer.invoke('session:list'),
  sessionDelete: (data: any) => ipcRenderer.invoke('session:delete', data),

  // ============ Checkpoint ============
  checkpointCreate: (data: any) => ipcRenderer.invoke('checkpoint:create', data),
  checkpointList: () => ipcRenderer.invoke('checkpoint:list'),
  checkpointRewind: (data: any) => ipcRenderer.invoke('checkpoint:rewind', data),

  // ============ 核心规则管理 ============
  getCoreRules: () => ipcRenderer.invoke('core-rules:get-all'),
  updateCoreRule: (data: { id: string; active?: boolean }) => ipcRenderer.invoke('core-rules:update', data),
  deleteCoreRule: (data: { id: string }) => ipcRenderer.invoke('core-rules:delete', data),

  // ============ 工具统计 ============
  usageStats: () => ipcRenderer.invoke('usage:stats'),

  // ============ Agent 管理 ============
  agentList: () => ipcRenderer.invoke('agent:list'),
  agentGet: (data: { agentId: string }) => ipcRenderer.invoke('agent:get', data),
  agentCreate: (data: { config: any }) => ipcRenderer.invoke('agent:create', data),
  agentUpdate: (data: { agentId: string; config: any }) => ipcRenderer.invoke('agent:update', data),
  agentDelete: (data: { agentId: string }) => ipcRenderer.invoke('agent:delete', data),

  // ============ Tools 查询 ============
  toolsList: () => ipcRenderer.invoke('tools:list'),

  // ============ Prompt 管理 ============
  promptGetComponents: () => ipcRenderer.invoke('prompt-get-components'),
  promptToggleComponent: (data: { id: string; enabled: boolean }) =>
    ipcRenderer.invoke('prompt-toggle-component', data),
  promptUpdateComponent: (data: { id: string; content?: string; keywords?: string }) =>
    ipcRenderer.invoke('prompt-update-component', data),
  promptPreview: (data: { scene?: string; complexity?: string }) =>
    ipcRenderer.invoke('prompt-preview', data),
  getPromptConfig: () => ipcRenderer.invoke('prompt-get-config'),
  setPromptConfig: (data: { defaultComplexity?: string; defaultScene?: string }) =>
    ipcRenderer.invoke('prompt-set-config', data),

  // ============ 项目管理 ============
  projectsList: () => ipcRenderer.invoke('projects-list'),
  projectsGetRules: (data: { projectPath: string }) =>
    ipcRenderer.invoke('projects-get-rules', data),
  projectsSaveRules: (data: { projectPath: string; rules: string; filePath?: string }) =>
    ipcRenderer.invoke('projects-save-rules', data),
  projectsGetDocs: (data: { projectPath: string }) =>
    ipcRenderer.invoke('projects-get-docs', data),
  projectsReadDoc: (data: { filePath: string }) =>
    ipcRenderer.invoke('projects-read-doc', data),
  onProjectInfo: (callback: (data: { type: string; hasGit: boolean; rootPath: string; configFiles: string[]; gitBranch?: string }) => void) => {
    ipcRenderer.on('project:info', (_event, data) => callback(data));
  },

  // ============ Todo 管理 ============
  todoArchiveCompleted: () => ipcRenderer.invoke('todo:archive-completed'),
  todoGetArchivedCount: () => ipcRenderer.invoke('todo:get-archived-count'),

  // ============ 高级功能 ============
  compact: (data: any) => ipcRenderer.invoke('compact', data),
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),

  // ============ 权限交互 ============
  onPermissionRequest: (callback: (data: any) => void) => {
    ipcRenderer.on('permission:request', (_event, data) => callback(data));
  },
  permissionRespond: (data: any) => ipcRenderer.invoke('permission:respond', data),

  onPlanReviewRequest: (callback: (data: any) => void) => {
    ipcRenderer.on('plan-review:request', (_event, data) => callback(data));
  },
  planReviewRespond: (data: any) => ipcRenderer.invoke('plan-review:respond', data),

  onPlanModeEnter: (callback: () => void) => {
    ipcRenderer.on('plan-mode:enter', () => callback());
  },
  onPlanModeExit: (callback: () => void) => {
    ipcRenderer.on('plan-mode:exit', () => callback());
  },

  onAskUserRequest: (callback: (data: any) => void) => {
    ipcRenderer.on('ask-user:request', (_event, data) => callback(data));
  },
  askUserRespond: (data: any) => ipcRenderer.invoke('ask-user:respond', data),

  // ============ 权限规则管理 ============
  permissionListRules: () => ipcRenderer.invoke('permission:list'),
  permissionDeleteRule: (data: { cacheKey: string }) => ipcRenderer.invoke('permission:delete', data),
  permissionClearRules: () => ipcRenderer.invoke('permission:clear'),

  // ============ 权限配置管理 ============
  permissionConfigGet: () => ipcRenderer.invoke('permission:config-get'),
  permissionConfigUpdate: (updates: any) => ipcRenderer.invoke('permission:config-update', updates),

  // ============ 审计日志管理 ============
  permissionAuditList: (options?: any) => ipcRenderer.invoke('permission:audit-list', options),
  permissionAuditStats: () => ipcRenderer.invoke('permission:audit-stats'),
  permissionAuditClear: () => ipcRenderer.invoke('permission:audit-clear'),

  // ============ 拒绝操作管理 ============
  permissionDeniedList: () => ipcRenderer.invoke('permission:denied-list'),
  permissionDeniedDelete: (data: { key: string }) => ipcRenderer.invoke('permission:denied-delete', data),
  permissionDeniedClear: () => ipcRenderer.invoke('permission:denied-clear'),

  // ============ 日志管理 ============
  logsRead: (query?: any) => ipcRenderer.invoke('logs:read', query),
  logsReadLatest: (count?: number, levels?: string[]) => ipcRenderer.invoke('logs:read-latest', count, levels),
  logsClear: () => ipcRenderer.invoke('logs:clear'),
  logsStats: () => ipcRenderer.invoke('logs:stats'),
  logsStartWatch: (levels: string[]) => ipcRenderer.invoke('logs:start-watch', levels),
  logsStopWatch: () => ipcRenderer.invoke('logs:stop-watch'),
  onLogsNewRecord: (callback: (record: any) => void) => {
    ipcRenderer.on('logs:new-record', (_event, record) => callback(record));
  },

  // ============ Persona 事件 ============
  onPersonaUpdated: (callback: (data: { persona: any; onboardingDone: boolean }) => void) => {
    ipcRenderer.on('persona-updated', (_event, data) => callback(data));
  },

  // ============ 下载管理 ============
  downloadGetTasks: () => ipcRenderer.invoke('download:get-tasks'),
  downloadGetProjectRoot: () => ipcRenderer.invoke('download:get-project-root'),
  downloadCheckEmbeddingModel: (modelId: string) => ipcRenderer.invoke('download:check-embedding-model', modelId),
  downloadUninstallEmbeddingModel: (modelId: string) => ipcRenderer.invoke('download:uninstall-embedding-model', modelId),
  downloadCreate: (options: { url: string; dest: string; name: string; category?: string }) =>
    ipcRenderer.invoke('download:create', options),
  downloadCancel: (taskId: string) => ipcRenderer.invoke('download:cancel', taskId),
  downloadClearFinished: () => ipcRenderer.invoke('download:clear-finished'),

  // ============ 本地模型管理 ============
  localModelCheck: (modelId: string) => ipcRenderer.invoke('local-model:check', modelId),
  localModelDownload: (modelId: string) => ipcRenderer.invoke('local-model:download', modelId),
  localModelList: () => ipcRenderer.invoke('local-model:list'),
  localModelDelete: (filename: string) => ipcRenderer.invoke('local-model:delete', filename),
  localModelOpenDir: () => ipcRenderer.invoke('local-model:open-dir'),

  // ============ 工作目录文件浏览 ============
  workspaceReadDirectory: (dirPath?: string) => ipcRenderer.invoke('workspace:read-directory', dirPath),
  workspaceOpenFile: (filePath: string) => ipcRenderer.invoke('workspace:open-file', filePath),
  workspaceGetGitStatus: (dirPath: string) => ipcRenderer.invoke('workspace:get-git-status', dirPath),

  // ============ 通用事件监听 ============
  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => {
      callback(...args);
    };
    (callback as any).__ipcHandler = handler;
    ipcRenderer.on(channel, handler);
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (callback as any).__ipcHandler;
    if (handler) {
      ipcRenderer.removeListener(channel, handler);
    }
  },

  // ============ 工作目录变更通知（从 agent-bridge 子进程发出） ============
  onWorkspaceDirectoryChanged: (callback: (data: { path: string }) => void) => {
    const handler = (_event: any, data: { path: string }) => {
      console.log('[preload] workspace:directory-changed received:', data);
      callback(data);
    };
    (callback as any).__ipcHandler = handler;
    ipcRenderer.on('workspace:directory-changed', handler);
  },
  offWorkspaceDirectoryChanged: (callback: (data: { path: string }) => void) => {
    const handler = (callback as any).__ipcHandler;
    if (handler) {
      ipcRenderer.removeListener('workspace:directory-changed', handler);
    }
  },
});
