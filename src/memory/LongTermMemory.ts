// ============================================================
// M4 记忆系统 — 长期记忆持久化
// ============================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MemoryEntry, MemoryEntryType, MemoryConfig } from './types';
import { DEFAULT_MEMORY_CONFIG } from './types';
import { StorageBackend } from './StorageBackend';

/** 记忆类型到文件名的映射 */
const TYPE_FILE_MAP: Record<MemoryEntryType, string> = {
  session_summary: 'sessions.jsonl',
  decision: 'decisions.jsonl',
  error_resolution: 'decisions.jsonl',
  tool_pattern: 'knowledge.jsonl',
  user_preference: 'knowledge.jsonl',
  project_fact: 'knowledge.jsonl',
};

/**
 * 长期记忆 — 管理 JSONL 文件持久化
 *
 * 存储路径:
 * - 全局: ~/.xuanji/memory/
 * - 项目: .xuanji/memory/
 */
export class LongTermMemory {
  private storage: StorageBackend;
  private globalDir: string;
  private projectDir: string | null;
  private config: MemoryConfig;

  constructor(
    projectRoot?: string,
    config?: Partial<MemoryConfig>,
    storage?: StorageBackend,
  ) {
    this.storage = storage ?? new StorageBackend();
    this.globalDir = join(homedir(), '.xuanji', 'memory');
    this.projectDir = projectRoot ? join(projectRoot, '.xuanji', 'memory') : null;
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  /** 保存单条记忆 */
  async save(entry: MemoryEntry): Promise<void> {
    const filePath = this.getFilePath(entry);
    await this.storage.append(filePath, entry);
  }

  /** 批量保存 */
  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.save(entry);
    }
  }

  /** 读取全局记忆 */
  async readGlobal(limit?: number): Promise<MemoryEntry[]> {
    const entries = await this.readFromDir(this.globalDir, limit);
    return entries;
  }

  /** 读取项目级记忆 */
  async readProject(limit?: number): Promise<MemoryEntry[]> {
    if (!this.projectDir) return [];
    return this.readFromDir(this.projectDir, limit);
  }

  /** 合并读取全局 + 项目记忆 */
  async readAll(limit?: number): Promise<MemoryEntry[]> {
    const [globalEntries, projectEntries] = await Promise.all([
      this.readGlobal(),
      this.readProject(),
    ]);

    const all = [...globalEntries, ...projectEntries];

    // 按创建时间降序排列
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (limit && all.length > limit) {
      return all.slice(0, limit);
    }
    return all;
  }

  /** 压缩后覆盖写入 */
  async replaceAll(scope: 'global' | 'project', entries: MemoryEntry[]): Promise<void> {
    const dir = scope === 'global' ? this.globalDir : this.projectDir;
    if (!dir) return;

    // 按文件名分组
    const grouped = new Map<string, MemoryEntry[]>();
    for (const entry of entries) {
      const fileName = TYPE_FILE_MAP[entry.type] ?? 'knowledge.jsonl';
      const existing = grouped.get(fileName) ?? [];
      existing.push(entry);
      grouped.set(fileName, existing);
    }

    // 覆盖每个文件
    const allFileNames = new Set(Object.values(TYPE_FILE_MAP));
    for (const fileName of allFileNames) {
      const filePath = join(dir, fileName);
      const records = grouped.get(fileName) ?? [];
      if (records.length > 0) {
        await this.storage.overwrite(filePath, records);
      } else if (this.storage.exists(filePath)) {
        // 如果没有记录但文件存在，清空文件
        await this.storage.overwrite(filePath, []);
      }
    }
  }

  /** 获取全局目录路径 */
  getGlobalDir(): string {
    return this.globalDir;
  }

  /** 获取项目目录路径 */
  getProjectDir(): string | null {
    return this.projectDir;
  }

  // ────────── 私有方法 ──────────

  /** 根据 entry 的 projectPath 和 type 确定文件路径 */
  private getFilePath(entry: MemoryEntry): string {
    const fileName = TYPE_FILE_MAP[entry.type] ?? 'knowledge.jsonl';
    const dir = entry.projectPath ? (this.projectDir ?? this.globalDir) : this.globalDir;
    return join(dir, fileName);
  }

  /** 从指定目录读取所有记忆文件 */
  private async readFromDir(dir: string, limit?: number): Promise<MemoryEntry[]> {
    const allFileNames = new Set(Object.values(TYPE_FILE_MAP));
    const entries: MemoryEntry[] = [];

    for (const fileName of allFileNames) {
      const filePath = join(dir, fileName);
      if (limit) {
        const records = await this.storage.readRecent<MemoryEntry>(filePath, limit);
        entries.push(...records);
      } else {
        const records = await this.storage.readAll<MemoryEntry>(filePath);
        entries.push(...records);
      }
    }

    return entries;
  }
}
