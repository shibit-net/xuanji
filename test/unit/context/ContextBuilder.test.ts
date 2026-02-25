import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '@/context/ContextBuilder';
import type { ProjectMetadata, RulesContent } from '@/context/types';

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
});
