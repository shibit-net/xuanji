// ============================================================
// 用户认证 — Cookie 管理（tough-cookie 封装）
// ============================================================

import { CookieJar, Cookie } from 'tough-cookie';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EncryptionService } from './EncryptionService';

export class CookieManager {
  private jar: CookieJar;

  constructor(
    private storePath: string,
    private encryption: EncryptionService,
  ) {
    this.jar = new CookieJar();
    this.load();
  }

  /** 获取指定 URL 的 Cookie header 值 */
  getCookieHeader(url: string): string {
    return this.jar.getCookieStringSync(url);
  }

  /** 从响应 headers 中提取并保存 Set-Cookie */
  setCookies(url: string, headers: Headers): void {
    const setCookieHeaders = headers.getSetCookie?.() ?? [];
    for (const raw of setCookieHeaders) {
      try {
        const cookie = Cookie.parse(raw);
        if (cookie) {
          this.jar.setCookieSync(cookie, url);
        }
      } catch {
        // 忽略解析失败的 Cookie
      }
    }
    this.save();
  }

  /** 清除所有 Cookie 并删除存储文件 */
  clear(): void {
    this.jar = new CookieJar();
    try {
      if (existsSync(this.storePath)) {
        const { unlinkSync } = require('node:fs') as typeof import('node:fs');
        unlinkSync(this.storePath);
      }
    } catch {
      // 忽略删除失败
    }
  }

  /** 从加密文件加载 Cookie */
  private load(): void {
    if (!existsSync(this.storePath)) return;

    try {
      const encrypted = readFileSync(this.storePath, 'utf-8');
      const json = this.encryption.decrypt(encrypted);
      const cookies = JSON.parse(json) as Array<{ url: string; cookie: string }>;

      for (const entry of cookies) {
        try {
          const cookie = Cookie.parse(entry.cookie);
          if (cookie) {
            this.jar.setCookieSync(cookie, entry.url);
          }
        } catch {
          // 跳过无效条目
        }
      }
    } catch {
      // 解密失败（密钥变更等），清除旧文件
      this.jar = new CookieJar();
    }
  }

  /** 加密保存 Cookie 到文件（权限 600） */
  private save(): void {
    try {
      const serialized = this.jar.serializeSync();
      const cookies = serialized?.cookies ?? [];
      const entries = cookies.map(c => ({
        url: `${c.secure ? 'https' : 'http'}://${c.domain ?? 'unknown'}${c.path ?? '/'}`,
        cookie: Cookie.fromJSON(c)?.toString() ?? '',
      })).filter(e => e.cookie);

      const json = JSON.stringify(entries);
      const encrypted = this.encryption.encrypt(json);

      const dir = dirname(this.storePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.storePath, encrypted, 'utf-8');
      try {
        chmodSync(this.storePath, 0o600);
      } catch {
        // Windows 等平台忽略
      }
    } catch {
      // 序列化失败时静默处理
    }
  }
}
