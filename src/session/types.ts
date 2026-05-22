/**
 * 会话持久化类型定义
 */

/**
 * 消息结构（与 core/types/agent.ts 的 Message/ContentBlock 兼容）
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string;
    is_error?: boolean;
    data?: string;
    mimeType?: string;
  }>;
  timestamp?: number;
}

/**
 * 会话元数据
 */
export interface SessionMetadata {
  /** 会话唯一标识 */
  id: string;
  /** 人类可读短标签，格式: {项目名}-{MMdd}{序号}，如 "xuanji-0703a" */
  shortLabel?: string;
  /** 会话名称（用户指定或 LLM 生成） */
  name: string;
  /** 创建时间（Unix 时间戳） */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 消息总数 */
  messageCount: number;
  /** 会话保存时的工作目录 */
  workingDirectory: string;
  /** 内容缩略（最近一轮对话摘要） */
  preview?: string;
  /** Git 仓库信息（如果存在） */
  gitInfo?: {
    branch: string;
    commit: string;
  };
  /** Hook 配置快照（用于恢复时对比） */
  hookConfigHash?: string;
}

/**
 * Checkpoint 数据结构
 */
export interface Checkpoint {
  /** Checkpoint 唯一标识 */
  id: string;
  /** 用户标签 */
  label: string;
  /** 创建时间 */
  createdAt: number;
  /** 指向的消息索引（messages.jsonl 中的行号，从 0 开始） */
  messageIndex: number;
  /** 该 checkpoint 时的消息总数 */
  messageCount: number;
  /** 备注信息 */
  notes?: string;
  /** 文件快照（checkpoint 创建时被修改文件的原始内容） */
  fileSnapshots?: FileSnapshot[];
}

/**
 * 文件快照 — 记录文件在 checkpoint 时刻的内容
 */
export interface FileSnapshot {
  /** 文件绝对路径 */
  path: string;
  /** 文件内容（checkpoint 时刻的原始内容，null 表示文件不存在/新建的） */
  content: string | null;
}

/**
 * 会话快照（用于保存和恢复）
 *
 * 记忆驱动模式：
 * - summary: AI 生成的会话摘要
 * - keyPoints: 关键决策/结论列表
 * - memoryRefs: 相关记忆 ID 引用
 * - recentMessages: 最近 N 条消息（快速上下文恢复）
 * - messages: 持久化到 messages.jsonl 的消息（记忆驱动模式下为 recentMessages 内容）
 */
export interface SessionSnapshot {
  metadata: SessionMetadata;

  /** AI 生成的会话摘要（会话主题、目标、进展） */
  summary?: string;
  /** 关键点列表（重要决策、结论、待办事项） */
  keyPoints?: string[];
  /** 相关记忆 ID 引用（该会话产生或引用的记忆） */
  memoryRefs?: string[];
  /** 最近 N 条消息（saveSnapshot 时优先写入这些消息） */
  recentMessages?: Message[];

  /** 消息历史（从 messages.jsonl 读取） */
  messages: Message[];

  checkpoints: Checkpoint[];
  corruptedLineCount?: number;
  /** 累计 token 用量（用于 resume 时恢复 TokenManager/CostTracker 状态） */
  usage?: SessionUsage;
  /** UI 历史消息摘要（用于 resume 时恢复 chatHistory 展示） */
  historyMessages?: HistoryMessage[];
}

/**
 * 会话 token 用量快照
 */
export interface SessionUsage {
  input: number;
  output: number;
  cost: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * UI 历史消息（纯文本摘要，用于 resume 后展示）
 */
export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/**
 * Resume 返回的完整上下文
 */
export interface ResumedSessionContext {
  /** 会话 ID */
  sessionId: string;

  /** 会话摘要 */
  summary?: string;
  /** 关键点列表 */
  keyPoints?: string[];
  /** 检索到的相关记忆条目 */
  memories?: Array<{
    id: string;
    content: string;
    tags?: string[];
    timestamp: number;
  }>;

  /** LLM 消息历史（记忆驱动模式下为最近 N 条） */
  messages: Message[];
  /** 累计 token 用量 */
  usage: SessionUsage;
  /** UI 历史消息 */
  historyMessages: HistoryMessage[];
}

/**
 * 会话列表项（用于 /resume 命令显示）
 */
export interface SessionListItem {
  id: string;
  /** 人类可读短标签 */
  shortLabel?: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  workingDirectory: string;
  /** 内容缩略 */
  preview?: string;
}

/**
 * SessionStorage 配置
 */
export interface SessionStorageOptions {
  /** 会话存储根目录（默认 .xuanji/sessions） */
  baseDir: string;
  /** 是否自动创建备份（.bak 文件） */
  autoBackup: boolean;
  /** 最大保留会话数（0 表示不限制） */
  maxSessions: number;
}

/**
 * 恢复选项
 */
export interface ResumeOptions {
  /** 是否使用保存时的 Hook 配置 */
  useSavedHooks?: boolean;
  /** 是否验证工作目录一致性 */
  verifyWorkingDirectory?: boolean;
  /** 是否验证 Git 状态一致性 */
  verifyGitState?: boolean;
}
