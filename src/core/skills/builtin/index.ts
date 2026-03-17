/**
 * ============================================================
 * Built-in Skills - Main Index
 * ============================================================
 * 所有内置 Skill 的统一导出和初始化
 *
 * 重构后：只导出 Workflow Skill，
 * Prompt 内容已迁移到 src/core/prompt/。
 */

// 导出 Workflow Skills（真正的技能）
export {
  commitSkill,
  reviewPRSkill,
} from './workflows';

// 导出初始化函数
export { initializeBuiltinSkills } from './init';
