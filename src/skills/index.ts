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
} from './types';

// 导出 SkillRegistry
export { SkillRegistry, getSkillRegistry, resetSkillRegistry } from './registry';

// 导出 SkillValidator
export { SkillValidator, checkCodeSafety } from './validator';
export type { CodeSafetyResult } from './validator';

// 导出 SkillLoader
export { SkillLoader, getSkillLoader, resetSkillLoader } from './loader';

// 导出内置 Skill 初始化函数
export { initializeBuiltinSkills } from './builtin';

// 导出 SkillInstaller（Marketplace 集成）
export { SkillInstaller } from './SkillInstaller';
export type { SkillInstallOptions, SkillInstallResult, SkillUninstallResult } from './SkillInstaller';

// 导出 SkillSandbox（安全沙箱）
export { SkillSandbox, getSkillSandbox, resetSkillSandbox } from './SkillSandbox';
