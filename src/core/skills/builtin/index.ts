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
  memoryContextSkill,
  codeAssistantSkill,
  lifeSecretarySkill,
  toolGuidanceSkill,
  securityRulesSkill,
  agentRulesSkill,
} from './prompts';

// 导出所有 Workflow Skills
export {
  commitSkill,
  reviewPRSkill,
} from './workflows';

// 导出初始化函数
export { initializeBuiltinSkills } from './init';
