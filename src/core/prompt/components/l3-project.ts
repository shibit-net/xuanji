/**
 * ============================================================
 * L3 Component: Project — 项目上下文
 * ============================================================
 * 从 identity.ts 迁移 buildProjectContext() 逻辑。
 * 动态注入，每轮更新。
 */

import type { PromptComponent, PromptBuildContext } from '../types';
import { ProjectScanner } from '@/context/ProjectScanner';
import { ContextBuilder } from '@/context/ContextBuilder';
import { FileIndexer } from '@/context/FileIndexer';
import { DependencyAnalyzer } from '@/context/DependencyAnalyzer';
import type { FileIndex, RulesContent } from '@/context/types';
import { logger } from '@/core/logger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const log = logger.child({ module: 'l3-project' });

export const l3Project: PromptComponent = {
  id: 'l3-project',
  name: 'Project Context',
  layer: 'L3',
  priority: 60,
  estimatedTokens: 0, // 动态，取决于项目大小

  async render(_context: PromptBuildContext): Promise<string> {
    try {
      return await buildProjectContext();
    } catch (error) {
      log.warn('Failed to build project context:', error);
      return '';
    }
  },
};

// ─── 以下为 project-rules 逻辑迁移 ───

async function buildProjectContext(): Promise<string> {
  const scanner = new ProjectScanner();
  const metadata = scanner.scan();

  const rules = loadRulesSync(metadata.rootPath);

  let indexSummary = '';
  try {
    const indexer = new FileIndexer(metadata.rootPath);
    const index = await indexer.buildIndex({
      directories: ['src'],
      maxFiles: 100,
      concurrency: 4,
    });
    indexSummary = formatIndexSummary(index, 20);
    log.info(`Index: ${index.totalFiles} files, ${index.bySymbol.size} symbols`);
  } catch (error) {
    log.warn('Failed to build file index:', error);
  }

  let dependencyInfo = undefined;
  try {
    const analyzer = new DependencyAnalyzer(metadata.rootPath);
    dependencyInfo = await analyzer.analyze(metadata.type);
    log.info(`Analyzed ${dependencyInfo.totalCount} dependencies`);
  } catch (error) {
    log.warn('Failed to analyze dependencies:', error);
  }

  const builder = new ContextBuilder(metadata, rules, indexSummary, dependencyInfo);
  return builder.build();
}

function formatIndexSummary(index: FileIndex, topN: number): string {
  const files = Array.from(index.byPath.values())
    .filter(f => f.exports.length > 0)
    .sort((a, b) => b.exports.length - a.exports.length)
    .slice(0, topN);

  if (files.length === 0) return '';

  const lines = [
    '### Code Structure',
    '',
    `**Total Files**: ${index.totalFiles}`,
    `**Total Symbols**: ${index.bySymbol.size}`,
    `**Top ${files.length} Files**:`,
    '',
  ];

  for (const file of files) {
    const exportNames = file.exports.map(s => s.name).join(', ');
    lines.push(`- \`${file.path}\` — ${exportNames}`);
  }

  return lines.join('\n');
}

function loadRulesSync(rootPath: string): RulesContent {
  const MAX_FILE_SIZE = 500 * 1024;
  const result: RulesContent = {};

  const loadFile = (filePath: string, label: string): string | undefined => {
    try {
      if (!fs.existsSync(filePath)) return undefined;
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return undefined;

      let content = fs.readFileSync(filePath, 'utf-8');
      if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
        log.warn(`${label} exceeds 500KB, truncating`);
        content = content.slice(0, MAX_FILE_SIZE);
      }
      return content;
    } catch (error) {
      log.error(`Failed to load ${label}:`, error);
      return undefined;
    }
  };

  result.xuanjiMd = loadFile(path.join(rootPath, 'XUANJI.md'), 'XUANJI.md');
  result.projectRules = loadFile(path.join(rootPath, '.xuanji', 'rules.md'), '.xuanji/rules.md');
  result.globalRules = loadFile(path.join(os.homedir(), '.xuanji', 'rules.md'), '~/.xuanji/rules.md');

  return result;
}
