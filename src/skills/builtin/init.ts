/**
 * ============================================================
 * Built-in Skills - Initialization
 * ============================================================
 * 初始化并注册所有内置 Skill
 *
 * 重构后：只注册真正的 Skill（Workflow），
 * Prompt 类内容已迁移到 LayeredPromptBuilder。
 */

import type { SkillRegistry } from '../registry';
import {
  commitSkill,
  reviewPRSkill,
} from './index';

/**
 * 初始化所有内置 Skill
 *
 * 只注册 Workflow Skill（真正的技能），
 * Prompt 内容由 LayeredPromptBuilder 管理。
 */
export function initializeBuiltinSkills(registry: SkillRegistry): void {
  // 注册 Workflow Skills（真正的技能）
  registry.register(commitSkill);
  registry.register(reviewPRSkill);
}

/**
 * 获取所有内置 Skill
 */
export function getBuiltinSkills() {
  return [
    commitSkill,
    reviewPRSkill,
  ];
}
