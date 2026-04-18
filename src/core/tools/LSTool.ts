// ============================================================
// M6 工具系统 — LSTool 目录浏览
// ============================================================

import { BaseTool } from './BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import { readdir, stat } from 'node:fs/promises';
import { resolve, basename, relative } from 'node:path';
import glob from 'fast-glob';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';

const MAX_ENTRIES = 1000; // 最多返回条目数

interface LSInput {
  path?: string;
  filter?: string;
  sort?: 'name' | 'size' | 'mtime';
  recursive?: boolean;
  max_depth?: number;
}

interface FileEntry {
  type: 'file' | 'dir';
  name: string;
  size: number;
  mtime: Date;
  relativePath: string;
}

/**
 * LS 目录浏览工具
 * 专用目录列表工具，替代 bash ls，提升 token 效率
 */
export class LSTool extends BaseTool {
  readonly name = 'list_directory';
  readonly description =
    '列出目录内容，支持过滤、排序、递归。优先使用此工具而非 bash ls 命令。';
  readonly readonly = true; // ✅ 只读工具，可并行执行

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '目录路径（默认为当前工作目录）',
      },
      filter: {
        type: 'string',
        description: 'glob 模式过滤，如 "*.ts" 或 "test*"（默认列出所有文件）',
      },
      sort: {
        type: 'string',
        enum: ['name', 'size', 'mtime'],
        description: '排序方式: name=名称, size=大小, mtime=修改时间（默认 name）',
      },
      recursive: {
        type: 'boolean',
        description: '是否递归列出子目录（默认 false）',
      },
      max_depth: {
        type: 'number',
        description: '递归最大深度（默认 3），仅在 recursive=true 时生效',
      },
    },
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const { path: dirPath, filter, sort, recursive, max_depth } = input as unknown as LSInput;
      const targetPath = resolve(dirPath ?? process.cwd());

      // 检查路径是否存在且为目录
      try {
        const stats = await stat(targetPath);
        if (!stats.isDirectory()) {
          return this.error(`路径不是目录: ${targetPath}`);
        }
      } catch {
        return this.error(`目录不存在: ${targetPath}`);
      }

      // 收集文件条目
      let entries: FileEntry[];

      if (recursive) {
        const maxDepth = (max_depth ?? 3);
        entries = await this.listRecursive(targetPath, filter, maxDepth);
      } else {
        entries = await this.listShallow(targetPath, filter);
      }

      // 排序
      this.sortEntries(entries, sort ?? 'name');

      // 截断保护
      const truncated = entries.length > MAX_ENTRIES;
      const displayEntries = truncated ? entries.slice(0, MAX_ENTRIES) : entries;

      // 构建 ASCII 表格输出
      let output = this.formatTable(displayEntries);

      if (truncated) {
        output += `\n\n[已截断：找到 ${entries.length} 个文件/目录，仅显示前 ${MAX_ENTRIES} 个]`;
      }

      // 输出长度截断
      output = middleTruncate(output, getMaxToolOutputLength());

      return this.success(output, {
        totalEntries: entries.length,
        shownEntries: displayEntries.length,
        truncated,
        path: targetPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(`列出目录失败: ${message}`);
    }
  }

  /**
   * 列出单层目录
   */
  private async listShallow(dirPath: string, filter?: string): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    const items = await readdir(dirPath);

    // 预编译 glob matcher（使用 micromatch 的 picomatch）
    let matchFn: ((name: string) => boolean) | null = null;
    if (filter) {
      const picomatch = (await import('picomatch')).default;
      matchFn = picomatch(filter, { dot: false });
    }

    for (const name of items) {
      // 应用 glob 过滤
      if (matchFn && !matchFn(name)) {
        continue;
      }

      const fullPath = resolve(dirPath, name);
      try {
        const stats = await stat(fullPath);
        entries.push({
          type: stats.isDirectory() ? 'dir' : 'file',
          name,
          size: stats.size,
          mtime: stats.mtime,
          relativePath: name,
        });
      } catch {
        // 忽略无法访问的文件
      }
    }

    return entries;
  }

  /**
   * 递归列出目录
   */
  private async listRecursive(
    dirPath: string,
    filter: string | undefined,
    maxDepth: number,
  ): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];

    // 使用 fast-glob 递归搜索
    // 如果 filter 不含路径分隔符，自动补 **/ 前缀以匹配子目录
    let pattern = filter ?? '**/*';
    if (filter && !filter.includes('/')) {
      pattern = `**/${filter}`;
    }
    const files = await glob(pattern, {
      cwd: dirPath,
      onlyFiles: false, // 包含目录
      dot: false,
      deep: maxDepth,
      absolute: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    for (const file of files) {
      const fullPath = resolve(dirPath, file);
      try {
        const stats = await stat(fullPath);
        entries.push({
          type: stats.isDirectory() ? 'dir' : 'file',
          name: basename(file),
          size: stats.size,
          mtime: stats.mtime,
          relativePath: file,
        });
      } catch {
        // 忽略无法访问的文件
      }
    }

    return entries;
  }

  /**
   * 排序条目
   */
  private sortEntries(entries: FileEntry[], sortBy: 'name' | 'size' | 'mtime'): void {
    switch (sortBy) {
      case 'name':
        entries.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'size':
        entries.sort((a, b) => b.size - a.size); // 降序
        break;
      case 'mtime':
        entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // 最新优先
        break;
    }
  }

  /**
   * 格式化为 ASCII 表格
   */
  private formatTable(entries: FileEntry[]): string {
    if (entries.length === 0) {
      return '(空目录)';
    }

    const header = 'Type  Size       Modified             Name';
    const separator = '────  ─────────  ───────────────────  ────';
    const rows = entries.map((e) => {
      const type = e.type === 'dir' ? '📁' : '📄';
      const size = this.formatSize(e.size);
      const mtime = this.formatDate(e.mtime);
      return `${type}    ${size.padEnd(10)}  ${mtime}  ${e.relativePath}`;
    });

    return [header, separator, ...rows].join('\n');
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes === 0) return '-';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
  }

  /**
   * 格式化日期
   */
  private formatDate(date: Date): string {
    const now = new Date();

    // 如果是今年，不显示年份
    if (date.getFullYear() === now.getFullYear()) {
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${month}-${day} ${hours}:${minutes}`;
    }

    // 跨年显示年份
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
