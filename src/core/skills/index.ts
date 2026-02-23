/**
 * ============================================================
 * Skill System - Main Index
 * ============================================================
 * 统一导出 Skill 系统的所有公开 API
 */

// 导出所有类型
export type {
  Skill,
  SkillMetadata,
  SkillParameter,
  SkillLoadOptions,
  SkillQueryFilter,
  SkillValidationResult,
  SkillRenderOptions,
  SkillRegistryOptions,
  SkillComposeResult,
} from './types';

// 导出 SkillRegistry
export { SkillRegistry, getSkillRegistry, resetSkillRegistry } from './registry';

// 导出 SkillValidator
export { SkillValidator } from './validator';

// 导出 SkillLoader
export { SkillLoader, getSkillLoader, resetSkillLoader } from './loader';

// 导出内置 Skill 初始化函数
export { initializeBuiltinSkills } from './builtin';
