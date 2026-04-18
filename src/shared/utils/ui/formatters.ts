// ============================================================
// UI 工具 — 格式化函数
// ============================================================

/**
 * 格式化时长（毫秒 → 人类可读）
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
}

/**
 * 格式化工具耗时（秒，保留2位小数）
 */
export function formatToolDuration(ms: number): string {
  if (!ms || ms < 0) return '0.00s';
  return (ms / 1000).toFixed(2) + 's';
}

/**
 * 格式化数字（添加千分位）
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * 格式化日期（相对时间）
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 7) {
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }
  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  if (seconds > 10) return `${seconds}秒前`;
  return '刚刚';
}

/**
 * 格式化工具名称（下划线转空格，首字母大写）
 */
export function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * 格式化命令（截取主命令）
 */
export function formatCommand(command: string, maxLength: number = 50): string {
  const cleaned = command.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 3) + '...';
}

/**
 * 脱敏 API Key
 */
export function maskApiKey(key?: string): string {
  if (!key) return '(未配置)';
  if (key.length <= 12) return key.slice(0, 4) + '****';
  return key.slice(0, 8) + '...' + key.slice(-4);
}

/**
 * 脱敏敏感信息（邮箱、手机号等）
 */
export function maskSensitive(text: string, type: 'email' | 'phone' | 'auto' = 'auto'): string {
  if (type === 'email' || (type === 'auto' && text.includes('@'))) {
    const [local, domain] = text.split('@');
    if (!domain) return text;
    const visibleLocal = local.slice(0, 2);
    return `${visibleLocal}***@${domain}`;
  }
  
  if (type === 'phone' || (type === 'auto' && /^\d{11}$/.test(text))) {
    return text.slice(0, 3) + '****' + text.slice(-4);
  }
  
  return text;
}
