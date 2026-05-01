/**
 * ============================================================
 * M3 上下文引擎 — 类型定义
 * ============================================================
 */

import type Parser from 'tree-sitter';

/**
 * 支持的项目类型
 */
export type ProjectType = 'node' | 'python' | 'java' | 'go' | 'rust' | 'unknown';

/**
 * 项目类型检测规则
 */
export interface DetectionRule {
  type: ProjectType;
  /** 特征文件列表，存在任一即匹配 */
  files: string[];
}

/**
 * 项目元数据
 */
export interface ProjectMetadata {
  /** 项目类型 */
  type: ProjectType;
  /** 是否为 Git 仓库 */
  hasGit: boolean;
  /** 项目根目录 */
  rootPath: string;
  /** 检测到的特征文件 */
  configFiles: string[];
}

/**
 * 规则文件内容
 */
export interface RulesContent {
  /** 项目根目录 XUANJI.md */
  xuanjiMd?: string;
  /** .xuanji/rules.md */
  projectRules?: string;
  /** .xuanji/rules.md */
  globalRules?: string;
}

// ============================================================
// 代码索引引擎 — 类型定义
// ============================================================

/** 支持的语言类型 */
export type SupportedLanguage = 'typescript' | 'tsx' | 'javascript' | 'jsx' | 'python' | 'java';

/** tree-sitter 解析结果 */
export interface ParsedTree {
  /** 文件路径 */
  filePath: string;
  /** 语言类型 */
  language: SupportedLanguage;
  /** tree-sitter 语法树 */
  tree: Parser.Tree;
  /** 解析时间（毫秒） */
  parseTimeMs: number;
}

/** 符号类型 */
export type SymbolKind = 'function' | 'class' | 'interface' | 'variable' | 'method';

/** 符号信息 */
export interface SymbolInfo {
  /** 符号名称 */
  name: string;
  /** 符号类型 */
  kind: SymbolKind;
  /** 起始行号（从 0 开始） */
  startLine: number;
  /** 结束行号 */
  endLine: number;
  /** 是否导出 */
  isExported: boolean;
}

/** 导入信息 */
export interface ImportInfo {
  /** 导入的模块路径 */
  source: string;
  /** 导入的符号（具名导入） */
  imports: string[];
  /** 是否默认导入 */
  isDefault: boolean;
}

/** 符号提取结果 */
export interface ExtractedSymbols {
  /** 所有符号 */
  symbols: SymbolInfo[];
  /** 导出的符号 */
  exports: SymbolInfo[];
  /** 导入信息 */
  imports: ImportInfo[];
}

/** 索引后的文件信息 */
export interface IndexedFile {
  /** 文件路径（相对于项目根目录） */
  path: string;
  /** 语言类型 */
  language: string;
  /** 提取的符号 */
  symbols: SymbolInfo[];
  /** 导出的符号 */
  exports: SymbolInfo[];
  /** 导入信息 */
  imports: ImportInfo[];
  /** 元数据 */
  metadata: {
    size: number;
    mtime: Date;
    parseTimeMs: number;
  };
}

/** 项目文件索引 */
export interface FileIndex {
  /** 索引的文件总数 */
  totalFiles: number;
  /** 按路径索引 */
  byPath: Map<string, IndexedFile>;
  /** 按符号名索引（一个符号可能在多个文件） */
  bySymbol: Map<string, IndexedFile[]>;
  /** 索引构建时间 */
  builtAt: Date;
}

/** 索引构建选项 */
export interface IndexOptions {
  /** 要索引的目录（相对于项目根目录） */
  directories?: string[];
  /** 排除的目录 */
  exclude?: string[];
  /** 文件数量限制 */
  maxFiles?: number;
  /** 并发解析数 */
  concurrency?: number;
}

// ============================================================
// 依赖分析 — 类型定义
// ============================================================

/** 依赖信息 */
export interface DependencyInfo {
  /** 生产依赖（包名 → 版本） */
  dependencies: Map<string, string>;
  /** 开发依赖（包名 → 版本） */
  devDependencies: Map<string, string>;
  /** 依赖总数 */
  totalCount: number;
  /** 项目元数据 */
  metadata: {
    projectName?: string;
    version?: string;
    description?: string;
  };
}
