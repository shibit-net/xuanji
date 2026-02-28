/**
 * ============================================================
 * Skill System - Loader
 * ============================================================
 * 从文件系统加载 Skill
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Skill, SkillLoadOptions } from './types';
import { SkillRegistry } from './registry';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SkillLoader' });

/**
 * Skill 加载器
 */
export class SkillLoader {
  private loadedFiles: string[] = [];

  constructor(
    private registry: SkillRegistry,
    private basePath: string = process.cwd()
  ) {}

  /** 获取关联的 SkillRegistry */
  getRegistry(): SkillRegistry {
    return this.registry;
  }

  /**
   * 加载 Skill
   */
  async load(options: SkillLoadOptions = {}): Promise<void> {
    const {
      loadBuiltin = true,
      loadCustom = true,
      customPath = '.xuanji/skills',
      filter,
      timeout = 30000,
    } = options;

    const loadPromises: Promise<void>[] = [];

    if (loadBuiltin) {
      loadPromises.push(this.loadBuiltinSkills());
    }

    if (loadCustom) {
      loadPromises.push(this.loadCustomSkills(customPath));
    }

    // 设置超时
    let timeoutTimer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutTimer = setTimeout(
        () => reject(new Error('Skill loading timeout')),
        timeout
      );
    });

    try {
      await Promise.race([
        Promise.all(loadPromises),
        timeoutPromise,
      ]);
    } catch (error) {
      log.error('Failed to load skills:', error);
    } finally {
      clearTimeout(timeoutTimer!);
    }

    // 应用过滤
    if (filter) {
      const allSkills = this.registry.list();
      const skillsToRemove = allSkills.filter((s) => !filter(s));
      for (const skill of skillsToRemove) {
        this.registry.unregister(skill.id);
      }
    }
  }

  /**
   * 加载内置 Skill
   */
  private async loadBuiltinSkills(): Promise<void> {
    try {
      // 动态导入内置 Skill
      // 这会在实现时导入 builtin 目录下的所有 Skill 文件
      const builtinPath = path.join(__dirname, 'builtin');
      await this.loadSkillsFromDirectory(builtinPath);
    } catch (error) {
      log.error('Failed to load builtin skills:', error);
    }
  }

  /**
   * 加载自定义 Skill
   */
  private async loadCustomSkills(customPath: string): Promise<void> {
    try {
      const fullPath = path.resolve(this.basePath, customPath);
      await this.loadSkillsFromDirectory(fullPath);
    } catch (error) {
      // 自定义目录不存在时，静默失败
      // console.debug('Custom skills directory not found:', customPath);
    }
  }

  /**
   * 从目录加载所有 Skill
   */
  private async loadSkillsFromDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // 递归加载子目录
          await this.loadSkillsFromDirectory(
            path.join(dirPath, entry.name)
          );
        } else if (entry.isFile()) {
          const filePath = path.join(dirPath, entry.name);
          await this.loadSkillFile(filePath);
        }
      }
    } catch (error) {
      log.debug('Scan custom skills failed:', error);
    }
  }

  /**
   * 加载单个 Skill 文件
   */
  private async loadSkillFile(filePath: string): Promise<void> {
    try {
      const ext = path.extname(filePath).toLowerCase();

      let skill: Skill | undefined;

      if (ext === '.ts' || ext === '.js') {
        skill = await this.loadTypeScriptSkill(filePath);
      } else if (ext === '.json') {
        skill = await this.loadJsonSkill(filePath);
      } else if (ext === '.yaml' || ext === '.yml') {
        skill = await this.loadYamlSkill(filePath);
      }

      if (skill) {
        this.registry.register(skill);
        this.loadedFiles.push(filePath);
      }
    } catch (error) {
      log.warn(`Failed to load skill from ${filePath}:`, error);
    }
  }

  /**
   * 加载 TypeScript Skill
   */
  private async loadTypeScriptSkill(filePath: string): Promise<Skill | undefined> {
    try {
      // 在 TypeScript 环境中，可以直接 import
      // 这里我们使用 dynamic import (ESM) 或 require (CommonJS)
      // 为了兼容性，使用一个延迟的 import
      const module = await import(filePath);

      // 寻找导出的 Skill
      // 支持以下格式:
      // 1. export default Skill
      // 2. export const skillId = Skill
      // 3. export const default = Skill

      if (module.default && this.isValidSkill(module.default)) {
        return module.default as Skill;
      }

      // 寻找所有导出的 Skill
      for (const [key, value] of Object.entries(module)) {
        if (key !== 'default' && this.isValidSkill(value)) {
          return value as Skill;
        }
      }

      log.warn(`No valid Skill export found in ${filePath}`);
      return undefined;
    } catch (error) {
      throw new Error(`Failed to load TypeScript Skill: ${String(error)}`);
    }
  }

  /**
   * 加载 JSON Skill
   */
  private async loadJsonSkill(filePath: string): Promise<Skill | undefined> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const skill = JSON.parse(content);

      if (this.isValidSkill(skill)) {
        return skill as Skill;
      }

      log.warn(`Invalid Skill format in ${filePath}`);
      return undefined;
    } catch (error) {
      throw new Error(`Failed to load JSON Skill: ${String(error)}`);
    }
  }

  /**
   * 加载 YAML Skill (需要 yaml 库)
   */
  private async loadYamlSkill(filePath: string): Promise<Skill | undefined> {
    try {
      // 延迟导入 yaml 库，避免强制依赖
      // @ts-expect-error -- js-yaml 无类型声明，动态延迟导入避免强制依赖
      const yaml = await import('js-yaml');
      const content = await fs.readFile(filePath, 'utf-8');
      // 使用 JSON_SCHEMA 确保安全（禁用 !!js/function 等危险标签）
      const skill = yaml.load(content, { schema: yaml.JSON_SCHEMA });

      if (this.isValidSkill(skill)) {
        return skill as Skill;
      }

      log.warn(`Invalid Skill format in ${filePath}`);
      return undefined;
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        log.warn('js-yaml not installed, skipping YAML skill loading');
      } else {
        throw new Error(`Failed to load YAML Skill: ${String(error)}`);
      }
      return undefined;
    }
  }

  /**
   * 检查是否是有效的 Skill
   */
  private isValidSkill(obj: any): boolean {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.id === 'string' &&
      typeof obj.name === 'string' &&
      typeof obj.version === 'string' &&
      typeof obj.description === 'string' &&
      ['prompt', 'agent', 'workflow'].includes(obj.category) &&
      Array.isArray(obj.tags)
    );
  }

  /**
   * 重新加载所有 Skill
   */
  async reload(options: SkillLoadOptions = {}): Promise<void> {
    this.registry.clear();
    this.loadedFiles = [];
    await this.load(options);
  }

  /**
   * 获取加载的 Skill 文件列表
   */
  async getLoadedSkillFiles(): Promise<string[]> {
    return [...this.loadedFiles];
  }
}

/**
 * 全局 Skill 加载器实例
 */
let globalLoader: SkillLoader | null = null;

/**
 * 获取全局 Skill 加载器
 *
 * 注意: 后续调用如果传入不同的 registry/basePath，会重新创建实例
 */
export function getSkillLoader(
  registry: SkillRegistry,
  basePath?: string
): SkillLoader {
  if (!globalLoader || globalLoader.getRegistry() !== registry) {
    globalLoader = new SkillLoader(registry, basePath);
  }
  return globalLoader;
}

/**
 * 重置全局 Skill 加载器 (仅用于测试)
 */
export function resetSkillLoader(): void {
  globalLoader = null;
}
