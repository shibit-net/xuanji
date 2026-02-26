import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '@/context/ContextBuilder';
import type { ProjectMetadata, RulesContent, DependencyInfo } from '@/context/types';

describe('ContextBuilder', () => {
  const baseMetadata: ProjectMetadata = {
    type: 'node',
    hasGit: true,
    rootPath: '/test/project',
    configFiles: ['package.json'],
  };

  it('should build full context with all sections', () => {
    const rules: RulesContent = {
      xuanjiMd: '# Project Instructions',
      projectRules: '# Custom Rules',
      globalRules: '# Global Rules',
    };

    const builder = new ContextBuilder(baseMetadata, rules);
    const result = builder.build();

    expect(result).toContain('## Project Context');
    expect(result).toContain('### Project Type');
    expect(result).toContain('Type: Node.js');
    expect(result).toContain('Git Repository: Yes');
    expect(result).toContain('Root: /test/project');
    expect(result).toContain('Config Files: package.json');
    expect(result).toContain('### Project Instructions (XUANJI.md)');
    expect(result).toContain('# Project Instructions');
    expect(result).toContain('### Custom Rules (.xuanji/rules.md)');
    expect(result).toContain('# Custom Rules');
    expect(result).toContain('### Global Rules (~/.xuanji/rules.md)');
    expect(result).toContain('# Global Rules');
    expect(result).toContain('### Environment');
    expect(result).toContain('Node:');
    expect(result).toContain('Platform:');
  });

  it('should omit empty sections', () => {
    const rules: RulesContent = {};

    const builder = new ContextBuilder(baseMetadata, rules);
    const result = builder.build();

    expect(result).toContain('### Project Type');
    expect(result).not.toContain('### Project Instructions');
    expect(result).not.toContain('### Custom Rules');
    expect(result).not.toContain('### Global Rules');
  });

  it('should format project type correctly', () => {
    const tests: Array<[string, string]> = [
      ['node', 'Node.js'],
      ['python', 'Python'],
      ['java', 'Java'],
      ['go', 'Go'],
      ['rust', 'Rust'],
      ['unknown', 'Unknown'],
    ];

    for (const [type, label] of tests) {
      const metadata = { ...baseMetadata, type: type as any };
      const builder = new ContextBuilder(metadata, {});
      const result = builder.build();
      expect(result).toContain(`Type: ${label}`);
    }
  });

  it('should show Git Repository: No when hasGit is false', () => {
    const metadata = { ...baseMetadata, hasGit: false };
    const builder = new ContextBuilder(metadata, {});
    const result = builder.build();

    expect(result).toContain('Git Repository: No');
  });

  it('should not show config files line when empty', () => {
    const metadata = { ...baseMetadata, configFiles: [] };
    const builder = new ContextBuilder(metadata, {});
    const result = builder.build();

    expect(result).not.toContain('Config Files:');
  });

  it('should include only xuanjiMd when others are missing', () => {
    const rules: RulesContent = {
      xuanjiMd: '# Instructions only',
    };

    const builder = new ContextBuilder(baseMetadata, rules);
    const result = builder.build();

    expect(result).toContain('### Project Instructions (XUANJI.md)');
    expect(result).not.toContain('### Custom Rules');
    expect(result).not.toContain('### Global Rules');
  });

  // 🆕 代码索引相关测试

  it('should include index summary when provided', () => {
    const indexSummary = [
      '### Code Structure',
      '',
      '**Total Files**: 10',
      '**Total Symbols**: 25',
      '**Top 3 Files**:',
      '',
      '- `src/foo.ts` — Foo, bar',
      '- `src/baz.ts` — Baz',
      '- `src/qux.ts` — Qux',
    ].join('\n');

    const builder = new ContextBuilder(baseMetadata, {}, indexSummary);
    const result = builder.build();

    expect(result).toContain('### Code Structure');
    expect(result).toContain('**Total Files**: 10');
    expect(result).toContain('**Total Symbols**: 25');
    expect(result).toContain('`src/foo.ts` — Foo, bar');
    // 索引应在 Environment 之前
    const indexPos = result.indexOf('### Code Structure');
    const envPos = result.indexOf('### Environment');
    expect(indexPos).toBeLessThan(envPos);
  });

  it('should not include index section when summary is empty', () => {
    const builder = new ContextBuilder(baseMetadata, {}, '');
    const result = builder.build();

    expect(result).not.toContain('### Code Structure');
  });

  it('should not include index section when summary is undefined', () => {
    const builder = new ContextBuilder(baseMetadata, {});
    const result = builder.build();

    expect(result).not.toContain('### Code Structure');
  });

  // 🆕 依赖信息相关测试

  it('should include dependency section when dependencyInfo is provided', () => {
    const depInfo: DependencyInfo = {
      dependencies: new Map([
        ['react', '^18.0.0'],
        ['lodash', '4.17.21'],
      ]),
      devDependencies: new Map([['vitest', '^1.0.0']]),
      totalCount: 3,
      metadata: { projectName: 'test' },
    };

    const builder = new ContextBuilder(baseMetadata, {}, undefined, depInfo);
    const result = builder.build();

    expect(result).toContain('### Dependencies');
    expect(result).toContain('**Production Dependencies**');
    expect(result).toContain('`react`: ^18.0.0');
    expect(result).toContain('`lodash`: 4.17.21');
    expect(result).toContain('**Dev Dependencies**');
    expect(result).toContain('`vitest`: ^1.0.0');
  });

  it('should not include dependency section when totalCount is 0', () => {
    const depInfo: DependencyInfo = {
      dependencies: new Map(),
      devDependencies: new Map(),
      totalCount: 0,
      metadata: {},
    };

    const builder = new ContextBuilder(baseMetadata, {}, undefined, depInfo);
    const result = builder.build();

    expect(result).not.toContain('### Dependencies');
  });

  it('should truncate production deps at 10 and dev deps at 5', () => {
    const deps = new Map<string, string>();
    for (let i = 0; i < 15; i++) {
      deps.set(`pkg-${i}`, `${i}.0.0`);
    }
    const devDeps = new Map<string, string>();
    for (let i = 0; i < 8; i++) {
      devDeps.set(`dev-pkg-${i}`, `${i}.0.0`);
    }

    const depInfo: DependencyInfo = {
      dependencies: deps,
      devDependencies: devDeps,
      totalCount: 23,
      metadata: {},
    };

    const builder = new ContextBuilder(baseMetadata, {}, undefined, depInfo);
    const result = builder.build();

    expect(result).toContain('... and 5 more');
    expect(result).toContain('... and 3 more');
  });

  it('should place dependency section before environment section', () => {
    const depInfo: DependencyInfo = {
      dependencies: new Map([['react', '^18.0.0']]),
      devDependencies: new Map(),
      totalCount: 1,
      metadata: {},
    };

    const builder = new ContextBuilder(baseMetadata, {}, undefined, depInfo);
    const result = builder.build();

    const depPos = result.indexOf('### Dependencies');
    const envPos = result.indexOf('### Environment');
    expect(depPos).toBeGreaterThan(-1);
    expect(depPos).toBeLessThan(envPos);
  });
});
