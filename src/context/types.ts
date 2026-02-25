/**
 * ============================================================
 * M3 上下文引擎 — 类型定义
 * ============================================================
 */

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
  /** ~/.xuanji/rules.md */
  globalRules?: string;
}
