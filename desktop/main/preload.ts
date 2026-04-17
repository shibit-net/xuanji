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

  // Agent 操作
  agentInit: () => ipcRenderer.invoke('agent:init'),
  agentSendMessage: (message: string) => ipcRenderer.invoke('agent:send-message', message),
  agentInterrupt: (message?: string) => ipcRenderer.invoke('agent:interrupt', message),
  agentReset: () => ipcRenderer.invoke('agent:reset'),
  agentGetState: () => ipcRenderer.invoke('agent:get-state'),

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

  // 移除监听器
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // 设置操作
  settingsGetConfig: () => ipcRenderer.invoke('settings:get-config'),
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

  // ============ 记忆管理 ============
  memoryRetrieve: (data: any) => ipcRenderer.invoke('memory:retrieve', data),
  memoryStats: () => ipcRenderer.invoke('memory:stats'),

  // ============ 记忆系统高级功能 ============
  getMemoryStats: () => ipcRenderer.invoke('memory:stats'),
  getMemoryConfig: () => ipcRenderer.invoke('memory:get-config'),
  saveMemoryConfig: (data: { config: any }) => ipcRenderer.invoke('memory:save-config', data),
  manualMemoryFlush: () => ipcRenderer.invoke('memory:manual-flush'),
  extractTopics: () => ipcRenderer.invoke('memory:extract-topics'),
  getMemoryList: (data: { query?: string; type?: string; category?: string; limit?: number }) =>
    ipcRenderer.invoke('memory:get-list', data),

  // ============ 工具统计 ============
  usageStats: () => ipcRenderer.invoke('usage:stats'),

  // ============ Agent 管理 ============
  agentList: () => ipcRenderer.invoke('agent:list'),
  agentGet: (data: { agentId: string }) => ipcRenderer.invoke('agent:get', data),
  agentCreate: (data: { config: any }) => ipcRenderer.invoke('agent:create', data),
  agentUpdate: (data: { agentId: string; config: any }) => ipcRenderer.invoke('agent:update', data),
  agentDelete: (data: { agentId: string }) => ipcRenderer.invoke('agent:delete', data),

  // ============ Skills / Tools / MCP 查询 ============
  skillsList: () => ipcRenderer.invoke('skills:list'),
  toolsList: () => ipcRenderer.invoke('tools:list'),
  mcpList: () => ipcRenderer.invoke('mcp:list'),

  // ============ Todo 管理 ============
  todoArchiveCompleted: () => ipcRenderer.invoke('todo:archive-completed'),
  todoGetArchivedCount: () => ipcRenderer.invoke('todo:get-archived-count'),

  // ============ Prompt 配置管理 ============
  promptGetConfig: () => ipcRenderer.invoke('prompt:get-config'),
  promptSaveConfig: (data: any) => ipcRenderer.invoke('prompt:save-config', data),

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

  // ============ 会话事件监听 ============
  onSessionMessagesRestored: (callback: (data: { messages: any[] }) => void) => {
    ipcRenderer.on('session:messages-restored', (_event, data) => callback(data));
  },

  // ============ Persona 事件 ============
  onPersonaUpdated: (callback: (data: { persona: any; onboardingDone: boolean }) => void) => {
    ipcRenderer.on('persona-updated', (_event, data) => callback(data));
  },

  // ============ 通用事件监听 ============
  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => callback(...args);
    (callback as any).__ipcHandler = handler;
    ipcRenderer.on(channel, handler);
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (callback as any).__ipcHandler;
    if (handler) {
      ipcRenderer.removeListener(channel, handler);
    }
  },
});
