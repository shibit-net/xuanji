// ============================================================
// M6 工具系统 — EnterPlanModeTool
// ============================================================
//
// LLM 可自主调用此工具进入 Plan Mode（只读规划模式）。
// Plan Mode 下所有写操作被 ToolRegistry 拦截。
//

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';

/** Plan Mode 进入回调（由 UI 层注入） */
export type PlanModeEnterHandler = () => Promise<boolean>;

/**
 * EnterPlanModeTool — LLM 自主进入 Plan Mode
 */
export class EnterPlanModeTool extends BaseTool {
  readonly name = 'enter_plan_mode';
  readonly description = [
    'Enter plan mode. In plan mode, all write operations are blocked.',
    'Use this before making complex changes to explore the codebase and design your approach first.',
    'Call exit_plan_mode when done to resume normal execution.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {},
  };

  readonly readonly = true;

  private handler: PlanModeEnterHandler | null = null;

  setHandler(handler: PlanModeEnterHandler): void {
    this.handler = handler;
  }

  async execute(_input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.handler) {
      return this.error('Plan Mode 不可用（非交互模式）');
    }

    try {
      const accepted = await this.handler();
      if (accepted) {
        return this.success('已进入 Plan Mode。所有写操作将被拦截，请先完成规划后使用 exit_plan_mode 退出。');
      }
      return this.success('用户拒绝进入 Plan Mode，继续正常执行。');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`进入 Plan Mode 失败: ${msg}`);
    }
  }
}
