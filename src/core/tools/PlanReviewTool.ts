// ============================================================
// M6 工具系统 — 计划审查工具
// ============================================================
//
// LLM 在执行复杂操作前，可调用此工具提交执行计划，
// 由用户审查后决定: 确认执行 / 拒绝执行 / 补充说明。
//
// 此工具由 LLM 自主判断何时调用，不受硬编码规则控制。
// 硬编码的 FileGuard/CommandGuard 仅作为安全兜底。
//

import { BaseTool } from './BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import type { IPermissionController } from '@/permission/types';

export class PlanReviewTool extends BaseTool {
  readonly name = 'plan_review';
  readonly description = [
    'Submit an execution plan for user review before performing complex operations.',
    'Use this tool when you are about to perform multiple file modifications, execute potentially impactful commands,',
    'or carry out any complex multi-step task. The user can approve, reject, or provide additional instructions.',
    'The plan should be a clear markdown document describing what you intend to do and why.',
  ].join(' ');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description: 'The execution plan in markdown format. Include: what will be done, which files will be modified, and any potential risks.',
      },
    },
    required: ['plan'],
  };

  /** 只读工具（不修改文件系统，可并行） */
  readonly readonly = true;

  /** 权限控制器引用（由 ToolRegistry 注入） */
  private permissionController: IPermissionController | null = null;

  /**
   * 设置权限控制器引用
   */
  setPermissionController(controller: IPermissionController): void {
    this.permissionController = controller;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const plan = input.plan as string;
    if (!plan || typeof plan !== 'string') {
      return this.error('Missing required parameter: plan');
    }

    if (!this.permissionController) {
      // 无权限控制器时直接通过
      return this.success('[Plan Review] No review handler configured. Proceeding with execution.');
    }

    const result = await this.permissionController.reviewPlan(plan);

    switch (result.decision) {
      case 'approve':
        return this.success('[Plan Approved] The user has approved your execution plan. Proceed with the planned operations.');

      case 'reject':
        return this.success('[Plan Rejected] The user has rejected your execution plan. Do NOT proceed with the planned operations. Ask the user what they would like to do instead.');

      case 'supplement':
        return this.success(
          `[Plan Needs Revision] The user wants you to revise the plan with the following additional instructions:\n\n${result.supplementText}\n\nPlease revise your plan accordingly and submit a new plan_review, or proceed with the adjusted approach.`,
        );

      default:
        return this.error(`Unknown decision: ${result.decision}`);
    }
  }
}
