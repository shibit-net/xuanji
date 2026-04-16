// ============================================================
// MigrationRunner — JSONL → SQLite 迁移器
// ============================================================
// 职责：
// - 读取旧 ~/.xuanji/memory/*.jsonl（7 个文件）
// - 从旧 vector.db 复制已有向量
// - 按 id 去重，批量 INSERT OR IGNORE 到 memory.db
// - 迁移完成后将旧文件移到 ~/.xuanji/memory.bak/

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { MemoryStore } from '../MemoryStore.js';
import type { MemoryEntry } from '../types.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MigrationRunner' });

const JSONL_FILES = [
  'sessions.jsonl',
  'decisions.jsonl',
  'knowledge.jsonl',
  'personal.jsonl',
  'agent-knowledge.jsonl',
  'lessons.jsonl',
  'unfinished-tasks.jsonl',
];

export class MigrationRunner {
  private store: MemoryStore;
  private globalMemoryDir: string;
  private vectorDbPath: string;

  constructor(store: MemoryStore) {
    this.store = store;
    this.globalMemoryDir = join(homedir(), '.xuanji', 'memory');
    this.vectorDbPath = join(homedir(), '.xuanji', 'vector.db');
  }

  async run(): Promise<void> {
    log.info('Starting JSONL → SQLite migration...');

    // 1. 读取所有 JSONL 文件
    const entries = await this.readAllJsonl();
    log.info(`Read ${entries.length} entries from JSONL files`);

    if (entries.length === 0) {
      log.info('No JSONL entries found, skipping migration');
      return;
    }

    // 2. 批量写入 SQLite（INSERT OR IGNORE 去重）
    this.store.saveBatch(entries);
    log.info(`Migrated ${entries.length} entries to SQLite`);

    // 3. 从旧 vector.db 复制向量
    await this.migrateVectors();

    // 4. 将旧文件移到 .bak/
    this.backupOldFiles();

    log.info('Migration completed successfully');
  }

  // ────────── 私有方法 ──────────

  private async readAllJsonl(): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    const seen = new Set<string>();

    for (const fileName of JSONL_FILES) {
      const filePath = join(this.globalMemoryDir, fileName);
      if (!existsSync(filePath)) continue;

      const fileEntries = await this.parseJsonlFile(filePath);
      for (const entry of fileEntries) {
        if (entry.id && !seen.has(entry.id)) {
          seen.add(entry.id);
          entries.push(entry);
        }
      }
    }

    return entries;
  }

  private async parseJsonlFile(filePath: string): Promise<MemoryEntry[]> {
    try {
      const text = await readFile(filePath, 'utf-8');
      const lines = text.split('\n').filter((l) => l.trim());
      const entries: MemoryEntry[] = [];

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          // 基本字段校验
          if (obj && typeof obj.id === 'string' && typeof obj.type === 'string' && typeof obj.content === 'string') {
            entries.push(obj as MemoryEntry);
          }
        } catch {
          // 跳过格式错误的行
        }
      }

      return entries;
    } catch (err) {
      log.debug(`Failed to read ${filePath}:`, err);
      return [];
    }
  }

  private async migrateVectors(): Promise<void> {
    if (!existsSync(this.vectorDbPath)) {
      log.debug('No vector.db found, skipping vector migration');
      return;
    }

    try {
      const Database = (await import('better-sqlite3')).default;
      const vectorDb = new Database(this.vectorDbPath, { readonly: true });

      // 读取旧 vector.db 中的向量
      const rows = vectorDb.prepare('SELECT memory_id, embedding FROM memory_vectors').all() as any[];
      log.info(`Found ${rows.length} vectors in vector.db`);

      for (const row of rows) {
        try {
          const buf = Buffer.from(row.embedding);
          const embedding = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
          this.store.upsertVector(row.memory_id, embedding);
        } catch (err) {
          log.debug(`Failed to migrate vector for ${row.memory_id}:`, err);
        }
      }

      // 迁移 skill_vectors
      try {
        const skillRows = vectorDb.prepare('SELECT * FROM skill_vectors').all() as any[];
        log.info(`Found ${skillRows.length} skill vectors in vector.db`);

        for (const row of skillRows) {
          try {
            const buf = Buffer.from(row.embedding);
            const embedding = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
            this.store.upsertSkillEmbedding(row.skill_id, row.skill_name, embedding, row.description);
          } catch (err) {
            log.debug(`Failed to migrate skill vector for ${row.skill_id}:`, err);
          }
        }
      } catch {
        log.debug('skill_vectors table not found in vector.db, skipping');
      }

      vectorDb.close();
      log.info('Vector migration completed');
    } catch (err) {
      log.warn('Vector migration failed (non-fatal):', err);
    }
  }

  private backupOldFiles(): void {
    if (!existsSync(this.globalMemoryDir)) return;

    const bakDir = join(homedir(), '.xuanji', 'memory.bak');
    try {
      mkdirSync(bakDir, { recursive: true });

      const files = readdirSync(this.globalMemoryDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const src = join(this.globalMemoryDir, file);
        const dst = join(bakDir, file);
        try {
          renameSync(src, dst);
          log.debug(`Backed up: ${file} → memory.bak/${file}`);
        } catch (err) {
          log.warn(`Failed to backup ${file}:`, err);
        }
      }

      log.info(`Old JSONL files backed up to ${bakDir}`);
    } catch (err) {
      log.warn('Failed to backup old files (non-fatal):', err);
    }
  }
}
