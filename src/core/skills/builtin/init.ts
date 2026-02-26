/**
 * ============================================================
 * Built-in Skills - Initialization
 * ============================================================
 * 初始化并注册所有内置 Skill
 */

import type { SkillRegistry } from '../registry';
import {
  xuanjiAssistantSkill,
  projectRulesSkill,
  memoryContextSkill,
  codeAssistantSkill,
  toolGuidanceSkill,
  securityRulesSkill,
  agentRulesSkill,
  reactLoopDefaultSkill,
  multiTurnHandlingSkill,
} from './index';

/**
 * 初始化所有内置 Skill
 */
export function initializeBuiltinSkills(registry: SkillRegistry): void {
  // 注册 Prompt Skills
  registry.register(projectRulesSkill); // 先注册依赖
  registry.register(xuanjiAssistantSkill);
  registry.register(memoryContextSkill); // 记忆上下文 (priority 95)
  registry.register(codeAssistantSkill); // 编程领域 Skill
  registry.register(toolGuidanceSkill);
  registry.register(securityRulesSkill);
  registry.register(agentRulesSkill);

  // 注册 Agent Skills
  registry.register(reactLoopDefaultSkill);
  registry.register(multiTurnHandlingSkill);
}

/**
 * 获取所有内置 Skill
 */
export function getBuiltinSkills() {
  return [
    projectRulesSkill,
    xuanjiAssistantSkill,
    memoryContextSkill,
    codeAssistantSkill,
    toolGuidanceSkill,
    securityRulesSkill,
    agentRulesSkill,
    reactLoopDefaultSkill,
    multiTurnHandlingSkill,
  ];
}
