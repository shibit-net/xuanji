/**
 * ============================================================
 * Skill System - Validator
 * ============================================================
 * 验证 Skill 的有效性和依赖关系。
 * 同时包含代码安全扫描，用于 action/workflow Skill 的
 * 第三方 .js 代码校验。
 */

import type { Skill, SkillValidationResult } from './types';
import { SkillRegistry } from './registry';

// ============================================================
// Code Safety Scanner (for action/workflow tar.gz skills)
// ============================================================

/**
 * 代码安全扫描结果
 */
export interface CodeSafetyResult {
  /** 是否安全 */
  safe: boolean;
  /** 被拦截的模块/模式列表 */
  blocked: string[];
  /** 警告（允许但记录） */
  warnings: string[];
}

/** 禁止的 import/require 模式 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, label: 'child_process' },
  { pattern: /from\s+['"]child_process['"]/, label: 'child_process (ESM import)' },
  { pattern: /require\s*\(\s*['"]vm['"]\s*\)/, label: 'vm' },
  { pattern: /from\s+['"]vm['"]/, label: 'vm (ESM import)' },
  { pattern: /require\s*\(\s*['"]worker_threads['"]\s*\)/, label: 'worker_threads' },
  { pattern: /from\s+['"]worker_threads['"]/, label: 'worker_threads (ESM import)' },
  { pattern: /require\s*\(\s*['"]worker_threads['"]\s*\)/, label: 'worker_threads' },
  { pattern: /\beval\s*\(/, label: 'eval()' },
  { pattern: /\bnew\s+Function\s*\(/, label: 'new Function()' },
];

/** 警告但不拦截的模式 */
const WARNING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/, label: 'fs (CommonJS)' },
  { pattern: /from\s+['"]fs['"]/, label: 'fs (ESM import)' },
  { pattern: /require\s*\(\s*['"]fs\/promises['"]\s*\)/, label: 'fs/promises' },
  { pattern: /from\s+['"]fs\/promises['"]/, label: 'fs/promises (ESM import)' },
  { pattern: /require\s*\(\s*['"]http['"]\s*\)/, label: 'http' },
  { pattern: /from\s+['"]http['"]/, label: 'http (ESM import)' },
  { pattern: /require\s*\(\s*['"]https['"]\s*\)/, label: 'https' },
  { pattern: /from\s+['"]https['"]/, label: 'https (ESM import)' },
  { pattern: /require\s*\(\s*['"]net['"]\s*\)/, label: 'net' },
  { pattern: /from\s+['"]net['"]/, label: 'net (ESM import)' },
  { pattern: /process\.env/, label: 'process.env' },
];

/**
 * 扫描源代码，检测禁止的模式（child_process, vm, eval 等）。
 *
 * 用途：在导入第三方 action/workflow Skill 的 .js 代码前进行安全检查。
 * 注意：此扫描基于静态正则匹配，不能提供 100% 的安全保证。
 * Worker 沙箱提供第二层运行时隔离。
 *
 * @param source - 待扫描的 JavaScript 源代码
 * @returns 扫描结果，包含 safe 状态和拦截/警告列表
 */
export function checkCodeSafety(source: string): CodeSafetyResult {
  const blocked: string[] = [];
  const warnings: string[] = [];

  for (const { pattern, label } of BLOCKED_PATTERNS) {
    if (pattern.test(source)) {
      blocked.push(label);
    }
  }

  for (const { pattern, label } of WARNING_PATTERNS) {
    if (pattern.test(source)) {
      warnings.push(label);
    }
  }

  return {
    safe: blocked.length === 0,
    blocked,
    warnings,
  };
}

/**
 * Skill 验证器
 */
export class SkillValidator {
  constructor(private registry: SkillRegistry) {}

  /**
   * 验证单个 Skill
   */
  validate(skillId: string): SkillValidationResult {
    return this.registry.validate(skillId);
  }

  /**
   * 验证多个 Skill
   */
  validateBatch(skillIds: string[]): Record<string, SkillValidationResult> {
    const results: Record<string, SkillValidationResult> = {};
    for (const id of skillIds) {
      results[id] = this.validate(id);
    }
    return results;
  }

  /**
   * 验证组合是否有效 (检查所有 Skill 及其依赖)
   */
  validateCompose(skillIds: string[]): SkillValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];
    const missingDeps = new Set<string>();
    const conflictSkills = new Set<string>();
    const visited = new Set<string>();

    const traverse = (id: string) => {
      if (visited.has(id)) {
        return;
      }
      visited.add(id);

      const result = this.validate(id);

      if (!result.valid) {
        allErrors.push(...result.errors);
      }

      allWarnings.push(...result.warnings);

      if (result.missingDependencies) {
        result.missingDependencies.forEach((dep) => missingDeps.add(dep));
      }

      if (result.conflicts) {
        result.conflicts.forEach((c) => conflictSkills.add(c));
      }

      // 递归检查依赖
      const skill = this.registry.get(id);
      if (skill?.dependencies) {
        for (const dep of skill.dependencies) {
          traverse(dep);
        }
      }
    };

    for (const id of skillIds) {
      traverse(id);
    }

    return {
      valid: allErrors.length === 0 && missingDeps.size === 0,
      errors: allErrors,
      warnings: allWarnings,
      missingDependencies:
        missingDeps.size > 0 ? Array.from(missingDeps) : undefined,
      conflicts: conflictSkills.size > 0 ? Array.from(conflictSkills) : undefined,
    };
  }

  /**
   * 检查是否存在循环依赖
   */
  detectCyclicDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (skillId: string, path: string[]): boolean => {
      visited.add(skillId);
      recursionStack.add(skillId);

      const skill = this.registry.get(skillId);
      if (skill?.dependencies) {
        for (const dep of skill.dependencies) {
          if (!visited.has(dep)) {
            if (dfs(dep, [...path, dep])) {
              return true;
            }
          } else if (recursionStack.has(dep)) {
            // 检测到循环
            const cycleStart = path.indexOf(dep);
            const cycle = [...path.slice(cycleStart), dep];
            cycles.push(cycle);
            return true;
          }
        }
      }

      recursionStack.delete(skillId);
      return false;
    };

    const allSkills = this.registry.list();
    for (const skill of allSkills) {
      if (!visited.has(skill.id)) {
        dfs(skill.id, [skill.id]);
      }
    }

    return cycles;
  }

  /**
   * 检查所需的工具是否可用
   */
  validateRequiredTools(
    skillId: string,
    availableTools: string[]
  ): { valid: boolean; missing: string[] } {
    const skill = this.registry.get(skillId);
    if (!skill?.requiredTools || skill.requiredTools.length === 0) {
      return { valid: true, missing: [] };
    }

    const missing = skill.requiredTools.filter(
      (tool) => !availableTools.includes(tool)
    );

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * 验证参数
   */
  validateParameters(
    skillId: string,
    params: Record<string, any>
  ): SkillValidationResult {
    const skill = this.registry.get(skillId);
    if (!skill) {
      return {
        valid: false,
        errors: [`Skill "${skillId}" not found`],
        warnings: [],
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!skill.parameters) {
      return { valid: true, errors, warnings };
    }

    // 检查必需参数
    for (const [paramName, paramDef] of Object.entries(
      skill.parameters
    )) {
      if (paramDef.required && !(paramName in params)) {
        errors.push(
          `Required parameter "${paramName}" is missing`
        );
      }

      // 检查类型
      if (paramName in params) {
        const value = params[paramName];
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (actualType !== paramDef.type) {
          errors.push(
            `Parameter "${paramName}" should be ${paramDef.type}, got ${actualType}`
          );
        }

        // 检查枚举值
        if (paramDef.enum && !paramDef.enum.includes(value)) {
          errors.push(
            `Parameter "${paramName}" should be one of: ${paramDef.enum.join(', ')}, got ${value}`
          );
        }
      }
    }

    // 检查未定义的参数
    for (const paramName of Object.keys(params)) {
      if (!(paramName in skill.parameters)) {
        warnings.push(`Unknown parameter: "${paramName}"`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 生成验证报告
   */
  generateReport(): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('Skill Registry Validation Report');
    lines.push('='.repeat(60));
    lines.push('');

    // 统计信息
    const stats = this.registry.getStats();
    lines.push('Summary:');
    lines.push(`  Total Skills: ${stats.totalSkills}`);
    lines.push(`  - Prompt: ${stats.byCategory.prompt}`);
    lines.push(`  - Workflow: ${stats.byCategory.workflow}`);
    lines.push(`  Enabled: ${stats.enabled}`);
    lines.push(`  Disabled: ${stats.disabled}`);
    lines.push('');

    // 检查循环依赖
    const cycles = this.detectCyclicDependencies();
    if (cycles.length > 0) {
      lines.push('⚠️  Cyclic Dependencies Found:');
      for (const cycle of cycles) {
        lines.push(`  - ${cycle.join(' -> ')}`);
      }
      lines.push('');
    } else {
      lines.push('✅ No cyclic dependencies detected');
      lines.push('');
    }

    // 验证所有 Skill
    const skills = this.registry.list();
    let hasErrors = false;

    for (const skill of skills) {
      const result = this.validate(skill.id);
      if (!result.valid) {
        hasErrors = true;
        lines.push(`❌ ${skill.id}:`);
        for (const error of result.errors) {
          lines.push(`   - ${error}`);
        }
      } else if (result.warnings.length > 0) {
        lines.push(`⚠️  ${skill.id}:`);
        for (const warning of result.warnings) {
          lines.push(`   - ${warning}`);
        }
      } else {
        lines.push(`✅ ${skill.id}`);
      }
    }

    lines.push('');
    lines.push('='.repeat(60));
    lines.push(hasErrors ? 'Status: FAILED' : 'Status: PASSED');
    lines.push('='.repeat(60));

    return lines.join('\n');
  }
}
