// ============================================================
// Xuanji Desktop - 数据模型类型定义
// ============================================================

// ============================================================
// 配置模型（Configuration Model）
// 静态、持久化、通过配置文件管理
// ============================================================

export interface UserSettings {
  language: 'zh-CN' | 'en-US';
  theme: 'light' | 'dark' | 'auto';
  fontSize: number;
  model: ModelConfig;
  api: APIConfig;
  permissions: PermissionConfig;
}

export interface ModelConfig {
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
}

export interface APIConfig {
  anthropicKey?: string;
  openaiKey?: string;
}

export interface PermissionConfig {
  autoAllowRead: boolean;
  autoAllowWrite: boolean;
  autoAllowBash: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  color?: string;
  enabled: boolean;
  tags: string[];
  capabilities: string[];
  systemPrompt: string;
  tools: Array<{ name: string; required: boolean }>;
  model: {
    primary: string;
    fallback?: string;
    maxTokens?: number;
    temperature?: number;
    thinking?: {
      type?: 'enabled' | 'disabled' | 'adaptive';
      effort?: 'low' | 'medium' | 'high';
    };
  };
  metadata: {
    source: 'builtin' | 'global' | 'project';
    filePath?: string;
    builtin?: boolean;
    isSubAgent?: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  type: 'prompt' | 'agent' | 'workflow';
  category?: 'core' | 'scene';
  enabled: boolean;
  requiredTools?: string[];
  triggers?: string[];
  tags: string[];
  content?: string;
  priority?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'core' | 'search' | 'meta' | 'task' | 'memory' | 'reminder' | 'network' | 'mcp' | 'special';
  required: boolean;
  readonly: boolean;
  inputSchema?: any;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

// ============================================================
// 运行时状态模型（Runtime State Model）
// 动态、易失、反映当前执行状态
// ============================================================

export interface AgentStatus {
  id: string;
  name: string;
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'done' | 'error';
  currentThought?: string;
  currentTool?: {
    name: string;
    status: 'running' | 'success' | 'error';
    duration?: number;
  };
}

export interface ToolCallState {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;

  // Multi-Agent 扩展字段
  multiAgent?: {
    type: 'orchestrate' | 'pipeline' | 'quick_team' | 'agent_team' | 'delegate';
    strategy?: 'sequential' | 'parallel' | 'hierarchical' | 'debate' | 'pipeline';
    teamName?: string;
    members?: Array<{
      id: string;
      name: string;
      role: string;
      status: 'idle' | 'running' | 'success' | 'error';
      progress?: number;
      duration?: number;
      tokenUsage?: number;
    }>;
    steps?: Array<{
      id: string;
      name: string;
      description?: string;
      status: 'pending' | 'running' | 'success' | 'error';
      progress?: number;
      output?: string;
    }>;
    currentStep?: number;
    totalSteps?: number;
  };
}

export interface MessageStreamState {
  text: string;
  thinking: string;
  toolCalls: ToolCallState[];
  finished: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
}

export interface ContextInfo {
  workingDirectory: string;
  focusedFiles: string[];
  recentFiles: string[];
  projectInfo?: {
    name: string;
    type: string;
    dependencies?: string[];
  };
}

export interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: 'system' | 'agent' | 'tool' | 'ipc';
  message: string;
  timestamp: number;
  details?: any;
}

export interface RuntimeState {
  agentStatus: AgentStatus | null;
  messageStream: MessageStreamState | null;
  tokenUsage: TokenUsage;
  cost: number;
  currentIteration: number;
  isProcessing: boolean;
  contextInfo: ContextInfo | null;
  logs: LogEntry[];
}

// ============================================================
// 历史记录模型（History Model）
// 持久化、可查询、只追加
// ============================================================

export interface SessionInfo {
  id: string;
  shortLabel?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workingDirectory?: string;
  preview?: string;
}

export interface CheckpointInfo {
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

export interface ToolCallLog {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
  status: 'success' | 'error';
  timestamp: number;
  duration: number;
}

export interface MemoryStats {
  total: number;
  byType?: Record<string, number>;
}
