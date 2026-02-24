/**
 * Preload Script — 安全隔离 IPC 通信
 *
 * 职责：
 * 1. 通过 contextBridge 向渲染进程暴露受限的 IPC API
 * 2. 防止渲染进程直接访问 Node.js API
 * 3. 提供事件监听注册/取消函数
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Xuanji 主进程暴露的 API 类型定义
 */
export interface XuanjiAPI {
  config: {
    load: () => Promise<Record<string, unknown>>;
    save: (config: Record<string, unknown>) => Promise<void>;
  };
  chat: {
    init: (options?: { model?: string }) => Promise<void>;
    run: (message: string) => Promise<void>;
    stop: () => Promise<void>;
    reset: () => Promise<void>;
    state: () => Promise<Record<string, unknown>>;
    onText: (callback: (text: string) => void) => () => void;
    onThinking: (callback: (text: string) => void) => () => void;
    onToolStart: (callback: (data: {
      id: string;
      name: string;
      input: Record<string, unknown>;
    }) => void) => () => void;
    onToolEnd: (callback: (data: {
      id: string;
      name: string;
      result: string;
      isError: boolean;
      duration: number;
    }) => void) => () => void;
    onToolDelta: (callback: (data: {
      id: string;
      name: string;
      receivedBytes: number;
    }) => void) => () => void;
    onUsage: (callback: (usage: any) => void) => () => void;
    onError: (callback: (error: string) => void) => () => void;
    onEnd: (callback: (data: any) => void) => () => void;
  };
  bot: {
    start: (type: string, config?: Record<string, string>) => Promise<void>;
    stop: (type: string) => Promise<void>;
    list: () => Promise<unknown[]>;
    onStatus: (callback: (data: any) => void) => () => void;
    onLog: (callback: (data: any) => void) => () => void;
  };
  models: {
    list: (options?: { page?: number; size?: number; name?: string }) => Promise<unknown[]>;
  };
  log: {
    onLog: (callback: (data: any) => void) => () => void;
    load: (options?: { maxLines?: number; days?: number }) => Promise<string[]>;
  };
}

/**
 * 配置管理 API
 */
const configAPI = {
  load: () => ipcRenderer.invoke('config:load'),
  save: (config: Record<string, unknown>) => ipcRenderer.invoke('config:save', config),
};

/**
 * 对话管理 API（会话、运行、停止等）
 */
const chatAPI = {
  init: (options?: { model?: string }) => ipcRenderer.invoke('chat:init', options),
  run: (message: string) => ipcRenderer.invoke('chat:run', message),
  stop: () => ipcRenderer.invoke('chat:stop'),
  reset: () => ipcRenderer.invoke('chat:reset'),
  state: () => ipcRenderer.invoke('chat:state'),

  // 事件监听注册
  onText: (callback: (text: string) => void) => {
    const handler = (_event: any, text: string) => callback(text);
    ipcRenderer.on('chat:text', handler);
    return () => ipcRenderer.removeListener('chat:text', handler);
  },

  onThinking: (callback: (text: string) => void) => {
    const handler = (_event: any, text: string) => callback(text);
    ipcRenderer.on('chat:thinking', handler);
    return () => ipcRenderer.removeListener('chat:thinking', handler);
  },

  onToolStart: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat:tool-start', handler);
    return () => ipcRenderer.removeListener('chat:tool-start', handler);
  },

  onToolEnd: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat:tool-end', handler);
    return () => ipcRenderer.removeListener('chat:tool-end', handler);
  },

  onToolDelta: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat:tool-delta', handler);
    return () => ipcRenderer.removeListener('chat:tool-delta', handler);
  },

  onUsage: (callback: (usage: any) => void) => {
    const handler = (_event: any, usage: any) => callback(usage);
    ipcRenderer.on('chat:usage', handler);
    return () => ipcRenderer.removeListener('chat:usage', handler);
  },

  onError: (callback: (error: string) => void) => {
    const handler = (_event: any, error: string) => callback(error);
    ipcRenderer.on('chat:error', handler);
    return () => ipcRenderer.removeListener('chat:error', handler);
  },

  onEnd: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat:end', handler);
    return () => ipcRenderer.removeListener('chat:end', handler);
  },
};

/**
 * IM 机器人管理 API
 */
const botAPI = {
  start: (type: string, config?: Record<string, string>) => ipcRenderer.invoke('bot:start', type, config),
  stop: (type: string) => ipcRenderer.invoke('bot:stop', type),
  list: () => ipcRenderer.invoke('bot:list'),

  // 事件监听
  onStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('bot:status', handler);
    return () => ipcRenderer.removeListener('bot:status', handler);
  },

  onLog: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('bot:log', handler);
    return () => ipcRenderer.removeListener('bot:log', handler);
  },
};

/**
 * 模型列表 API
 */
const modelsAPI = {
  list: (options?: { page?: number; size?: number; name?: string }) =>
    ipcRenderer.invoke('models:list', options),
};

/**
 * 主进程日志 API
 */
const mainLogAPI = {
  onLog: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('main:log', handler);
    return () => ipcRenderer.removeListener('main:log', handler);
  },
  load: (options?: { maxLines?: number; days?: number }) => ipcRenderer.invoke('log:load', options),
};

/**
 * 通过 contextBridge 暴露 API 到渲染进程
 *
 * 用法：在渲染进程中访问 window.xuanji.config.load() 等
 */
contextBridge.exposeInMainWorld('xuanji', {
  config: configAPI,
  chat: chatAPI,
  bot: botAPI,
  models: modelsAPI,
  log: mainLogAPI,
});
