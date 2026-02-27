// ============================================================
// ReminderSetTool + ReminderCheckTool 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { ReminderSetTool } from '@/core/tools/ReminderSetTool';
import { ReminderCheckTool } from '@/core/tools/ReminderCheckTool';
import { ReminderEngine } from '@/reminder/ReminderEngine';
import { StorageBackend } from '@/memory/StorageBackend';

describe('ReminderSetTool', () => {
  let tool: ReminderSetTool;
  let engine: ReminderEngine;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-remset-'));
    storage = new StorageBackend();
    engine = new ReminderEngine({}, storage);
    (engine as any).filePath = join(tempDir, 'reminders.jsonl');
    await engine.init();

    tool = new ReminderSetTool();
    tool.setReminderEngine(engine);
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should set a one-time reminder', async () => {
    const result = await tool.execute({
      content: 'Submit weekly report',
      triggerDate: '2026-03-01',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Reminder set');
    expect(result.content).toContain('2026-03-01');
    expect(result.metadata?.recurring).toBe('once');
  });

  it('should set a yearly recurring reminder', async () => {
    const result = await tool.execute({
      content: "Alice's birthday",
      triggerDate: '2026-03-08',
      recurring: 'yearly',
      source: 'auto_extracted',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('yearly');
    expect(result.metadata?.recurring).toBe('yearly');
    expect(result.metadata?.source).toBe('auto_extracted');
  });

  it('should reject empty content', async () => {
    const result = await tool.execute({
      content: '',
      triggerDate: '2026-03-01',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('content');
  });

  it('should reject invalid date format', async () => {
    const result = await tool.execute({
      content: 'Test reminder',
      triggerDate: 'March 1, 2026',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('YYYY-MM-DD');
  });

  it('should reject missing triggerDate', async () => {
    const result = await tool.execute({
      content: 'Test reminder',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('triggerDate');
  });

  it('should error when engine is not set', async () => {
    const toolWithoutEngine = new ReminderSetTool();
    const result = await toolWithoutEngine.execute({
      content: 'Test',
      triggerDate: '2026-03-01',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not available');
  });

  it('should have correct tool metadata', () => {
    expect(tool.name).toBe('reminder_set');
    expect(tool.readonly).toBe(false);
    expect(tool.input_schema.required).toContain('content');
    expect(tool.input_schema.required).toContain('triggerDate');
  });
});

describe('ReminderCheckTool', () => {
  let tool: ReminderCheckTool;
  let engine: ReminderEngine;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-remchk-'));
    storage = new StorageBackend();
    engine = new ReminderEngine({ upcomingDays: 3 }, storage);
    (engine as any).filePath = join(tempDir, 'reminders.jsonl');
    await engine.init();

    tool = new ReminderCheckTool();
    tool.setReminderEngine(engine);
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should return no reminders when empty', async () => {
    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    expect(result.content).toContain('No active reminders');
    expect(result.metadata?.count).toBe(0);
  });

  it('should return due reminders', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    await engine.setReminder({
      content: 'Submit report',
      triggerDate: today,
      recurring: 'once',
      source: 'user_explicit',
    });

    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Submit report');
    expect(result.metadata?.dueCount).toBeGreaterThan(0);
  });

  it('should mark a reminder as done', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    const reminder = await engine.setReminder({
      content: 'Submit report',
      triggerDate: today,
      recurring: 'once',
      source: 'user_explicit',
    });

    const result = await tool.execute({ markDoneId: reminder.id });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('marked as done');
  });

  it('should dismiss a reminder', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    const reminder = await engine.setReminder({
      content: 'Annoying reminder',
      triggerDate: today,
      recurring: 'once',
      source: 'auto_extracted',
    });

    const result = await tool.execute({ dismissId: reminder.id });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('dismissed');
  });

  it('should error when engine is not set', async () => {
    const toolWithoutEngine = new ReminderCheckTool();
    const result = await toolWithoutEngine.execute({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not available');
  });

  it('should have correct tool metadata', () => {
    expect(tool.name).toBe('reminder_check');
    expect(tool.readonly).toBe(true);
  });
});
