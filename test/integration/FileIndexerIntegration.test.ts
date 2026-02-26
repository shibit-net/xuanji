import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileIndexer } from '@/context/FileIndexer';
import { ContextBuilder } from '@/context/ContextBuilder';
import type { ProjectMetadata, RulesContent, FileIndex } from '@/context/types';

/**
 * 格式化索引摘要（与 project-rules.ts 中的 formatIndexSummary 逻辑相同）
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

describe('FileIndexer Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-integration-'));

    // 创建一个模拟项目结构
    await mkdir(join(tempDir, 'src', 'core'), { recursive: true });
    await mkdir(join(tempDir, 'src', 'utils'), { recursive: true });

    // 核心文件
    await writeFile(
      join(tempDir, 'src', 'core', 'Agent.ts'),
      `export class AgentLoop {
  async run(message: string): Promise<void> {}
  stop(): void {}
}

export interface AgentCallbacks {
  onText?: (text: string) => void;
}
`,
    );

    await writeFile(
      join(tempDir, 'src', 'core', 'Session.ts'),
      `export class ChatSession {
  async init(): Promise<void> {}
  async run(userMessage: string): Promise<void> {}
}
`,
    );

    await writeFile(
      join(tempDir, 'src', 'utils', 'logger.ts'),
      `export class Logger {
  info(msg: string): void {}
  error(msg: string): void {}
}

export const logger = new Logger();
`,
    );

    // 无导出的文件
    await writeFile(
      join(tempDir, 'src', 'internal.ts'),
      `function helper() { return 42; }
const secret = 'hidden';
`,
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should build index and generate summary for ContextBuilder', async () => {
    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex({
      directories: ['src'],
      maxFiles: 100,
      concurrency: 4,
    });

    expect(index.totalFiles).toBeGreaterThanOrEqual(3);
    expect(index.bySymbol.has('AgentLoop')).toBe(true);
    expect(index.bySymbol.has('ChatSession')).toBe(true);
    expect(index.bySymbol.has('Logger')).toBe(true);

    // 生成摘要
    const summary = formatIndexSummary(index, 20);
    expect(summary).toContain('### Code Structure');
    expect(summary).toContain('AgentLoop');
    expect(summary).toContain('ChatSession');
    expect(summary).toContain('Logger');
  });

  it('should integrate index summary into ContextBuilder output', async () => {
    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex({
      directories: ['src'],
      maxFiles: 100,
      concurrency: 4,
    });

    const summary = formatIndexSummary(index, 20);

    const metadata: ProjectMetadata = {
      type: 'node',
      hasGit: true,
      rootPath: tempDir,
      configFiles: ['package.json'],
    };
    const rules: RulesContent = {
      xuanjiMd: '# Test Project',
    };

    const builder = new ContextBuilder(metadata, rules, summary);
    const result = builder.build();

    // 验证所有 section 都存在
    expect(result).toContain('## Project Context');
    expect(result).toContain('### Project Type');
    expect(result).toContain('### Project Instructions (XUANJI.md)');
    expect(result).toContain('### Code Structure');
    expect(result).toContain('### Environment');

    // 验证索引内容
    expect(result).toContain('AgentLoop');
    expect(result).toContain('ChatSession');

    // 验证顺序：索引在 Environment 之前
    const indexPos = result.indexOf('### Code Structure');
    const envPos = result.indexOf('### Environment');
    expect(indexPos).toBeLessThan(envPos);
  });

  it('should handle empty project gracefully', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'xuanji-empty-'));
    await mkdir(join(emptyDir, 'src'), { recursive: true });

    try {
      const indexer = new FileIndexer(emptyDir);
      const index = await indexer.buildIndex({
        directories: ['src'],
        maxFiles: 100,
        concurrency: 4,
      });

      expect(index.totalFiles).toBe(0);

      const summary = formatIndexSummary(index, 20);
      expect(summary).toBe('');

      // 空摘要不应出现在 ContextBuilder 中
      const metadata: ProjectMetadata = {
        type: 'node',
        hasGit: false,
        rootPath: emptyDir,
        configFiles: [],
      };
      const builder = new ContextBuilder(metadata, {}, summary);
      const result = builder.build();
      expect(result).not.toContain('### Code Structure');
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('should complete indexing within performance budget', async () => {
    const startTime = Date.now();

    const indexer = new FileIndexer(tempDir);
    await indexer.buildIndex({
      directories: ['src'],
      maxFiles: 100,
      concurrency: 4,
    });

    const duration = Date.now() - startTime;
    // 小型项目应在 2 秒内完成
    expect(duration).toBeLessThan(2000);
  });
});
