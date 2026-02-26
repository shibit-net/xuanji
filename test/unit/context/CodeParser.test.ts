import { describe, it, expect } from 'vitest';
import { CodeParser } from '@/context/CodeParser';

describe('CodeParser', () => {
  describe('parse', () => {
    it('should parse TypeScript file', () => {
      const code = 'function foo() { return 42; }';
      const parsed = CodeParser.parse('test.ts', code);

      expect(parsed.language).toBe('typescript');
      expect(parsed.tree).toBeDefined();
      expect(parsed.tree.rootNode).toBeDefined();
      expect(parsed.filePath).toBe('test.ts');
      expect(parsed.parseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should parse TSX file', () => {
      const code = 'const App = () => <div>Hello</div>;';
      const parsed = CodeParser.parse('App.tsx', code);

      expect(parsed.language).toBe('tsx');
      expect(parsed.tree.rootNode).toBeDefined();
    });

    it('should parse Python file', () => {
      const code = 'def greet(name):\n    return f"Hello, {name}"';
      const parsed = CodeParser.parse('main.py', code);

      expect(parsed.language).toBe('python');
      expect(parsed.tree.rootNode).toBeDefined();
    });

    it('should parse Java file', () => {
      const code = 'public class User { private String name; }';
      const parsed = CodeParser.parse('User.java', code);

      expect(parsed.language).toBe('java');
      expect(parsed.tree.rootNode).toBeDefined();
    });

    it('should parse JavaScript file using TypeScript parser', () => {
      const code = 'function foo() { return 42; }';
      const parsed = CodeParser.parse('test.js', code);

      expect(parsed.language).toBe('javascript');
      expect(parsed.tree.rootNode).toBeDefined();
    });

    it('should throw for unsupported file types', () => {
      expect(() => CodeParser.parse('test.txt', 'content')).toThrow(
        'Unsupported file type',
      );
      expect(() => CodeParser.parse('test.md', '# hello')).toThrow(
        'Unsupported file type',
      );
    });
  });

  describe('tryParse', () => {
    it('should return undefined for unsupported files', () => {
      const parsed = CodeParser.tryParse('test.txt', 'content');
      expect(parsed).toBeUndefined();
    });

    it('should return ParsedTree for supported files', () => {
      const parsed = CodeParser.tryParse('test.ts', 'const x = 1;');
      expect(parsed).toBeDefined();
      expect(parsed!.language).toBe('typescript');
    });
  });

  describe('detectLanguage', () => {
    it('should detect TypeScript', () => {
      expect(CodeParser.detectLanguage('foo.ts')).toBe('typescript');
    });

    it('should detect TSX', () => {
      expect(CodeParser.detectLanguage('App.tsx')).toBe('tsx');
    });

    it('should detect Python', () => {
      expect(CodeParser.detectLanguage('main.py')).toBe('python');
    });

    it('should detect Java', () => {
      expect(CodeParser.detectLanguage('User.java')).toBe('java');
    });

    it('should handle path with directories', () => {
      expect(CodeParser.detectLanguage('src/lib/utils.ts')).toBe('typescript');
    });
  });

  describe('isSupported', () => {
    it('should return true for supported extensions', () => {
      expect(CodeParser.isSupported('test.ts')).toBe(true);
      expect(CodeParser.isSupported('test.tsx')).toBe(true);
      expect(CodeParser.isSupported('test.js')).toBe(true);
      expect(CodeParser.isSupported('test.jsx')).toBe(true);
      expect(CodeParser.isSupported('test.py')).toBe(true);
      expect(CodeParser.isSupported('test.java')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(CodeParser.isSupported('test.txt')).toBe(false);
      expect(CodeParser.isSupported('test.md')).toBe(false);
      expect(CodeParser.isSupported('test.go')).toBe(false);
      expect(CodeParser.isSupported('test.rs')).toBe(false);
    });
  });

  describe('Language caching', () => {
    it('should return consistent results across multiple parses', () => {
      const code = 'const x = 1;';
      const parsed1 = CodeParser.parse('a.ts', code);
      const parsed2 = CodeParser.parse('b.ts', code);

      expect(parsed1.tree.rootNode.type).toBe(parsed2.tree.rootNode.type);
    });
  });
});
