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
  agentInterrupt: () => ipcRenderer.invoke('agent:interrupt'),
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

  // ============ 工具统计 ============
  usageStats: () => ipcRenderer.invoke('usage:stats'),

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

  onAskUserRequest: (callback: (data: any) => void) => {
    ipcRenderer.on('ask-user:request', (_event, data) => callback(data));
  },
  askUserRespond: (data: any) => ipcRenderer.invoke('ask-user:respond', data),
});
