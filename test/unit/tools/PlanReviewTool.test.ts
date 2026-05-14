import { describe, it, expect, vi } from 'vitest';
import { PlanReviewTool } from '@/core/tools/PlanReviewTool';
import type { IPermissionController, PlanReviewResult } from '@/permission/types';

function createMockController(reviewResult: PlanReviewResult): IPermissionController {
  return {
    check: vi.fn(),
    setConfirmationHandler: vi.fn(),
    updateConfig: vi.fn(),
    getConfig: vi.fn().mockReturnValue({}),
    setPlanReviewHandler: vi.fn(),
    reviewPlan: vi.fn().mockResolvedValue(reviewResult),
    setIgnoreFilter: vi.fn(),
    setCurrentUserIntent: vi.fn(),
    listDecisions: vi.fn().mockReturnValue([]),
    deleteDecision: vi.fn().mockResolvedValue(undefined),
    clearDecisions: vi.fn().mockResolvedValue(undefined),
    recordDeniedOperation: vi.fn(),
    isDeniedOperation: vi.fn().mockReturnValue(false),
    listDeniedOperations: vi.fn().mockReturnValue([]),
    deleteDeniedOperation: vi.fn().mockResolvedValue(undefined),
    clearDeniedOperations: vi.fn().mockResolvedValue(undefined),
    serialize: vi.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  };
}

describe('PlanReviewTool', () => {
  it('should have correct name and schema', () => {
    const tool = new PlanReviewTool();
    expect(tool.name).toBe('plan_review');
    expect(tool.input_schema.required).toContain('plan');
    expect(tool.readonly).toBe(true);
  });

  it('should return error when plan is missing', async () => {
    const tool = new PlanReviewTool();
    const result = await tool.execute({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Missing required parameter');
  });

  it('should auto-approve when no permission controller is set', async () => {
    const tool = new PlanReviewTool();
    const result = await tool.execute({ plan: '# My Plan\n- Step 1\n- Step 2' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('No review handler');
  });

  it('should return approved message when user approves', async () => {
    const tool = new PlanReviewTool();
    const controller = createMockController({ decision: 'approve' });
    tool.setPermissionController(controller);

    const result = await tool.execute({ plan: '# Deploy Plan\n- Build\n- Deploy' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Plan Approved');
    expect(result.content).toContain('Proceed');
    expect(controller.reviewPlan).toHaveBeenCalledWith('# Deploy Plan\n- Build\n- Deploy');
  });

  it('should return rejected message when user rejects', async () => {
    const tool = new PlanReviewTool();
    const controller = createMockController({ decision: 'reject' });
    tool.setPermissionController(controller);

    const result = await tool.execute({ plan: '# Risky Plan' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Plan Rejected');
    expect(result.content).toContain('Do NOT proceed');
  });

  it('should return supplement message with user text when user supplements', async () => {
    const tool = new PlanReviewTool();
    const controller = createMockController({
      decision: 'supplement',
      supplementText: 'Please also backup the database first',
    });
    tool.setPermissionController(controller);

    const result = await tool.execute({ plan: '# Migration Plan' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Plan Needs Revision');
    expect(result.content).toContain('backup the database first');
  });
});
