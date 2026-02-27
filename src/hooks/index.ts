/**
 * Hook 系统模块
 */

export { HookRegistry, type PromptInjector } from './HookRegistry.js';
export { HookEventEmitter, type HookListener } from './EventEmitter.js';
export { HookConfigLoader } from './ConfigLoader.js';
export { executeCommandHandler } from './handlers/CommandHandler.js';
export { executePromptHandler } from './handlers/PromptHandler.js';
export { executeAgentHandler, setAgentHandlerDeps, type AgentHandlerDeps } from './handlers/AgentHandler.js';

export type {
  HookEvent,
  HookHandler,
  HookHandlerType,
  HookScope,
  HookConfig,
  HookEventContext,
  HookHandlerResult,
  HookRegistryOptions,
  BaseHookHandler,
  CommandHookHandler,
  PromptHookHandler,
  AgentHookHandler,
} from './types.js';

export { ALL_EVENTS, SYNC_EVENTS } from './types.js';
