// ============================================================
// 全局类型定义
// ============================================================

export interface FileChange {
  filePath: string;
  operation: 'create' | 'edit' | 'overwrite';
  stats: {
    added: number;
    removed: number;
    unchanged?: number;
  };
  diffContent?: string;
  size?: {
    lines: number;
    chars: number;
  };
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  type: 'prompt' | 'agent' | 'workflow';
  category?: string;
  enabled: boolean;
  requiredTools?: string[];
  triggers?: string[];
  tags?: string[];
}

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
  required: boolean;
  readonly: boolean;
  inputSchema?: any;
}

export interface MCPServerInfo {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  toolCount?: number;
  promptCount?: number;
}

export interface ElectronAPI {
  getVersion: () => Promise<string>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;

  // Agent 操作
  agentInit: () => Promise<{ success: boolean; config?: any; error?: string }>;
  agentSendMessage: (message: string) => Promise<{ success: boolean; error?: string }>;
  agentInterrupt: (message?: string) => Promise<{ success: boolean; error?: string }>;
  agentReset: () => Promise<{ success: boolean; error?: string }>;
  agentGetState: () => Promise<{
    status: string;
    tokenUsage: { input: number; output: number };
    cost: number;
    currentIteration?: number;
  }>;

  // 流式事件监听
  onAgentText: (callback: (text: string) => void) => void;
  onAgentThinking: (callback: (thinking: string) => void) => void;
  onAgentToolStart: (callback: (data: { id: string; name: string; input: Record<string, unknown> }) => void) => void;
  onAgentToolEnd: (callback: (data: { id: string; name: string; result: string; isError: boolean }) => void) => void;
  onAgentFileChanges: (callback: (data: { changes: FileChange[] }) => void) => void;
  onAgentUsage: (callback: (usage: any) => void) => void;
  onAgentError: (callback: (error: string) => void) => void;
  onAgentEnd: (callback: (state: { tokenUsage: any; cost: number; currentIteration: number }) => void) => void;

  removeAllListeners: (channel: string) => void;

  // 设置
  settingsGetConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
  settingsUpdateConfig: (data: any) => Promise<{ success: boolean; error?: string }>;

  // 会话管理
  sessionSave: (data: any) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
  sessionResume: (data: any) => Promise<{ success: boolean; sessionId?: string; historyMessages?: any[]; usage?: any; messageCount?: number; error?: string }>;
  sessionList: () => Promise<{ success: boolean; sessions?: SessionListItem[]; error?: string }>;
  sessionDelete: (data: any) => Promise<{ success: boolean; error?: string }>;

  // Checkpoint
  checkpointCreate: (data: any) => Promise<{ success: boolean; checkpointId?: string; error?: string }>;
  checkpointList: () => Promise<{ success: boolean; checkpoints?: CheckpointItem[]; error?: string }>;
  checkpointRewind: (data: any) => Promise<{ success: boolean; messageCount?: number; error?: string }>;

  // 手动操作
  manualMemoryFlush: () => Promise<{ success: boolean; error?: string }>;
  compact: (data: any) => Promise<{ success: boolean; error?: string }>;

  // 记忆管理
  memoryRetrieve: (data: any) => Promise<{ success: boolean; entries?: MemoryEntry[]; error?: string }>;
  memoryStats: () => Promise<{ success: boolean; stats?: any; error?: string }>;

  // 记忆系统高级功能
  getMemoryStats: () => Promise<{ success: boolean; stats?: any; error?: string }>;
  getMemoryConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
  saveMemoryConfig: (data: { config: any }) => Promise<{ success: boolean; requiresRestart?: boolean; error?: string }>;
  manualMemoryFlush: () => Promise<{ success: boolean; error?: string }>;
  extractTopics: () => Promise<{ success: boolean; error?: string }>;
  getMemoryList: (data: { query?: string; type?: string; category?: string; limit?: number }) => Promise<{ success: boolean; memories?: any[]; error?: string }>;

  // 工具统计
  usageStats: () => Promise<{ success: boolean; stats?: any; error?: string }>;

  // 高级功能
  compact: (data: any) => Promise<{ success: boolean; result?: CompactResult; error?: string }>;
  getDiagnostics: () => Promise<{ success: boolean; report?: string; error?: string }>;

  // Skills / Tools / MCP 查询
  skillsList: () => Promise<{ success: boolean; skills?: SkillInfo[]; error?: string }>;
  toolsList: () => Promise<{ success: boolean; tools?: ToolInfo[]; error?: string }>;
  mcpList: () => Promise<{ success: boolean; servers?: MCPServerInfo[]; error?: string }>;

  // Todo 管理
  todoArchiveCompleted: () => Promise<{ success: boolean; count?: number; error?: string }>;
  todoGetArchivedCount: () => Promise<{ success: boolean; count?: number; error?: string }>;

  // Agent 配置管理
  agentList: () => Promise<{ success: boolean; agents?: any[]; error?: string }>;
  agentCreate: (data: any) => Promise<{ success: boolean; agent?: any; error?: string }>;
  agentUpdate: (data: any) => Promise<{ success: boolean; error?: string }>;
  agentDelete: (data: any) => Promise<{ success: boolean; error?: string }>;

  // 会话事件
  onSessionMessagesRestored: (callback: (data: any) => void) => void;

  // Persona 事件
  onPersonaUpdated: (callback: (data: { persona: any; onboardingDone: boolean }) => void) => void;

  // 权限交互
  onPermissionRequest: (callback: (data: PermissionRequestData) => void) => void;
  permissionRespond: (data: any) => Promise<void>;

  onPlanReviewRequest: (callback: (data: PlanReviewRequestData) => void) => void;
  planReviewRespond: (data: any) => Promise<void>;

  onPlanModeEnter: (callback: () => void) => void;
  onPlanModeExit: (callback: () => void) => void;

  onAskUserRequest: (callback: (data: AskUserRequestData) => void) => void;
  askUserRespond: (data: any) => Promise<void>;

  // 权限规则管理
  permissionListRules: () => Promise<{ success: boolean; rules?: PermissionRule[]; error?: string }>;
  permissionDeleteRule: (data: { cacheKey: string }) => Promise<{ success: boolean; error?: string }>;
  permissionClearRules: () => Promise<{ success: boolean; error?: string }>;

  // 日志管理
  logsRead: (query?: any) => Promise<{ success: boolean; logs?: LogRecord[]; error?: string }>;
  logsReadLatest: (count?: number, levels?: string[]) => Promise<{ success: boolean; logs?: LogRecord[]; error?: string }>;
  logsClear: () => Promise<{ success: boolean; error?: string }>;
  logsStats: () => Promise<{ success: boolean; stats?: Record<string, { size: number; lines: number }>; error?: string }>;
  logsStartWatch: (levels: string[]) => Promise<{ success: boolean; error?: string }>;
  logsStopWatch: () => Promise<{ success: boolean; error?: string }>;
  onLogsNewRecord: (callback: (record: LogRecord) => void) => void;

  // 通用事件监听
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

// ============================================================
// 业务类型
// ============================================================

export interface SessionListItem {
  id: string;
  shortLabel?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workingDirectory?: string;
  preview?: string;
}

export interface CheckpointItem {
  id: string;
  label?: string;
  createdAt: string;
  messageIndex: number;
  messageCount: number;
}

export interface MemoryEntry {
  type: string;
  content: string;
  tags?: string[];
  createdAt?: string;
  score?: number;
}

export interface PermissionRequestData {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  riskLevel: 'safe' | 'warn' | 'danger';
  description: string;
  suggestion: string;
}

export interface PermissionRule {
  cacheKey: string;
  allowed: boolean;
  toolName: string;
  timestamp: string;
  expiresAt?: string;
}

export interface PlanReviewRequestData {
  id: string;
  content: string;
  title: string;
}

export interface AskUserRequestData {
  id: string;
  question: string;
  options?: string[];
  multiSelect?: boolean;
  default?: string;
}

export interface CompactResult {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  summary: string;
}

export interface LogRecord {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  namespace: string;
  message: string;
  raw: string;
}

export interface PromptComponentConfig {
  content: string;
  requiredTools?: string[];
}

export interface PromptConfig {
  sceneRules: SceneMatchRule[];
  loadMatrix: LoadMatrixConfig;
  l3Config: L3Config;
  components?: Record<string, PromptComponentConfig>;
}

export interface SceneMatchRule {
  scene: 'coding' | 'life';
  keywords: string;
  description: string;
}

export interface LoadMatrixConfig {
  simple: string[];
  standard: string[];
  complex: string[];
}

export interface L3Config {
  enabled: boolean;
  maxFiles: number;
  maxSymbols: number;
  directories: string[];
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
