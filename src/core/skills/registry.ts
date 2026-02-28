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
  WorkflowResult,
} from './types';
import { CORE_SKILL_IDS } from './types';
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
   * 渲染一个 Skill (支持异步 render)
   */
  async render(skillId: string, options?: SkillRenderOptions): Promise<string> {
    const cacheKey = `${skillId}:${JSON.stringify(options?.params || {}, Object.keys(options?.params || {}).sort())}`;

    // 检查缓存
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const skill = this.get(skillId);
    if (!skill) {
      throw new Error(`Skill "${skillId}" not found`);
    }

    let params = options?.params || {};

    // 🆕 处理依赖注入：渲染所有依赖并注入到 params.dependencies
    if (skill.dependencies && skill.dependencies.length > 0) {
      const dependencyResults: Record<string, string> = {};

      for (const depId of skill.dependencies) {
        try {
          const depContent = await this.render(depId, {
            params: options?.params,
            includeDependencies: false, // 避免递归包含
          });
          dependencyResults[depId] = depContent;
        } catch (error) {
          log.error(`Failed to render dependency "${depId}":`, error);
          // 依赖渲染失败不阻塞主 Skill，设置空字符串
          dependencyResults[depId] = '';
        }
      }

      // 将依赖结果注入到 params
      params = {
        ...params,
        dependencies: dependencyResults,
      };
    }

    let content: string;

    // 如果有自定义渲染方法，使用它（传入增强的 params）
    // 🆕 支持异步 render 方法
    if (skill.render) {
      const result = skill.render({ ...options, params });
      content = result instanceof Promise ? await result : result;
    } else if (typeof skill.content === 'string') {
      // 否则使用内容并替换参数
      content = this.replaceParameters(skill.content, params);
    } else {
      throw new Error(
        `Skill "${skillId}" has no render method and content is not a string`
      );
    }

    // 如果需要包含依赖（向后兼容：拼接依赖内容）
    if (options?.includeDependencies && skill.dependencies) {
      const depContents = skill.dependencies
        .map((depId) => params.dependencies?.[depId] || '')
        .filter((c) => c.length > 0)
        .join('\n\n');
      if (depContents) {
        content = `${depContents}\n\n${content}`;
      }
    }

    // 应用自定义转换
    if (options?.transformer) {
      content = options.transformer(content, params);
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
   * 组合多个 Skill (异步版本)
   */
  async compose(...skillIds: string[]): Promise<string> {
    return this.composeBatch(skillIds);
  }

  /**
   * 组合一个 Skill 数组 (异步版本)
   */
  async composeBatch(skillIds: string[], options?: SkillRenderOptions): Promise<string> {
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

    // 递归处理依赖 (异步)
    const process = async (skill: Skill) => {
      if (processed.has(skill.id)) {
        return;
      }
      processed.add(skill.id);

      // 先处理依赖
      if (skill.dependencies) {
        for (const depId of skill.dependencies) {
          const depSkill = this.get(depId);
          if (depSkill) {
            await process(depSkill);
          }
        }
      }

      // 再处理自己
      order.push(skill.id);
      usedSkills.push(skill);

      const rendered = await this.render(skill.id, {
        params: options?.params,
        includeDependencies: false, // 已手动处理依赖
      });

      if (rendered) {
        contents.push(rendered);
      }
    };

    // 处理所有 Skill
    for (const skill of skillsToCompose) {
      await process(skill);
    }

    const result = contents.join('\n\n');
    const renderTime = Date.now() - startTime;

    return result;
  }

  /**
   * 获取组合结果的详细信息 (异步版本)
   */
  async composeDetail(...skillIds: string[]): Promise<SkillComposeResult> {
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

    const content = await this.composeBatch(skillIds);
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

  // ────────── Workflow Skill 执行 ──────────

  /**
   * 执行 Workflow Skill
   *
   * 查找 category='workflow' 的 Skill 并调用其 execute() 方法。
   * 返回标准化的 WorkflowResult。
   */
  async executeWorkflow(skillId: string, params?: Record<string, any>): Promise<WorkflowResult> {
    const skill = this.get(skillId);
    if (!skill) {
      return { success: false, error: `Workflow skill not found: ${skillId}` };
    }
    if (skill.category !== 'workflow') {
      return { success: false, error: `Skill "${skillId}" is not a workflow (category: ${skill.category})` };
    }
    if (!skill.execute) {
      return { success: false, error: `Workflow skill "${skillId}" has no execute method` };
    }

    try {
      log.info(`Executing workflow: ${skillId}`);
      const result = await skill.execute(params);

      // 如果返回的是 WorkflowResult 格式，直接返回
      if (result && typeof result === 'object' && 'success' in result) {
        return result as WorkflowResult;
      }

      // 否则包装为成功结果
      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Workflow "${skillId}" failed:`, err);
      return { success: false, error: message };
    }
  }

  /**
   * 获取所有具有斜杠命令的 Workflow Skill
   */
  getWorkflowCommands(): Array<{ skillId: string; command: string; description: string }> {
    return this.list({ category: 'workflow' })
      .filter((s) => s.slashCommand)
      .map((s) => ({
        skillId: s.id,
        command: s.slashCommand!,
        description: s.description,
      }));
  }

  // ────────── 意图路由 ──────────

  /** 始终加载的核心 Skill（不参与意图过滤） */
  private static CORE_SKILLS = CORE_SKILL_IDS;

  /** 场景 Skill 的意图关键词映射 */
  private static INTENT_KEYWORDS: Record<string, RegExp> = {
    'code-assistant': /(?:代码|编程|函数|文件|目录|项目|bug|fix|refactor|debug|compile|build|npm|git|import|export|class|function|component|api|error|test|config|deploy|typescript|javascript|python|java|code|file|folder|package|module|install|run|script)/i,
    'life-secretary': /(?:约会|餐厅|吃什么|推荐|生日|礼物|纪念日|日程|安排|计划|预约|提醒|天气|电影|活动|旅行|购物|健身|date|dinner|restaurant|birthday|gift|schedule|plan|remind|weather|movie|travel|shop)/i,
  };

  /**
   * 基于用户消息的意图过滤 Skill 列表
   *
   * 核心 Skill 始终保留，场景 Skill 按意图关键词匹配。
   * 如果无法判断意图（无明显关键词），保留所有 Skill。
   *
   * @deprecated 使用 VectorSkillMatcher.matchSkills() 替代，提供更精确的语义匹配。
   * 此方法保留作为 VectorSkillMatcher 不可用时的降级方案。
   */
  filterByIntent(enabledIds: string[], userMessage: string): string[] {
    if (!userMessage || userMessage.length < 3) return enabledIds;

    const coreIds: string[] = [];
    const sceneIds: string[] = [];

    for (const id of enabledIds) {
      if (SkillRegistry.CORE_SKILLS.has(id)) {
        coreIds.push(id);
      } else {
        sceneIds.push(id);
      }
    }

    // 如果没有场景 Skill，直接返回
    if (sceneIds.length === 0) return enabledIds;

    // 检测匹配的场景 Skill
    const matchedSceneIds: string[] = [];
    for (const id of sceneIds) {
      const pattern = SkillRegistry.INTENT_KEYWORDS[id];
      if (!pattern) {
        // 未配置意图关键词的 Skill，始终保留
        matchedSceneIds.push(id);
      } else if (pattern.test(userMessage)) {
        matchedSceneIds.push(id);
      }
    }

    // 如果没有匹配到任何场景 Skill，保留所有（安全降级）
    if (matchedSceneIds.length === 0) return enabledIds;

    log.debug(`Intent filter: ${enabledIds.length} → ${coreIds.length + matchedSceneIds.length} skills ` +
      `(matched: ${matchedSceneIds.join(', ')})`);

    return [...coreIds, ...matchedSceneIds];
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
 * @internal 仅用于测试，业务代码应使用 ChatSession 中的 SkillRegistry 实例
 */
let globalRegistry: SkillRegistry | null = null;

/**
 * 获取全局 Skill 注册表
 * @internal 仅用于测试
 */
export function getSkillRegistry(options?: SkillRegistryOptions): SkillRegistry {
  if (!globalRegistry) {
    globalRegistry = new SkillRegistry(options);
  }
  return globalRegistry;
}

/**
 * 重置全局 Skill 注册表 (仅用于测试)
 * @internal
 */
export function resetSkillRegistry(): void {
  globalRegistry = null;
}
