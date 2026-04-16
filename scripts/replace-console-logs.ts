#!/usr/bin/env tsx
/**
 * 批量替换 console.log/error/warn/debug 为统一的 logger
 */

import { promises as fs } from 'fs';
import path from 'path';
import globCb from 'glob';
import { promisify } from 'util';

const glob = promisify(globCb);

const DRY_RUN = process.argv.includes('--dry-run');

interface Replacement {
  file: string;
  line: number;
  original: string;
  replaced: string;
}

const replacements: Replacement[] = [];

async function processFile(filePath: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  let modified = false;
  let hasLogger = false;
  let importLineIndex = -1;

  // 检查是否已经导入 logger
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("from '@/core/logger'") || lines[i].includes('from "./core/logger"')) {
      hasLogger = true;
      break;
    }
    if (lines[i].startsWith('import ') && importLineIndex === -1) {
      importLineIndex = i;
    }
  }

  // 处理每一行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跳过注释行
    if (line.trim().startsWith('//')) continue;

    // 匹配 console.log/error/warn/debug/info
    const consoleMatch = line.match(/console\.(log|error|warn|debug|info)\(/);
    if (consoleMatch) {
      const method = consoleMatch[1];
      let newLine = line;

      // 替换为 log.method
      newLine = newLine.replace(/console\.(log|error|warn|debug|info)\(/g, 'log.$1(');

      if (newLine !== line) {
        replacements.push({
          file: filePath,
          line: i + 1,
          original: line.trim(),
          replaced: newLine.trim(),
        });
        lines[i] = newLine;
        modified = true;
      }
    }
  }

  // 如果有修改且没有导入 logger，添加导入
  if (modified && !hasLogger) {
    const loggerImport = "import { logger } from '@/core/logger';\n\nconst log = logger.child({ module: '" +
      path.basename(filePath, path.extname(filePath)) + "' });";

    if (importLineIndex >= 0) {
      // 在最后一个 import 后面插入
      let insertIndex = importLineIndex;
      for (let i = importLineIndex + 1; i < lines.length; i++) {
        if (lines[i].startsWith('import ')) {
          insertIndex = i;
        } else if (lines[i].trim() !== '') {
          break;
        }
      }
      lines.splice(insertIndex + 1, 0, '', loggerImport);
    } else {
      // 在文件开头插入
      lines.unshift(loggerImport, '');
    }
  }

  // 写回文件
  if (modified && !DRY_RUN) {
    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
  }
}

async function main() {
  console.log('🔍 扫描 TypeScript 文件...\n');

  // 扫描 src 目录下的所有 .ts 文件（排除 .d.ts）
  const files = await glob('src/**/*.ts', {
    ignore: ['**/*.d.ts', '**/node_modules/**'],
    cwd: process.cwd(),
  }) as string[];

  console.log(`📁 找到 ${files.length} 个文件\n`);

  for (const file of files) {
    await processFile(file);
  }

  if (replacements.length > 0) {
    console.log(`\n✅ 完成！共替换 ${replacements.length} 处 console 调用：\n`);

    // 按文件分组显示
    const byFile = new Map<string, Replacement[]>();
    for (const r of replacements) {
      if (!byFile.has(r.file)) {
        byFile.set(r.file, []);
      }
      byFile.get(r.file)!.push(r);
    }

    for (const [file, items] of byFile) {
      console.log(`📄 ${file} (${items.length} 处)`);
      for (const item of items) {
        console.log(`   L${item.line}: ${item.original}`);
        console.log(`        → ${item.replaced}`);
      }
      console.log();
    }

    if (DRY_RUN) {
      console.log('⚠️  这是预览模式，未实际修改文件');
      console.log('   移除 --dry-run 参数以应用更改\n');
    }
  } else {
    console.log('\n✨ 没有找到需要替换的 console 调用\n');
  }
}

main().catch(console.error);
