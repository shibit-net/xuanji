/**
 * ============================================================
 * M3 上下文引擎 — 模块导出
 * ============================================================
 */

export { ProjectScanner } from './ProjectScanner';
export { RulesLoader } from './RulesLoader';
export { ContextBuilder } from './ContextBuilder';
export { CodeParser } from './CodeParser';
export { SymbolExtractor } from './SymbolExtractor';
export { FileIndexer } from './FileIndexer';
export { DependencyAnalyzer } from './DependencyAnalyzer';

export type { ProjectMetadata, ProjectType, DetectionRule, RulesContent, DependencyInfo } from './types';
export type {
  ParsedTree,
  SupportedLanguage,
  SymbolInfo,
  SymbolKind,
  ImportInfo,
  ExtractedSymbols,
  IndexedFile,
  FileIndex,
  IndexOptions,
} from './types';
