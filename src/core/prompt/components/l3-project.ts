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
import { RulesLoader } from '@/core/config/RulesLoader';
import type { FileIndex } from '@/context/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'l3-project' });

export const l3Project: PromptComponent = {
  id: 'l3-project',
  name: 'Project Context',
  layer: 'L3',
  // 不限制 scenes，让所有场景都可以尝试加载，但在 render 中判断是否真的是项目
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

  // 先加载规则文件（即使不是项目，也可能有 XUANJI.md）
  const loader = new RulesLoader();
  const rules = loader.loadRulesSync(metadata.rootPath);

  // 如果不是项目（没有 git 且类型未知）且没有规则文件，跳过
  if (metadata.type === 'unknown' && !metadata.hasGit && !rules.xuanjiMd && !rules.projectRules) {
    log.debug('Not a project and no rules, skipping project context');
    return '';
  }

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
