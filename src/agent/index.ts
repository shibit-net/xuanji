// ============================================================
// M2 Agent 调度模块 — 模块导出
// ============================================================

export type { InterruptChecker } from './InterruptChecker';
export { AgentLoop, type AgentCallbacks } from './AgentLoop';
export { AgentFactory } from './factory/AgentFactory';
export type { AgentCreateOptions, AgentInstance } from './factory/AgentFactory';
export { WorktreeManager } from './WorktreeManager';
export type { SubAgentResult } from './factory/AgentFactory';
export { SubAgentContext } from './SubAgentContext';


// Multi-Agent System (v2: 简化架构)
export { AgentRegistry } from './AgentRegistry';
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
