import { describe, it, expect } from 'vitest';
import { CodeParser } from '@/context/CodeParser';
import { SymbolExtractor } from '@/context/SymbolExtractor';

describe('SymbolExtractor', () => {
  describe('TypeScript extraction', () => {
    it('should extract exported function', () => {
      const code = `
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`;
      const parsed = CodeParser.parse('test.ts', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].name).toBe('greet');
      expect(result.symbols[0].kind).toBe('function');
      expect(result.symbols[0].isExported).toBe(true);
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('greet');
    });

    it('should extract exported class', () => {
      const code = `
export class User {
  constructor(public name: string) {}
  greet(): string { return this.name; }
}
`;
      const parsed = CodeParser.parse('test.ts', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'User', kind: 'class', isExported: true }),
      );
      expect(result.exports).toContainEqual(
        expect.objectContaining({ name: 'User' }),
      );
    });

    it('should extract exported interface', () => {
      const code = `
export interface IUser {
  name: string;
  greet(): string;
}
`;
      const parsed = CodeParser.parse('test.ts', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'IUser', kind: 'interface', isExported: true }),
      );
    });

    it('should extract exported variable', () => {
      const code = `export const MAX_RETRIES = 3;`;
      const parsed = CodeParser.parse('test.ts', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'MAX_RETRIES', kind: 'variable', isExported: true }),
      );
    });

    it('should distinguish exported and non-exported symbols', () => {
      const code = `
export function publicFn() {}
function privateFn() {}
export class PublicClass {}
class PrivateClass {}
`;
      const parsed = CodeParser.parse('test.ts', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toHaveLength(4);
      expect(result.exports).toHaveLength(2);

      const publicFn = result.symbols.find(s => s.name === 'publicFn');
      expect(publicFn?.isExported).toBe(true);

      const privateFn = result.symbols.find(s => s.name === 'privateFn');
      expect(privateFn?.isExported).toBe(false);
    });

    it('should extract import statements', () => {
      const code = `
import { readFile } from 'fs/promises';
import path from 'path';
`;
      const parsed = CodeParser.parse('test.ts', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe('fs/promises');
      expect(result.imports[0].imports).toContain('readFile');
      expect(result.imports[0].isDefault).toBe(false);

      expect(result.imports[1].source).toBe('path');
      expect(result.imports[1].isDefault).toBe(true);
    });

    it('should record line numbers', () => {
      const code = `export function foo() {
  return 42;
}

export class Bar {
  baz() {}
}`;
      const parsed = CodeParser.parse('test.ts', code);
      const result = SymbolExtractor.extract(parsed);

      const foo = result.symbols.find(s => s.name === 'foo');
      expect(foo?.startLine).toBe(0);

      const bar = result.symbols.find(s => s.name === 'Bar');
      expect(bar?.startLine).toBe(4);
    });
  });

  describe('Python extraction', () => {
    it('should extract top-level functions', () => {
      const code = `
def greet(name: str) -> str:
    return f"Hello, {name}"

def _private_helper():
    pass
`;
      const parsed = CodeParser.parse('test.py', code);
      const result = SymbolExtractor.extract(parsed);

      const greet = result.symbols.find(s => s.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet!.kind).toBe('function');
      expect(greet!.isExported).toBe(true);

      const helper = result.symbols.find(s => s.name === '_private_helper');
      expect(helper).toBeDefined();
      expect(helper!.isExported).toBe(false);
    });

    it('should extract classes and methods', () => {
      const code = `
class User:
    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        return self.name
`;
      const parsed = CodeParser.parse('test.py', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'User', kind: 'class' }),
      );
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: '__init__', kind: 'method' }),
      );
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'greet', kind: 'method' }),
      );
    });

    it('should extract imports', () => {
      const code = `
import os
from pathlib import Path
from typing import Optional, List
`;
      const parsed = CodeParser.parse('test.py', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.imports.length).toBeGreaterThanOrEqual(2);
      expect(result.imports).toContainEqual(
        expect.objectContaining({ source: 'os' }),
      );
      expect(result.imports).toContainEqual(
        expect.objectContaining({ source: 'pathlib' }),
      );
    });

    it('should treat non-underscore symbols as exported', () => {
      const code = `
def public_fn():
    pass

class PublicClass:
    pass

def _private_fn():
    pass
`;
      const parsed = CodeParser.parse('test.py', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.exports).toContainEqual(
        expect.objectContaining({ name: 'public_fn' }),
      );
      expect(result.exports).toContainEqual(
        expect.objectContaining({ name: 'PublicClass' }),
      );
      expect(result.exports).not.toContainEqual(
        expect.objectContaining({ name: '_private_fn' }),
      );
    });
  });

  describe('Java extraction', () => {
    it('should extract public class', () => {
      const code = `
public class User {
    private String name;
    public String getName() {
        return this.name;
    }
}
`;
      const parsed = CodeParser.parse('User.java', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'User', kind: 'class', isExported: true }),
      );
    });

    it('should extract interface', () => {
      const code = `
public interface IUser {
    String getName();
}
`;
      const parsed = CodeParser.parse('IUser.java', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'IUser', kind: 'interface', isExported: true }),
      );
    });

    it('should extract methods', () => {
      const code = `
public class User {
    public String getName() { return this.name; }
    private void setName(String name) { this.name = name; }
}
`;
      const parsed = CodeParser.parse('User.java', code);
      const result = SymbolExtractor.extract(parsed);

      const getName = result.symbols.find(s => s.name === 'getName');
      expect(getName).toBeDefined();
      expect(getName!.kind).toBe('method');
      expect(getName!.isExported).toBe(true);

      const setName = result.symbols.find(s => s.name === 'setName');
      expect(setName).toBeDefined();
      expect(setName!.isExported).toBe(false);
    });

    it('should extract imports', () => {
      const code = `
import java.util.List;
import java.util.Map;

public class Foo {}
`;
      const parsed = CodeParser.parse('Foo.java', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe('java.util.List');
      expect(result.imports[1].source).toBe('java.util.Map');
    });
  });

  describe('edge cases', () => {
    it('should handle empty file', () => {
      const parsed = CodeParser.parse('empty.ts', '');
      const result = SymbolExtractor.extract(parsed);

      expect(result.symbols).toEqual([]);
      expect(result.exports).toEqual([]);
      expect(result.imports).toEqual([]);
    });

    it('should handle complex TypeScript file', () => {
      const code = `
import { EventEmitter } from 'events';

export interface Config {
  name: string;
  debug: boolean;
}

export class App extends EventEmitter {
  private config: Config;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  start(): void {
    this.emit('start');
  }
}

export function createApp(config: Config): App {
  return new App(config);
}

const VERSION = '1.0.0';
`;
      const parsed = CodeParser.parse('app.ts', code);
      const result = SymbolExtractor.extract(parsed);

      expect(result.exports.length).toBeGreaterThanOrEqual(3); // Config, App, createApp
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('events');
    });
  });
});
