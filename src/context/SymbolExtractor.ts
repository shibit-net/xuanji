/**
 * ============================================================
 * SymbolExtractor — 符号提取器
 *
 * 使用 tree-sitter Query API 从 AST 中提取函数、类、接口、
 * 导出、导入等符号信息。
 * ============================================================
 */

import Parser from 'tree-sitter';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { logger } from '@/infrastructure/logger';
import { CodeParser } from './CodeParser';
import type {
  ParsedTree,
  SymbolInfo,
  SymbolKind,
  ImportInfo,
  ExtractedSymbols,
} from './types';

const log = logger.child({ module: 'SymbolExtractor' });

/** Query 源码缓存 */
const querySourceCache = new Map<string, string>();

/** 获取 queries 目录路径 */
function getQueriesDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return join(dirname(currentFile), 'queries');
}

/** 加载并缓存 Query 源码 */
function loadQuerySource(filename: string): string {
  if (!querySourceCache.has(filename)) {
    const filePath = join(getQueriesDir(), filename);
    querySourceCache.set(filename, readFileSync(filePath, 'utf-8'));
  }
  return querySourceCache.get(filename)!;
}

export class SymbolExtractor {
  /**
   * 从语法树提取符号
   */
  static extract(parsedTree: ParsedTree): ExtractedSymbols {
    try {
      switch (parsedTree.language) {
        case 'typescript':
        case 'tsx':
        case 'javascript':
        case 'jsx':
          return this.extractTypeScript(parsedTree);
        case 'python':
          return this.extractPython(parsedTree);
        case 'java':
          return this.extractJava(parsedTree);
        default:
          return { symbols: [], exports: [], imports: [] };
      }
    } catch (error) {
      log.debug(`Failed to extract symbols from ${parsedTree.filePath}`);
      return { symbols: [], exports: [], imports: [] };
    }
  }

  /**
   * 提取 TypeScript/JavaScript 符号
   */
  private static extractTypeScript(parsedTree: ParsedTree): ExtractedSymbols {
    const querySource = loadQuerySource('typescript.scm');
    const lang = CodeParser.getLanguage(parsedTree.language);
    const query = new Parser.Query(lang, querySource);
    const matches = query.matches(parsedTree.tree.rootNode);

    const symbols: SymbolInfo[] = [];
    const exports: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];

    // 跟踪已添加的导出符号，避免重复
    const exportedNames = new Set<string>();

    for (const match of matches) {
      const captureMap = new Map<string, Parser.SyntaxNode>();
      for (const capture of match.captures) {
        captureMap.set(capture.name, capture.node);
      }

      // 导出的函数
      const exportFnName = captureMap.get('export.function.name');
      if (exportFnName) {
        const parentNode = captureMap.get('export.function')!;
        const symbol: SymbolInfo = {
          name: exportFnName.text,
          kind: 'function',
          startLine: parentNode.startPosition.row,
          endLine: parentNode.endPosition.row,
          isExported: true,
        };
        symbols.push(symbol);
        exports.push(symbol);
        exportedNames.add(symbol.name);
        continue;
      }

      // 导出的类
      const exportClassName = captureMap.get('export.class.name');
      if (exportClassName) {
        const parentNode = captureMap.get('export.class')!;
        const symbol: SymbolInfo = {
          name: exportClassName.text,
          kind: 'class',
          startLine: parentNode.startPosition.row,
          endLine: parentNode.endPosition.row,
          isExported: true,
        };
        symbols.push(symbol);
        exports.push(symbol);
        exportedNames.add(symbol.name);
        continue;
      }

      // 导出的接口
      const exportIfaceName = captureMap.get('export.interface.name');
      if (exportIfaceName) {
        const parentNode = captureMap.get('export.interface')!;
        const symbol: SymbolInfo = {
          name: exportIfaceName.text,
          kind: 'interface',
          startLine: parentNode.startPosition.row,
          endLine: parentNode.endPosition.row,
          isExported: true,
        };
        symbols.push(symbol);
        exports.push(symbol);
        exportedNames.add(symbol.name);
        continue;
      }

      // 导出的变量
      const exportVarName = captureMap.get('export.variable.name');
      if (exportVarName) {
        const parentNode = captureMap.get('export.variable')!;
        const symbol: SymbolInfo = {
          name: exportVarName.text,
          kind: 'variable',
          startLine: parentNode.startPosition.row,
          endLine: parentNode.endPosition.row,
          isExported: true,
        };
        symbols.push(symbol);
        exports.push(symbol);
        exportedNames.add(symbol.name);
        continue;
      }

      // 非导出的函数（跳过已作为导出处理的）
      const fnName = captureMap.get('function.name');
      if (fnName && !exportedNames.has(fnName.text)) {
        const parentNode = captureMap.get('function.def')!;
        symbols.push({
          name: fnName.text,
          kind: 'function',
          startLine: parentNode.startPosition.row,
          endLine: parentNode.endPosition.row,
          isExported: false,
        });
        continue;
      }

      // 非导出的类（跳过已作为导出处理的）
      const className = captureMap.get('class.name');
      if (className && !exportedNames.has(className.text)) {
        const parentNode = captureMap.get('class.def')!;
        symbols.push({
          name: className.text,
          kind: 'class',
          startLine: parentNode.startPosition.row,
          endLine: parentNode.endPosition.row,
          isExported: false,
        });
        continue;
      }

      // 非导出的接口（跳过已作为导出处理的）
      const ifaceName = captureMap.get('interface.name');
      if (ifaceName && !exportedNames.has(ifaceName.text)) {
        const parentNode = captureMap.get('interface.def')!;
        symbols.push({
          name: ifaceName.text,
          kind: 'interface',
          startLine: parentNode.startPosition.row,
          endLine: parentNode.endPosition.row,
          isExported: false,
        });
        continue;
      }

      // 导入语句
      const importSource = captureMap.get('import.source');
      if (importSource) {
        const importNode = captureMap.get('import.stmt')!;
        imports.push(this.parseTypeScriptImport(importNode, importSource.text));
        continue;
      }
    }

    return { symbols, exports, imports };
  }

  /**
   * 解析 TypeScript import 语句
   */
  private static parseTypeScriptImport(
    importNode: Parser.SyntaxNode,
    source: string,
  ): ImportInfo {
    // import_clause 不是通过 field name 获取的，需要遍历子节点
    const importClause = importNode.children.find(c => c.type === 'import_clause');
    if (!importClause) {
      return { source, imports: [], isDefault: false };
    }

    const importNames: string[] = [];
    let isDefault = false;

    for (const child of importClause.children) {
      if (child.type === 'identifier') {
        // default import: import foo from '...'
        isDefault = true;
        importNames.push(child.text);
      } else if (child.type === 'named_imports') {
        // named import: import { a, b } from '...'
        for (const specifier of child.namedChildren) {
          if (specifier.type === 'import_specifier') {
            const name = specifier.childForFieldName('name');
            if (name) importNames.push(name.text);
          }
        }
      } else if (child.type === 'namespace_import') {
        // namespace import: import * as ns from '...'
        const name = child.childForFieldName('name');
        if (name) importNames.push(`* as ${name.text}`);
      }
    }

    return { source, imports: importNames, isDefault };
  }

  /**
   * 提取 Python 符号
   */
  private static extractPython(parsedTree: ParsedTree): ExtractedSymbols {
    const querySource = loadQuerySource('python.scm');
    const lang = CodeParser.getLanguage('python');
    const query = new Parser.Query(lang, querySource);
    const matches = query.matches(parsedTree.tree.rootNode);

    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];

    for (const match of matches) {
      const captureMap = new Map<string, Parser.SyntaxNode>();
      for (const capture of match.captures) {
        captureMap.set(capture.name, capture.node);
      }

      // 函数定义（仅顶层和类方法）
      const fnName = captureMap.get('function.name');
      if (fnName) {
        const fnNode = captureMap.get('function.def')!;
        // 判断是否为顶层函数（parent 是 module）
        const isTopLevel = fnNode.parent?.type === 'module';
        // 判断是否为类方法（parent 是 block，grandparent 是 class_definition）
        const isMethod =
          fnNode.parent?.type === 'block' &&
          fnNode.parent.parent?.type === 'class_definition';

        if (isTopLevel) {
          symbols.push({
            name: fnName.text,
            kind: 'function',
            startLine: fnNode.startPosition.row,
            endLine: fnNode.endPosition.row,
            isExported: !fnName.text.startsWith('_'),
          });
        } else if (isMethod) {
          symbols.push({
            name: fnName.text,
            kind: 'method',
            startLine: fnNode.startPosition.row,
            endLine: fnNode.endPosition.row,
            isExported: !fnName.text.startsWith('_'),
          });
        }
        continue;
      }

      // 类定义
      const className = captureMap.get('class.name');
      if (className) {
        const classNode = captureMap.get('class.def')!;
        symbols.push({
          name: className.text,
          kind: 'class',
          startLine: classNode.startPosition.row,
          endLine: classNode.endPosition.row,
          isExported: !className.text.startsWith('_'),
        });
        continue;
      }

      // import 语句
      const importModule = captureMap.get('import.module');
      if (importModule) {
        imports.push({
          source: importModule.text,
          imports: [importModule.text],
          isDefault: true,
        });
        continue;
      }

      // from ... import 语句
      const importSource = captureMap.get('import.source');
      if (importSource) {
        const fromNode = captureMap.get('import.from')!;
        const importNames: string[] = [];
        for (const child of fromNode.children) {
          if (child.type === 'dotted_name' && child !== importSource) {
            importNames.push(child.text);
          }
        }
        imports.push({
          source: importSource.text,
          imports: importNames,
          isDefault: false,
        });
        continue;
      }
    }

    // Python 没有显式 export，所有非 _ 前缀的顶层符号都视为导出
    const exports = symbols.filter(s => s.isExported && s.kind !== 'method');

    return { symbols, exports, imports };
  }

  /**
   * 提取 Java 符号
   */
  private static extractJava(parsedTree: ParsedTree): ExtractedSymbols {
    const querySource = loadQuerySource('java.scm');
    const lang = CodeParser.getLanguage('java');
    const query = new Parser.Query(lang, querySource);
    const matches = query.matches(parsedTree.tree.rootNode);

    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];

    for (const match of matches) {
      const captureMap = new Map<string, Parser.SyntaxNode>();
      for (const capture of match.captures) {
        captureMap.set(capture.name, capture.node);
      }

      // 类声明
      const className = captureMap.get('class.name');
      if (className) {
        const classNode = captureMap.get('class.def')!;
        const isPublic = this.hasModifier(classNode, 'public');
        symbols.push({
          name: className.text,
          kind: 'class',
          startLine: classNode.startPosition.row,
          endLine: classNode.endPosition.row,
          isExported: isPublic,
        });
        continue;
      }

      // 接口声明
      const ifaceName = captureMap.get('interface.name');
      if (ifaceName) {
        const ifaceNode = captureMap.get('interface.def')!;
        const isPublic = this.hasModifier(ifaceNode, 'public');
        symbols.push({
          name: ifaceName.text,
          kind: 'interface',
          startLine: ifaceNode.startPosition.row,
          endLine: ifaceNode.endPosition.row,
          isExported: isPublic,
        });
        continue;
      }

      // 方法声明
      const methodName = captureMap.get('method.name');
      if (methodName) {
        const methodNode = captureMap.get('method.def')!;
        const isPublic = this.hasModifier(methodNode, 'public');
        symbols.push({
          name: methodName.text,
          kind: 'method',
          startLine: methodNode.startPosition.row,
          endLine: methodNode.endPosition.row,
          isExported: isPublic,
        });
        continue;
      }

      // 导入语句
      const importPath = captureMap.get('import.path');
      if (importPath) {
        imports.push({
          source: importPath.text,
          imports: [importPath.text.split('.').pop() ?? importPath.text],
          isDefault: false,
        });
        continue;
      }
    }

    const exports = symbols.filter(s => s.isExported);

    return { symbols, exports, imports };
  }

  /**
   * 检查 Java 节点是否有指定修饰符
   */
  private static hasModifier(node: Parser.SyntaxNode, modifier: string): boolean {
    // modifiers 在 Java AST 中不是通过 field name 访问的，需要遍历子节点
    const modifiers = node.children.find(c => c.type === 'modifiers');
    if (!modifiers) return false;
    return modifiers.children.some(c => c.text === modifier);
  }
}
