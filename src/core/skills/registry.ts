/**
 * ============================================================
 * Skill System - SkillRegistry
 * ============================================================
 * 技能注册表和管理器
 */

import type {
  Skill,
  SkillLoadOptions,
  SkillQueryFilter,
  SkillValidationResult,
  SkillRenderOptions,
  SkillRegistryOptions,
  SkillComposeResult,
} from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SkillRegistry' });

/**
 * 技能注册表 - 管理所有 Skill 的生命周期
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private options: Required<SkillRegistryOptions>;
  private cache: Map<string, string> = new Map();
  private loadedFromCustom: Set<string> = new Set();

  constructor(options: SkillRegistryOptions = {}) {
    this.options = {
      autoLoad: options.autoLoad ?? false,
      customPath: options.customPath ?? '.xuanji/skills',
      cacheSize: options.cacheSize ?? 100,
      validateDependencies: options.validateDependencies ?? true,
    };
  }

  /**
   * 注册一个 Skill
   */
  register(skill: Skill): void {
    if (!skill.id) {
      throw new Error('Skill must have an id');
    }
    if (this.skills.has(skill.id)) {
      log.warn(`Skill "${skill.id}" is already registered, overwriting...`);
    }
    this.skills.set(skill.id, skill);
    this.cache.delete(skill.id); // 清除缓存
  }

  /**
   * 注册多个 Skill
   */
  registerBulk(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 注销一个 Skill
   */
  unregister(id: string): void {
    this.skills.delete(id);
    this.cache.delete(id);
    this.loadedFromCustom.delete(id);
  }

  /**
   * 获取一个 Skill
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * 检查 Skill 是否存在
   */
  has(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * 列出所有 Skill (支持过滤)
   */
  list(filter?: SkillQueryFilter): Skill[] {
    let results = Array.from(this.skills.values());

    if (!filter) {
      return results;
    }

    // 分类过滤
    if (filter.category) {
      results = results.filter((s) => s.category === filter.category);
    }

    // 标签过滤
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter((s) =>
        filter.tags!.some((tag) => s.tags.includes(tag))
      );
    }

    // 启用状态过滤
    if (filter.enabled !== undefined) {
      results = results.filter((s) => (s.enabled ?? true) === filter.enabled);
    }

    // 关键词搜索
    if (filter.search) {
      const keyword = filter.search.toLowerCase();
      results = results.filter(
        (s) =>
          s.id.toLowerCase().includes(keyword) ||
          s.name.toLowerCase().includes(keyword) ||
          s.description.toLowerCase().includes(keyword)
      );
    }

    return results;
  }

  /**
   * 验证 Skill 的依赖
   */
  validate(skillId: string): SkillValidationResult {
    const skill = this.get(skillId);
    if (!skill) {
      return {
        valid: false,
        errors: [`Skill "${skillId}" not found`],
        warnings: [],
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const missingDependencies: string[] = [];
    const conflicts: string[] = [];

    // 检查依赖
    if (skill.dependencies && skill.dependencies.length > 0) {
      for (const dep of skill.dependencies) {
        if (!this.has(dep)) {
          missingDependencies.push(dep);
          errors.push(`Missing dependency: "${dep}"`);
        }
      }
    }

    // 检查冲突
    if (skill.conflicts && skill.conflicts.length > 0) {
      for (const conflict of skill.conflicts) {
        if (this.has(conflict)) {
          conflicts.push(conflict);
          warnings.push(`Conflicting skill found: "${conflict}"`);
        }
      }
    }

    // 检查必需的工具
    if (skill.requiredTools && skill.requiredTools.length > 0) {
      warnings.push(
        `Requires tools: ${skill.requiredTools.join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      missingDependencies: missingDependencies.length > 0 ? missingDependencies : undefined,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  /**
   * 获取 Skill 依赖树
   */
  getDependencies(skillId: string): Skill[] {
    const skill = this.get(skillId);
    if (!skill || !skill.dependencies) {
      return [];
    }

    const deps: Skill[] = [];
    const visited = new Set<string>();

    const traverse = (id: string) => {
      if (visited.has(id)) {
        return; // 避免循环依赖
      }
      visited.add(id);

      const s = this.get(id);
      if (!s) {
        return;
      }

      if (s.dependencies) {
        for (const dep of s.dependencies) {
          traverse(dep);
          const depSkill = this.get(dep);
          if (depSkill) {
            deps.push(depSkill);
          }
        }
      }
    };

    traverse(skillId);
    return deps;
  }

  /**
   * 获取依赖于某个 Skill 的所有 Skill
   */
  getDependents(skillId: string): Skill[] {
    return this.list().filter(
      (s) => s.dependencies && s.dependencies.includes(skillId)
    );
  }

  /**
   * 渲染一个 Skill
   */
  render(skillId: string, options?: SkillRenderOptions): string {
    const cacheKey = `${skillId}:${JSON.stringify(options?.params || {})}`;

    // 检查缓存
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const skill = this.get(skillId);
    if (!skill) {
      throw new Error(`Skill "${skillId}" not found`);
    }

    let content: string;

    // 如果有自定义渲染方法，使用它
    if (skill.render) {
      content = skill.render(options);
    } else if (typeof skill.content === 'string') {
      // 否则使用内容并替换参数
      content = this.replaceParameters(
        skill.content,
        options?.params || {}
      );
    } else {
      throw new Error(
        `Skill "${skillId}" has no render method and content is not a string`
      );
    }

    // 如果需要包含依赖
    if (options?.includeDependencies && skill.dependencies) {
      const depContents = skill.dependencies
        .map((depId) => this.render(depId, options))
        .join('\n\n');
      content = `${depContents}\n\n${content}`;
    }

    // 应用自定义转换
    if (options?.transformer) {
      content = options.transformer(content, options.params || {});
    }

    // 缓存结果
    if (this.cache.size < this.options.cacheSize) {
      this.cache.set(cacheKey, content);
    }

    return content;
  }

  /**
   * 替换参数 (支持 {{key}} 格式)
   */
  private replaceParameters(
    content: string,
    params: Record<string, any>
  ): string {
    let result = content;
    for (const [key, value] of Object.entries(params)) {
      const placeholder = `{{${key}}}`;
      result = result.replaceAll(placeholder, String(value));
    }
    return result;
  }

  /**
   * 组合多个 Skill
   */
  compose(...skillIds: string[]): string {
    return this.composeBatch(skillIds);
  }

  /**
   * 组合一个 Skill 数组
   */
  composeBatch(skillIds: string[], options?: SkillRenderOptions): string {
    const startTime = Date.now();
    const contents: string[] = [];
    const usedSkills: Skill[] = [];
    const order: string[] = [];
    const processed = new Set<string>();

    // 按优先级排序
    const skillsToCompose = skillIds
      .map((id) => this.get(id))
      .filter((s): s is Skill => s !== undefined)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // 递归处理依赖
    const process = (skill: Skill) => {
      if (processed.has(skill.id)) {
        return;
      }
      processed.add(skill.id);

      // 先处理依赖
      if (skill.dependencies) {
        for (const depId of skill.dependencies) {
          const depSkill = this.get(depId);
          if (depSkill) {
            process(depSkill);
          }
        }
      }

      // 再处理自己
      order.push(skill.id);
      usedSkills.push(skill);

      const rendered = this.render(skill.id, {
        params: options?.params,
        includeDependencies: false, // 已手动处理依赖
      });

      if (rendered) {
        contents.push(rendered);
      }
    };

    // 处理所有 Skill
    for (const skill of skillsToCompose) {
      process(skill);
    }

    const result = contents.join('\n\n');
    const renderTime = Date.now() - startTime;

    return result;
  }

  /**
   * 获取组合结果的详细信息
   */
  composeDetail(...skillIds: string[]): SkillComposeResult {
    const startTime = Date.now();
    const order: string[] = [];
    const processed = new Set<string>();
    const allSkills: Skill[] = [];

    const process = (skillId: string) => {
      if (processed.has(skillId)) {
        return;
      }
      processed.add(skillId);

      const skill = this.get(skillId);
      if (!skill) {
        return;
      }

      // 先处理依赖
      if (skill.dependencies) {
        for (const depId of skill.dependencies) {
          process(depId);
        }
      }

      order.push(skillId);
      allSkills.push(skill);
    };

    for (const id of skillIds) {
      process(id);
    }

    const content = this.composeBatch(skillIds);
    const renderTime = Date.now() - startTime;

    return {
      content,
      skills: allSkills,
      order,
      metadata: {
        totalSkills: allSkills.length,
        totalDependencies: Array.from(processed).length - skillIds.length,
        renderTime,
      },
    };
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 清空所有 Skill
   */
  clear(): void {
    this.skills.clear();
    this.cache.clear();
    this.loadedFromCustom.clear();
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats = {
      totalSkills: this.skills.size,
      byCategory: {
        prompt: 0,
        agent: 0,
        workflow: 0,
      },
      byTag: {} as Record<string, number>,
      enabled: 0,
      disabled: 0,
      cacheSize: this.cache.size,
      loadedFromCustom: this.loadedFromCustom.size,
    };

    for (const skill of this.skills.values()) {
      stats.byCategory[skill.category]++;

      if (skill.enabled ?? true) {
        stats.enabled++;
      } else {
        stats.disabled++;
      }

      for (const tag of skill.tags) {
        stats.byTag[tag] = (stats.byTag[tag] ?? 0) + 1;
      }
    }

    return stats;
  }
}

/**
 * 全局 Skill 注册表实例
 */
let globalRegistry: SkillRegistry | null = null;

/**
 * 获取全局 Skill 注册表
 */
export function getSkillRegistry(options?: SkillRegistryOptions): SkillRegistry {
  if (!globalRegistry) {
    globalRegistry = new SkillRegistry(options);
  }
  return globalRegistry;
}

/**
 * 重置全局 Skill 注册表 (仅用于测试)
 */
export function resetSkillRegistry(): void {
  globalRegistry = null;
}
