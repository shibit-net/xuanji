// ============================================================
// M6 工具系统 — 模块导出
// ============================================================

export { BaseTool } from './BaseTool';
export { ReadTool } from './ReadTool';
export { WriteTool } from './WriteTool';
export { EditTool } from './EditTool';
export { MultiEditTool } from './MultiEditTool';
export { BashTool } from './BashTool';
export { GlobTool } from './GlobTool';
export { GrepTool } from './GrepTool';
export { LSTool } from './LSTool';
export { ChangeDirectoryTool } from './ChangeDirectoryTool';
export { TaskOutputTool } from './TaskOutputTool';
export { TaskTool } from './TaskTool';
export { TeamTool } from './TeamTool';
export { MatchAgentTool } from './MatchAgentTool';
export { ListAgentsTool } from './ListAgentsTool';
export { ListScenesTool } from './ListScenesTool';
export { AskUserTool } from './AskUserTool';
export { PlanReviewTool } from './PlanReviewTool';
export { EnhancedWebSearchTool } from '@/mcp/search/EnhancedWebSearchTool';
export type { EnhancedWebSearchConfig } from '@/mcp/search/EnhancedWebSearchTool';
export { TodoManager } from './TodoManager';
export { TodoCreateTool, TodoListTool, TodoUpdateTool, setTodoManager, getTodoManager } from './TodoTool';
export { BackgroundTaskManager } from './BackgroundTaskManager';
export { PersistentShell, getSharedShell, closeSharedShell } from './PersistentShell';
export { SleepTool } from './SleepTool';
export { EnterPlanModeTool } from './EnterPlanModeTool';
export { ExitPlanModeTool } from './ExitPlanModeTool';
export { NotebookEditTool } from './NotebookEditTool';
export { WorktreeTool } from './WorktreeTool';
export { PdfTool } from './PdfTool';
export { OfficeGenerateTool } from './OfficeGenerateTool';
export { XlsxEditTool } from './XlsxEditTool';
export { DocxEditTool } from './DocxEditTool';
export { DocToDocxTool } from './DocToDocxTool';
export { ToolGateway } from './ToolGateway';
export type { ExecutionContext, ToolMetrics, PermissionController } from './ToolGateway';
export { ToolRegistry, createDefaultRegistry } from './ToolRegistry';

// Utils
export { DiffRenderer } from '@/shared/utils/DiffRenderer';
