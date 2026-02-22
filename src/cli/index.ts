// ============================================================
// 向后兼容 — 转发到 adapters/cli
// ============================================================

export { App, type AppProps } from '../adapters/cli/App';
export { InputHandler, type InputHandlerProps } from '../adapters/cli/InputHandler';
export { Spinner, type SpinnerProps } from '../adapters/cli/Spinner';
export { ToolDisplay, type ToolDisplayProps } from '../adapters/cli/ToolDisplay';
export { StatusBar, type StatusBarProps } from '../adapters/cli/StatusBar';
export { getTheme, darkTheme, lightTheme, type Theme } from '../adapters/cli/Theme';
export { createBuiltinCommands, parseSlashCommand, type SlashCommand } from '../adapters/cli/SlashCommands';
export type { ChatMessage, ToolResultDisplay, CurrentToolState } from '../adapters/cli/types';
