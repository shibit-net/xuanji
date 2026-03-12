// ============================================================
// 全局类型定义
// ============================================================

export interface ElectronAPI {
  getVersion: () => Promise<string>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;

  // Agent 操作
  agentInit: () => Promise<{ success: boolean; config?: any; error?: string }>;
  agentSendMessage: (message: string) => Promise<{ success: boolean; error?: string }>;
  agentInterrupt: () => Promise<{ success: boolean; error?: string }>;
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

  // 记忆管理
  memoryRetrieve: (data: any) => Promise<{ success: boolean; entries?: MemoryEntry[]; error?: string }>;
  memoryStats: () => Promise<{ success: boolean; stats?: any; error?: string }>;

  // 工具统计
  usageStats: () => Promise<{ success: boolean; stats?: any; error?: string }>;

  // 高级功能
  compact: (data: any) => Promise<{ success: boolean; result?: CompactResult; error?: string }>;
  getDiagnostics: () => Promise<{ success: boolean; report?: string; error?: string }>;

  // 权限交互
  onPermissionRequest: (callback: (data: PermissionRequestData) => void) => void;
  permissionRespond: (data: any) => Promise<void>;

  onPlanReviewRequest: (callback: (data: PlanReviewRequestData) => void) => void;
  planReviewRespond: (data: any) => Promise<void>;

  onAskUserRequest: (callback: (data: AskUserRequestData) => void) => void;
  askUserRespond: (data: any) => Promise<void>;
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

export interface PlanReviewRequestData {
  id: string;
  content: string;
  title: string;
}

export interface AskUserRequestData {
  id: string;
  question: string;
  options?: string[];
}

export interface CompactResult {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  summary: string;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
