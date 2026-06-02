// ============================================================
// M9 配置管理 — RulesLoader XUANJI.md 规则加载
// ============================================================
//
// 统一的规则文件加载器，支持同步和异步加载。
//
// 扫描优先级（低 → 高）:
// 1. 项目根到 cwd 路径上的所有 XUANJI.md
// 2. .xuanji/rules.md — 备选位置
//
// 安全措施：
// - 单文件最大 500KB，超过截断并警告
// - 敏感内容检测（API_KEY / PASSWORD / SECRET 等）
//

import { readFile } from 'node:fs/promises';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, parse as parsePath, basename } from 'node:path';
import type { RulesContent } from '@/context/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'RulesLoader' });

/** 单文件最大字节数 (500KB) */
const MAX_FILE_SIZE = 500 * 1024;

/** 敏感关键词匹配模式 */
const SENSITIVE_PATTERNS = [
  /api[_-]?key\s*[:=]/i,
  /password\s*[:=]/i,
  /secret\s*[:=]/i,
  /token\s*[:=]/i,
  /private[_-]?key\s*[:=]/i,
];

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
   * 加载所有规则（异步）
   * @param cwd 当前工作目录
   */
  async loadRules(cwd: string): Promise<RuleEntry[]> {
    const rules: RuleEntry[] = [];

    // 从文件系统根到 cwd，扫描每一层的 XUANJI.md
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
   * 加载规则（同步版本，用于性能敏感场景）
   * @param rootPath 项目根目录
   */
  loadRulesSync(rootPath: string): RulesContent {
    const result: RulesContent = {};

    // 1. 加载 XUANJI.md
    const xuanjiMdPath = join(rootPath, 'XUANJI.md');
    result.xuanjiMd = this.tryReadFileSync(xuanjiMdPath, 'XUANJI.md');

    // 2. 加载 .xuanji/rules.md
    const projectRulesPath = join(rootPath, '.xuanji', 'rules.md');
    result.projectRules = this.tryReadFileSync(projectRulesPath, '.xuanji/rules.md');

    return result;
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
        if (basename(r.path) === 'XUANJI.md') {
          return `<!-- XUANJI Rules ${label} -->\n${this.buildXuanjiMdIndex(r.content, r.path)}`;
        }
        return `<!-- XUANJI Rules ${label} -->\n${r.content}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * 将规则合并为单个文本（同步版本）
   */
  loadAsTextSync(rootPath: string): string {
    const rules = this.loadRulesSync(rootPath);
    const parts: string[] = [];

    if (rules.xuanjiMd) {
      const xuanjiMdPath = join(rootPath, 'XUANJI.md');
      parts.push(`### Project Knowledge Index (XUANJI.md)\n${this.buildXuanjiMdIndex(rules.xuanjiMd, xuanjiMdPath)}`);
    }
    if (rules.projectRules) {
      parts.push(`### Custom Rules (.xuanji/rules.md)\n${rules.projectRules}`);
    }

    return parts.join('\n\n');
  }

  private buildXuanjiMdIndex(content: string, filePath: string): string {
    const headings = content
      .split('\n')
      .filter((line) => /^#{1,3}\s+/.test(line))
      .slice(0, 40);
    const headingList = headings.length > 0
      ? headings.map((heading) => `- ${heading.replace(/^#+\s+/, '')}`).join('\n')
      : '- No headings found';

    return [
      `Project knowledge file: ${filePath}`,
      '',
      'Do not treat this index as complete project context. When the task needs project facts, conventions, progress, architecture, or write-back checks, read the relevant section from `XUANJI.md` on demand.',
      '',
      `Indexed sections from ${basename(filePath)}:`,
      headingList,
    ].join('\n');
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
   * 尝试读取文件（异步），不存在则返回 null
   */
  private async tryReadFile(filePath: string): Promise<string | null> {
    try {
      if (!existsSync(filePath)) return null;
      let content = await readFile(filePath, 'utf-8');

      // 大小检查
      if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
        log.warn(`${filePath} exceeds 500KB, truncating`);
        content = content.slice(0, MAX_FILE_SIZE);
      }

      // 敏感内容检测
      if (this.detectSensitive(content)) {
        log.warn(`Potential sensitive data detected in ${filePath}`);
      }

      const trimmed = content.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /**
   * 尝试读取文件（同步），不存在则返回 undefined
   */
  private tryReadFileSync(filePath: string, label: string): string | undefined {
    try {
      if (!existsSync(filePath)) return undefined;
      const stat = statSync(filePath);
      if (!stat.isFile()) return undefined;

      let content = readFileSync(filePath, 'utf-8');

      // 大小检查
      if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
        log.warn(`${label} exceeds 500KB, truncating`);
        content = content.slice(0, MAX_FILE_SIZE);
      }

      // 敏感内容检测
      if (this.detectSensitive(content)) {
        log.warn(`Potential sensitive data detected in ${label}`);
      }

      // 空文件返回 undefined
      const trimmed = content.trim();
      return trimmed.length > 0 ? content : undefined;
    } catch (error) {
      log.error(`Failed to load ${label}:`, error);
      return undefined;
    }
  }

  /**
   * 检测内容中是否包含敏感信息
   */
  private detectSensitive(content: string): boolean {
    return SENSITIVE_PATTERNS.some((p) => p.test(content));
  }
}
