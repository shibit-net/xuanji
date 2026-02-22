// ============================================================
// M1 终端 UI — 共享类型定义
// ============================================================

import type { TokenUsage } from '@/types';

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolIsError?: boolean;
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
