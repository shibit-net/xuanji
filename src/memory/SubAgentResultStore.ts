/**
 * SubAgentResultStore — 子 Agent 结果持久化
 *
 * 将子 Agent 执行结果写入 JSONL 文件，支持按日期分文件 + 7 天过期。
 * 设计文档：docs/memory-system-part-6-archiving.md §2–§3
 */

import { join } from 'node:path';
import { appendFile, readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/infrastructure/logger';
import type { SubAgentResult } from '@/memory/types';

const log = logger.child({ module: 'SubAgentResultStore' });

/**
 * 子 Agent 结果持久化存储
 *
 * HookRegistry 的 PostToolUse 回调将结果写入 JSONL。
 * 每个 session 一个文件，7 天后自动清理。
 */
export class SubAgentResultStore {
  constructor(private baseDir: string) {}

  /**
   * 存储子 Agent 结果
   */
  async store(result: SubAgentResult): Promise<void> {
    try {
      await this.ensureDir();

      const dateStr = new Date(result.timestamp).toISOString().slice(0, 10);
      const fileName = `${dateStr}.jsonl`;
      const filePath = join(this.baseDir, fileName);

      const line = JSON.stringify({
        sessionId: result.sessionId,
        agentId: result.agentId,
        toolName: result.toolName,
        input: result.input,
        output: result.output,
        full_output: result.full_output ?? null,
        duration: result.duration,
        timestamp: result.timestamp,
        scene: result.scene ?? '',
        summary: result.summary ?? '',
        key_entities: result.key_entities ?? [],
        token_count: result.token_count ?? null,
        expires_at: result.expires_at ?? (result.timestamp + 7 * 24 * 3600 * 1000),
        error: result.error ?? null,
      }) + '\n';

      await appendFile(filePath, line, 'utf-8');
    } catch (err) {
      log.error('Failed to store sub-agent result:', err);
    }
  }

  /**
   * 搜索子 Agent 结果
   */
  async search(query: string, limit: number = 10): Promise<SubAgentResult[]> {
    try {
      const files = await readdir(this.baseDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort().reverse();

      const results: SubAgentResult[] = [];
      const lowerQuery = query.toLowerCase();

      for (const file of jsonlFiles) {
        if (results.length >= limit) break;

        try {
          const content = await readFile(join(this.baseDir, file), 'utf-8');
          const lines = content.trim().split('\n');

          for (const line of lines.reverse()) {
            if (results.length >= limit) break;
            try {
              const parsed = JSON.parse(line);
              const matchTarget = JSON.stringify(parsed).toLowerCase();
              if (matchTarget.includes(lowerQuery)) {
                results.push(parsed);
              }
            } catch { /* skip malformed lines — expected for partial writes */ }
          }
        } catch { log.debug('SubAgentResultStore: skip unreadable results file'); }
      }

      return results;
    } catch (err) {
      log.error('Failed to search sub-agent results:', err);
      return [];
    }
  }

  /**
   * 清理 7 天前的旧文件
   */
  async cleanExpired(): Promise<number> {
    try {
      const files = await readdir(this.baseDir);
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 3600 * 1000;
      let cleaned = 0;

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const dateStr = file.slice(0, 10); // YYYY-MM-DD
        const fileTime = new Date(dateStr).getTime();
        if (now - fileTime > sevenDaysMs) {
          await unlink(join(this.baseDir, file));
          cleaned++;
        }
      }

      if (cleaned > 0) log.info(`Cleaned ${cleaned} expired sub-agent result files`);
      return cleaned;
    } catch (err) {
      log.error('Failed to clean expired results:', err);
      return 0;
    }
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }
}
