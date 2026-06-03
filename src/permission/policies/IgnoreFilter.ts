// ============================================================
// M5 权限控制 — Ignore 过滤器
// ============================================================
//
// 实现类似 .gitignore 的文件访问黑名单
// 阻止 LLM 读取敏感文件
//

import ignore, { type Ignore } from 'ignore';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'IgnoreFilter' });

/**
 * Ignore 过滤器
 *
 * 加载 .xuanji/ignore 文件并检查路径是否被忽略
 */
export class IgnoreFilter {
  private ig: Ignore;
  private projectRoot: string;
  private loaded: boolean = false;

  constructor(projectRoot: string) {
    this.ig = ignore();
    this.projectRoot = projectRoot;
  }

  /**
   * 从文件加载 ignore 规则
   */
  async loadFromFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      // 分行解析，过滤空行和注释
      const lines = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      if (lines.length > 0) {
        this.ig.add(lines);
        this.loaded = true;
        log.debug(`Loaded ${lines.length} ignore rules from ${filePath}`);
      }
    } catch (err) {
      // ignore 文件不存在时静默跳过
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`Failed to load ignore file ${filePath}:`, err);
      }
    }
  }

  /**
   * 检查路径是否被忽略
   *
   * @param absolutePath 绝对路径
   * @returns true 表示被忽略（应阻止访问）
   */
  isIgnored(absolutePath: string): boolean {
    if (!this.loaded) {
      return false; // 未加载 ignore 规则时不阻止
    }

    try {
      const relativePath = relative(this.projectRoot, absolutePath);

      // 路径在项目外，不检查
      if (relativePath.startsWith('..')) {
        return false;
      }

      return this.ig.ignores(relativePath);
    } catch (err) {
      // 路径解析失败时保守阻止（安全优先）
      log.warn(`Ignore filter path resolution failed for: ${absolutePath}`, err);
      return true;
    }
  }

  /**
   * 是否已加载规则
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 添加额外的规则（编程式添加）
   */
  addRule(pattern: string): void {
    this.ig.add(pattern);
    this.loaded = true;
  }

  /**
   * 批量添加规则
   */
  addRules(patterns: string[]): void {
    this.ig.add(patterns);
    if (patterns.length > 0) {
      this.loaded = true;
    }
  }
}
