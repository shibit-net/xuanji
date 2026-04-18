
// ============================================================
// Xuanji Desktop - 全局类型定义
// ============================================================

export interface ElectronAPI {
  // 应用信息
  getVersion: () => Promise<string>;

  // 窗口控制
  minimize: () => void;
  maximize: () => void;
  close: () => void;

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
  agentSendMessage: (message: string) => Promise<{ success: boolean }>;
  agentInterrupt: (message?: string) => Promise<{ success: boolean }>;
  agentReset: () => Promise<{ success: boolean }>;
  agentGetState: () => Promise<any>;

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

  // 记忆管理
  memoryRetrieve: (data: any) => Promise<any>;
  memoryStats: () => Promise<any>;

  // 记忆系统高级功能
  getMemoryStats: () => Promise<any>;
  getMemoryConfig: () => Promise<any>;
  saveMemoryConfig: (data: { config: any }) => Promise<any>;
  manualMemoryFlush: () => Promise<any>;
  extractTopics: () => Promise<any>;
  getMemoryList: (data: { query?: string; type?: string; category?: string; limit?: number }) => Promise<any>;

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

  // Skills / Tools / MCP 查询
  skillsList: () => Promise<any>;
  toolsList: () => Promise<any>;
  mcpList: () => Promise<any>;

  // Todo 管理
  todoArchiveCompleted: () => Promise<any>;
  todoGetArchivedCount: () => Promise<any>;

  // Prompt 配置管理
  promptGetConfig: () => Promise<any>;
  promptSaveConfig: (data: any) => Promise<any>;

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

  // 日志管理
  logsRead: (query?: any) => Promise<any>;
  logsReadLatest: (count?: number, levels?: string[]) => Promise<any>;
  logsClear: () => Promise<any>;
  logsStats: () => Promise<any>;
  logsStartWatch: (levels: string[]) => Promise<any>;
  logsStopWatch: () => Promise<any>;
  onLogsNewRecord: (callback: (record: any) => void) => void;

  // 会话事件监听
  onSessionMessagesRestored: (callback: (data: { messages: any[] }) => void) => void;

  // Persona 事件
  onPersonaUpdated: (callback: (data: { persona: any; onboardingDone: boolean }) => void) => void;

  // 通用事件监听
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;

  // 意图分析 (可选功能)
  analyzeIntent?: (prompt: string) => Promise<{
    intent: 'interrupt_replace' | 'supplement' | 'new_task';
    confidence: number;
    reasoning: string;
  }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};