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
  WorkflowResult,
} from './types';
import path from 'node:path';
import { homedir } from 'node:os';
import { promises as fs, existsSync } from 'node:fs';
import { parse as parseYAML } from 'yaml';
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
      customPath: options.customPath ?? path.join(homedir(), '.xuanji', 'skills'),
      cacheSize: options.cacheSize ?? 100,
      validateDependencies: options.validateDependencies ?? true,
    };

    if (this.options.autoLoad) {
      this.scanInstalled().catch((err) =>
        log.warn('Failed to scan installed skills on startup:', err),
      );
    }
  }

  /**
   * 扫描 installed/ 目录下的 manifest.json，加载所有已安装的 marketplace skill。
   * 解决重启后 SkillRegistry 丢失的问题（MCP 有 mcp.json 中心化注册表，Skills 没有）。
   */
  async scanInstalled(): Promise<number> {
    const installedDir = path.join(this.options.customPath, 'installed');
    let count = 0;

    try {
      const entries = await fs.readdir(installedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const skillDir = path.join(installedDir, entry.name);
        const manifestPath = path.join(skillDir, 'manifest.json');

        let skill: Skill | null = null;

        // 1. 尝试从 manifest.json 加载
        try {
          const raw = await fs.readFile(manifestPath, 'utf-8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;

          if (parsed.id && parsed.name) {
            // 新格式：manifest.json = 完整 Skill 对象
            skill = {
              ...parsed,
              source: (parsed.source as Skill['source']) || 'marketplace',
              enabled: parsed.enabled !== false,
            } as unknown as Skill;
          } else if (parsed.skillId) {
            // 旧格式：manifest.json 只有元数据，从 SKILL.md 重建
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            try {
              const skillMdContent = await fs.readFile(skillMdPath, 'utf-8');
              const fm = parseSkillFrontmatter(skillMdContent);
              if (fm) {
                skill = {
                  id: String(fm.id ?? parsed.skillId),
                  name: String(fm.name ?? parsed.skillId),
                  version: String(fm.version ?? parsed.version ?? '0.0.0'),
                  description: String(fm.description ?? ''),
                  category: 'prompt',
                  tags: normalizeSkillTags(fm.tags),
                  author: typeof fm.author === 'string' ? fm.author : undefined,
                  content: fm.body ?? skillMdContent,
                  source: 'marketplace' as const,
                  packageId: parsed.packageId as string,
                  installedVersion: parsed.version as string,
                  installedAt: parsed.installedAt as string,
                  enabled: true,
                };
              }
            } catch {
              // SKILL.md 不可读，跳过
            }
          }
        } catch {
          // manifest.json 不存在或损坏，尝试从 SKILL.md 直接恢复
          const skillMdPath = path.join(skillDir, 'SKILL.md');
          try {
            const skillMdContent = await fs.readFile(skillMdPath, 'utf-8');
            const fm = parseSkillFrontmatter(skillMdContent);
            if (fm) {
              skill = {
                id: String(fm.id ?? path.basename(skillDir)),
                name: String(fm.name ?? path.basename(skillDir)),
                version: String(fm.version ?? '0.0.0'),
                description: String(fm.description ?? ''),
                category: 'prompt',
                tags: normalizeSkillTags(fm.tags),
                author: typeof fm.author === 'string' ? fm.author : undefined,
                content: fm.body ?? skillMdContent,
                source: 'marketplace' as const,
                enabled: true,
                installedAt: new Date().toISOString(),
              };
              // 补写 manifest.json
              try {
                await fs.writeFile(manifestPath, JSON.stringify(skill, null, 2), 'utf-8');
              } catch { /* 写失败不阻塞 */ }
            }
          } catch {
            // SKILL.md 也不可读，跳过
          }
        }

        if (skill && skill.id && skill.name) {
          this.register(skill);
          count++;
          log.debug(`Loaded installed skill: ${skill.id} from ${skillDir}`);
        }
      }
    } catch {
      // installed/ 目录不存在，跳过
    }

    if (count > 0) {
      log.info(`Scanned ${count} installed skills from ${installedDir}`);
    }
    return count;
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
    if (filter.search && typeof filter.search === 'string') {
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

    // ── ClawHub 兼容：追加 references/ 目录中的参考文档 ──
    if (skill.references && skill.references.length > 0) {
      const refContents: string[] = [];
      for (const refPath of skill.references) {
        try {
          const { readFile } = await import('node:fs/promises');
          const refText = await readFile(refPath, 'utf-8');
          if (refText.trim()) {
            refContents.push(refText.trim());
          }
        } catch {
          // 参考文件读取失败则跳过
        }
      }
      if (refContents.length > 0) {
        content = content + '\n\n---\n\n' + refContents.join('\n\n---\n\n');
      }
    }

    // 缓存结果（FIFO 淘汰）
    if (this.cache.size >= this.options.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, content);

    return content;
  }

  async executeWorkflow(skillId: string, params?: Record<string, any>): Promise<WorkflowResult> {
    const skill = this.get(skillId);
    if (!skill) {
      return { success: false, error: `Workflow skill "${skillId}" not found` };
    }
    if (skill.category !== 'workflow') {
      return { success: false, error: `Skill "${skillId}" is not a workflow` };
    }
    if (!skill.execute) {
      return { success: false, error: `Workflow skill "${skillId}" has no execute method` };
    }

    try {
      const result = await skill.execute(params);
      if (result && typeof result === 'object' && 'success' in result) {
        return result as WorkflowResult;
      }
      return { success: true, output: String(result ?? '') };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  getWorkflowCommands(): Array<{ skillId: string; command: string; description: string }> {
    return this.list()
      .filter((s) => s.category === 'workflow' && s.slashCommand)
      .map((s) => ({
        skillId: s.id,
        command: s.slashCommand!,
        description: s.description,
      }));
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

  // ────────── Workflow Skill 执行 ──────────

  /**
   * 获取所有具有斜杠命令的 Skill
   */
  getSlashCommands(): Array<{ skillId: string; command: string; description: string }> {
    return this.list()
      .filter((s) => s.slashCommand)
      .map((s) => ({
        skillId: s.id,
        command: s.slashCommand!,
        description: s.description,
      }));
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

// ============================================================
// scanInstalled 辅助函数
// ============================================================

interface SkillFrontmatter {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  category?: string;
  tags?: unknown;
  author?: string;
  parameters?: unknown;
  dependencies?: unknown;
  conflicts?: unknown;
  requiredTools?: unknown;
  enabled?: unknown;
  priority?: unknown;
  body?: string;
  [key: string]: unknown;
}

function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return null;

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) return null;

  const yamlBlock = trimmed.substring(3, endIdx).trim();
  const body = trimmed.substring(endIdx + 3).trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYAML(yamlBlock) as Record<string, unknown>;
  } catch {
    log.warn('Failed to parse SKILL.md YAML frontmatter');
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  return { ...parsed, body: body || undefined };
}

function normalizeSkillTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return tags.split(',').map(t => t.trim()).filter(Boolean);
    }
  }
  return [];
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
