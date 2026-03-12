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
});

// 类型定义（供 TypeScript 使用）
export interface ElectronAPI {
  getVersion: () => Promise<string>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;

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

  onAgentText: (callback: (text: string) => void) => void;
  onAgentThinking: (callback: (thinking: string) => void) => void;
  onAgentToolStart: (callback: (data: { id: string; name: string; input: Record<string, unknown> }) => void) => void;
  onAgentToolEnd: (callback: (data: { id: string; name: string; result: string; isError: boolean }) => void) => void;
  onAgentUsage: (callback: (usage: any) => void) => void;
  onAgentError: (callback: (error: string) => void) => void;
  onAgentEnd: (callback: (state: { tokenUsage: any; cost: number; currentIteration: number }) => void) => void;

  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
