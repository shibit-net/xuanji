import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TodoManager } from '@/tools/TodoManager';
import { TodoCreateTool, TodoListTool, TodoUpdateTool, setTodoManager } from '@/tools/TodoTool';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync, existsSync } from 'node:fs';

describe('TodoManager', () => {
  let manager: TodoManager;
  let testPath: string;

  beforeEach(() => {
    testPath = join(tmpdir(), `xuanji-test-todos-${Date.now()}.jsonl`);
    manager = new TodoManager(testPath);
    // 设置共享实例供 Tool 使用
    setTodoManager(manager);
  });

  afterEach(() => {
    try {
      if (existsSync(testPath)) unlinkSync(testPath);
    } catch { /* ignore */ }
  });

  // ─── TodoManager 基础 CRUD ───────────────────────

  describe('create()', () => {
    it('应创建任务并返回完整对象', async () => {
      const todo = await manager.create({ title: '实现 WebFetch 工具' });
      expect(todo.id).toBe('todo-001');
      expect(todo.title).toBe('实现 WebFetch 工具');
      expect(todo.status).toBe('pending');
      expect(todo.created_at).toBeDefined();
    });

    it('应自动递增 ID', async () => {
      const t1 = await manager.create({ title: 'Task 1' });
      const t2 = await manager.create({ title: 'Task 2' });
      expect(t1.id).toBe('todo-001');
      expect(t2.id).toBe('todo-002');
    });

    it('应支持描述和元数据', async () => {
      const todo = await manager.create({
        title: 'Task',
        description: '详细描述',
        metadata: { priority: 'high' },
      });
      expect(todo.description).toBe('详细描述');
      expect(todo.metadata).toEqual({ priority: 'high' });
    });
  });

  describe('list()', () => {
    it('空列表应返回空数组', async () => {
      const todos = await manager.list();
      expect(todos).toEqual([]);
    });

    it('应返回所有任务', async () => {
      await manager.create({ title: 'A' });
      await manager.create({ title: 'B' });
      const todos = await manager.list();
      expect(todos).toHaveLength(2);
    });

    it('应按状态过滤', async () => {
      await manager.create({ title: 'A' });
      const t2 = await manager.create({ title: 'B' });
      await manager.update(t2.id, { status: 'completed' });

      const pending = await manager.list({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('A');

      const completed = await manager.list({ status: 'completed' });
      expect(completed).toHaveLength(1);
      expect(completed[0].title).toBe('B');
    });
  });

  describe('update()', () => {
    it('应更新状态', async () => {
      const todo = await manager.create({ title: 'Task' });
      const updated = await manager.update(todo.id, { status: 'in_progress' });
      expect(updated.status).toBe('in_progress');
    });

    it('应更新标题', async () => {
      const todo = await manager.create({ title: 'Old' });
      const updated = await manager.update(todo.id, { title: 'New' });
      expect(updated.title).toBe('New');
    });

    it('不存在的任务应抛出错误', async () => {
      await expect(manager.update('nonexistent', { status: 'completed' })).rejects.toThrow('任务不存在');
    });
  });

  describe('delete()', () => {
    it('应删除任务', async () => {
      const todo = await manager.create({ title: 'Task' });
      const result = await manager.delete(todo.id);
      expect(result).toBe(true);
      const todos = await manager.list();
      expect(todos).toHaveLength(0);
    });

    it('删除不存在的任务应返回 false', async () => {
      const result = await manager.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('count()', () => {
    it('应返回总数', async () => {
      await manager.create({ title: 'A' });
      await manager.create({ title: 'B' });
      expect(await manager.count()).toBe(2);
    });

    it('应按状态计数', async () => {
      await manager.create({ title: 'A' });
      const t2 = await manager.create({ title: 'B' });
      await manager.update(t2.id, { status: 'completed' });
      expect(await manager.count('pending')).toBe(1);
      expect(await manager.count('completed')).toBe(1);
    });
  });

  describe('持久化', () => {
    it('数据应在新实例中恢复', async () => {
      await manager.create({ title: 'Persist Test' });

      // 创建新实例读取同一文件
      const manager2 = new TodoManager(testPath);
      const todos = await manager2.list();
      expect(todos).toHaveLength(1);
      expect(todos[0].title).toBe('Persist Test');
    });
  });

  // ─── TodoCreateTool ─────────────────────────────

  describe('TodoCreateTool', () => {
    it('应创建任务', async () => {
      const tool = new TodoCreateTool();
      const result = await tool.execute({ title: '测试任务' });
      expect(result.isError).toBe(false);
      expect(result.content).toContain('已创建');
      expect(result.content).toContain('测试任务');
    });

    it('空标题应返回错误', async () => {
      const tool = new TodoCreateTool();
      const result = await tool.execute({ title: '' });
      expect(result.isError).toBe(true);
    });
  });

  // ─── TodoListTool ────────────────────────────────

  describe('TodoListTool', () => {
    it('空列表应显示提示', async () => {
      await manager.clear();
      const tool = new TodoListTool();
      const result = await tool.execute({});
      expect(result.isError).toBe(false);
      expect(result.content).toContain('没有');
    });

    it('应列出任务', async () => {
      await manager.create({ title: 'Task A' });
      await manager.create({ title: 'Task B' });
      const tool = new TodoListTool();
      const result = await tool.execute({});
      expect(result.content).toContain('Task A');
      expect(result.content).toContain('Task B');
    });

    it('应按状态过滤', async () => {
      await manager.create({ title: 'Pending' });
      const t2 = await manager.create({ title: 'Done' });
      await manager.update(t2.id, { status: 'completed' });

      const tool = new TodoListTool();
      const result = await tool.execute({ status: 'completed' });
      expect(result.content).toContain('Done');
      expect(result.content).not.toContain('Pending');
    });
  });

  // ─── TodoUpdateTool ──────────────────────────────

  describe('TodoUpdateTool', () => {
    it('应更新任务状态', async () => {
      const todo = await manager.create({ title: 'Task' });
      const tool = new TodoUpdateTool();
      const result = await tool.execute({ id: todo.id, status: 'in_progress' });
      expect(result.isError).toBe(false);
      expect(result.content).toContain('开始执行');
      expect(result.content).toContain('Task');
      // 验证 manager 中的状态确实已更新
      const updated = await manager.get(todo.id);
      expect(updated?.status).toBe('in_progress');
    });

    it('空 id 应返回错误', async () => {
      const tool = new TodoUpdateTool();
      const result = await tool.execute({ id: '' });
      expect(result.isError).toBe(true);
    });

    it('不存在的 id 应返回错误', async () => {
      const tool = new TodoUpdateTool();
      const result = await tool.execute({ id: 'nonexistent', status: 'completed' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('任务不存在');
    });
  });
});
