// ============================================================
// 工具系统 — Diff 渲染器
// ============================================================
//
// 生成行级 diff 对比，用于 Edit/Write 工具执行前预览变更
//

import * as Diff from 'diff';

export interface DiffStats {
  /** 新增行数 */
  added: number;
  /** 删除行数 */
  removed: number;
  /** 未变更行数 */
  unchanged: number;
}

/**
 * Diff 渲染器
 *
 * 提供行级 diff 对比和统计功能
 */
export class DiffRenderer {
  /**
   * 渲染行级 diff（ANSI 颜色 + 行号）
   *
   * @param oldStr 原始内容
   * @param newStr 新内容
   * @param showLineNumbers 是否显示行号（默认 true）
   * @param changesOnly 是否仅显示变更的行（过滤掉未变更的上下文，默认 true）
   * @returns ANSI 颜色的 diff 字符串
   */
  static renderLines(
    oldStr: string,
    newStr: string,
    showLineNumbers: boolean = true,
    changesOnly: boolean = true,
  ): string {
    const changes = Diff.diffLines(oldStr, newStr);
    const lines: string[] = [];

    let oldLineNum = 1; // 旧文件行号
    let newLineNum = 1; // 新文件行号

    for (const change of changes) {
      const prefix = change.added ? '+' : change.removed ? '-' : ' ';
      const color = change.added ? '\x1b[32m' : change.removed ? '\x1b[31m' : '';
      const reset = change.added || change.removed ? '\x1b[0m' : '';

      // 如果启用 changesOnly，跳过未变更的行
      const isChange = change.added || change.removed;
      if (changesOnly && !isChange) {
        // 仍需更新行号，但不渲染内容
        const lineCount = change.count ?? change.value.split('\n').length - 1;
        oldLineNum += lineCount;
        newLineNum += lineCount;
        continue;
      }

      // 分割行并逐行渲染
      const contentLines = change.value.split('\n');
      // 最后一行如果是空字符串（因为 \n 结尾），去掉
      if (contentLines[contentLines.length - 1] === '') {
        contentLines.pop();
      }

      for (const line of contentLines) {
        let lineNumPrefix = '';
        if (showLineNumbers) {
          // 单列行号：删除行显示旧行号，其他行显示新行号
          const lineNum = change.removed ? oldLineNum : newLineNum;
          lineNumPrefix = `${String(lineNum).padStart(4)} │ `;
        }
        lines.push(`${lineNumPrefix}${color}${prefix} ${line}${reset}`);

        // 更新行号
        if (!change.added) oldLineNum++;
        if (!change.removed) newLineNum++;
      }
    }

    // 大 diff 截断（超过 100 行只显示前 50 + 后 50）
    if (lines.length > 100) {
      return [
        ...lines.slice(0, 50),
        `\x1b[90m... (省略 ${lines.length - 100} 行) ...\x1b[0m`,
        ...lines.slice(-50),
      ].join('\n');
    }

    return lines.join('\n');
  }

  /**
   * 生成 diff 摘要统计
   *
   * @param oldStr 原始内容
   * @param newStr 新内容
   * @returns 统计信息（added/removed/unchanged 行数）
   */
  static getStats(oldStr: string, newStr: string): DiffStats {
    const changes = Diff.diffLines(oldStr, newStr);

    const stats: DiffStats = {
      added: 0,
      removed: 0,
      unchanged: 0,
    };

    for (const change of changes) {
      const lineCount = change.count ?? 0;

      if (change.added) {
        stats.added += lineCount;
      } else if (change.removed) {
        stats.removed += lineCount;
      } else {
        stats.unchanged += lineCount;
      }
    }

    return stats;
  }

  /**
   * 格式化统计信息为字符串
   *
   * @param stats 统计信息
   * @returns 格式化的字符串（如 "+10 -5"）
   */
  static formatStats(stats: DiffStats): string {
    return `+${stats.added} -${stats.removed}`;
  }

  /**
   * 生成完整 Diff 预览（含头部和统计）
   *
   * @param oldStr 原始内容
   * @param newStr 新内容
   * @param filePath 文件路径
   * @param showLineNumbers 是否显示行号（默认 true）
   * @param changesOnly 是否仅显示变更的行（过滤掉未变更的上下文，默认 true）
   * @returns 完整的 diff 预览字符串
   */
  static renderPreview(
    oldStr: string,
    newStr: string,
    filePath: string,
    showLineNumbers: boolean = true,
    changesOnly: boolean = true,
  ): string {
    // 单次 diff 计算，同时获取 stats 和 lines
    const changes = Diff.diffLines(oldStr, newStr);

    const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 };
    const lines: string[] = [];

    let oldLineNum = 1; // 旧文件行号
    let newLineNum = 1; // 新文件行号

    for (const change of changes) {
      const lineCount = change.count ?? 0;
      if (change.added) {
        stats.added += lineCount;
      } else if (change.removed) {
        stats.removed += lineCount;
      } else {
        stats.unchanged += lineCount;
      }

      const prefix = change.added ? '+' : change.removed ? '-' : ' ';
      const color = change.added ? '\x1b[32m' : change.removed ? '\x1b[31m' : '';
      const reset = change.added || change.removed ? '\x1b[0m' : '';

      // 如果启用 changesOnly，跳过未变更的行
      const isChange = change.added || change.removed;
      if (changesOnly && !isChange) {
        // 仍需更新行号，但不渲染内容
        const skipLineCount = change.count ?? change.value.split('\n').length - 1;
        oldLineNum += skipLineCount;
        newLineNum += skipLineCount;
        continue;
      }

      const contentLines = change.value.split('\n');
      if (contentLines[contentLines.length - 1] === '') {
        contentLines.pop();
      }
      for (const line of contentLines) {
        let lineNumPrefix = '';
        if (showLineNumbers) {
          // 单列行号：删除行显示旧行号，其他行显示新行号
          const lineNum = change.removed ? oldLineNum : newLineNum;
          lineNumPrefix = `${String(lineNum).padStart(4)} │ `;
        }
        lines.push(`${lineNumPrefix}${color}${prefix} ${line}${reset}`);

        // 更新行号
        if (!change.added) oldLineNum++;
        if (!change.removed) newLineNum++;
      }
    }

    // 大 diff 截断
    let diffOutput: string;
    if (lines.length > 100) {
      diffOutput = [
        ...lines.slice(0, 50),
        `\x1b[90m... (省略 ${lines.length - 100} 行) ...\x1b[0m`,
        ...lines.slice(-50),
      ].join('\n');
    } else {
      diffOutput = lines.join('\n');
    }

    const header = [
      `\x1b[1m变更预览: ${filePath}\x1b[0m`,
      `统计: ${this.formatStats(stats)}`,
      showLineNumbers ? `${'─'.repeat(60)}` : `${'─'.repeat(60)}`,
      showLineNumbers ? '  行 │ 差异' : '',
    ].filter(Boolean).join('\n');

    return `${header}\n${diffOutput}`;
  }
}
