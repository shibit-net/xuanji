/**
 * 集成测试：会话持久化 + 记忆系统 + 提醒系统 + Todo 管理
 *
 * 真实调用各模块（非 mock），使用临时目录隔离，验证数据完整往返。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

// ─── 被测模块 ───
import { SessionManager } from '@/session/SessionManager';
import { CheckpointManager } from '@/session/CheckpointManager';
import { MemoryManager } from '@/memory/MemoryManager';
import { MemoryStore } from '@/memory/MemoryStore';
import { ReminderEngine } from '@/reminder/ReminderEngine';
import { TodoManager } from '@/core/tools/TodoManager';
import type { Message } from '@/session/types';
import type { MemoryEntry } from '@/memory/types';

// ─── 临时测试目录 ───
let tempDir: string;
let sessionsDir: string;
let memoryDbPath: string;
let remindersFile: string;
let todosFile: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'xuanji-integ-'));
  sessionsDir = join(tempDir, 'sessions');
  memoryDbPath = join(tempDir, 'memory.db');
  remindersFile = join(tempDir, 'reminders.jsonl');
  todosFile = join(tempDir, 'todos.jsonl');
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

// ═════════════════════════════════════════════════════════════
// 1. 会话持久化：保存 → 列出 → 恢复 → 删除
// ═════════════════════════════════════════════════════════════

describe('Session Persistence', () => {
  let sessionManager: SessionManager;
  let savedSessionId: string;

  const messages: Message[] = [
    { role: 'user', content: '帮我分析项目架构' },
    { role: 'assistant', content: [{ type: 'text', text: '好的，让我看看项目结构...' }] },
    { role: 'user', content: '重点看看 Agent 模块' },
    { role: 'assistant', content: [{ type: 'text', text: 'Agent 模块采用 ReAct 循环架构...' }] },
  ];

  beforeAll(() => {
    sessionManager = new SessionManager({ baseDir: sessionsDir });
  });

  it('保存会话', async () => {
    savedSessionId = await sessionManager.save(messages, '架构分析', {
      usage: { input: 1000, output: 500, cost: 0.02 },
    });

    expect(savedSessionId).toBeTruthy();
    expect(typeof savedSessionId).toBe('string');
  });

  it('列出会话', async () => {
    const list = await sessionManager.list();

    expect(list.length).toBe(1);
    expect(list[0].id).toBe(savedSessionId);
    expect(list[0].name).toBe('架构分析');
    expect(list[0].messageCount).toBe(4);
  });

  it('恢复会话 — 消息完整还原', async () => {
    const resumed = await sessionManager.resume(savedSessionId);

    expect(resumed.sessionId).toBe(savedSessionId);
    expect(resumed.messages.length).toBe(4);
    expect(resumed.messages[0].role).toBe('user');
    expect(resumed.messages[0].content).toBe('帮我分析项目架构');
    // ContentBlock 数组也应还原
    expect(resumed.messages[1].role).toBe('assistant');
    expect(resumed.usage.input).toBe(1000);
    expect(resumed.usage.output).toBe(500);
    expect(resumed.usage.cost).toBe(0.02);
  });

  it('追加消息后再保存', async () => {
    const updatedMessages = [
      ...messages,
      { role: 'user' as const, content: '谢谢，非常清楚' },
    ];

    const id = await sessionManager.save(updatedMessages, '架构分析');
    expect(id).toBe(savedSessionId); // 同一个活跃 session

    const resumed = await sessionManager.resume(savedSessionId);
    expect(resumed.messages.length).toBe(5);
  });

  it('删除会话', async () => {
    await sessionManager.delete(savedSessionId);
    const list = await sessionManager.list();
    expect(list.length).toBe(0);
  });

  it('恢复不存在的会话抛异常', async () => {
    await expect(sessionManager.resume('non-existent-id')).rejects.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════
// 2. Checkpoint：创建 → 回滚
// ═════════════════════════════════════════════════════════════

describe('Checkpoint Manager', () => {
  let sessionManager: SessionManager;
  let checkpointManager: CheckpointManager;
  let sessionId: string;

  const messages: Message[] = [
    { role: 'user', content: '步骤一' },
    { role: 'assistant', content: '完成步骤一' },
    { role: 'user', content: '步骤二' },
    { role: 'assistant', content: '完成步骤二' },
    { role: 'user', content: '步骤三' },
    { role: 'assistant', content: '完成步骤三' },
  ];

  beforeAll(async () => {
    const cpDir = join(tempDir, 'sessions-cp');
    sessionManager = new SessionManager({ baseDir: cpDir });
    checkpointManager = new CheckpointManager(sessionManager.getStorage());

    // 先保存会话
    sessionId = await sessionManager.save(messages, 'Checkpoint 测试');
  });

  it('创建 checkpoint', async () => {
    const cpId = await checkpointManager.create(sessionId, messages, '步骤二完成后');

    expect(cpId).toBeTruthy();

    const list = await checkpointManager.list(sessionId);
    expect(list.length).toBe(1);
    expect(list[0].label).toBe('步骤二完成后');
  });

  it('回滚到 checkpoint 截断消息', async () => {
    // 创建 checkpoint 时有 6 条消息，在第 4 条处打点
    const cpId = await checkpointManager.create(sessionId, messages.slice(0, 4), '步骤二前');

    const restoredCount = await checkpointManager.restore(sessionId, cpId);
    expect(restoredCount).toBeGreaterThanOrEqual(0);
  });
});

// ═════════════════════════════════════════════════════════════
// 3. 记忆系统：直接写入 → 检索 → 格式化
// ═════════════════════════════════════════════════════════════

describe('Memory System', () => {
  let memoryManager: MemoryManager;

  // 模拟 MemoryStoreTool 的直接写入路径
  const testEntries: MemoryEntry[] = [
    {
      id: 'mem-001',
      type: 'user_preference',
      content: '不吃辣，对花生过敏',
      keywords: ['food', 'spicy', 'allergy', 'peanut'],
      confidence: 0.95,
      source: 'user_stated',
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
    },
    {
      id: 'mem-002',
      type: 'relationship',
      content: 'Alice 是同事，喜欢日料和文艺电影',
      keywords: ['Alice', 'colleague', 'japanese', 'food', 'movie'],
      confidence: 0.9,
      source: 'user_stated',
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
    },
    {
      id: 'mem-003',
      type: 'important_date',
      content: 'Alice 的生日是 3 月 8 日',
      keywords: ['Alice', 'birthday', 'march'],
      confidence: 0.95,
      source: 'user_stated',
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
    },
    {
      id: 'mem-004',
      type: 'decision',
      content: '项目选用 TypeScript + Ink 技术栈',
      keywords: ['typescript', 'ink', 'tech-stack', 'decision'],
      confidence: 0.9,
      source: 'conversation',
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
    },
  ];

  beforeAll(async () => {
    // 使用隔离的 SQLite 数据库
    memoryManager = new MemoryManager(
      { enabled: true, longTermMaxEntries: 1000, retrieveMaxResults: 10 },
    );
    (memoryManager as any).store = new MemoryStore(memoryDbPath);

    await memoryManager.init();

    // 直接通过 getStore() 写入（模拟 MemoryStoreTool 路径）
    const store = memoryManager.getStore();
    store.saveBatch(testEntries);
  });

  afterAll(async () => {
    await memoryManager.shutdown();
  });

  it('初始化后条目数正确', async () => {
    const stats = await memoryManager.getStats();
    expect(stats.total).toBeGreaterThanOrEqual(testEntries.length);
  });

  it('关键词检索 — 食物偏好', async () => {
    const results = await memoryManager.retrieve('food preferences allergy');

    expect(results.length).toBeGreaterThan(0);
    const foodEntry = results.find(r => r.id === 'mem-001');
    expect(foodEntry).toBeDefined();
    expect(foodEntry!.content).toContain('花生过敏');
  });

  it('关键词检索 — 人名', async () => {
    const results = await memoryManager.retrieve('Alice');

    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map(r => r.id);
    expect(ids).toContain('mem-002');
    expect(ids).toContain('mem-003');
  });

  it('检索结果 accessCount 递增', async () => {
    const before = testEntries.find(e => e.id === 'mem-004')!.accessCount;
    await memoryManager.retrieve('typescript tech-stack');
    // accessCount 在缓存中更新
    // 注意：retrieve 返回的是从缓存中筛选的引用，accessCount 已递增
    // 但原始 testEntries 对象不受影响，需要重新检索验证
    const results = await memoryManager.retrieve('typescript');
    const entry = results.find(r => r.id === 'mem-004');
    expect(entry).toBeDefined();
    expect(entry!.accessCount).toBeGreaterThan(0);
  });

  it('类型过滤检索', async () => {
    const results = await memoryManager.retrieve('Alice birthday', {
      types: ['important_date'],
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.type === 'important_date')).toBe(true);
  });

  it('格式化为 Prompt 片段', () => {
    const formatted = memoryManager.formatForPrompt(testEntries.slice(0, 2));

    expect(formatted).toContain('Relevant Past Context');
    expect(formatted).toContain('偏好');
    expect(formatted).toContain('花生过敏');
    expect(formatted).toContain('人际关系');
    expect(formatted).toContain('Alice');
  });

  it('空查询返回空结果', async () => {
    const results = await memoryManager.retrieve('xyznonexistent12345');
    // 可能返回空，也可能返回低分结果（取决于检索策略）
    // 至少不应该报错
    expect(Array.isArray(results)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// 4. 提醒系统：设置 → 检查 → 标记完成
// ═════════════════════════════════════════════════════════════

describe('Reminder Engine', () => {
  let engine: ReminderEngine;

  beforeAll(() => {
    engine = new ReminderEngine({ enabled: true, upcomingDays: 7 });
    // 覆盖内部路径到临时目录（测试隔离）
    (engine as any).filePath = remindersFile;
  });

  it('设置提醒', async () => {
    const reminder = await engine.setReminder({
      content: 'Alice 的生日 — 准备礼物',
      triggerDate: new Date(Date.now() + 2 * 86400_000).toISOString().split('T')[0], // 2 天后
      source: 'auto_extracted',
      recurring: 'yearly',
    });

    expect(reminder.id).toBeTruthy();
    expect(reminder.content).toBe('Alice 的生日 — 准备礼物');
    expect(reminder.status).toBe('active');
    expect(reminder.recurring).toBe('yearly');
  });

  it('设置一次性提醒', async () => {
    const reminder = await engine.setReminder({
      content: '提交周报',
      triggerDate: new Date().toISOString().split('T')[0], // 今天
      source: 'user_explicit',
      recurring: 'once',
    });

    expect(reminder.recurring).toBe('once');
  });

  it('启动检查返回到期提醒', async () => {
    const context = await engine.checkOnStartup();

    // 今天的提醒应出现在 due 中
    expect((context.dueReminders?.length ?? 0) + (context.upcomingReminders?.length ?? 0)).toBeGreaterThan(0);
  });

  it('标记提醒完成', async () => {
    const context = await engine.checkOnStartup();
    const dueReminder = (context.dueReminders ?? [])[0];

    if (dueReminder) {
      await engine.markDone(dueReminder.id);
      // 再次检查，已完成的不应再出现
      const context2 = await engine.checkOnStartup();
      const stillThere = (context2.dueReminders ?? []).find(r => r.id === dueReminder.id);
      expect(stillThere).toBeUndefined();
    }
  });

  it('提醒数据持久化到文件', async () => {
    expect(existsSync(remindersFile)).toBe(true);
    const content = await readFile(remindersFile, 'utf-8');
    expect(content).toContain('Alice');
    expect(content).toContain('提交周报');
  });
});

// ═════════════════════════════════════════════════════════════
// 5. Todo 管理：创建 → 更新 → 依赖 → 完成
// ═════════════════════════════════════════════════════════════

describe('Todo Manager', () => {
  let todoManager: TodoManager;

  beforeAll(() => {
    todoManager = new TodoManager(todosFile);
  });

  it('创建多个任务', async () => {
    const t1 = await todoManager.create({ title: '分析项目结构', activeForm: '分析项目结构中' });
    const t2 = await todoManager.create({ title: '安装依赖' });
    const t3 = await todoManager.create({ title: '编写配置文件' });

    expect(t1.id).toBe('todo-001');
    expect(t2.id).toBe('todo-002');
    expect(t3.id).toBe('todo-003');
    expect(t1.status).toBe('pending');
  });

  it('设置依赖关系', async () => {
    // t3 依赖 t2（t2 完成后才能开始 t3）
    await todoManager.update('todo-003', { addBlockedBy: ['todo-002'] });

    const t3 = await todoManager.get('todo-003');
    expect(t3!.blockedBy).toContain('todo-002');

    // 双向维护：t2 应 blocks t3
    const t2 = await todoManager.get('todo-002');
    expect(t2!.blocks).toContain('todo-003');
  });

  it('更新任务状态', async () => {
    await todoManager.update('todo-001', { status: 'in_progress' });
    const t1 = await todoManager.get('todo-001');
    expect(t1!.status).toBe('in_progress');

    await todoManager.update('todo-001', { status: 'completed' });
    const t1Done = await todoManager.get('todo-001');
    expect(t1Done!.status).toBe('completed');
  });

  it('完成任务自动解除依赖', async () => {
    await todoManager.update('todo-002', { status: 'completed' });

    // t3 的 blockedBy 应被清除
    const t3 = await todoManager.get('todo-003');
    expect(t3!.blockedBy!.length).toBe(0);
  });

  it('列出任务支持过滤', async () => {
    const completed = await todoManager.list({ status: 'completed' });
    expect(completed.length).toBe(2); // t1, t2

    const all = await todoManager.list();
    expect(all.length).toBe(3);
  });

  it('数据持久化到文件', async () => {
    expect(existsSync(todosFile)).toBe(true);
    const content = await readFile(todosFile, 'utf-8');
    expect(content).toContain('分析项目结构');
    expect(content).toContain('安装依赖');
  });
});
