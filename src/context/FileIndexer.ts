/**
 * ============================================================
 * FileIndexer — 项目级文件索引构建器
 *
 * 扫描项目目录中的代码文件，调用 CodeParser 批量解析，
 * 构建文件→符号、符号→文件的双向索引。
 * ============================================================
 */

import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import fg from 'fast-glob';
import { logger } from '@/core/logger';
import { CodeParser } from './CodeParser';
import { SymbolExtractor } from './SymbolExtractor';
import type { IndexedFile, FileIndex, IndexOptions } from './types';

const log = logger.child({ module: 'FileIndexer' });

/** 支持索引的文件扩展名 */
const SUPPORTED_EXTENSIONS = '{ts,tsx,js,jsx,py,java}';

/** 默认排除的目录 */
const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/.venv/**',
  '**/venv/**',
  '**/*.d.ts',
  '**/*.min.js',
];

export class FileIndexer {
  private rootPath: string;
  private cachedIndex: FileIndex | null = null;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * 构建索引
   */
  async buildIndex(options: IndexOptions = {}): Promise<FileIndex> {
    if (this.cachedIndex) {
      return this.cachedIndex;
    }

    const {
      directories = ['src'],
      exclude = DEFAULT_EXCLUDE,
      maxFiles = 1000,
      concurrency = 10,
    } = options;

    const startTime = Date.now();

    // 1. 扫描文件
    const files = await this.scanFiles({ directories, exclude, maxFiles });
    log.debug(`Scanned ${files.length} files`);

    // 2. 批量解析
    const indexedFiles = await this.parseFiles(files, concurrency);
    log.debug(`Indexed ${indexedFiles.length} files`);

    // 3. 构建双向索引
    const byPath = new Map(indexedFiles.map(f => [f.path, f]));
    const bySymbol = this.buildSymbolIndex(indexedFiles);

    const duration = Date.now() - startTime;
    log.info(`Index built: ${indexedFiles.length} files, ${bySymbol.size} symbols in ${duration}ms`);

    this.cachedIndex = {
      totalFiles: indexedFiles.length,
      byPath,
      bySymbol,
      builtAt: new Date(),
    };

    return this.cachedIndex;
  }

  /**
   * 增量更新索引（仅重新解析指定文件）
   */
  async updateIndex(changedFiles: string[]): Promise<FileIndex> {
    if (!this.cachedIndex) {
      return this.buildIndex();
    }

    for (const file of changedFiles) {
      try {
        const fullPath = join(this.rootPath, file);
        const content = await readFile(fullPath, 'utf-8');
        const stats = await stat(fullPath);

        const parsed = CodeParser.tryParse(file, content);
        if (!parsed) {
          this.cachedIndex.byPath.delete(file);
          continue;
        }

        const extracted = SymbolExtractor.extract(parsed);
        const indexedFile: IndexedFile = {
          path: file,
          language: parsed.language,
          symbols: extracted.symbols,
          exports: extracted.exports,
          imports: extracted.imports,
          metadata: {
            size: stats.size,
            mtime: stats.mtime,
            parseTimeMs: parsed.parseTimeMs,
          },
        };

        this.cachedIndex.byPath.set(file, indexedFile);
      } catch {
        log.debug(`Failed to update index for ${file}`);
      }
    }

    // 重建符号索引
    const allFiles = Array.from(this.cachedIndex.byPath.values());
    this.cachedIndex.bySymbol = this.buildSymbolIndex(allFiles);
    this.cachedIndex.totalFiles = allFiles.length;
    this.cachedIndex.builtAt = new Date();

    return this.cachedIndex;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cachedIndex = null;
  }

  /**
   * 获取缓存的索引（不触发构建）
   */
  getCachedIndex(): FileIndex | null {
    return this.cachedIndex;
  }

  /**
   * 扫描文件列表
   */
  private async scanFiles(options: IndexOptions): Promise<string[]> {
    const { directories = ['src'], exclude = DEFAULT_EXCLUDE, maxFiles = 1000 } = options;

    const patterns = directories.map(
      dir => `${dir}/**/*.${SUPPORTED_EXTENSIONS}`,
    );

    const files = await fg(patterns, {
      cwd: this.rootPath,
      ignore: exclude,
      onlyFiles: true,
      absolute: false,
    });

    return files.slice(0, maxFiles);
  }

  /**
   * 批量解析文件（带并发控制）
   */
  private async parseFiles(
    files: string[],
    concurrency: number,
  ): Promise<IndexedFile[]> {
    const results: IndexedFile[] = [];

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(file => this.parseFile(file)),
      );

      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }

    return results;
  }

  /**
   * 解析单个文件
   */
  private async parseFile(file: string): Promise<IndexedFile | null> {
    try {
      const fullPath = join(this.rootPath, file);
      const content = await readFile(fullPath, 'utf-8');
      const stats = await stat(fullPath);

      const parsed = CodeParser.tryParse(file, content);
      if (!parsed) return null;

      const extracted = SymbolExtractor.extract(parsed);

      return {
        path: file,
        language: parsed.language,
        symbols: extracted.symbols,
        exports: extracted.exports,
        imports: extracted.imports,
        metadata: {
          size: stats.size,
          mtime: stats.mtime,
          parseTimeMs: parsed.parseTimeMs,
        },
      };
    } catch {
      log.debug(`Failed to index ${file}`);
      return null;
    }
  }

  /**
   * 构建符号→文件双向索引
   */
  private buildSymbolIndex(files: IndexedFile[]): Map<string, IndexedFile[]> {
    const index = new Map<string, IndexedFile[]>();

    for (const file of files) {
      for (const symbol of file.symbols) {
        const existing = index.get(symbol.name) || [];
        existing.push(file);
        index.set(symbol.name, existing);
      }
    }

    return index;
  }
}
