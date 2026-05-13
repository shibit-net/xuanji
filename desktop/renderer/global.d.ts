
// ============================================================
// Xuanji Desktop - 全局类型定义
// ============================================================

// 权限请求数据
export interface PermissionRequestData {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: 'safe' | 'warn' | 'danger';
  reason?: string;
}

// 计划审查请求数据
export interface PlanReviewRequestData {
  id: string;
  plan: string;
  filePath?: string;
}

// 询问用户请求数据
export interface AskUserRequestData {
  id: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
}

// 权限规则
export interface PermissionRule {
  cacheKey: string;
  tool: string;
  decision: 'allow' | 'deny';
  timestamp: number;
}

// Checkpoint 项
export interface CheckpointItem {
  id: string;
  timestamp: number;
  description?: string;
}

// 记忆条目
export interface MemoryEntry {
  id: string;
  content: string;
  type?: string;
  category?: string;
  timestamp: number;
}

// 会话列表项
export interface SessionListItem {
  id: string;
  title: string;
  timestamp: number;
  messageCount?: number;
}

// 文件变更
export interface FileChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  content?: string;
}

export interface ElectronAPI {
  // 应用信息
  getVersion: () => Promise<string>;

  // 窗口控制
  minimize: () => void;
  maximize: () => void;
  close: () => void;

  manualMemoryFlush: (data?: any) => Promise<{ success: boolean; error?: string }>;

  // ============================================================
  // 认证相关
  // ============================================================
  authLogin: (email: string, password: string) => Promise<{
    success: boolean;
    data?: any;
    message?: string;
  }>;
  authLogout: () => Promise<{ success: boolean }>;
  authCheck: () => Promise<{
    success: boolean;
    data?: any;
  }>;
  authGetSavedAccounts: () => Promise<Array<{
    email: string;
    nickname?: string;
    avatar?: string;
    lastLogin: number;
  }>>;
  authSwitchAccount: (email: string) => Promise<{ success: boolean }>;
  authRemoveAccount: (email: string) => Promise<{ success: boolean }>;
  onAuthSessionExpired: (callback: () => void) => void;

  // ============================================================
  // 模型管理
  // ============================================================
  modelsListMarketplace: (options?: {
    vendor?: string;
    name?: string;
    routeId?: number;
    page?: number;
    size?: number;
  }) => Promise<{ success: boolean; data?: any; error?: string }>;
  modelsListAll: () => Promise<{ success: boolean; data?: any; error?: string }>;
  modelsListVendors: () => Promise<{ success: boolean; data?: any; error?: string }>;
  modelsGetInfo: (id: number, routeId?: number) => Promise<{ success: boolean; data?: any; error?: string }>;
  modelsListUserConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;

  // ============================================================
  // 以下是原有的 API
  // ============================================================

  // Agent 操作
  agentInit: () => Promise<{ success: boolean; config?: any; error?: string }>;
  agentUserAction: (action: { type: 'SEND_MESSAGE' | 'INTERRUPT'; message?: string }) => Promise<{ success: boolean; result?: any; error?: string }>;
  agentReset: () => Promise<{ success: boolean }>;
  agentGetState: () => Promise<any>;
  openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
  getResourceUsage: () => Promise<{ success: boolean; data?: { cpu: { percentCPUUsage: number }; memory: { usedMB: number; totalMB: number; percent: number } }; error?: string }>;

  // 文件系统
  // 流式事件监听
  onAgentText: (callback: (text: string) => void) => void;
  onAgentThinking: (callback: (thinking: string) => void) => void;
  onAgentToolStart: (callback: (data: { id: string; name: string; input: Record<string, unknown> }) => void) => void;
  onAgentToolEnd: (callback: (data: { id: string; name: string; result: string; isError: boolean }) => void) => void;
  onAgentFileChanges: (callback: (data: { changes: any[] }) => void) => void;
  onAgentUsage: (callback: (usage: any) => void) => void;
  onAgentError: (callback: (error: string) => void) => void;
  onAgentEnd: (callback: (state: { tokenUsage: any; cost: number; currentIteration: number }) => void) => void;

  // 移除监听器
  removeAllListeners: (channel: string) => void;

  // 设置操作
  settingsGetConfig: () => Promise<any>;
  settingsGetFullConfig: () => Promise<any>;
  settingsUpdateConfig: (data: any) => Promise<any>;

  // 会话管理
  sessionSave: (data: any) => Promise<any>;
  sessionResume: (data: any) => Promise<any>;
  sessionList: () => Promise<any>;
  sessionDelete: (data: any) => Promise<any>;

  // Checkpoint
  checkpointCreate: (data: any) => Promise<any>;
  checkpointList: () => Promise<any>;
  checkpointRewind: (data: any) => Promise<any>;

  // 核心规则管理
  getCoreRules: () => Promise<any>;
  updateCoreRule: (data: { id: string; active?: boolean }) => Promise<any>;
  deleteCoreRule: (data: { id: string }) => Promise<any>;

  // 工具统计
  usageStats: () => Promise<any>;

  // Agent 管理
  agentList: () => Promise<any>;
  agentGet: (data: { agentId: string }) => Promise<any>;
  agentCreate: (data: { config: any }) => Promise<any>;
  agentUpdate: (data: { agentId: string; config: any }) => Promise<any>;
  agentDelete: (data: { agentId: string }) => Promise<any>;

  // Tools 查询
  toolsList: () => Promise<any>;

  // Todo 管理
  todoArchiveCompleted: () => Promise<any>;
  todoGetArchivedCount: () => Promise<any>;

  // ============ Prompt 管理 ============
  promptGetComponents: () => Promise<{
    success: boolean;
    components?: Array<{
      id: string;
      name: string;
      layer: string;
      priority: number;
      estimatedTokens: number;
      enabled: boolean;
      scenes?: string[];
      complexity?: string;
      content: string;
      dynamic?: boolean;
    }>;
    error?: string;
  }>;
  promptToggleComponent: (data: { id: string; enabled: boolean }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  promptUpdateComponent: (data: { id: string; content?: string; keywords?: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  promptPreview: (data: { scene?: string; complexity?: string }) => Promise<{
    success: boolean;
    prompt?: string;
    tokenCount?: number;
    error?: string;
  }>;

  // Prompt 配置管理
  getPromptConfig: () => Promise<{
    success: boolean;
    config?: { defaultComplexity?: string; defaultScene?: string };
    error?: string;
  }>;
  setPromptConfig: (data: { defaultComplexity?: string; defaultScene?: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;

  // 项目管理
  projectsList: () => Promise<{
    success: boolean;
    projects?: Array<{
      path: string;
      name: string;
      hasRules: boolean;
      lastAccessed: number;
      firstAccessed: number;
    }>;
    error?: string;
  }>;
  projectsGetRules: (data: { projectPath: string }) => Promise<{
    success: boolean;
    rules?: string;
    filePath?: string;
    error?: string;
  }>;
  projectsSaveRules: (data: { projectPath: string; rules: string; filePath?: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  projectsGetDocs: (data: { projectPath: string }) => Promise<{
    success: boolean;
    docs?: Array<{
      name: string;
      path: string;
      relativePath: string;
    }>;
    error?: string;
  }>;
  projectsReadDoc: (data: { filePath: string }) => Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }>;
  onProjectInfo: (callback: (data: { type: string; hasGit: boolean; rootPath: string; configFiles: string[]; gitBranch?: string }) => void) => void;

  // 高级功能
  compact: (data: any) => Promise<any>;
  getDiagnostics: () => Promise<any>;

  // 权限交互
  onPermissionRequest: (callback: (data: any) => void) => void;
  permissionRespond: (data: any) => Promise<any>;

  onPlanReviewRequest: (callback: (data: any) => void) => void;
  planReviewRespond: (data: any) => Promise<any>;

  onPlanModeEnter: (callback: () => void) => void;
  onPlanModeExit: (callback: () => void) => void;

  onAskUserRequest: (callback: (data: any) => void) => void;
  askUserRespond: (data: any) => Promise<any>;

  // 权限规则管理
  permissionListRules: () => Promise<any>;
  permissionDeleteRule: (data: { cacheKey: string }) => Promise<any>;
  permissionClearRules: () => Promise<any>;

  // 权限配置管理
  permissionConfigGet: () => Promise<{
    success: boolean;
    config?: {
      fileRead: boolean;
      fileWrite: boolean;
      bashExec: boolean;
      warnLevel: 'safe' | 'warn' | 'danger';
      confirmWrite: boolean;
      allowedPaths?: string[];
      deniedPaths?: string[];
      allowedCommands?: string[];
      deniedCommands?: string[];
    };
    error?: string;
  }>;
  permissionConfigUpdate: (updates: any) => Promise<{
    success: boolean;
    error?: string;
  }>;

  // 审计日志管理
  permissionAuditList: (options?: {
    toolName?: string;
    decision?: string;
    riskLevel?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    offset?: number;
  }) => Promise<{
    success: boolean;
    logs?: Array<{
      id: number;
      eventType: string;
      toolName: string;
      category?: string;
      riskLevel?: string;
      decision: string;
      reason?: string;
      target?: string;
      userAction?: string;
      timestamp: number;
      sessionId?: string;
    }>;
    error?: string;
  }>;
  permissionAuditStats: () => Promise<{
    success: boolean;
    stats?: {
      totalChecks: number;
      allowedCount: number;
      deniedCount: number;
      allowRate: number;
    };
    error?: string;
  }>;
  permissionAuditClear: () => Promise<{
    success: boolean;
    error?: string;
  }>;

  // 拒绝操作管理
  permissionDeniedList: () => Promise<{
    success: boolean;
    deniedOps?: Array<{
      key: string;
      tool: string;
      category: string;
      target: string;
      reason: string;
      timestamp: number;
    }>;
    error?: string;
  }>;
  permissionDeniedDelete: (data: { key: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  permissionDeniedClear: () => Promise<{
    success: boolean;
    error?: string;
  }>;

  // 日志管理
  logsRead: (query?: any) => Promise<any>;
  logsReadLatest: (count?: number, levels?: string[]) => Promise<any>;
  logsClear: () => Promise<any>;
  logsStats: () => Promise<any>;
  logsStartWatch: (levels: string[]) => Promise<any>;
  logsStopWatch: () => Promise<any>;
  onLogsNewRecord: (callback: (record: any) => void) => void;

  // Persona 事件
  onPersonaUpdated: (callback: (data: { persona: any; onboardingDone: boolean }) => void) => void;

  // 下载管理
  downloadGetTasks: () => Promise<{
    success: boolean;
    tasks?: Array<{
      id: string;
      url: string;
      name: string;
      category?: string;
      status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
      progress: {
        percent: number;
        downloaded: number;
        total: number;
        speed: number;
      };
      error?: string;
    }>;
    error?: string;
  }>;
  downloadGetProjectRoot: () => Promise<{
    success: boolean;
    projectRoot?: string;
    error?: string;
  }>;
  downloadGetEmbeddingModelDir: () => Promise<{
    success: boolean;
    dir?: string;
    error?: string;
  }>;
  downloadCheckEmbeddingModel: (modelId: string) => Promise<{
    success: boolean;
    installed?: boolean;
    error?: string;
  }>;
  downloadUninstallEmbeddingModel: (modelId: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  downloadCreate: (options: {
    url: string;
    dest: string;
    name: string;
    category?: string;
  }) => Promise<{
    success: boolean;
    taskId?: string;
    error?: string;
  }>;
  downloadCancel: (taskId: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  downloadClearFinished: () => Promise<{
    success: boolean;
    error?: string;
  }>;

  // 本地模型管理
  localModelCheck: (modelId: string) => Promise<{
    success: boolean;
    installed?: boolean;
    error?: string;
  }>;
  localModelDownload: (modelId: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  localModelList: () => Promise<{
    success: boolean;
    models?: Array<{
      filename: string;
      path: string;
      size: number;
      modifiedAt: string;
    }>;
    error?: string;
  }>;
  localModelDelete: (filename: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  localModelOpenDir: () => Promise<{
    success: boolean;
    error?: string;
  }>;

  // 工作目录文件浏览
  workspaceReadDirectory: (dirPath?: string) => Promise<{
    success: boolean;
    items?: Array<{
      name: string;
      path: string;
      isDirectory: boolean;
      size: number;
      modifiedAt: number;
    }>;
    currentPath?: string;
    gitBranch?: string | null;
    error?: string;
  }>;
  workspaceOpenFile: (filePath: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  workspaceGetGitStatus: (dirPath: string) => Promise<{
    success: boolean;
    status?: Record<string, string>;
    error?: string;
  }>;

  // 工作目录变更通知
  onWorkspaceDirectoryChanged: (callback: (data: { path: string }) => void) => void;
  offWorkspaceDirectoryChanged: (callback: (data: { path: string }) => void) => void;

  // 通用事件监听
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;

  // 意图分析 (可选功能)
  analyzeIntent?: (prompt: string) => Promise<{
    intent: 'interrupt_replace' | 'supplement' | 'new_task';
    confidence: number;
    reasoning: string;
  }>;

  // 调试日志
  debugLog: (message: string) => Promise<{ success: boolean; error?: string }>;

}

declare global {
  interface Window {
    electron: ElectronAPI;
    __DEBUG_FLOW__?: boolean;
  }
}

export {};