// ============================================================
// UI 工具 — 图标映射
// ============================================================

/**
 * 工具图标映射
 */
export const TOOL_ICONS: Record<string, string> = {
  // 文件操作
  read_file: '📖',
  write_file: '✍️',
  edit_file: '✏️',
  glob: '🔍',
  grep: '🔎',
  ls: '📂',
  
  // 命令执行
  bash: '💻',
  task_output: '📋',
  
  // 网络
  web_fetch: '🌐',
  web_search: '🔍',
  
  // 交互
  ask_user: '❓',
  plan_review: '📝',

  // 提醒
  reminder_set: '⏰',
  reminder_check: '📅',
  
  // Todo
  todo_create: '✅',
  todo_update: '🔄',
  todo_list: '📋',
  
  // 其他
  sleep: '😴',
  multi_edit: '📝',
  notebook_edit: '📓',
  
  // SubAgent
  task: '🤖',
  team: '👥',
  quick_team: '⚡',
};

/**
 * 日志源图标映射
 */
export const LOG_SOURCE_ICONS: Record<string, string> = {
  Chat: '💬',
  Bot: '🤖',
  System: '⚙️',
  MCP: '🔌',
  Tool: '🔧',
  Error: '❌',
  Warn: '⚠️',
  Info: 'ℹ️',
  Debug: '🐛',
};

/**
 * 状态图标映射
 */
export const STATUS_ICONS = {
  // 通用状态
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  pending: '⏳',
  running: '🔄',
  completed: '✅',
  
  // MCP 状态
  ready: '✓',
  connecting: '⟳',
  error_state: '✗',
  
  // Reminder 状态
  overdue: '⚠️',
  today: '📅',
  upcoming: '🔔',
  
  // Package 状态
  draft: '📝',
  online: '✅',
  offline: '❌',
  pending_review: '⏳',
  
  // Subscription 状态
  active: '✅',
  paused: '⏸️',
  expired: '❌',
} as const;

/**
 * 获取工具图标
 */
export function getToolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] || '🔧';
}

/**
 * 获取日志源图标
 */
export function getLogSourceIcon(source: string): string {
  return LOG_SOURCE_ICONS[source] || 'ℹ️';
}

/**
 * 获取状态图标
 */
export function getStatusIcon(status: string | number): string {
  // 数字状态码（Package）
  if (typeof status === 'number') {
    switch (status) {
      case 1: return STATUS_ICONS.draft;
      case 2: return STATUS_ICONS.online;
      case 3: return STATUS_ICONS.offline;
      case 4: return STATUS_ICONS.pending_review;
      default: return STATUS_ICONS.info;
    }
  }
  
  // 字符串状态
  return STATUS_ICONS[status as keyof typeof STATUS_ICONS] || STATUS_ICONS.info;
}

/**
 * 获取订阅状态图标
 */
export function getSubscriptionStatusIcon(status: number): string {
  switch (status) {
    case 1: return STATUS_ICONS.active;
    case 2: return STATUS_ICONS.paused;
    case 3: return STATUS_ICONS.expired;
    default: return STATUS_ICONS.info;
  }
}
