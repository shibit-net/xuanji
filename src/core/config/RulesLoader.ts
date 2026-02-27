// ============================================================
// M9 配置管理 — RulesLoader XUANJI.md 规则加载
// ============================================================
//
// 自动扫描并加载 XUANJI.md 规则文件，合并到系统提示中。
//
// 扫描优先级（低 → 高）:
// 1. ~/.xuanji/XUANJI.md — 全局用户偏好
// 2. 项目根到 cwd 路径上的所有 XUANJI.md
// 3. .xuanji/rules.md — 备选位置
//

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, parse as parsePath } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'RulesLoader' });

/**
 * 规则条目
 */
export interface RuleEntry {
  /** 文件路径 */
  path: string;
  /** 规则内容 */
  content: string;
  /** 来源层级 */
  level: 'global' | 'project' | 'directory';
}

/**
 * RulesLoader — 加载 XUANJI.md 规则文件
 */
export class RulesLoader {
  /** 支持的规则文件名 */
  private static readonly RULE_FILES = ['XUANJI.md', '.xuanji/rules.md'];

  /**
   * 加载所有规则
   * @param cwd 当前工作目录
   */
  async loadRules(cwd: string): Promise<RuleEntry[]> {
    const rules: RuleEntry[] = [];

    // 1. 全局规则: ~/.xuanji/XUANJI.md
    const globalPath = join(homedir(), '.xuanji', 'XUANJI.md');
    const globalRule = await this.tryReadFile(globalPath);
    if (globalRule) {
      rules.push({ path: globalPath, content: globalRule, level: 'global' });
    }

    // 2. 从文件系统根到 cwd，扫描每一层的 XUANJI.md
    const visitedPaths = new Set<string>();
    const directories = this.getAncestorDirs(cwd);

    for (const dir of directories) {
      for (const fileName of RulesLoader.RULE_FILES) {
        const filePath = join(dir, fileName);
        if (visitedPaths.has(filePath)) continue;
        visitedPaths.add(filePath);

        const content = await this.tryReadFile(filePath);
        if (content) {
          const level = dir === cwd ? 'directory' : 'project';
          rules.push({ path: filePath, content, level });
        }
      }
    }

    if (rules.length > 0) {
      log.info(`Loaded ${rules.length} rule file(s): ${rules.map((r) => r.path).join(', ')}`);
    }

    return rules;
  }

  /**
   * 将规则合并为单个文本（用于注入系统提示）
   */
  async loadAsText(cwd: string): Promise<string> {
    const rules = await this.loadRules(cwd);
    if (rules.length === 0) return '';

    return rules
      .map((r) => {
        const label = r.level === 'global'
          ? '(global rules)'
          : `(${r.path})`;
        return `<!-- XUANJI Rules ${label} -->\n${r.content}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * 获取从根到 cwd 的所有祖先目录（从根开始）
   */
  private getAncestorDirs(cwd: string): string[] {
    const dirs: string[] = [];
    let current = resolve(cwd);
    const root = parsePath(current).root;

    while (current !== root) {
      dirs.unshift(current); // 从根开始
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return dirs;
  }

  /**
   * 尝试读取文件，不存在则返回 null
   */
  private async tryReadFile(filePath: string): Promise<string | null> {
    try {
      if (!existsSync(filePath)) return null;
      const content = await readFile(filePath, 'utf-8');
      const trimmed = content.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }
}
