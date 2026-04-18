// ============================================================
// 工具系统 — ANSI 转义序列处理
// ============================================================

/**
 * 去除字符串中的 ANSI 转义序列（颜色、样式等控制代码）
 *
 * @param str 包含 ANSI 代码的字符串
 * @returns 去除 ANSI 代码后的纯文本
 *
 * @example
 * ```ts
 * stripAnsi('\x1b[32m+added\x1b[0m') // => '+added'
 * stripAnsi('\x1b[31m-removed\x1b[0m') // => '-removed'
 * stripAnsi('\x1b[1mBold text\x1b[0m') // => 'Bold text'
 * ```
 */
export function stripAnsi(str: string): string {
  // 匹配所有 ANSI CSI 序列：ESC [ ... m
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * 检测字符串是否包含 ANSI 转义序列
 *
 * @param str 要检测的字符串
 * @returns 如果包含 ANSI 代码返回 true
 */
export function hasAnsi(str: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[[0-9;]*m/.test(str);
}
