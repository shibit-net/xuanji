// ============================================================
// Memory Context Skill — 注入历史记忆到 system prompt
// ============================================================

import type { Skill, SkillRenderOptions } from '../../types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'memory-context' });

/**
 * memory-context Skill
 *
 * 优先级 95（在 xuanji-assistant(100) 和 project-rules(90) 之间）。
 * 从 MemoryManager 检索与当前查询相关的历史记忆，
 * 格式化为 Markdown 后注入 system prompt。
 */
export const memoryContextSkill: Skill<string> = {
  id: 'memory-context',
  name: 'Memory Context',
  version: '1.0.0',
  description: '注入相关历史记忆到 system prompt',
  category: 'prompt',
  tags: ['memory', 'context', 'history'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-26'),
  dependencies: [],
  conflicts: [],
  enabled: true,
  priority: 95,

  render: async (_options?: SkillRenderOptions): Promise<string> => {
    try {
      // 记忆上下文通过 ChatSession.run() 动态注入到 MessageManager 的 systemPromptSuffix，
      // 而非通过 Skill 渲染。这里提供 Skill 占位以确保系统一致性。
      //
      // 在 ChatSession.run() 中：
      // 1. 调用 memoryManager.retrieve(userMessage) 检索相关记忆
      // 2. 调用 memoryManager.formatForPrompt(memories) 格式化
      // 3. 通过 messageManager.setSystemPromptSuffix() 注入
      //
      // 这样设计是因为记忆检索需要当前用户消息作为查询，
      // 而 Skill render 在初始化阶段执行，无法获得用户输入。
      return '';
    } catch (error) {
      log.warn('Failed to render memory context:', error);
      return '';
    }
  },
};
