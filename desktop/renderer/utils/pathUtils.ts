// ============================================================
// 文件路径工具 — 跨平台路径检测与标准化
// ============================================================

/** 检测当前是否为 Windows 系统 */
export function isWindows(): boolean {
  return /win/i.test(navigator.platform || '');
}

/** 检测文本是否像文件路径（兼容 Unix / Windows 正反斜杠） */
export function isFilePath(text: string): boolean {
  if (!text || text.length < 5) return false;
  if (!text.includes('/') && !text.includes('\\')) return false;
  // Unix: ~/  /  ./  ../
  // Windows: ~\  \  .\  ..\  C:\
  return /^(~[\/\\]|\/|[a-zA-Z]:[\/\\]|\.\.?[\/\\])/.test(text);
}

/** 将路径分隔符转为当前系统原生格式 */
export function toNativePath(filePath: string): string {
  if (!filePath) return filePath;
  if (isWindows()) {
    return filePath.replace(/\//g, '\\');
  }
  return filePath.replace(/\\/g, '/');
}
