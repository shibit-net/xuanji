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
  private archivePath: string;
  private loaded = false;
  private nextId = 1;

  constructor(storagePath?: string) {
    this.storagePath = storagePath ?? join(homedir(), '.xuanji', 'todos.jsonl');
    this.archivePath = storagePath
      ? storagePath.replace('.jsonl', '-archive.jsonl')
      : join(homedir(), '.xuanji', 'todos-archive.jsonl');
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
    const todoId = `todo-${String(this.nextId++).padStart(3, '0')}`;

    console.log(`[TodoManager] 创建任务: id=${todoId}, title=${params.title}, 当前任务总数=${this.todos.size}`);

    const todo: Todo = {
      id: todoId,
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
      console.error(`[TodoManager] 任务不存在: ${id}, 当前任务列表:`, Array.from(this.todos.keys()));
      throw new Error(`任务不存在: ${id}`);
    }

    console.log(`[TodoManager] 更新任务: id=${id}, 旧状态=${todo.status}, 新状态=${updates.status || '未变'}, title=${todo.title}`);

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
   * 检查是否有活跃的（未完成的）任务
   *
   * 同步方法，基于内存中的 todos Map 判断。
   * 用于 UI 层快速判断用户是否在延续当前任务：
   * - 有活跃任务 → 用户的下一条消息可能是补充/修正，不应清空 TODO
   * - 无活跃任务 → 安全地重置 TODO 状态
   */
  hasActiveTodos(): boolean {
    if (this.todos.size === 0) return false;
    return Array.from(this.todos.values()).some(
      (t) => t.status === 'pending' || t.status === 'in_progress',
    );
  }

  /**
   * 开始新一轮任务 — 清空所有 todo 数据
   *
   * 每次用户发送新消息触发 Agent 执行时调用，
   * 确保 TODO 列表只包含当前任务创建的 todo。
   */
  async startTurn(): Promise<void> {
    console.log(`[TodoManager] startTurn() 被调用，清空前任务数=${this.todos.size}, nextId=${this.nextId}`);
    console.log(`[TodoManager] 清空前的任务列表:`, Array.from(this.todos.values()).map(t => ({ id: t.id, title: t.title, status: t.status })));
    this.todos.clear();
    this.nextId = 1;
    this.loaded = true; // 标记已加载，避免从磁盘恢复旧数据
    await this.persist();
    console.log(`[TodoManager] startTurn() 完成，任务已清空`);
  }

  /**
   * 归档单个任务
   * 将任务从活跃列表移动到归档文件
   */
  async archiveTodo(todoId: string): Promise<boolean> {
    await this.ensureLoaded();

    const todo = this.todos.get(todoId);
    if (!todo) return false;

    // 追加到归档文件
    const dir = dirname(this.archivePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await appendFile(this.archivePath, JSON.stringify(todo) + '\n', 'utf-8');

    // 从活跃列表移除
    this.todos.delete(todoId);
    await this.persist();

    console.log(`[TodoManager] 任务已归档: ${todoId}`);
    return true;
  }

  /**
   * 自动归档已完成任务
   * @param thresholdHours 完成后多少小时自动归档（默认 24 小时）
   * @returns 归档的任务数量
   */
  async autoArchive(thresholdHours = 24): Promise<number> {
    await this.ensureLoaded();

    const threshold = Date.now() - thresholdHours * 60 * 60 * 1000;
    const toArchive = Array.from(this.todos.values()).filter(
      (t) =>
        t.status === 'completed' &&
        new Date(t.updated_at).getTime() < threshold
    );

    for (const todo of toArchive) {
      await this.archiveTodo(todo.id);
    }

    console.log(`[TodoManager] 自动归档完成: ${toArchive.length} 个任务`);
    return toArchive.length;
  }

  /**
   * 归档所有已完成任务
   * @returns 归档的任务数量
   */
  async archiveCompleted(): Promise<number> {
    await this.ensureLoaded();

    const completed = Array.from(this.todos.values()).filter(
      (t) => t.status === 'completed'
    );

    for (const todo of completed) {
      await this.archiveTodo(todo.id);
    }

    console.log(`[TodoManager] 已归档所有完成任务: ${completed.length} 个`);
    return completed.length;
  }

  /**
   * 检测孤儿任务（长时间无更新的 pending 任务）
   * @param thresholdDays 多少天无更新视为孤儿任务（默认 7 天）
   * @returns 孤儿任务列表
   */
  async detectStaleTasks(thresholdDays = 7): Promise<Todo[]> {
    await this.ensureLoaded();

    const threshold = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;
    return Array.from(this.todos.values()).filter(
      (t) =>
        t.status === 'pending' &&
        new Date(t.updated_at).getTime() < threshold
    );
  }

  /**
   * 清空指定状态的任务
   * @param status 要清空的状态，不传则清空所有
   */
  async clearByStatus(status?: Todo['status']): Promise<number> {
    await this.ensureLoaded();

    const before = this.todos.size;

    if (status) {
      // 清空指定状态
      for (const [id, todo] of this.todos.entries()) {
        if (todo.status === status) {
          this.todos.delete(id);
        }
      }
    } else {
      // 清空所有
      this.todos.clear();
      this.nextId = 1;
    }

    await this.persist();
    const cleared = before - this.todos.size;

    console.log(`[TodoManager] 清空任务: status=${status || 'all'}, 数量=${cleared}`);
    return cleared;
  }

  /**
   * 获取归档任务数量
   */
  async getArchivedCount(): Promise<number> {
    try {
      if (!existsSync(this.archivePath)) return 0;

      const content = await readFile(this.archivePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.length;
    } catch {
      return 0;
    }
  }

  /**
   * 格式化当前 TODO 进度摘要
   *
   * 返回包含结构化 JSON 标记的字符串，格式：
   * <!--TODO_PROGRESS:{"completed":1,"total":3,"items":[...]}-->
   *
   * UI 层（TodoPanel）会解析此标记并渲染可视化面板。
   * 同时保留纯文本回退：LLM 看到的仍是 JSON，可正常理解进度。
   */
  formatProgress(): string {
    const todos = Array.from(this.todos.values())
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    if (todos.length === 0) return '';

    const completed = todos.filter((t) => t.status === 'completed').length;
    const total = todos.length;

    const items = todos.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description || '',
      status: t.status,
      activeForm: t.activeForm,
    }));

    const progressData = JSON.stringify({ completed, total, items });
    return `\n<!--TODO_PROGRESS:${progressData}-->`;
  }
}

let _todoManagerInstance: TodoManager | null = null;

export function getTodoManager(): TodoManager {
  if (!_todoManagerInstance) {
    _todoManagerInstance = new TodoManager();
  }
  return _todoManagerInstance;
}
