// ============================================================
// M6 工具系统 — ExitPlanModeTool
// ============================================================
//
// LLM 调用此工具退出 Plan Mode，恢复写操作能力。
//

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';

/** Plan Mode 退出回调（由 UI 层注入） */
export type PlanModeExitHandler = () => Promise<boolean>;

/**
 * ExitPlanModeTool — LLM 退出 Plan Mode
 */
export class ExitPlanModeTool extends BaseTool {
  readonly name = 'exit_plan_mode';
  readonly description = [
    '退出 Plan Mode，恢复正常执行模式。',
    '规划完成后使用此工具，之后可以执行写操作。',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {},
  };

  readonly readonly = true;

  private handler: PlanModeExitHandler | null = null;

  setHandler(handler: PlanModeExitHandler): void {
    this.handler = handler;
  }

  async execute(_input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.handler) {
      return this.error('Plan Mode 不可用（非交互模式）');
    }

    try {
      const accepted = await this.handler();
      if (accepted) {
        return this.success('已退出 Plan Mode，恢复正常执行模式。');
      }
      return this.success('用户拒绝退出 Plan Mode，继续规划。');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`退出 Plan Mode 失败: ${msg}`);
    }
  }
}
