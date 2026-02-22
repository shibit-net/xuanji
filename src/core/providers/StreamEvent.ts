// ============================================================
// M7 LLM Provider — 流事件类型 (re-export)
// ============================================================

// StreamEvent 相关类型已在 types/provider.ts 中定义
// 此文件提供额外的流处理工具函数

import type { StreamEvent, StreamEventType } from '@/core/types';

/**
 * 判断事件是否为文本类型
 */
export function isTextEvent(event: StreamEvent): boolean {
  return event.type === 'text_delta' && event.text !== undefined;
}

/**
 * 判断事件是否为思考类型
 */
export function isThinkingEvent(event: StreamEvent): boolean {
  return event.type === 'thinking_delta' && event.thinking !== undefined;
}

/**
 * 判断事件是否为工具调用类型
 */
export function isToolEvent(event: StreamEvent): boolean {
  return event.type === 'tool_use_start' || event.type === 'tool_use_delta' || event.type === 'tool_use_end';
}

/**
 * 判断事件是否为终止事件
 */
export function isEndEvent(event: StreamEvent): boolean {
  return event.type === 'end';
}

export type { StreamEvent, StreamEventType };
