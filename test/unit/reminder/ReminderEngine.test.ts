// ============================================================
// ReminderEngine 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { ReminderEngine } from '@/reminder/ReminderEngine';
import { StorageBackend } from '@/memory/StorageBackend';
import type { Reminder, ReminderInput } from '@/reminder/types';
import type { MemoryEntry } from '@/memory/types';

/** 获取本地日期字符串 YYYY-MM-DD（与 ReminderEngine.getToday() 保持一致） */
function getLocalToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function createReminderInput(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    content: 'Submit weekly report',
    triggerDate: getLocalToday(), // 今天（本地时间）
    recurring: 'once',
    source: 'user_explicit',
    ...overrides,
  };
}

function createMemoryEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: 'relationship',
    content: 'Bob is a college friend',
    keywords: ['Bob', 'friend', 'college'],
    source: 'llm-explicit',
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
    ...overrides,
  };
}

describe('ReminderEngine', () => {
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-reminder-'));
    storage = new StorageBackend();
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function createEngine(configOverrides = {}): ReminderEngine {
    const engine = new ReminderEngine(
      { storageFile: 'reminders.jsonl', ...configOverrides },
      storage,
    );
    // 覆盖文件路径到临时目录
    (engine as any).filePath = join(tempDir, 'reminders.jsonl');
    return engine;
  }

  describe('init', () => {
    it('should initialize successfully with empty file', async () => {
      const engine = createEngine();
      await engine.init();
      expect(engine.getActiveReminders()).toHaveLength(0);
    });

    it('should load existing reminders', async () => {
      // 预先写入一条提醒
      const filePath = join(tempDir, 'reminders.jsonl');
      const reminder: Reminder = {
        id: 'rem_test_1',
        content: 'Test reminder',
        triggerDate: '2026-03-01',
        recurring: 'once',
        status: 'active',
        source: 'user_explicit',
        createdAt: new Date().toISOString(),
      };
      await storage.append(filePath, reminder);

      const engine = createEngine();
      await engine.init();
      expect(engine.getActiveReminders()).toHaveLength(1);
    });
  });

  describe('setReminder', () => {
    it('should create a new reminder', async () => {
      const engine = createEngine();
      await engine.init();

      const result = await engine.setReminder(createReminderInput());

      expect(result.id).toMatch(/^rem_/);
      expect(result.content).toBe('Submit weekly report');
      expect(result.status).toBe('active');
      expect(result.recurring).toBe('once');
      expect(engine.getActiveReminders()).toHaveLength(1);
    });

    it('should persist to file', async () => {
      const engine = createEngine();
      await engine.init();

      await engine.setReminder(createReminderInput());

      const filePath = join(tempDir, 'reminders.jsonl');
      expect(existsSync(filePath)).toBe(true);

      const records = await storage.readAll<Reminder>(filePath);
      expect(records).toHaveLength(1);
      expect(records[0].content).toBe('Submit weekly report');
    });

    it('should support yearly recurring', async () => {
      const engine = createEngine();
      await engine.init();

      const result = await engine.setReminder(
        createReminderInput({
          content: "Alice's birthday",
          triggerDate: '2026-03-08',
          recurring: 'yearly',
          source: 'auto_extracted',
        }),
      );

      expect(result.recurring).toBe('yearly');
      expect(result.source).toBe('auto_extracted');
    });
  });

  describe('checkOnStartup', () => {
    it('should find due reminders', async () => {
      const engine = createEngine();
      await engine.init();

      // 设置一个今天到期的提醒
      const today = getLocalToday();
      await engine.setReminder(createReminderInput({ triggerDate: today }));

      const context = await engine.checkOnStartup();
      expect(context.dueReminders).toHaveLength(1);
      expect(context.upcomingReminders).toHaveLength(0);
    });

    it('should find overdue reminders', async () => {
      const engine = createEngine();
      await engine.init();

      // 设置一个昨天到期的提醒
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0]!;

      await engine.setReminder(createReminderInput({ triggerDate: yesterdayStr }));

      const context = await engine.checkOnStartup();
      expect(context.dueReminders).toHaveLength(1);
    });

    it('should find upcoming reminders', async () => {
      const engine = createEngine({ upcomingDays: 3 });
      await engine.init();

      // 设置一个后天的提醒
      const dayAfterTomorrow = new Date();
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      const dateStr = dayAfterTomorrow.toISOString().split('T')[0]!;

      await engine.setReminder(createReminderInput({ triggerDate: dateStr }));

      const context = await engine.checkOnStartup();
      expect(context.dueReminders).toHaveLength(0);
      expect(context.upcomingReminders).toHaveLength(1);
    });

    it('should exclude done/dismissed reminders', async () => {
      const engine = createEngine();
      await engine.init();

      const today = getLocalToday();
      const reminder = await engine.setReminder(createReminderInput({ triggerDate: today }));

      await engine.markDone(reminder.id);

      const context = await engine.checkOnStartup();
      expect(context.dueReminders).toHaveLength(0);
    });
  });

  describe('markDone', () => {
    it('should mark reminder as done', async () => {
      const engine = createEngine();
      await engine.init();

      const reminder = await engine.setReminder(createReminderInput());
      await engine.markDone(reminder.id);

      expect(engine.getActiveReminders()).toHaveLength(0);
    });

    it('should create next occurrence for recurring reminders', async () => {
      const engine = createEngine();
      await engine.init();

      const reminder = await engine.setReminder(
        createReminderInput({
          triggerDate: '2026-03-08',
          recurring: 'yearly',
        }),
      );

      await engine.markDone(reminder.id);

      // 原提醒变为 done，新提醒应该是 2027-03-08
      const active = engine.getActiveReminders();
      expect(active).toHaveLength(1);
      expect(active[0].triggerDate).toBe('2027-03-08');
    });
  });

  describe('dismiss', () => {
    it('should dismiss a reminder', async () => {
      const engine = createEngine();
      await engine.init();

      const reminder = await engine.setReminder(createReminderInput());
      await engine.dismiss(reminder.id);

      expect(engine.getActiveReminders()).toHaveLength(0);
    });
  });

  describe('checkNeglectedRelationships', () => {
    it('should find neglected relationships', async () => {
      const engine = createEngine({ neglectThresholdDays: 60 });
      await engine.init();

      // 创建一个 90 天前的 relationship 记忆
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 90);

      const memories: MemoryEntry[] = [
        createMemoryEntry({
          content: 'Bob is a college friend',
          keywords: ['Bob', 'friend', 'college'],
          lastAccessedAt: oldDate.toISOString(),
          createdAt: oldDate.toISOString(),
        }),
      ];

      const result = await engine.checkNeglectedRelationships(60, memories);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');
      expect(result[0].daysSinceLastContact).toBeGreaterThanOrEqual(90);
    });

    it('should not flag recent contacts', async () => {
      const engine = createEngine({ neglectThresholdDays: 60 });
      await engine.init();

      // 创建一个昨天访问的记忆
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const memories: MemoryEntry[] = [
        createMemoryEntry({
          content: 'Alice likes Japanese food',
          keywords: ['Alice', 'japanese', 'food'],
          lastAccessedAt: yesterday.toISOString(),
        }),
      ];

      const result = await engine.checkNeglectedRelationships(60, memories);
      expect(result).toHaveLength(0);
    });

    it('should return empty for no memories', async () => {
      const engine = createEngine();
      await engine.init();

      const result = await engine.checkNeglectedRelationships(60, []);
      expect(result).toHaveLength(0);
    });
  });

  describe('formatForPrompt', () => {
    it('should format due reminders', () => {
      const engine = createEngine();

      const context = {
        dueReminders: [
          {
            id: 'rem_1',
            content: 'Submit report',
            triggerDate: getLocalToday(),
            recurring: 'once' as const,
            status: 'active' as const,
            source: 'user_explicit' as const,
            createdAt: new Date().toISOString(),
          },
        ],
        upcomingReminders: [],
        neglectedRelationships: [],
      };

      const result = engine.formatForPrompt(context);
      expect(result).toContain('Reminder Context');
      expect(result).toContain('Submit report');
      expect(result).toContain('TODAY');
    });

    it('should format neglected relationships', () => {
      const engine = createEngine();

      const context = {
        dueReminders: [],
        upcomingReminders: [],
        neglectedRelationships: [
          {
            name: 'Bob',
            daysSinceLastContact: 65,
            memoryContent: 'Bob is a college friend',
            memoryId: 'mem_123',
          },
        ],
      };

      const result = engine.formatForPrompt(context);
      expect(result).toContain('Bob');
      expect(result).toContain('65 days');
    });

    it('should return empty for no reminders', () => {
      const engine = createEngine();

      const result = engine.formatForPrompt({
        dueReminders: [],
        upcomingReminders: [],
        neglectedRelationships: [],
      });

      expect(result).toBe('');
    });
  });
});
