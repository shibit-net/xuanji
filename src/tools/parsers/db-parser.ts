/**
 * ============================================================
 * DB Parser — .db/.sqlite → 表结构 + 数据采样
 * ============================================================
 * 使用 better-sqlite3 读取 SQLite 数据库文件。
 * 输出所有表的结构和前 20 行数据。
 */

import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import type { FileParserResult } from './types';

export async function parseDatabase(filePath: string): Promise<FileParserResult> {
  // 动态加载 better-sqlite3（已在依赖中）
  // better-sqlite3 在 ESM 下可能 default 不可用，用类型断言忽略
  const Database = (await import('better-sqlite3')) as any;

  const db = new (Database.default ?? Database)(filePath, { readonly: true });
  try {
    const lines: string[] = [];

    // 获取文件大小
    const st = statSync(filePath);
    const sizeMB = (st.size / 1024 / 1024).toFixed(1);
    lines.push(`[SQLite Database] ${filePath} (${sizeMB}MB)`);
    lines.push('');

    // 获取所有表
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as { name: string }[];

    if (tables.length === 0) {
      lines.push('(no tables found)');
      return { content: lines.join('\n') };
    }

    lines.push(`Tables (${tables.length}):`);
    lines.push('');

    for (const table of tables) {
      const tableName = table.name;

      // 表结构
      const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;

      // 行数
      const rowCountRow = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number };
      const rowCount = rowCountRow.count;

      // 列定义
      const colDefs = columns.map(c => {
        const parts = [c.name, c.type];
        if (c.pk) parts.push('PK');
        if (c.notnull) parts.push('NOT NULL');
        return parts.join(' ');
      });

      lines.push(`### ${tableName} (${rowCount} rows)`);
      lines.push('');
      lines.push(`Columns: ${columns.length}`);
      lines.push(`- ${colDefs.join('\n- ')}`);
      lines.push('');

      // 采样前 20 行
      if (rowCount > 0) {
        const sampleRows = db.prepare(`SELECT * FROM "${tableName}" LIMIT 20`).all() as Record<string, unknown>[];
        const colNames = columns.map(c => c.name);

        // Markdown 表格
        lines.push('| ' + colNames.join(' | ') + ' |');
        lines.push('| ' + colNames.map(() => '---').join(' | ') + ' |');

        for (const row of sampleRows) {
          const vals = colNames.map(name => {
            const v = row[name];
            if (v === null || v === undefined) return '';
            return String(v).slice(0, 60); // 防止超长单元格破坏表格
          });
          lines.push('| ' + vals.join(' | ') + ' |');
        }

        if (rowCount > 20) {
          lines.push('');
          lines.push(`> ... ${rowCount - 20} more rows`);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    // 索引信息
    const indexes = db.prepare(
      `SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name`
    ).all() as { name: string; tbl_name: string }[];

    if (indexes.length > 0) {
      lines.push('### Indexes');
      lines.push('');
      for (const idx of indexes) {
        lines.push(`- ${idx.tbl_name}.${idx.name}`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return {
      content: lines.join('\n').trim(),
      metadata: { tables: tables.length, tableNames: tables.map(t => t.name), sizeMB },
    };
  } finally {
    db.close();
  }
}
