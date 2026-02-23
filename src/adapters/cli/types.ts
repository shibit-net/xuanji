// ============================================================
// M1 终端 UI — 共享类型定义
// ============================================================

import type { TokenUsage } from '@/core/types';

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolIsError?: boolean;
  toolDuration?: number;
  timestamp: number;
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
