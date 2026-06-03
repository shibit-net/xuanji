/**
 * ============================================================
 * CodeParser — 单文件解析器
 *
 * 根据文件扩展名选择对应的 tree-sitter Language，
 * 调用 parser.parse() 生成 AST。
 * Language 对象缓存（重量级），Parser 实例按需创建（轻量级）。
 * ============================================================
 */

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import { logger } from '@/infrastructure/logger';
import type { ParsedTree, SupportedLanguage } from './types';

const log = logger.child({ module: 'CodeParser' });

/** 文件扩展名到语言类型的映射 */
const EXT_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  java: 'java',
};

export class CodeParser {
  /** Language 对象缓存（全局单例，重量级） */
  private static languageCache = new Map<string, any>();

  /**
   * 解析单个文件
   * @throws 如果文件类型不支持或解析失败
   */
  static parse(filePath: string, content: string): ParsedTree {
    const startTime = Date.now();
    const language = this.detectLanguage(filePath);
    const langObj = this.getLanguage(language);

    const parser = new Parser();
    parser.setLanguage(langObj);

    const tree = parser.parse(content);

    return {
      filePath,
      language,
      tree,
      parseTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 静默解析（失败返回 undefined）
   */
  static tryParse(filePath: string, content: string): ParsedTree | undefined {
    try {
      return this.parse(filePath, content);
    } catch {
      log.debug(`Failed to parse ${filePath}`);
      return undefined;
    }
  }

  /**
   * 检测文件语言类型
   * @throws 如果文件类型不支持
   */
  static detectLanguage(filePath: string): SupportedLanguage {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext || !(ext in EXT_TO_LANGUAGE)) {
      throw new Error(`Unsupported file type: .${ext ?? '(none)'}`);
    }
    return EXT_TO_LANGUAGE[ext];
  }

  /**
   * 获取缓存的 Language 对象
   */
  static getLanguage(lang: SupportedLanguage): any {
    if (!this.languageCache.has(lang)) {
      switch (lang) {
        case 'typescript':
          this.languageCache.set(lang, TypeScript.typescript);
          break;
        case 'tsx':
          this.languageCache.set(lang, TypeScript.tsx);
          break;
        case 'javascript':
        case 'jsx':
          // TypeScript parser 兼容 JS/JSX 语法
          this.languageCache.set(lang, TypeScript.typescript);
          break;
        case 'python':
          this.languageCache.set(lang, Python);
          break;
        case 'java':
          this.languageCache.set(lang, Java);
          break;
        default:
          throw new Error(`Unknown language: ${lang}`);
      }
    }
    return this.languageCache.get(lang)!;
  }

  /**
   * 检查文件是否支持解析
   */
  static isSupported(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase();
    return !!ext && ext in EXT_TO_LANGUAGE;
  }
}
