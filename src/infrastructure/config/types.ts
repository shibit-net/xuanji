/**
 * Config 模块类型定义
 */

export interface UserSettings {
  defaultProvider: string;
  providers: Record<string, { adapter: string; apiKey: string; baseURL: string; model?: string }>;
  defaultModel: string;
  maxIterations: number;
  maxTokens: number;
  temperature: number;
}

export interface SystemConfig {
  language: 'zh-CN' | 'en';
  theme: 'light' | 'dark';
  keybindings: Record<string, string>;
}

export interface AgentConfig {
  id: string;
  name: string;
  type?: 'agent' | 'embedding';
  enabled: boolean;
  model: { primary: string; temperature?: number; maxTokens?: number; thinking?: any };
  systemPrompt: string;
  tools: Array<{ name: string; required?: boolean; enabled?: boolean; config?: Record<string, unknown> }>;
  provider?: { apiKey?: string; baseURL?: string; adapter?: string };
  execution: { timeout: number; maxIterations: number };
  metadata?: Record<string, any>;
}
