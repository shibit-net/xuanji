// ============================================================
// M1 终端 UI — 共享类型定义
// ============================================================

import type { TokenUsage } from '@/core/types';
import type { TodoProgressData } from '../cli/TodoPanel';

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'tool_group';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolIsError?: boolean;
  toolDuration?: number;
  /** 该工具是否通过并行方式执行 */
  toolParallel?: boolean;
  /** 并行工具组的工具列表（仅当 role='tool_group' 时有效） */
  toolGroupItems?: ParallelToolGroupItem[];
  timestamp: number;
  /** 增量刷出的部分消息（不加 marginBottom，避免视觉断裂） */
  partial?: boolean;
  /** TODO 进度快照（归档到 Static 时携带，用于渲染 TodoPanel） */
  todoData?: TodoProgressData;
}

/**
 * 并行工具组中的单个工具项
 */
export interface ParallelToolGroupItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  duration: number;
}

/**
 * 🆕 Pending 用户输入（队列项）
 */
export interface PendingUserInput {
  content: string;
  timestamp: number;
  merged?: boolean;       // 是否由多条消息合并而成
  originalCount?: number; // 合并前的消息数
}

/**
 * 工具调用结果展示数据
 */
export interface ToolResultDisplay {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  duration: number;
}

/**
 * 当前正在执行的工具
 */
export interface CurrentToolState {
  name: string;
  input: Record<string, unknown>;
}

/**
 * 应用模式（M1 终端 UI 中的模式切换）
 */
export type AppMode = 'chat' | 'settings' | 'logs' | 'bots';

/**
 * 设置面板的标签页
 */
export type SettingsTab = 'llm' | 'ui' | 'bots_config';

/**
 * 日志条目（JSONL 格式）
 */
export interface LogEntry {
  timestamp: string;        // ISO 格式或 HH:mm:ss
  source: 'Chat' | 'Bot' | 'Config' | 'System';
  message: string;
  level: 'info' | 'warn' | 'error';
}

/**
 * IM 机器人类型
 */
export type BotType = 'dingtalk' | 'feishu' | 'wecom';

/**
 * 机器人状态
 */
export interface BotStatus {
  type: BotType;
  enabled: boolean;
  running: boolean;
  lastError?: string;
  lastStartTime?: number;
}
