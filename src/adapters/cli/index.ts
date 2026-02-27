// ============================================================
// M1 终端 UI — 模块导出
// ============================================================

export { App, type AppProps } from './App';
export { InputHandler, type InputHandlerProps } from './InputHandler';
export { Spinner, type SpinnerProps } from './Spinner';
export { ToolDisplay, type ToolDisplayProps } from './ToolDisplay';
export { StatusBar, type StatusBarProps } from './StatusBar';
export { StartupLogo, type StartupLogoProps } from './StartupLogo';
export { getTheme, darkTheme, lightTheme, type Theme } from './Theme';
export { parseSlashCommand, type SlashCommand } from './SlashCommands';
export type { ChatMessage, ToolResultDisplay, CurrentToolState, AppMode, SettingsTab, LogEntry, BotType, BotStatus } from './types';

// 新增：设置模式相关导出
export { SettingsMode } from './settings/SettingsMode';
export { LlmSettings } from './settings/LlmSettings';
export { UiSettings } from './settings/UiSettings';
export { BotsConfigPanel } from './settings/BotsConfigPanel';

// 新增：日志和机器人模式导出
export { LogsMode } from './LogsMode';
export { BotsMode } from './BotsMode';

// 新增：工具类导出
export { ConfigManager } from './utils/ConfigManager';
export { LogSystem } from './utils/LogSystem';
export { BotManager } from './utils/BotManager';

