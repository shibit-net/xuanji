// ============================================================
// M6 工具系统 — Todo 任务管理器
// ============================================================

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

/**
 * Todo 任务
 */
export interface Todo {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
  /** 此任务阻塞哪些任务 */
  blocks?: string[];
  /** 此任务被哪些任务阻塞 */
  blockedBy?: string[];
  /** 任务归属（代理 ID） */
  owner?: string;
  /** 进行中时的显示文案 */
  activeForm?: string;
}

/**
 * Todo 任务管理器
 *
 * 使用 JSONL 格式持久化任务到 ~/.xuanji/todos.jsonl
 * 每行一个完整的 Todo 对象（写入时覆盖整个文件）
 */
export class TodoManager {
  private todos: Map<string, Todo> = new Map();
  private storagePath: string;
  private loaded = false;
  private nextId = 1;

  constructor(storagePath?: string) {
    this.storagePath = storagePath ?? join(homedir(), '.xuanji', 'todos.jsonl');
  }

  /**
   * 确保已加载数据
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      if (existsSync(this.storagePath)) {
        const content = await readFile(this.storagePath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const todo = JSON.parse(line) as Todo;
            this.todos.set(todo.id, todo);
            // 更新 nextId
            const idNum = parseInt(todo.id.replace('todo-', ''), 10);
            if (!isNaN(idNum) && idNum >= this.nextId) {
              this.nextId = idNum + 1;
            }
          } catch {
            // 跳过损坏的行
          }
        }
      }
    } catch {
      // 文件不存在或读取失败，使用空数据
    }

    this.loaded = true;
  }

  /**
   * 持久化到磁盘
   */
  private async persist(): Promise<void> {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const content = Array.from(this.todos.values())
      .map((todo) => JSON.stringify(todo))
      .join('\n');

    await writeFile(this.storagePath, content + (content ? '\n' : ''), 'utf-8');
  }

  /**
   * 创建任务
   */
  async create(params: {
    title: string;
    description?: string;
    metadata?: Record<string, unknown>;
    owner?: string;
    activeForm?: string;
  }): Promise<Todo> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const todo: Todo = {
      id: `todo-${String(this.nextId++).padStart(3, '0')}`,
      title: params.title,
      description: params.description,
      status: 'pending',
      created_at: now,
      updated_at: now,
      metadata: params.metadata,
      blocks: [],
      blockedBy: [],
      owner: params.owner,
      activeForm: params.activeForm,
    };

    this.todos.set(todo.id, todo);
    await this.persist();

    return todo;
  }

  /**
   * 更新任务
   */
  async update(
    id: string,
    updates: {
      title?: string;
      description?: string;
      status?: 'pending' | 'in_progress' | 'completed';
      metadata?: Record<string, unknown>;
      owner?: string;
      activeForm?: string;
      addBlocks?: string[];
      addBlockedBy?: string[];
    }
  ): Promise<Todo> {
    await this.ensureLoaded();

    const todo = this.todos.get(id);
    if (!todo) {
      throw new Error(`任务不存在: ${id}`);
    }

    if (updates.title !== undefined) todo.title = updates.title;
    if (updates.description !== undefined) todo.description = updates.description;
    if (updates.status !== undefined) todo.status = updates.status;
    if (updates.metadata !== undefined) {
      todo.metadata = { ...todo.metadata, ...updates.metadata };
    }
    if (updates.owner !== undefined) todo.owner = updates.owner;
    if (updates.activeForm !== undefined) todo.activeForm = updates.activeForm;

    // 添加阻塞关系
    if (updates.addBlocks && updates.addBlocks.length > 0) {
      const blocksSet = new Set(todo.blocks ?? []);
      for (const targetId of updates.addBlocks) {
        if (!this.todos.has(targetId)) continue;
        blocksSet.add(targetId);
        // 双向维护: 在目标任务的 blockedBy 中添加当前任务
        const target = this.todos.get(targetId)!;
        const targetBlockedBy = new Set(target.blockedBy ?? []);
        targetBlockedBy.add(id);
        target.blockedBy = Array.from(targetBlockedBy);
      }
      todo.blocks = Array.from(blocksSet);
    }

    if (updates.addBlockedBy && updates.addBlockedBy.length > 0) {
      const blockedBySet = new Set(todo.blockedBy ?? []);
      for (const sourceId of updates.addBlockedBy) {
        if (!this.todos.has(sourceId)) continue;
        blockedBySet.add(sourceId);
        // 双向维护: 在源任务的 blocks 中添加当前任务
        const source = this.todos.get(sourceId)!;
        const sourceBlocks = new Set(source.blocks ?? []);
        sourceBlocks.add(id);
        source.blocks = Array.from(sourceBlocks);
      }
      todo.blockedBy = Array.from(blockedBySet);
    }

    // 任务完成时，自动清理其他任务的 blockedBy 引用
    if (updates.status === 'completed') {
      this.clearBlockReferences(id);
    }

    todo.updated_at = new Date().toISOString();

    await this.persist();
    return todo;
  }

  /**
   * 列出任务
   */
  async list(filter?: {
    status?: 'all' | 'pending' | 'in_progress' | 'completed';
  }): Promise<Todo[]> {
    await this.ensureLoaded();

    const statusFilter = filter?.status ?? 'all';
    const todos = Array.from(this.todos.values());

    if (statusFilter === 'all') {
      return todos.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return todos
      .filter((t) => t.status === statusFilter)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /**
   * 获取单个任务
   */
  async get(id: string): Promise<Todo | undefined> {
    await this.ensureLoaded();
    return this.todos.get(id);
  }

  /**
   * 删除任务
   */
  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();

    if (!this.todos.has(id)) return false;

    this.todos.delete(id);
    await this.persist();
    return true;
  }

  /**
   * 获取任务数量
   */
  async count(status?: 'pending' | 'in_progress' | 'completed'): Promise<number> {
    await this.ensureLoaded();

    if (!status) return this.todos.size;

    return Array.from(this.todos.values()).filter((t) => t.status === status).length;
  }

  /**
   * 清空所有任务（仅用于测试）
   */
  async clear(): Promise<void> {
    this.todos.clear();
    this.nextId = 1;
    await this.persist();
  }

  /**
   * 清理已完成任务的阻塞引用
   * 当某任务完成时，从其他任务的 blockedBy 中移除它
   */
  private clearBlockReferences(completedId: string): void {
    for (const [, todo] of this.todos) {
      if (todo.blockedBy && todo.blockedBy.includes(completedId)) {
        todo.blockedBy = todo.blockedBy.filter((id) => id !== completedId);
      }
    }
  }

  /**
   * 获取未阻塞的待处理任务（blockedBy 为空或所有 blocker 已完成）
   */
  async getAvailable(): Promise<Todo[]> {
    await this.ensureLoaded();

    return Array.from(this.todos.values()).filter((t) => {
      if (t.status !== 'pending') return false;
      if (!t.blockedBy || t.blockedBy.length === 0) return true;
      // 检查所有 blocker 是否已完成
      return t.blockedBy.every((blockerId) => {
        const blocker = this.todos.get(blockerId);
        return !blocker || blocker.status === 'completed';
      });
    });
  }
}
