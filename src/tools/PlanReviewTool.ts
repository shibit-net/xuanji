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
import type { ToolResult, JSONSchema } from '@/infrastructure/core-types';
import type { IPermissionController } from '@/permission/types';

export class PlanReviewTool extends BaseTool {
  readonly name = 'plan_review';
  readonly description = 'Submit an execution plan for user review. Use before multi-file changes, high-risk commands, or complex multi-step operations. Users can approve, reject, or supplement the plan.';
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
      return this.success('[Plan Review] 无审批处理器，自动通过。请创建 todo 后使用 agent_team 或 task 执行。');
    }

    const result = await this.permissionController.reviewPlan(plan);

    switch (result.decision) {
      case 'approve':
        return this.success(
          '[Plan Approved] 计划已审批通过。后续步骤：\n' +
          '1. 使用 todo_create 为每个步骤创建待办任务\n' +
          '2. 使用 agent_team（多领域协作）或 task（单领域执行）按计划执行\n' +
          '3. 执行过程中用 todo_update 更新任务状态\n' +
          '4. 全部完成后汇总结果回复用户',
        );

      case 'reject':
        return this.success('[Plan Rejected] 用户已拒绝此执行计划。请询问用户希望如何调整，不要继续执行原计划。');

      case 'supplement':
        return this.success(
          `[Plan Needs Revision] 用户要求按以下补充说明调整计划：\n\n${result.supplementText}\n\n请调整计划后重新提交 plan_review。`,
        );

      default:
        return this.error(`Unknown decision: ${result.decision}`);
    }
  }
}
