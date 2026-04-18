// ============================================================
// 时间格式化工具
// ============================================================

/**
 * 格式化时间戳为友好的日志格式
 * @param timestamp ISO 8601 字符串或 Date 对象
 * @returns 格式化后的时间字符串，如 "04-19 23:08:58"
 */
export function formatLogTimestamp(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 格式化时间戳为完整日期时间
 * @param timestamp ISO 8601 字符串或 Date 对象
 * @returns 格式化后的时间字符串，如 "2026-04-19 23:08:58"
 */
export function formatFullTimestamp(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 格式化时间戳为简短时间（仅时分秒）
 * @param timestamp ISO 8601 字符串或 Date 对象
 * @returns 格式化后的时间字符串，如 "23:08:58"
 */
export function formatShortTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

/**
 * 获取当前时间的日志格式时间戳
 * @returns 格式化后的当前时间，如 "04-19 23:08:58"
 */
export function getCurrentLogTimestamp(): string {
  return formatLogTimestamp(new Date());
}

/**
 * 获取当前时间的完整时间戳
 * @returns 格式化后的当前时间，如 "2026-04-19 23:08:58"
 */
export function getCurrentFullTimestamp(): string {
  return formatFullTimestamp(new Date());
}
