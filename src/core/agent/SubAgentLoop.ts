/**
 * SubAgentLoop — 子代理循环
 *
 * 基于 AgentLoop 实现上下文隔离的子代理:
 * - 独立的 MessageManager（不污染父代理上下文）
 * - 超时自动终止
 * - 工具过滤（排除 TaskTool 等递归风险工具）
 * - Hook 事件（SubAgentStart/SubAgentEnd）
 */

import type { AgentConfig, ILLMProvider, IToolRegistry, Tool, ToolResult, ToolSchema } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { HookListener } from '@/hooks/EventEmitter';
import type { HookEventContext } from '@/hooks/types';
import { AgentLoop } from './AgentLoop';
import { SubAgentContext } from './SubAgentContext';
import { emitSubAgentToolUse, type SubAgentHookContext } from './SubAgentHooks';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SubAgentLoop' });

/**
 * 子代理执行结果
 */
export interface SubAgentResult {
  /** 子代理最终输出文本 */
  result: string;
  /** 消耗的 token 数 */
  tokensUsed: { input: number; output: number };
  /** 执行耗时（毫秒） */
  duration: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 迭代次数 */
  iterations: number;
}

/**
 * 过滤工具的注册表代理
 *
 * 包装 IToolRegistry，过滤掉受限工具
 */
class FilteredToolRegistry implements IToolRegistry {
  private inner: IToolRegistry;
  private restrictedTools: Set<string>;

  constructor(inner: IToolRegistry, restrictedTools: string[]) {
    this.inner = inner;
    this.restrictedTools = new Set(restrictedTools);
  }

  register(_tool: Tool): void {
    // 子代理不允许修改父注册表的工具列表
    throw new Error('Sub-agent cannot register tools');
  }

  unregister(_name: string): void {
    // 子代理不允许修改父注册表的工具列表
    throw new Error('Sub-agent cannot unregister tools');
  }

  get(name: string): Tool | undefined {
    if (this.restrictedTools.has(name)) return undefined;
    return this.inner.get(name);
  }

  getAll(): Tool[] {
    return this.inner.getAll().filter((t) => !this.restrictedTools.has(t.name));
  }

  getSchemas(): ToolSchema[] {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  has(name: string): boolean {
    if (this.restrictedTools.has(name)) return false;
    return this.inner.has(name);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (this.restrictedTools.has(name)) {
      return {
        content: `Tool "${name}" is not available in sub-agent mode.`,
        isError: true,
      };
    }
    return this.inner.execute(name, input);
  }
}

/**
 * 启动子代理并等待结果
 */
export async function runSubAgent(
  provider: ILLMProvider,
  registry: IToolRegistry,
  parentConfig: AgentConfig,
  context: SubAgentContext,
  hookRegistry?: HookRegistry | null,
  memoryStore?: IMemoryStore | null,
): Promise<SubAgentResult> {
  const subAgentId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  // 1. 检查嵌套深度
  if (context.isDepthExceeded()) {
    return {
      result: `Error: Maximum nesting depth (${context.depth}) exceeded. Cannot create sub-agent.`,
      tokensUsed: { input: 0, output: 0 },
      duration: 0,
      timedOut: false,
      iterations: 0,
    };
  }

  // 2. 构建子代理配置
  const agentConfig = context.buildAgentConfig(parentConfig);

  // 3. 创建过滤后的工具注册表
  const filteredRegistry = new FilteredToolRegistry(registry, context.restrictedTools);

  // 4. 创建子代理 AgentLoop
  const agentLoop = new AgentLoop(
    provider,
    filteredRegistry,
    agentConfig,
    memoryStore ?? undefined,
  );

  // 注入 Hook（子代理模式）
  let postToolUseListener: HookListener | null = null;
  if (hookRegistry) {
    agentLoop.setHookRegistry(hookRegistry);

    // 监听子代理 PostToolUse → 转发为 SubAgentToolUse
    const hookCtx: SubAgentHookContext = {
      hookRegistry,
      subAgentId,
      depth: context.depth,
      task: context.task,
    };
    postToolUseListener = async (ctx: HookEventContext) => {
      emitSubAgentToolUse(hookCtx, {
        toolName: ctx.toolName ?? '',
        toolInput: ctx.toolInput as Record<string, unknown>,
        toolResult: ctx.toolResult as string | undefined,
        toolIsError: ctx.toolIsError as boolean | undefined,
        toolDuration: ctx.toolDuration as number | undefined,
      });
      return { success: true, blocked: false };
    };
    hookRegistry.addListener('PostToolUse', postToolUseListener);
  }

  // 5. 收集输出
  let outputText = '';
  let timedOut = false;

  agentLoop.on({
    onText: (text) => {
      outputText += text;
    },
    onError: (error) => {
      log.warn(`[${subAgentId}] Error:`, error.message);
    },
  });

  // 6. 触发 SubAgentStart Hook
  if (hookRegistry) {
    hookRegistry.emit('SubAgentStart', {
      subAgentId,
      data: { task: context.task, depth: context.depth },
    }).catch(() => {});
  }

  log.info(`[${subAgentId}] Starting sub-agent (depth=${context.depth}, timeout=${context.timeout}ms)`);

  // 7. 带超时执行
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const runPromise = agentLoop.run(context.task);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        agentLoop.stop();
        timedOut = true;
        reject(new Error(`Sub-agent timed out after ${context.timeout}ms`));
      }, context.timeout);
    });

    await Promise.race([runPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      outputText += `\n[Sub-agent timed out after ${context.timeout}ms]`;
    } else {
      const errMsg = error instanceof Error ? error.message : String(error);
      outputText += `\n[Sub-agent error: ${errMsg}]`;
    }
  } finally {
    // 清理 timeout timer，防止 Promise 泄漏和 unhandled rejection
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
    // 清理 PostToolUse listener，防止内存泄漏
    if (hookRegistry && postToolUseListener) {
      hookRegistry.removeListener('PostToolUse', postToolUseListener);
    }
  }

  const duration = Date.now() - startTime;
  const state = agentLoop.getState();

  // 8. 触发 SubAgentEnd Hook
  if (hookRegistry) {
    hookRegistry.emit('SubAgentEnd', {
      subAgentId,
      data: {
        task: context.task,
        depth: context.depth,
        duration,
        timedOut,
        iterations: state.currentIteration,
      },
    }).catch(() => {});
  }

  log.info(
    `[${subAgentId}] Completed in ${duration}ms ` +
    `(${state.currentIteration} iterations, ${timedOut ? 'TIMED OUT' : 'ok'})`,
  );

  return {
    result: outputText || '[Sub-agent produced no output]',
    tokensUsed: {
      input: state.tokenUsage.input,
      output: state.tokenUsage.output,
    },
    duration,
    timedOut,
    iterations: state.currentIteration,
  };
}
