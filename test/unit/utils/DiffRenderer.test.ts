import { describe, it, expect } from 'vitest';
import { DiffRenderer } from '@/shared/utils/DiffRenderer';

describe('DiffRenderer', () => {
  describe('renderLines', () => {
    it('相同内容应无变更标记', () => {
      const result = DiffRenderer.renderLines('hello\n', 'hello\n', true, false); // changesOnly=false 显示未变更的内容
      expect(result).toContain('hello');
      expect(result).not.toContain('+');
      expect(result).not.toContain('-');
    });

    it('新增行应标记为 +', () => {
      const result = DiffRenderer.renderLines('line1\n', 'line1\nline2\n');
      expect(result).toContain('+');
      expect(result).toContain('line2');
    });

    it('删除行应标记为 -', () => {
      const result = DiffRenderer.renderLines('line1\nline2\n', 'line1\n');
      expect(result).toContain('-');
      expect(result).toContain('line2');
    });

    it('修改行应同时包含 + 和 -', () => {
      const result = DiffRenderer.renderLines('old\n', 'new\n');
      expect(result).toContain('-');
      expect(result).toContain('+');
      expect(result).toContain('old');
      expect(result).toContain('new');
    });

    it('超长 diff 应被截断', () => {
      const oldLines = Array.from({ length: 200 }, (_, i) => `old-line-${i}`).join('\n') + '\n';
      const newLines = Array.from({ length: 200 }, (_, i) => `new-line-${i}`).join('\n') + '\n';
      const result = DiffRenderer.renderLines(oldLines, newLines);
      expect(result).toContain('省略');
    });
  });

  describe('getStats', () => {
    it('应正确统计新增和删除行数', () => {
      const stats = DiffRenderer.getStats('a\nb\n', 'a\nc\nd\n');
      expect(stats.added).toBeGreaterThan(0);
      expect(stats.removed).toBeGreaterThan(0);
    });

    it('相同内容应无变更', () => {
      const stats = DiffRenderer.getStats('hello\n', 'hello\n');
      expect(stats.added).toBe(0);
      expect(stats.removed).toBe(0);
    });
  });

  describe('formatStats', () => {
    it('应格式化统计信息', () => {
      const result = DiffRenderer.formatStats({ added: 5, removed: 3, unchanged: 10 });
      expect(result).toContain('+5');
      expect(result).toContain('-3');
    });
  });

  describe('renderPreview', () => {
    it('应包含文件路径', () => {
      const result = DiffRenderer.renderPreview('old\n', 'new\n', '/path/to/file.ts');
      expect(result).toContain('file.ts');
    });
  });
});
