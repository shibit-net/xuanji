import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/infrastructure/core-types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { AgentLoop } from './AgentLoop';

/**
 * 后台静默 AgentLoop — 用于系统后台任务（记忆提取、上下文压缩等）。
 *
 * 与普通 AgentLoop 的区别：
 * - 自动 suppressEventBus，不向 EventBus 发射 AGENT_TEXT_DELTA/AGENT_TOOL_START 等事件
 * - 拒绝 hookRegistry 注入，不参与 Hook 管线
 * - 生命周期事件由调用方通过专属 hook 事件（HOOK_BACKGROUND_TASK_START/END）管理
 */
export class SilentAgentLoop extends AgentLoop {
  constructor(
    provider: ILLMProvider,
    registry: IToolRegistry,
    config: AgentConfig,
    userId?: string,
  ) {
    super(provider, registry, config, userId);
    this.setSuppressEventBus(true);
  }

  setHookRegistry(_hookRegistry: HookRegistry): void {
    // 后台 agent 不参与 Hook 管线
  }
}
