/**
 * 会话持久化类型定义
 */

/**
 * 消息结构（与 MessageManager 兼容）
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
    tool_use_id?: string;
    content?: any;
  }>;
  timestamp?: number;
}

/**
 * 会话元数据
 */
export interface SessionMetadata {
  /** 会话唯一标识 */
  id: string;
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
 */
export interface SessionSnapshot {
  metadata: SessionMetadata;
  messages: Message[];
  checkpoints: Checkpoint[];
}

/**
 * 会话列表项（用于 /resume 命令显示）
 */
export interface SessionListItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  workingDirectory: string;
}

/**
 * SessionStorage 配置
 */
export interface SessionStorageOptions {
  /** 会话存储根目录（默认 ~/.xuanji/sessions） */
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
