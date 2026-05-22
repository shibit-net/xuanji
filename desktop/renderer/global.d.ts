
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

// 权限规则（与后端 PersistedDecisionInfo 对齐）
export interface PermissionRule {
  cacheKey: string;
  allowed: boolean;
  toolName: string;
  timestamp: string;
  expiresAt?: string;
}

// 文件附件（拖拽/粘贴上传）
export interface FileAttachment {
  name: string;
  path?: string;
  content: string;
  size: number;
  mimeType?: string;
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

  manualMemoryFlush: (data?: any) => Promise<{
    success: boolean;
    result?: { entityCount: number; relationCount: number; factCount: number; eventCount: number };
    error?: string;
  }>;

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
  agentUserAction: (action: { type: 'SEND_MESSAGE' | 'INTERRUPT'; message?: string; attachments?: FileAttachment[]; agentId?: string; imageBlocks?: Array<{ data: string; mimeType: string; name: string }> }) => Promise<{ success: boolean; result?: any; error?: string }>;
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
  promptUpdateComponent: (data: { id: string; content?: string; keywords?: string; scenes?: string[] }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  promptPreview: (data: { scene?: string; complexity?: string }) => Promise<{
    success: boolean;
    prompt?: string;
    tokenCount?: number;
    error?: string;
  }>;

  promptDeleteComponent: (data: { id: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  promptCreateComponent: (data: {
    id: string; name: string; layer: string; priority: number;
    estimatedTokens: number; scenes?: string[]; content: string;
    match?: { keywords: string; description: string };
  }) => Promise<{
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
  compact: (data: any) => Promise<{
    success: boolean;
    result?: { originalTokens: number; compressedTokens: number; compressionRatio: number; summary?: string };
    error?: string;
  }>;
  contextStatus: () => Promise<{
    success: boolean;
    data?: { estimatedTokens: number; maxInputTokens: number; usagePercent: number; messageCount: number };
    error?: string;
  }>;
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
  permissionListRules: () => Promise<{
    success: boolean;
    rules?: PermissionRule[];
    error?: string;
  }>;
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
      pattern: string;
      reason: string;
      timestamp: string;
      sessionOnly: boolean;
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

  // ============ 记忆管理 ============
  memoryStatus: () => Promise<{
    success: boolean;
    initialized?: boolean;
    sessionReady?: boolean;
    isExtracting?: boolean;
    isCompressing?: boolean;
    error?: string;
  }>;
  memoryStats: () => Promise<{
    success: boolean;
    stats?: {
      entityCount: number;
      factCount: number;
      eventCount: number;
      relationCount: number;
      episodeCount: number;
      ftsEntryCount: number;
      dbSizeBytes: number;
    };
    error?: string;
  }>;
  memorySearch: (data: {
    query: string;
    source?: string;
    scene_tag?: string;
    limit?: number;
    minImportance?: number;
  }) => Promise<{
    success: boolean;
    results?: Array<{
      source_table: string;
      source_id: string;
      title: string;
      content: string;
      scene_tag: string;
      score?: number;
    }>;
    error?: string;
  }>;
  memoryEntities: (data?: {
    type?: string;
    scene?: string;
    keyword?: string;
    limit?: number;
  }) => Promise<{
    success: boolean;
    entities?: Array<{
      id: string;
      name: string;
      type: string;
      summary: string;
      belief: string | null;
      scene_tag: string;
      importance: number;
      ref_count: number;
      created_at: number;
      updated_at: number;
    }>;
    error?: string;
  }>;
  memoryFacts: (data?: {
    keyword?: string;
    scene?: string;
    isLatest?: boolean;
    limit?: number;
  }) => Promise<{
    success: boolean;
    facts?: Array<{
      id: string;
      title: string;
      content: string;
      source: string;
      version: number;
      is_latest: number;
      scene_tag: string;
      created_at: number;
    }>;
    error?: string;
  }>;
  memoryTimeline: (data?: {
    entityNames?: string[];
    scene?: string;
    from?: number;
    to?: number;
    limit?: number;
  }) => Promise<{
    success: boolean;
    events?: Array<{
      id: string;
      time: number;
      entity_ids: string;
      content: string;
      result: string | null;
      importance: number;
      scene_tag: string;
      operator: string | null;
      created_at: number;
    }>;
    error?: string;
  }>;
  memoryEpisodes: (data?: {
    query?: string;
    limit?: number;
  }) => Promise<{
    success: boolean;
    episodes?: Array<{
      id: string;
      timestamp: number;
      title: string;
      narrative: string;
      scene_tag: string;
      importance: number;
    }>;
    error?: string;
  }>;
  memoryRelations: (data?: {
    entityId?: string;
    direction?: string;
    activeOnly?: boolean;
  }) => Promise<{
    success: boolean;
    relations?: Array<{
      id: string;
      subject_id: string;
      object_id: string;
      relation: string;
      desc: string | null;
      strength: number;
      is_active: number;
      scene_tag: string;
    }>;
    error?: string;
  }>;
  memoryGraphData: (data?: {
    entityId?: string;
    maxHops?: number;
  }) => Promise<{
    success: boolean;
    nodes?: Array<{
      id: string;
      name: string;
      type: string;
      summary: string;
      importance: number;
    }>;
    edges?: Array<{
      id: string;
      subject_id: string;
      object_id: string;
      relation: string;
      strength: number;
      is_active: number;
    }>;
    error?: string;
  }>;
  memoryGraphSearch: (data: { query: string; limit?: number }) => Promise<{
    success: boolean;
    nodes?: Array<{
      id: string;
      name: string;
      type: string;
      scene_tag: string;
      category?: string | null;
      metadata?: string | null;
    }>;
    error?: string;
  }>;
  memoryGraphNeighborhood: (data: { entityId: string; maxHops?: number }) => Promise<{
    success: boolean;
    centerId?: string;
    nodes?: Array<{
      id: string;
      name: string;
      type: string;
      scene_tag: string;
      category?: string | null;
      metadata?: string | null;
    }>;
    edges?: Array<{
      subjectId: string;
      relation: string;
      objectId: string;
      strength: number;
    }>;
    error?: string;
  }>;
  memoryDeleteEntity: (data: { id: string }) => Promise<{ success: boolean; error?: string }>;
  memoryClearAll: () => Promise<{ success: boolean; error?: string }>;

  // ============ 定时任务管理 ============
  schedulerJobs: () => Promise<{
    success: boolean;
    jobs?: Array<{
      id: string;
      userId: string;
      type: 'daily' | 'weekly' | 'once';
      hour?: number;
      minute?: number;
      dayOfWeek?: number;
      scheduledAt?: number;
      action: 'learn' | 'custom';
      params?: Record<string, any>;
      prompt?: string;
      enabled?: boolean;
      executed?: boolean;
      description?: string;
      createdAt?: number;
    }>;
    error?: string;
  }>;
  schedulerAdd: (data: { job: any }) => Promise<{ success: boolean; error?: string }>;
  schedulerUpdate: (data: { id: string; updates: any }) => Promise<{ success: boolean; error?: string }>;
  schedulerRemove: (data: { id: string }) => Promise<{ success: boolean; error?: string }>;
  schedulerLogs: (data?: { limit?: number }) => Promise<{
    success: boolean;
    logs?: Array<{
      id: number;
      job_id: string;
      scheduled_at: number;
      executed_at: number;
      status: string;
    }>;
    error?: string;
  }>;

  // ============ MCP 管理 ============
  mcpList: () => Promise<{
    success: boolean;
    servers?: Array<{ name: string; transport: string; enabled: boolean; toolCount: number; source: string; packageId: string }>;
    error?: string;
  }>;
  mcpToggle: (data: { name: string; enabled: boolean }) => Promise<{ success: boolean; error?: string }>;
  mcpDetail: (data: { name: string }) => Promise<{
    success: boolean;
    server?: { name: string; transport: string; enabled: boolean; toolCount: number; tools: Array<{ name: string; description: string }>; config: any };
    error?: string;
  }>;
  mcpUninstall: (data: { serverName?: string; packageId?: string }) => Promise<{ success: boolean; error?: string }>;
  mcpInstall: (data: { packageId: string; version?: string }) => Promise<{ success: boolean; config?: any; error?: string }>;
  mcpPublish: (data: { serverName: string }) => Promise<{ success: boolean; data?: any; error?: string }>;

  // ============ Skill 管理 ============
  skillList: () => Promise<{
    success: boolean;
    skills?: Array<{ id: string; name: string; version: string; description: string; category: string; source: string; tags: string[]; enabled: boolean; requiredTools: string[]; content: string }>;
    error?: string;
  }>;
  skillToggle: (data: { id: string; enabled: boolean }) => Promise<{ success: boolean; error?: string }>;
  skillDetail: (data: { id: string }) => Promise<{
    success: boolean;
    skill?: { id: string; name: string; version: string; description: string; category: string; source: string; tags: string[]; enabled: boolean; requiredTools: string[]; content: string };
    error?: string;
  }>;
  skillUninstall: (data: { skillId: string }) => Promise<{ success: boolean; error?: string }>;
  skillInstall: (data: { packageId: string; version?: string }) => Promise<{ success: boolean; skillId?: string; error?: string }>;
  skillPublish: (data: { skillId: string }) => Promise<{ success: boolean; data?: any; error?: string }>;

  // ============ 天工坊市场 ============
  tiangongSearch: (data: { type?: 'mcp' | 'skill'; query?: string; categoryId?: number; tags?: string; sort?: string; page?: number; pageSize?: number }) => Promise<{
    success: boolean;
    data?: {
      items: Array<{
        packageId: string;
        name: string;
        type: 'mcp' | 'skill';
        description: string;
        authorName: string;
        categoryName: string;
        totalDownloads: number;
        ratingAvg: number;
        ratingCount: number;
        qualityScore: number;
        securityScore: number;
        tags: string[];
        transport?: string;
        currentVersion: string;
        proxyEnabled: boolean;
        pricingModel: number;
        source: number;
        isPrivate: boolean;
      }>;
      total: number;
      pageNum: number;
      pageSize: number;
      pages: number;
    };
    error?: string;
  }>;
  tiangongDetail: (data: { packageId: string }) => Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }>;
  tiangongInstalledIds: () => Promise<{
    success: boolean;
    mcpIds?: string[];
    skillIds?: string[];
    error?: string;
  }>;
  tiangongCheckUpdates: () => Promise<{
    success: boolean;
    updates?: Array<{ packageId: string; hasUpdate: boolean; currentVersion: string; latestVersion: string; changelog?: string }>;
    error?: string;
  }>;
  tiangongDeletePackage: (data: { id: number }) => Promise<{
    success: boolean;
    error?: string;
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