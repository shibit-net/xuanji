/**
 * ============================================================
 * Built-in Prompt Skill: Project Rules
 * ============================================================
 * 注入项目特定的上下文、规则和代码索引到 system prompt。
 *
 * 扫描项目类型 → 加载 XUANJI.md / .xuanji/rules.md → 构建代码索引 → 组装上下文字符串
 */

import type { Skill } from '../../types';
import { ProjectScanner } from '@/context/ProjectScanner';
import { ContextBuilder } from '@/context/ContextBuilder';
import { FileIndexer } from '@/context/FileIndexer';
import { DependencyAnalyzer } from '@/context/DependencyAnalyzer';
import type { FileIndex } from '@/context/types';
import { logger } from '@/core/logger';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const log = logger.child({ module: 'project-rules' });

export const projectRulesSkill: Skill<string> = {
  id: 'project-rules',
  name: 'Project Rules',
  version: '2.0.0',
  description: '注入项目特定的上下文、规则和代码索引',
  category: 'prompt',
  tags: ['context', 'rules', 'project', 'index'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-26'),

  dependencies: [],
  conflicts: [],
  enabled: true,
  priority: 90, // 低于 xuanji-assistant (100)

  // 🆕 异步 render — 支持 FileIndexer 异步索引
  render: async (_options?: any): Promise<string> => {
    try {
      // 1. 扫描项目类型
      const scanner = new ProjectScanner();
      const metadata = scanner.scan();

      // 2. 加载规则文件（同步）
      const rules = loadRulesSync(metadata.rootPath);

      // 3. 🆕 构建文件索引
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
        // 索引失败不阻塞启动
      }

      // 4. 🆕 分析依赖
      let dependencyInfo = undefined;
      try {
        const analyzer = new DependencyAnalyzer(metadata.rootPath);
        dependencyInfo = await analyzer.analyze(metadata.type);
        log.info(`Analyzed ${dependencyInfo.totalCount} dependencies`);
      } catch (error) {
        log.warn('Failed to analyze dependencies:', error);
      }

      // 5. 组装上下文（传入索引摘要 + 依赖信息）
      const builder = new ContextBuilder(metadata, rules, indexSummary, dependencyInfo);
      return builder.build();
    } catch (error) {
      log.error('Failed to build project context:', error);
      return '';
    }
  },
};

/**
 * 🆕 格式化索引摘要为 Markdown
 */
function formatIndexSummary(index: FileIndex, topN: number): string {
  const files = Array.from(index.byPath.values())
    .filter(f => f.exports.length > 0)
    .sort((a, b) => b.exports.length - a.exports.length)
    .slice(0, topN);

  if (files.length === 0) {
    return '';
  }

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

/**
 * 同步加载规则文件
 */
function loadRulesSync(rootPath: string): import('@/context/types').RulesContent {
  const MAX_FILE_SIZE = 500 * 1024;
  const result: import('@/context/types').RulesContent = {};

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
