/**
 * CredentialManager — Token 持久化 + 自动刷新
 *
 * 设计文档：docs/platform-integration-design.md §12.1
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'CredentialManager' });

interface TokenEntry {
  platform: string;
  token: string;
  expiresAt: number;
  refreshToken?: string;
}

export class CredentialManager extends EventEmitter {
  private tokens = new Map<string, TokenEntry>();
  private persistPath: string | null = null;

  // ── 磁盘持久化路径（由 PlatformRouter 在构造时注入）────────

  setPersistPath(filePath: string): void {
    this.persistPath = filePath;
    // 路径设置后立即加载已持久化的 token
    this.loadFromDisk();
  }

  // ── 磁盘读写 ────────────────────────────────────────────

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.tokens.entries()).map(([, entry]) => entry);
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
    } catch (err) {
      log.error(`Failed to save credentials: ${(err as Error).message}`);
    }
  }

  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (existsSync(this.persistPath)) {
        const raw = readFileSync(this.persistPath, 'utf-8');
        const entries: TokenEntry[] = JSON.parse(raw);
        for (const entry of entries) {
          // 仅加载未过期的 token
          if (entry.expiresAt > Date.now()) {
            this.tokens.set(entry.platform, entry);
            log.info(`Loaded credential for ${entry.platform}`);
          }
        }
      }
    } catch (err) {
      log.warn(`Failed to load credentials: ${(err as Error).message}`);
    }
  }

  // ── Token 存储 ──────────────────────────────────────────

  async storeToken(platform: string, token: string, expiresInSeconds: number): Promise<void> {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    this.tokens.set(platform, { platform, token, expiresAt });
    log.debug(`Token stored for ${platform}, expires in ${expiresInSeconds}s`);
    this.saveToDisk();
  }

  async getToken(platform: string): Promise<string> {
    const entry = this.tokens.get(platform);
    if (!entry) throw new Error(`No token for platform: ${platform}`);

    // 过期前 5 分钟刷新
    if (Date.now() + 300_000 > entry.expiresAt) {
      log.info(`Token for ${platform} expiring soon, refreshing...`);
      await this.refreshToken(platform);
    }

    return this.tokens.get(platform)!.token;
  }

  hasToken(platform: string): boolean {
    const entry = this.tokens.get(platform);
    return !!entry && Date.now() < entry.expiresAt;
  }

  clearToken(platform: string): void {
    this.tokens.delete(platform);
    this.saveToDisk();
  }

  // ── Token 配置（供适配器注册刷新方法）─────────────────────

  private refreshers = new Map<string, () => Promise<{ token: string; expiresIn: number }>>();

  registerRefresher(
    platform: string,
    refresher: () => Promise<{ token: string; expiresIn: number }>,
  ): void {
    this.refreshers.set(platform, refresher);
  }

  private async refreshToken(platform: string): Promise<void> {
    const refresher = this.refreshers.get(platform);
    if (!refresher) {
      log.warn(`No refresher registered for ${platform}`);
      return;
    }

    let lastError: Error | null = null;
    for (let i = 0; i < 3; i++) {
      try {
        const { token, expiresIn } = await refresher();
        await this.storeToken(platform, token, expiresIn);
        log.info(`Token refreshed for ${platform}`);
        return;
      } catch (err) {
        lastError = err as Error;
        log.warn(`Token refresh failed for ${platform} (attempt ${i + 1}/3): ${lastError.message}`);
        if (i < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }

    // 3 次都失败
    if (platform === 'wechat') {
      this.tokens.delete(platform);
      this.saveToDisk();
      this.emit('re-auth-required', platform);
      log.error(`WeChat token refresh failed, re-auth required`);
    } else {
      this.emit('token-refresh-failed', platform, lastError);
      log.error(`Token refresh failed for ${platform} after 3 attempts`);
    }
  }

  // ── 获取各平台过期信息 ────────────────────────────────────

  getTokenStatus(platform: string): { hasToken: boolean; expiresAt?: number } {
    const entry = this.tokens.get(platform);
    if (!entry) return { hasToken: false };
    return { hasToken: true, expiresAt: entry.expiresAt };
  }
}
