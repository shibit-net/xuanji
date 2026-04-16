/**
 * ============================================================
 * L0 Component: Identity — 璇玑核心人设（组合组件）
 * ============================================================
 * 组合 base-identity + base-memory-guide + base-task-execution。
 * 保持向后兼容，主 Agent 使用此组件。
 * ~1000 tokens
 */

import type { PromptComponent, PromptBuildContext } from '../types';
import { buildBaseIdentityPrompt } from './base-identity';
import { buildMemoryGuidePrompt } from './base-memory-guide';
import { buildTaskExecutionPrompt } from './base-task-execution';

/**
 * 构建完整的 Identity prompt（组合三个 base 组件）
 * @deprecated 推荐直接使用 base-identity + base-memory-guide + base-task-execution
 */
export function buildIdentityPrompt(persona?: any): string {
  // 组合三个 base 组件
  const parts = [
    buildBaseIdentityPrompt(persona),
    buildMemoryGuidePrompt(),
    buildTaskExecutionPrompt(),
  ];

  return parts.join('\n\n');
}

export const l0Identity: PromptComponent = {
  id: 'l0-identity',
  name: 'Core Identity',
  layer: 'L0',
  priority: 100,
  estimatedTokens: 1000,

  render(context: PromptBuildContext): string {
    return buildIdentityPrompt(context.config?.persona);
  },
};
