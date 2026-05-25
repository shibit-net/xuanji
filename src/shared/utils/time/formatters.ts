// ============================================================
// 时间格式化工具（所有时间戳统一使用 UTC+8，即北京时间）
// ============================================================

/** UTC+8 偏移量（毫秒） */
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/**
 * 将 Date 对象转换为 UTC+8 时间组件。
 * 原理：在原始时间戳上加上 UTC+8 偏移，然后使用 getUTC* 方法读取。
 */
export function getUTC8Components(date: Date) {
  const d = new Date(date.getTime() + UTC8_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  };
}

/**
 * 获取当前时间的 UTC+8 时间戳字符串。
 * 格式：YYYY-MM-DDTHH:mm:ss.SSS+08:00（兼容 ISO 8601，用于 JSONL 文件）
 */
export function getUTC8Timestamp(): string {
  const c = getUTC8Components(new Date());
  return `${c.year}-${pad(c.month)}-${pad(c.day)}T${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}.${pad(c.ms, 3)}+08:00`;
}

/**
 * 获取当前 UTC+8 日期字符串。
 * 格式：YYYY-MM-DD（用于日志文件命名）
 */
export function getUTC8DateString(): string {
  const c = getUTC8Components(new Date());
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

/**
 * 将 Date 对象转为 UTC+8 时间戳字符串。
 * 格式与 getUTC8Timestamp() 一致：YYYY-MM-DDTHH:mm:ss.SSS+08:00
 */
export function dateToUTC8Timestamp(date: Date): string {
  const c = getUTC8Components(date);
  return `${c.year}-${pad(c.month)}-${pad(c.day)}T${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}.${pad(c.ms, 3)}+08:00`;
}

/**
 * 格式化时间戳为友好的日志格式（UTC+8）
 * @param timestamp ISO 8601 字符串或 Date 对象
 * @returns 格式化后的时间字符串，如 "04-19 23:08:58"
 */
export function formatLogTimestamp(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const c = getUTC8Components(date);
  return `${pad(c.month)}-${pad(c.day)} ${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
}

/**
 * 格式化时间戳为完整日期时间（UTC+8）
 * @param timestamp ISO 8601 字符串或 Date 对象
 * @returns 格式化后的时间字符串，如 "2026-04-19 23:08:58"
 */
export function formatFullTimestamp(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const c = getUTC8Components(date);
  return `${c.year}-${pad(c.month)}-${pad(c.day)} ${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
}

/**
 * 格式化时间戳为简短时间（仅时分秒，UTC+8）
 * @param timestamp ISO 8601 字符串或 Date 对象
 * @returns 格式化后的时间字符串，如 "23:08:58"
 */
export function formatShortTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const c = getUTC8Components(date);
  return `${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
}

/**
 * 获取当前时间的日志格式时间戳（UTC+8）
 * @returns 格式化后的当前时间，如 "04-19 23:08:58"
 */
export function getCurrentLogTimestamp(): string {
  return formatLogTimestamp(new Date());
}

/**
 * 获取当前时间的完整时间戳（UTC+8）
 * @returns 格式化后的当前时间，如 "2026-04-19 23:08:58"
 */
export function getCurrentFullTimestamp(): string {
  return formatFullTimestamp(new Date());
}
