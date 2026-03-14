// ============================================================
// M2 Agent 调度模块 — 模块导出
// ============================================================

export { AgentLoop, type AgentCallbacks } from './AgentLoop';
export { MessageManager, type IMessageManager } from './MessageManager';
export { StreamProcessor, type ProcessResult } from './StreamProcessor';
export { ToolDispatcher, type IToolDispatcher } from './ToolDispatcher';
export { TokenManager } from './TokenManager';
export { ContextCompressor, DEFAULT_COMPRESSOR_CONFIG } from './ContextCompressor';
export { CostTracker } from './CostTracker';
export { ErrorRecovery } from './ErrorRecovery';
export { PricingResolver } from './PricingResolver';
export { WorktreeManager } from './WorktreeManager';
export { runSubAgent } from './SubAgentLoop';
export { SubAgentContext } from './SubAgentContext';
export { emitSubAgentToolUse, createSubAgentToolUseHook, type SubAgentHookContext } from './SubAgentHooks';

// Multi-Agent System
export { AgentCoordinator } from './AgentCoordinator';
export { AgentFactory } from './AgentFactory';
export { AgentLoader } from './AgentLoader';
export { RouterAgent } from './RouterAgent';
export { SpecialistAgent } from './SpecialistAgent';
export { CoordinatorAgent, type CoordinationMode, type TeamConfig as CoordinatorTeamConfig } from './CoordinatorAgent';
export type {
  AgentRole,
  AgentInput,
  AgentOutput,
  RouterOutput,
  AgentDefinition,
  IAgent,
  IAgentFactory,
  IAgentCoordinator,
} from './types';
