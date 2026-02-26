import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileIndexer } from '@/context/FileIndexer';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FileIndexer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempProject();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should build index for project', async () => {
    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex();

    expect(index.totalFiles).toBeGreaterThanOrEqual(1);
    expect(index.byPath.has('src/foo.ts')).toBe(true);
    expect(index.bySymbol.has('foo')).toBe(true);
    expect(index.builtAt).toBeInstanceOf(Date);
  });

  it('should build bidirectional index', async () => {
    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex();

    // 通过路径查找
    const fooFile = index.byPath.get('src/foo.ts');
    expect(fooFile).toBeDefined();
    expect(fooFile!.symbols.length).toBeGreaterThanOrEqual(1);

    // 通过符号查找
    const fooSymbol = index.bySymbol.get('foo');
    expect(fooSymbol).toBeDefined();
    expect(fooSymbol!.length).toBeGreaterThanOrEqual(1);
    expect(fooSymbol![0].path).toBe('src/foo.ts');
  });

  it('should index multiple files', async () => {
    await writeFile(
      join(tempDir, 'src/bar.ts'),
      'export class Bar { hello() {} }',
    );

    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex();

    expect(index.totalFiles).toBeGreaterThanOrEqual(2);
    expect(index.byPath.has('src/bar.ts')).toBe(true);
    expect(index.bySymbol.has('Bar')).toBe(true);
  });

  it('should respect maxFiles limit', async () => {
    // 创建多个文件
    for (let i = 0; i < 10; i++) {
      await writeFile(
        join(tempDir, `src/file${i}.ts`),
        `export function fn${i}() {}`,
      );
    }

    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex({ maxFiles: 5 });

    expect(index.totalFiles).toBeLessThanOrEqual(5);
  });

  it('should cache index results', async () => {
    const indexer = new FileIndexer(tempDir);
    const index1 = await indexer.buildIndex();
    const index2 = await indexer.buildIndex();

    expect(index1).toBe(index2); // 同一引用
  });

  it('should clear cache', async () => {
    const indexer = new FileIndexer(tempDir);
    const index1 = await indexer.buildIndex();

    indexer.clearCache();
    const index2 = await indexer.buildIndex();

    expect(index1).not.toBe(index2);
  });

  it('should exclude node_modules and dist', async () => {
    await mkdir(join(tempDir, 'node_modules/pkg'), { recursive: true });
    await writeFile(
      join(tempDir, 'node_modules/pkg/index.ts'),
      'export function dep() {}',
    );
    await mkdir(join(tempDir, 'dist'), { recursive: true });
    await writeFile(
      join(tempDir, 'dist/bundle.js'),
      'function bundled() {}',
    );

    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex();

    expect(index.byPath.has('node_modules/pkg/index.ts')).toBe(false);
    expect(index.byPath.has('dist/bundle.js')).toBe(false);
  });

  it('should support custom directories', async () => {
    await mkdir(join(tempDir, 'lib'), { recursive: true });
    await writeFile(
      join(tempDir, 'lib/utils.ts'),
      'export function util() {}',
    );

    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex({ directories: ['lib'] });

    expect(index.byPath.has('lib/utils.ts')).toBe(true);
    // src/foo.ts should not be indexed when only 'lib' is specified
    expect(index.byPath.has('src/foo.ts')).toBe(false);
  });

  it('should handle Python files', async () => {
    await writeFile(
      join(tempDir, 'src/main.py'),
      'def hello():\n    pass\n\nclass World:\n    pass',
    );

    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex();

    expect(index.byPath.has('src/main.py')).toBe(true);
    expect(index.bySymbol.has('hello')).toBe(true);
    expect(index.bySymbol.has('World')).toBe(true);
  });

  it('should handle Java files', async () => {
    await writeFile(
      join(tempDir, 'src/User.java'),
      'public class User { public String getName() { return ""; } }',
    );

    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex();

    expect(index.byPath.has('src/User.java')).toBe(true);
    expect(index.bySymbol.has('User')).toBe(true);
  });

  it('should support incremental update', async () => {
    const indexer = new FileIndexer(tempDir);
    await indexer.buildIndex();

    // 添加新文件
    await writeFile(
      join(tempDir, 'src/new.ts'),
      'export function newFn() {}',
    );

    const updated = await indexer.updateIndex(['src/new.ts']);

    expect(updated.byPath.has('src/new.ts')).toBe(true);
    expect(updated.bySymbol.has('newFn')).toBe(true);
  });

  it('should include file metadata', async () => {
    const indexer = new FileIndexer(tempDir);
    const index = await indexer.buildIndex();

    const fooFile = index.byPath.get('src/foo.ts');
    expect(fooFile).toBeDefined();
    expect(fooFile!.metadata.size).toBeGreaterThan(0);
    expect(fooFile!.metadata.mtime).toBeInstanceOf(Date);
    expect(fooFile!.metadata.parseTimeMs).toBeGreaterThanOrEqual(0);
  });
});

async function createTempProject(): Promise<string> {
  const dir = join(tmpdir(), `xuanji-index-test-${Date.now()}`);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(
    join(dir, 'src/foo.ts'),
    'export function foo() { return 42; }',
  );
  return dir;
}
