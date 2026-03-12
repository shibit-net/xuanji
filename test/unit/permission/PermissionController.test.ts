import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionController } from '@/permission/PermissionController';
import type { PermissionRequest, ConfirmationHandler, GuardCheckResult, PlanReviewHandler, PlanReviewResult } from '@/permission/types';
import type { PermissionConfig } from '@/core/types';

function createConfig(overrides?: Partial<PermissionConfig>): PermissionConfig {
  return {
    fileWrite: 'ask',
    fileRead: 'always',
    bashExec: 'ask',
    allowedCommands: [],
    deniedCommands: [],
    allowedPaths: [],
    deniedPaths: [],
    ...overrides,
  };
}

function createRequest(toolName: string, input: Record<string, unknown> = {}): PermissionRequest {
  return {
    requestId: `${toolName}-test`,
    toolName,
    input,
  };
}

describe('PermissionController', () => {
  let controller: PermissionController;
  let mockHandler: ConfirmationHandler;

  beforeEach(() => {
    controller = new PermissionController(createConfig());
    mockHandler = vi.fn(async (_req: PermissionRequest, _guard: GuardCheckResult) => ({
      allowed: true,
      remember: false,
    }));
    controller.setConfirmationHandler(mockHandler);
  });

  describe('safe 级别 — 自动放行', () => {
    it('读取普通文件应自动放行 (auto-safe-read)', async () => {
      const result = await controller.check(
        createRequest('read_file', { file_path: process.cwd() + '/src/index.ts' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-safe-read');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('写入普通项目文件应委托给 plan_review (plan-delegated)', async () => {
      const result = await controller.check(
        createRequest('write_file', { file_path: process.cwd() + '/test.txt' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('plan-delegated');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('执行普通命令应自动放行 (auto-safe)', async () => {
      const result = await controller.check(
        createRequest('bash', { command: 'git status' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-safe');
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('warn 级别 — 默认需要确认 (warnLevel: ask)', () => {
    it('sudo 命令应触发确认 (user-confirmation)', async () => {
      const result = await controller.check(
        createRequest('bash', { command: 'sudo apt install vim' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('user-confirmation');
      expect(mockHandler).toHaveBeenCalled();
    });

    it('git push --force 应触发确认 (user-confirmation)', async () => {
      const result = await controller.check(
        createRequest('bash', { command: 'git push --force origin main' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('user-confirmation');
      expect(mockHandler).toHaveBeenCalled();
    });

    it('项目外写入应触发确认 (user-confirmation)', async () => {
      const result = await controller.check(
        createRequest('write_file', { file_path: '/tmp/test.txt' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('user-confirmation');
      expect(mockHandler).toHaveBeenCalled();
    });

    it('读取 .env 文件应触发确认 (user-confirmation)', async () => {
      const result = await controller.check(
        createRequest('read_file', { file_path: '/project/.env' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('user-confirmation');
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('warn 级别 — warnLevel: auto-allow (自动放行)', () => {
    let autoAllowController: PermissionController;

    beforeEach(() => {
      autoAllowController = new PermissionController(createConfig({ warnLevel: 'auto-allow' }));
    });

    it('sudo 命令应自动放行 (auto-warn)', async () => {
      const result = await autoAllowController.check(
        createRequest('bash', { command: 'sudo apt install vim' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-warn');
    });

    it('git push --force 应自动放行 (auto-warn)', async () => {
      const result = await autoAllowController.check(
        createRequest('bash', { command: 'git push --force origin main' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-warn');
    });

    it('项目外写入应自动放行 (auto-warn)', async () => {
      const result = await autoAllowController.check(
        createRequest('write_file', { file_path: '/tmp/test.txt' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-warn');
    });

    it('读取 .env 文件应自动放行 (auto-warn)', async () => {
      const result = await autoAllowController.check(
        createRequest('read_file', { file_path: '/project/.env' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-warn');
    });
  });

  describe('warn 级别 — warnLevel: ask (需要确认)', () => {
    let askController: PermissionController;
    let askMockHandler: ConfirmationHandler;

    beforeEach(() => {
      askController = new PermissionController(createConfig({ warnLevel: 'ask' }));
      askMockHandler = vi.fn(async (_req: PermissionRequest, _guard: GuardCheckResult) => ({
        allowed: true,
        remember: false,
      }));
      askController.setConfirmationHandler(askMockHandler);
    });

    it('sudo 命令应触发确认', async () => {
      const result = await askController.check(
        createRequest('bash', { command: 'sudo apt install vim' }),
      );
      expect(askMockHandler).toHaveBeenCalled();
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('user-confirmation');
    });

    it('git push --force 应触发确认', async () => {
      const result = await askController.check(
        createRequest('bash', { command: 'git push --force origin main' }),
      );
      expect(askMockHandler).toHaveBeenCalled();
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('user-confirmation');
    });

    it('项目外写入应触发确认', async () => {
      const result = await askController.check(
        createRequest('write_file', { file_path: '/tmp/test.txt' }),
      );
      expect(askMockHandler).toHaveBeenCalled();
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('user-confirmation');
    });

    it('用户拒绝 warn 操作应被拒绝', async () => {
      askMockHandler = vi.fn(async () => ({ allowed: false, remember: false }));
      askController.setConfirmationHandler(askMockHandler);

      const result = await askController.check(
        createRequest('bash', { command: 'sudo rm -rf /var/log' }),
      );
      expect(result.allowed).toBe(false);
      expect(result.checkedBy).toBe('user-confirmation');
    });

    it('warn 级别选择 Always 后应命中缓存', async () => {
      askMockHandler = vi.fn(async () => ({ allowed: true, remember: true }));
      askController.setConfirmationHandler(askMockHandler);

      // 第一次: 触发确认
      await askController.check(createRequest('bash', { command: 'sudo ls' }));
      expect(askMockHandler).toHaveBeenCalledTimes(1);

      // 第二次: 命中缓存
      const result = await askController.check(createRequest('bash', { command: 'sudo ls /tmp' }));
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('session-cache');
      expect(askMockHandler).toHaveBeenCalledTimes(1);
    });

    it('safe 操作不受 warnLevel: ask 影响', async () => {
      const result = await askController.check(
        createRequest('bash', { command: 'git status' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-safe');
      expect(askMockHandler).not.toHaveBeenCalled();
    });

    it('无确认处理器时 warn 操作应被拒绝', async () => {
      const ctrl = new PermissionController(createConfig({ warnLevel: 'ask' }));
      // 不设置 confirmationHandler
      const result = await ctrl.check(
        createRequest('bash', { command: 'sudo apt update' }),
      );
      expect(result.allowed).toBe(false);
      expect(result.checkedBy).toBe('no-handler');
    });

    it('updateConfig 切换 warnLevel 应生效', async () => {
      // 先验证 ask 模式
      await askController.check(createRequest('bash', { command: 'sudo ls' }));
      expect(askMockHandler).toHaveBeenCalledTimes(1);

      // 切换为 auto-allow
      askController.updateConfig(createConfig({ warnLevel: 'auto-allow' }));
      const result = await askController.check(
        createRequest('bash', { command: 'sudo ls' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-warn');
      expect(askMockHandler).toHaveBeenCalledTimes(1); // 不再触发确认
    });
  });

  describe('danger 级别 — 强制确认 (安全兜底)', () => {
    it('写入 /etc/passwd 应触发强制确认', async () => {
      const result = await controller.check(
        createRequest('write_file', { file_path: '/etc/passwd' }),
      );
      expect(mockHandler).toHaveBeenCalled();
    });

    it('执行 rm -rf / 应触发强制确认', async () => {
      const result = await controller.check(
        createRequest('bash', { command: 'rm -rf /' }),
      );
      expect(mockHandler).toHaveBeenCalled();
    });

    it('写入 .env 文件应触发强制确认', async () => {
      const result = await controller.check(
        createRequest('write_file', { file_path: '/project/.env' }),
      );
      expect(mockHandler).toHaveBeenCalled();
    });

    it('黑名单命令应触发强制确认', async () => {
      controller.updateConfig(createConfig({ deniedCommands: ['docker rm'] }));
      const result = await controller.check(
        createRequest('bash', { command: 'docker rm container' }),
      );
      expect(mockHandler).toHaveBeenCalled();
    });

    it('黑名单路径应触发强制确认', async () => {
      controller.updateConfig(createConfig({ deniedPaths: ['**/node_modules/**'] }));
      const result = await controller.check(
        createRequest('write_file', { file_path: '/project/node_modules/pkg/index.js' }),
      );
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('danger 确认后的缓存', () => {
    it('用户选择 Always 后同类 danger 操作应命中缓存', async () => {
      mockHandler = vi.fn(async () => ({ allowed: true, remember: true }));
      controller.setConfirmationHandler(mockHandler);

      // 第一次: 触发确认
      await controller.check(createRequest('write_file', { file_path: '/etc/hosts' }));
      expect(mockHandler).toHaveBeenCalledTimes(1);

      // 第二次: 命中缓存 (同一系统路径前缀)
      const result = await controller.check(createRequest('write_file', { file_path: '/etc/hostname' }));
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('session-cache');
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('用户选择 Never 后同类 danger 操作应被缓存拒绝', async () => {
      mockHandler = vi.fn(async () => ({ allowed: false, remember: true }));
      controller.setConfirmationHandler(mockHandler);

      await controller.check(createRequest('write_file', { file_path: '/etc/hosts' }));
      const result = await controller.check(createRequest('write_file', { file_path: '/etc/hostname' }));
      expect(result.allowed).toBe(false);
      expect(result.checkedBy).toBe('session-cache');
    });

    it('updateConfig 应清空缓存', async () => {
      mockHandler = vi.fn(async () => ({ allowed: true, remember: true }));
      controller.setConfirmationHandler(mockHandler);

      await controller.check(createRequest('write_file', { file_path: '/etc/hosts' }));
      controller.updateConfig(createConfig());

      await controller.check(createRequest('write_file', { file_path: '/etc/hosts' }));
      expect(mockHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('无确认处理器', () => {
    it('无处理器时 danger 操作应被拒绝', async () => {
      const ctrl = new PermissionController(createConfig());
      // 不设置 confirmationHandler
      const result = await ctrl.check(
        createRequest('write_file', { file_path: '/etc/passwd' }),
      );
      expect(result.allowed).toBe(false);
      expect(result.checkedBy).toBe('no-handler');
    });

    it('无处理器时 safe 操作仍应自动放行', async () => {
      const ctrl = new PermissionController(createConfig());
      const result = await ctrl.check(
        createRequest('bash', { command: 'ls -la' }),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('auto-safe');
    });
  });

  describe('未识别的工具', () => {
    it('未识别的工具应直接放行', async () => {
      const result = await controller.check(
        createRequest('unknown_tool', {}),
      );
      expect(result.allowed).toBe(true);
      expect(result.checkedBy).toBe('no-guard');
    });
  });

  describe('并发确认队列', () => {
    it('多个并发 danger 确认应串行化处理', async () => {
      const resolvers: Array<(v: { allowed: boolean; remember: boolean }) => void> = [];

      mockHandler = vi.fn(async () => {
        return new Promise<{ allowed: boolean; remember: boolean }>((resolve) => {
          resolvers.push(resolve);
        });
      });
      controller.setConfirmationHandler(mockHandler);

      // 发起两个并发 danger 请求
      const p1 = controller.check(createRequest('bash', { command: 'rm -rf /' }));
      const p2 = controller.check(createRequest('bash', { command: 'mkfs.ext4 /dev/sda1' }));

      await new Promise((r) => setTimeout(r, 10));

      // 第一个 handler 应已被调用
      expect(mockHandler).toHaveBeenCalledTimes(1);

      // resolve 第一个
      resolvers[0]({ allowed: true, remember: false });
      await new Promise((r) => setTimeout(r, 10));

      // 第二个 handler 现在应该被调用
      expect(mockHandler).toHaveBeenCalledTimes(2);

      // resolve 第二个
      resolvers[1]({ allowed: true, remember: false });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
    });
  });

  describe('计划审查 (Plan Review)', () => {
    it('无处理器时应自动通过', async () => {
      const ctrl = new PermissionController(createConfig());
      const result = await ctrl.reviewPlan('# My Plan');
      expect(result.decision).toBe('approve');
    });

    it('用户确认应返回 approve', async () => {
      const handler: PlanReviewHandler = vi.fn(async () => ({ decision: 'approve' as const }));
      controller.setPlanReviewHandler(handler);

      const result = await controller.reviewPlan('# Deploy Plan\n- Step 1\n- Step 2');
      expect(result.decision).toBe('approve');
      expect(handler).toHaveBeenCalledWith('# Deploy Plan\n- Step 1\n- Step 2');
    });

    it('用户拒绝应返回 reject', async () => {
      const handler: PlanReviewHandler = vi.fn(async () => ({ decision: 'reject' as const }));
      controller.setPlanReviewHandler(handler);

      const result = await controller.reviewPlan('# Risky Plan');
      expect(result.decision).toBe('reject');
    });

    it('用户补充应返回 supplement 和文本', async () => {
      const handler: PlanReviewHandler = vi.fn(async () => ({
        decision: 'supplement' as const,
        supplementText: 'Also update tests',
      }));
      controller.setPlanReviewHandler(handler);

      const result = await controller.reviewPlan('# Refactor Plan');
      expect(result.decision).toBe('supplement');
      expect(result.supplementText).toBe('Also update tests');
    });

    it('处理器异常时应返回 reject', async () => {
      const handler: PlanReviewHandler = vi.fn(async () => {
        throw new Error('UI crashed');
      });
      controller.setPlanReviewHandler(handler);

      const result = await controller.reviewPlan('# Plan');
      expect(result.decision).toBe('reject');
    });
  });
});
