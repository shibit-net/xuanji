// ============================================================
// 全局类型定义
// ============================================================

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

  settingsGetConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
  settingsUpdateConfig: (data: any) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
