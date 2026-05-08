// ============================================================
// IPC 通道定义 — 集中管理所有通道名和类型
// 加新通道时只改这里，preload + handler 自动同步
// ============================================================

// ── 窗口控制 ───────────────────────────────────────────
export const IPC_WINDOW_MINIMIZE = 'window:minimize';
export const IPC_WINDOW_MAXIMIZE = 'window:maximize';
export const IPC_WINDOW_CLOSE = 'window:close';

// ── 应用 ───────────────────────────────────────────────
export const IPC_APP_VERSION = 'app:version';

// ── 认证 ───────────────────────────────────────────────
export const IPC_AUTH_LOGIN = 'auth:login';
export const IPC_AUTH_LOGOUT = 'auth:logout';
export const IPC_AUTH_CHECK = 'auth:check';
export const IPC_AUTH_GET_SAVED_ACCOUNTS = 'auth:getSavedAccounts';
export const IPC_AUTH_SWITCH_ACCOUNT = 'auth:switchAccount';
export const IPC_AUTH_REMOVE_ACCOUNT = 'auth:removeAccount';

// ── Agent ──────────────────────────────────────────────
export const IPC_AGENT_INIT = 'agent:init';
export const IPC_AGENT_SEND_MESSAGE = 'agent:send-message';
export const IPC_AGENT_INTERRUPT = 'agent:interrupt';
export const IPC_AGENT_RESET = 'agent:reset';
export const IPC_AGENT_GET_STATE = 'agent:get-state';
export const IPC_AGENT_SEND_SUPPLEMENT = 'agent:send-supplement';
export const IPC_AGENT_APPEND_MESSAGE = 'agent:append-message';
export const IPC_AGENT_ANALYZE_INTENT = 'agent:analyze-intent';

// ── Workspace ──────────────────────────────────────────
export const IPC_WORKSPACE_OPEN_FILE = 'workspace:open-file';
export const IPC_WORKSPACE_OPEN_URL = 'workspace:open-url';

// ── 系统 ───────────────────────────────────────────────
export const IPC_SYSTEM_RESOURCE_USAGE = 'system:resource-usage';

// ── 设置 ───────────────────────────────────────────────
export const IPC_SETTINGS_GET = 'settings:get-config';
export const IPC_SETTINGS_GET_FULL = 'settings:get-full-config';
export const IPC_SETTINGS_UPDATE = 'settings:update-config';

// ── Session ────────────────────────────────────────────
export const IPC_SESSION_SAVE = 'session:save';
export const IPC_SESSION_RESUME = 'session:resume';
export const IPC_SESSION_LIST = 'session:list';
export const IPC_SESSION_DELETE = 'session:delete';

// ── Checkpoint ─────────────────────────────────────────
export const IPC_CHECKPOINT_CREATE = 'checkpoint:create';
export const IPC_CHECKPOINT_LIST = 'checkpoint:list';
export const IPC_CHECKPOINT_REWIND = 'checkpoint:rewind';
