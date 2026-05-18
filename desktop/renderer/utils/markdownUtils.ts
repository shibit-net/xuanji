/**
 * 检测当前文本中是否存在未闭合的 markdown 结构。
 * 用于气泡拆分时判断是否可以安全切分。
 */

/** 检查是否存在未闭合的代码围栏 (```) */
export function hasUnclosedFence(text: string): boolean {
  const fences = text.match(/^```/gm);
  if (!fences) return false;
  return fences.length % 2 !== 0;
}

/** 检查文本末尾是否存在未闭合的表格（最后非空行是表格行） */
export function hasUnclosedTable(text: string): boolean {
  const lines = text.split('\n');
  // 去掉末尾空行
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  if (lines.length === 0) return false;

  const lastLine = lines[lines.length - 1];
  // 表格行：以 | 开头且包含 |
  if (!/^\s*\|.*\|\s*$/.test(lastLine)) return false;

  // 向上查找连续的表格行和分隔行
  let rowCount = 0;
  let hasSeparator = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^\s*\|(\s*[-:]+\s*\|)+\s*$/.test(line)) {
      hasSeparator = true;
      rowCount++;
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      rowCount++;
    } else {
      break;
    }
  }

  // 有分隔行的表格 → 未闭合
  if (hasSeparator) return true;
  // 仅有表头（如 | A | B |），分隔行尚未到达 → 也是未闭合表格
  if (!hasSeparator && rowCount >= 1) return true;

  return false;
}

/** 是否存在任何未闭合的 markdown 结构 */
export function hasUnclosedMarkdownStructure(text: string): boolean {
  return hasUnclosedFence(text) || hasUnclosedTable(text);
}
