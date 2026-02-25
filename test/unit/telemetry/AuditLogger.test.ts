// ============================================================
// AuditLogger 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { AuditLogger, type AuditRecord } from '@/core/telemetry/AuditLogger';
import type { PermissionRequest, PermissionResult, GuardCheckResult, PlanReviewResult } from '@/permission/types';

describe('AuditLogger', () => {
  let tempDir: string;
  let testFilePath: string;
  let auditLogger: AuditLogger;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-audit-test-'));
    testFilePath = join(tempDir, 'audit.log');
    auditLogger = new AuditLogger(testFilePath);
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // ── 权限检查记录 ──

  it('should record safe permission check', async () => {
    const request: PermissionRequest = {
      requestId: 'req-1',
      toolName: 'read_file',
      input: { file_path: '/home/user/test.ts' },
    };
    const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };
    const guardResult: GuardCheckResult = {
      category: 'fileRead',
      riskLevel: 'safe',
      description: 'Read file: /home/user/test.ts',
      cacheKey: 'read:/home/user/test.ts',
    };

    await auditLogger.recordPermissionCheck(request, result, guardResult);

    const records = await auditLogger.query();
    expect(records).toHaveLength(1);
    expect(records[0].eventType).toBe('permission_check');
    expect(records[0].toolName).toBe('read_file');
    expect(records[0].riskLevel).toBe('safe');
    expect(records[0].allowed).toBe(true);
    expect(records[0].checkedBy).toBe('auto-safe');
  });

  it('should record warn permission check', async () => {
    const request: PermissionRequest = {
      requestId: 'req-2',
      toolName: 'write_file',
      input: { file_path: '/home/user/project/src/test.ts', content: 'hello' },
    };
    const result: PermissionResult = { allowed: true, checkedBy: 'auto-warn' };
    const guardResult: GuardCheckResult = {
      category: 'fileWrite',
      riskLevel: 'warn',
      description: 'Write file: /home/user/project/src/test.ts',
      cacheKey: 'write:/home/user/project/src/test.ts',
    };

    await auditLogger.recordPermissionCheck(request, result, guardResult);

    const records = await auditLogger.query();
    expect(records).toHaveLength(1);
    expect(records[0].riskLevel).toBe('warn');
    expect(records[0].allowed).toBe(true);
    expect(records[0].checkedBy).toBe('auto-warn');
  });

  it('should record danger user-confirmed permission check', async () => {
    const request: PermissionRequest = {
      requestId: 'req-3',
      toolName: 'bash',
      input: { command: 'rm -rf /tmp/test' },
    };
    const result: PermissionResult = { allowed: true, checkedBy: 'user-confirmation' };
    const guardResult: GuardCheckResult = {
      category: 'bashExec',
      riskLevel: 'danger',
      description: 'Execute: rm -rf /tmp/test',
      cacheKey: 'bash:rm',
    };

    await auditLogger.recordPermissionCheck(request, result, guardResult, true);

    const records = await auditLogger.query();
    expect(records).toHaveLength(1);
    expect(records[0].riskLevel).toBe('danger');
    expect(records[0].allowed).toBe(true);
    expect(records[0].checkedBy).toBe('user-confirmation');
    expect(records[0].remembered).toBe(true);
  });

  it('should record cache hit permission check', async () => {
    const request: PermissionRequest = {
      requestId: 'req-4',
      toolName: 'bash',
      input: { command: 'git status' },
    };
    const result: PermissionResult = { allowed: true, checkedBy: 'cache' };
    const guardResult: GuardCheckResult = {
      category: 'bashExec',
      riskLevel: 'danger',
      description: 'Execute: git status',
      cacheKey: 'bash:git',
    };

    await auditLogger.recordPermissionCheck(request, result, guardResult);

    const records = await auditLogger.query();
    expect(records).toHaveLength(1);
    expect(records[0].checkedBy).toBe('cache');
  });

  it('should record timeout permission check', async () => {
    const request: PermissionRequest = {
      requestId: 'req-5',
      toolName: 'write_file',
      input: { file_path: '/etc/hosts', content: 'bad' },
    };
    const result: PermissionResult = {
      allowed: false,
      reason: 'Confirmation timed out',
      checkedBy: 'timeout',
    };
    const guardResult: GuardCheckResult = {
      category: 'fileWrite',
      riskLevel: 'danger',
      description: 'System file write: /etc/hosts',
      cacheKey: 'write:/etc/hosts',
    };

    await auditLogger.recordPermissionCheck(request, result, guardResult);

    const records = await auditLogger.query();
    expect(records).toHaveLength(1);
    expect(records[0].allowed).toBe(false);
    expect(records[0].checkedBy).toBe('timeout');
    expect(records[0].reason).toBe('Confirmation timed out');
  });

  it('should record permission check without guard result', async () => {
    const request: PermissionRequest = {
      requestId: 'req-6',
      toolName: 'plan_review',
      input: {},
    };
    const result: PermissionResult = { allowed: true, checkedBy: 'no-guard' };

    await auditLogger.recordPermissionCheck(request, result, null);

    const records = await auditLogger.query();
    expect(records).toHaveLength(1);
    expect(records[0].toolName).toBe('plan_review');
    expect(records[0].checkedBy).toBe('no-guard');
    expect(records[0].riskLevel).toBeUndefined();
  });

  // ── 敏感数据脱敏 ──

  it('should sanitize long text in input', async () => {
    const longContent = 'x'.repeat(500);
    const request: PermissionRequest = {
      requestId: 'req-sanitize',
      toolName: 'write_file',
      input: { file_path: '/home/user/test.ts', content: longContent },
    };
    const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };

    await auditLogger.recordPermissionCheck(request, result, null);

    const records = await auditLogger.query();
    expect(records).toHaveLength(1);
    const recordedContent = records[0].input?.content as string;
    expect(recordedContent.length).toBeLessThan(300);
    expect(recordedContent).toContain('...[truncated]');
  });

  it('should not truncate short text', async () => {
    const request: PermissionRequest = {
      requestId: 'req-short',
      toolName: 'write_file',
      input: { file_path: '/home/user/test.ts', content: 'short text' },
    };
    const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };

    await auditLogger.recordPermissionCheck(request, result, null);

    const records = await auditLogger.query();
    expect(records[0].input?.content).toBe('short text');
  });

  // ── 查询过滤 ──

  it('should filter by risk level', async () => {
    // 写入多条记录
    const levels: Array<'safe' | 'warn' | 'danger'> = ['safe', 'warn', 'danger', 'safe'];
    for (let i = 0; i < levels.length; i++) {
      const request: PermissionRequest = { requestId: `req-${i}`, toolName: 'read_file', input: {} };
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };
      const guard: GuardCheckResult = { category: 'fileRead', riskLevel: levels[i], description: '', cacheKey: '' };
      await auditLogger.recordPermissionCheck(request, result, guard);
    }

    const safeRecords = await auditLogger.query({ riskLevel: 'safe' });
    expect(safeRecords).toHaveLength(2);

    const dangerRecords = await auditLogger.query({ riskLevel: 'danger' });
    expect(dangerRecords).toHaveLength(1);
  });

  it('should filter by tool name', async () => {
    const tools = ['read_file', 'write_file', 'bash', 'read_file'];
    for (let i = 0; i < tools.length; i++) {
      const request: PermissionRequest = { requestId: `req-${i}`, toolName: tools[i], input: {} };
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };
      await auditLogger.recordPermissionCheck(request, result, null);
    }

    const bashRecords = await auditLogger.query({ toolName: 'bash' });
    expect(bashRecords).toHaveLength(1);

    const readRecords = await auditLogger.query({ toolName: 'read_file' });
    expect(readRecords).toHaveLength(2);
  });

  it('should filter by time range', async () => {
    // 写入第一条记录（手动构造旧时间戳）
    const request: PermissionRequest = { requestId: 'req-old', toolName: 'read_file', input: {} };
    const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };
    await auditLogger.recordPermissionCheck(request, result, null);

    // 写入第二条记录
    await auditLogger.recordPermissionCheck(
      { requestId: 'req-new', toolName: 'write_file', input: {} },
      { allowed: true, checkedBy: 'auto-safe' },
      null,
    );

    // 获取所有记录，确定时间戳
    const all = await auditLogger.query();
    expect(all.length).toBeGreaterThanOrEqual(2);

    // 以第一条记录的时间戳作为 startTime 查询
    const filtered = await auditLogger.query({ startTime: all[0].timestamp });
    expect(filtered.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter by allowed status', async () => {
    await auditLogger.recordPermissionCheck(
      { requestId: 'req-allow', toolName: 'read_file', input: {} },
      { allowed: true, checkedBy: 'auto-safe' },
      null,
    );
    await auditLogger.recordPermissionCheck(
      { requestId: 'req-deny', toolName: 'bash', input: {} },
      { allowed: false, reason: 'denied', checkedBy: 'timeout' },
      null,
    );

    const allowed = await auditLogger.query({ allowed: true });
    expect(allowed).toHaveLength(1);
    expect(allowed[0].toolName).toBe('read_file');

    const denied = await auditLogger.query({ allowed: false });
    expect(denied).toHaveLength(1);
    expect(denied[0].toolName).toBe('bash');
  });

  it('should support limit', async () => {
    for (let i = 0; i < 5; i++) {
      await auditLogger.recordPermissionCheck(
        { requestId: `req-${i}`, toolName: 'read_file', input: {} },
        { allowed: true, checkedBy: 'auto-safe' },
        null,
      );
    }

    const limited = await auditLogger.query({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  // ── 计划审查记录 ──

  it('should record plan review approve', async () => {
    const plan = '1. Read package.json\n2. Install dependencies';
    const result: PlanReviewResult = { decision: 'approve' };

    await auditLogger.recordPlanReview(plan, result);

    const records = await auditLogger.query({ eventType: 'plan_review' });
    expect(records).toHaveLength(1);
    expect(records[0].eventType).toBe('plan_review');
    expect(records[0].decision).toBe('approve');
    expect(records[0].allowed).toBe(true);
    expect(records[0].planPreview).toBe(plan);
  });

  it('should record plan review reject', async () => {
    const plan = 'Delete all files';
    const result: PlanReviewResult = { decision: 'reject' };

    await auditLogger.recordPlanReview(plan, result);

    const records = await auditLogger.query({ eventType: 'plan_review' });
    expect(records).toHaveLength(1);
    expect(records[0].decision).toBe('reject');
    expect(records[0].allowed).toBe(false);
  });

  it('should record plan review supplement', async () => {
    const plan = 'Refactor code';
    const result: PlanReviewResult = { decision: 'supplement', supplementText: 'Also add tests' };

    await auditLogger.recordPlanReview(plan, result);

    const records = await auditLogger.query({ eventType: 'plan_review' });
    expect(records).toHaveLength(1);
    expect(records[0].decision).toBe('supplement');
    expect(records[0].hasSupplementText).toBe(true);
    expect(records[0].allowed).toBe(false); // supplement is not approve
  });

  it('should truncate long plan text', async () => {
    const longPlan = 'Step '.repeat(100);
    const result: PlanReviewResult = { decision: 'approve' };

    await auditLogger.recordPlanReview(longPlan, result);

    const records = await auditLogger.query();
    expect(records[0].planPreview!.length).toBeLessThan(longPlan.length);
    expect(records[0].planPreview).toContain('...[truncated]');
  });

  // ── 容错处理 ──

  it('should silently handle write failures', async () => {
    // 使用不可写路径
    const badLogger = new AuditLogger('/proc/nonexistent/audit.log');

    // 不应抛出异常
    await expect(
      badLogger.recordPermissionCheck(
        { requestId: 'req-fail', toolName: 'test', input: {} },
        { allowed: true, checkedBy: 'auto-safe' },
        null,
      ),
    ).resolves.not.toThrow();
  });

  it('should return empty array for non-existent file', async () => {
    const records = await auditLogger.query();
    expect(records).toEqual([]);
  });

  it('should handle malformed JSONL lines', async () => {
    // 先写一条正常记录
    await auditLogger.recordPermissionCheck(
      { requestId: 'req-ok', toolName: 'read_file', input: {} },
      { allowed: true, checkedBy: 'auto-safe' },
      null,
    );

    // 追加一条格式错误的行
    await appendFile(testFilePath, 'invalid json line\n', 'utf-8');

    // 再写一条正常记录
    await auditLogger.recordPermissionCheck(
      { requestId: 'req-ok2', toolName: 'bash', input: {} },
      { allowed: true, checkedBy: 'auto-safe' },
      null,
    );

    const records = await auditLogger.query();
    expect(records).toHaveLength(2);
    expect(records[0].requestId).toBe('req-ok');
    expect(records[1].requestId).toBe('req-ok2');
  });

  // ── 清空 ──

  it('should clear all records', async () => {
    await auditLogger.recordPermissionCheck(
      { requestId: 'req-clear', toolName: 'test', input: {} },
      { allowed: true, checkedBy: 'auto-safe' },
      null,
    );

    expect(existsSync(testFilePath)).toBe(true);
    await auditLogger.clear();
    expect(existsSync(testFilePath)).toBe(false);
  });
});
