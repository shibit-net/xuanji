// ============================================================
// MemoryAttributeInferrer — 记忆属性推断器（单一职责）
// ============================================================
// 统一的记忆属性推断逻辑，供 MemoryExtractor 和 MemoryStoreTool 共享

import type { MemoryEntryType, MemoryScope, MemoryVolatility } from './types';

export interface MemoryAttributes {
  scope: MemoryScope;
  volatility: MemoryVolatility;
  significance: number;
  categoryLabel: string;
}

/**
 * 根据记忆类型推断所有属性（单一职责原则）
 */
export function inferMemoryAttributes(type: MemoryEntryType): MemoryAttributes {
  // profile 层：用户画像相关，stable 时效性，高重要性
  if (type === 'user_fact' || type === 'user_preference') {
    return {
      scope: 'profile',
      volatility: 'stable',
      significance: 0.8,
      categoryLabel: type === 'user_fact' ? '用户/基本信息' : '用户/偏好习惯',
    };
  }
  if (type === 'relationship') {
    return {
      scope: 'profile',
      volatility: 'stable',
      significance: 0.8,
      categoryLabel: '用户/人际关系',
    };
  }
  if (type === 'important_date') {
    return {
      scope: 'profile',
      volatility: 'stable',
      significance: 0.7,
      categoryLabel: '用户/重要日期',
    };
  }

  // knowledge 层：经验教训、决策，normal 时效性
  if (type === 'decision') {
    return {
      scope: 'knowledge',
      volatility: 'normal',
      significance: 0.7,
      categoryLabel: '项目/决策记录',
    };
  }
  if (type === 'error_resolution') {
    return {
      scope: 'knowledge',
      volatility: 'normal',
      significance: 0.6,
      categoryLabel: '经验/错误解决',
    };
  }
  if (type === 'tool_pattern') {
    return {
      scope: 'knowledge',
      volatility: 'normal',
      significance: 0.6,
      categoryLabel: '经验/工具模式',
    };
  }
  if (type === 'lesson_learned' || type === 'reusable_pattern' || type === 'domain_knowledge' || type === 'agent_knowledge') {
    return {
      scope: 'knowledge',
      volatility: 'normal',
      significance: 0.6,
      categoryLabel: '经验/知识库',
    };
  }

  // episode 层：会话摘要、项目事实，transient 时效性
  if (type === 'session_summary') {
    return {
      scope: 'episode',
      volatility: 'transient',
      significance: 0.3,
      categoryLabel: '会话/摘要',
    };
  }
  if (type === 'project_fact') {
    return {
      scope: 'episode',
      volatility: 'normal',
      significance: 0.5,
      categoryLabel: '项目/事实',
    };
  }
  if (type === 'unfinished_task') {
    return {
      scope: 'episode',
      volatility: 'transient',
      significance: 0.6,
      categoryLabel: '任务/待办',
    };
  }

  // 默认 episode 层
  return {
    scope: 'episode',
    volatility: 'transient',
    significance: 0.5,
    categoryLabel: '其他',
  };
}
