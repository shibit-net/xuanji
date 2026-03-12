// ============================================================
// 用户认证 — AES-256-GCM 加密服务
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { dirname } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 10000;
const PBKDF2_SALT = 'xuanji-auth-salt';

export class EncryptionService {
  private key: Buffer;

  constructor(private keyPath: string) {
    this.key = this.loadOrGenerateKey();
  }

  /** 加密字符串，返回 base64 编码的密文 */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // 格式: iv(12) + encrypted(N) + authTag(16) → base64
    return Buffer.concat([iv, encrypted, authTag]).toString('base64');
  }

  /** 解密 base64 编码的密文 */
  decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('密文格式无效');
    }

    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf-8');
  }

  /** 加载或生成机器密钥 */
  private loadOrGenerateKey(): Buffer {
    if (existsSync(this.keyPath)) {
      try {
        const hex = readFileSync(this.keyPath, 'utf-8').trim();
        const key = Buffer.from(hex, 'hex');
        if (key.length === KEY_LENGTH) return key;
      } catch {
        // 密钥文件损坏，重新生成
      }
    }

    const key = EncryptionService.generateMachineKey();
    this.saveKey(key);
    return key;
  }

  /** 基于机器硬件信息生成密钥 */
  static generateMachineKey(): Buffer {
    const mac = getMacAddress();
    const host = hostname();
    const seed = `${mac}:${host}`;

    return pbkdf2Sync(seed, PBKDF2_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  }

  /** 保存密钥文件（权限 400） */
  private saveKey(key: Buffer): void {
    const dir = dirname(this.keyPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.keyPath, key.toString('hex'), 'utf-8');
    try {
      chmodSync(this.keyPath, 0o400);
    } catch {
      // Windows 等平台 chmod 可能不支持
    }
  }
}

/** 获取第一个非 loopback 网卡的 MAC 地址 */
function getMacAddress(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
        return addr.mac;
      }
    }
  }
  return 'unknown-mac';
}
