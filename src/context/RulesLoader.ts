/**
 * ============================================================
 * M3 上下文引擎 — RulesLoader
 * ============================================================
 * 加载项目级和用户级规则文件。
 *
 * 加载优先级（展示顺序）：
 * 1. 项目根目录 XUANJI.md（最高优先级）
 * 2. .xuanji/rules.md（项目级规则）
 * 3. ~/.xuanji/rules.md（全局默认规则）
 *
 * 安全措施：
 * - 单文件最大 500KB，超过截断并警告
 * - 敏感内容检测（API_KEY / PASSWORD / SECRET 等）
 * - 单文件读取失败不影响其他文件
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RulesContent } from './types';
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

export class RulesLoader {
  /**
   * 加载规则文件
   * @param rootPath 项目根目录
   */
  async load(rootPath: string): Promise<RulesContent> {
    const result: RulesContent = {};

    // 1. 加载 XUANJI.md
    const xuanjiMdPath = path.join(rootPath, 'XUANJI.md');
    result.xuanjiMd = await this.loadFile(xuanjiMdPath, 'XUANJI.md');

    // 2. 加载 .xuanji/rules.md
    const projectRulesPath = path.join(rootPath, '.xuanji', 'rules.md');
    result.projectRules = await this.loadFile(projectRulesPath, '.xuanji/rules.md');

    // 3. 加载 ~/.xuanji/rules.md
    const globalRulesPath = path.join(os.homedir(), '.xuanji', 'rules.md');
    result.globalRules = await this.loadFile(globalRulesPath, '~/.xuanji/rules.md');

    return result;
  }

  /**
   * 加载单个文件，包含大小检查和敏感内容检测
   */
  private async loadFile(filePath: string, label: string): Promise<string | undefined> {
    try {
      if (!fs.existsSync(filePath)) {
        return undefined;
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return undefined;
      }

      let content = await fs.promises.readFile(filePath, 'utf-8');

      // 大小检查
      if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
        log.warn(`${label} exceeds 500KB, truncating`);
        content = content.slice(0, MAX_FILE_SIZE);
      }

      // 敏感内容检测
      if (this.detectSensitive(content)) {
        log.warn(`Potential sensitive data detected in ${label}`);
      }

      return content;
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
