// ============================================================
// SSHCrypto — 密码 AES-256-GCM 加解密
// ============================================================
//
// 密钥从 machineId (hostname + username) 通过 PBKDF2 派生，
// 加密数据绑定当前机器，配置拷贝到其他机器无法解密。
// 如需更高安全性，建议使用 SSH 密钥认证 (type: 'key')。

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'xuanji-ssh-v1';
const KEY_ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class SSHCrypto {
  private static machineKey: Buffer | null = null;

  private static getKey(): Buffer {
    if (!this.machineKey) {
      const machineId = hostname() + '-' + (process.env.USER || process.env.USERNAME || 'default');
      this.machineKey = pbkdf2Sync(machineId, SALT, KEY_ITERATIONS, KEY_LENGTH, 'sha256');
    }
    return this.machineKey;
  }

  static encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64url')}:${encrypted.toString('base64url')}:${authTag.toString('base64url')}`;
  }

  static decrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const [ivB64, ctB64, tagB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const ct = Buffer.from(ctB64, 'base64url');
    const authTag = Buffer.from(tagB64, 'base64url');
    const decipher = createDecipheriv(ALGORITHM, this.getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
    return decrypted.toString('utf-8');
  }

  static isEncrypted(value: string): boolean {
    const parts = value.split(':');
    return parts.length === 3 && parts.every(p => {
      try { Buffer.from(p, 'base64url'); return true; } catch { return false; }
    });
  }
}
