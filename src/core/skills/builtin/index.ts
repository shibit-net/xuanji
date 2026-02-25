/**
 * ============================================================
 * Built-in Skills - Main Index
 * ============================================================
 * 所有内置 Skill 的统一导出和初始化
 */

// 导出所有 Prompt Skills
export {
  xuanjiAssistantSkill,
  projectRulesSkill,
  toolGuidanceSkill,
  securityRulesSkill,
  agentRulesSkill,
} from './prompts';

// 导出所有 Agent Skills
export {
  reactLoopDefaultSkill,
  multiTurnHandlingSkill,
} from './agents';

// 导出初始化函数
export { initializeBuiltinSkills } from './init';
