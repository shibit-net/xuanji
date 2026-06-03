// ============================================================
// AgentEditor 共享常量、类型和工具函数
// ============================================================

import type { AgentCategory } from '../../../utils/agentPermissions';

// 根据工具名推断分类
export function inferToolCategory(name: string): string {
  if (/^(read_file|write_file|edit_file|multi_edit|glob|grep|list_directory|change_directory|docx_edit|xlsx_edit|pdf|doc_to_docx|notebook_edit|send_file_to_user)$/.test(name)) return 'file';
  if (/^(bash|ssh_exec|ssh_list|ssh_read|ssh_write|enter_worktree|exit_plan_mode|enter_plan_mode|task$|task_control|task_output|plan_review)$/.test(name)) return 'code';
  if (/^(sleep|scheduler|install|uninstall|mcp_settings|todo_)/.test(name)) return 'system';
  if (/^(web_fetch|web_search)$/.test(name)) return 'network';
  return 'meta';
}

// 工具分类 → Tailwind 色系
export const TOOL_CATEGORY_STYLE: Record<string, { bg: string; border: string; dot: string; text: string; label: string }> = {
  file: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', dot: 'bg-blue-400/60', text: 'text-blue-300/80', label: '文件' },
  code: { bg: 'bg-green-500/10', border: 'border-green-500/20', dot: 'bg-green-400/60', text: 'text-green-300/80', label: '代码' },
  system: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', dot: 'bg-purple-400/60', text: 'text-purple-300/80', label: '系统' },
  network: { bg: 'bg-orange-500/10', border: 'border-orange-500/20', dot: 'bg-orange-400/60', text: 'text-orange-300/80', label: '网络' },
  meta: { bg: 'bg-pink-500/10', border: 'border-pink-500/20', dot: 'bg-pink-400/60', text: 'text-pink-300/80', label: '元认知' },
};

// 媒体生成工具名称和默认配置
export const MEDIA_TOOL_NAMES = new Set(['generate_image', 'edit_image', 'generate_video', 'generate_audio']);

export const MEDIA_TOOL_DEFAULT_CONFIG: Record<string, Record<string, unknown>> = {
  generate_image: {
    defaultSize: '2K',
    watermark: false,
  },
  edit_image: {
    watermark: false,
  },
  generate_video: {
    defaultSize: '2K',
    defaultDuration: 5,
    pollInterval: 5000,
    pollTimeout: 600000,
  },
  generate_audio: {
    defaultDuration: 30,
  },
};

export interface AgentEditorProps {
  agent: any | null;
  builtinAgents: any[];
  onSave: (config: any) => void;
  onCancel: () => void;
}

export type EditorMode = 'form' | 'json5';
export type ExpandedSections = Set<string>;

export interface ModelOption {
  id: number;
  name: string;
  model: string;
  adapter: string;
  vendor?: string;
  inputPrice?: number;
  outputPrice?: number;
  priceUnit?: string;
}

// 默认配置（创建新 Agent 时使用）
export const DEFAULT_CONFIG = {
  id: '',
  name: '',
  description: '',
  enabled: true,
  capabilities: [],
  skills: [],

  systemPrompt: '',

  model: {
    primary: 'claude-sonnet-4-6',
    temperature: 0.3,
    thinking: {
      type: 'adaptive',
      effort: 'medium',
    },
  },

  provider: {
    adapter: 'anthropic',
  },

  tools: [
    { name: 'read_file', enabled: true },
    { name: 'write_file', enabled: true },
    { name: 'edit_file', enabled: true },
    { name: 'bash', enabled: true },
    { name: 'glob', enabled: true },
    { name: 'grep', enabled: true },
  ],

  execution: {
    mode: 'react',
    maxIterations: 100,
    timeout: 300000,
    streaming: true,
    parallelTools: true,
  },

  permissions: {
    fileRead: 'always',
    fileWrite: 'ask',
    bashExec: 'ask',
    network: 'ask',
  },
};

// 本地模型不需要 API Key
export const LOCAL_PROVIDERS = new Set(['ollama', 'vllm', 'lmstudio', 'local-llama']);

export function canEnableAgent(cfg: any): boolean {
  const adapter = cfg.provider?.adapter || 'anthropic';
  if (LOCAL_PROVIDERS.has(adapter)) return true;
  return !!cfg.provider?.apiKey;
}
