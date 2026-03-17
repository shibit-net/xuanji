/**
 * ============================================================
 * Core Block: Memory — 记忆上下文占位
 * ============================================================
 * 迁移自 memory-context Skill
 *
 * 实际记忆内容通过 ChatSession.run() 动态注入到
 * MessageManager.setSystemPromptSuffix()，这里只是占位。
 */

import type { PromptBlock, PromptBuildContext } from '../types';

export const memoryBlock: PromptBlock = {
  id: 'memory',
  name: 'Memory Context',
  priority: 95,

  render(_context: PromptBuildContext): string {
    // 记忆上下文通过 ChatSession.run() 动态注入，
    // 而非在 prompt 构建阶段渲染。
    return '';
  },
};
