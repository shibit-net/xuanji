// ============================================================
// SSHConfigStore — SSH 主机配置持久化
// ============================================================
//
// 存储位置: ~/.xuanji/ssh/hosts.json (mode 0o600)
// 与 config.json 分离，支持动态增删，密码在文件中加密存储

import * as path from 'node:path';
import * as fs from 'node:fs';
import { getXuanjiRoot } from '@/core/config/PathManager';
import { SSHCrypto } from './SSHCrypto';
import type { SSHHost } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SSHConfigStore' });

interface HostsFile {
  version: 1;
  hosts: SSHHost[];
}

export class SSHConfigStore {
  private filePath: string;

  constructor() {
    const dir = path.join(getXuanjiRoot(), 'ssh');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    this.filePath = path.join(dir, 'hosts.json');
  }

  async loadHosts(): Promise<SSHHost[]> {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data: HostsFile = JSON.parse(raw);
      return this.decryptHosts(data.hosts || []);
    } catch {
      // 文件不存在或格式错误 → 返回空列表
      return [];
    }
  }

  async saveHosts(hosts: SSHHost[]): Promise<void> {
    const toSave = this.encryptHosts(hosts);
    const data: HostsFile = { version: 1, hosts: toSave };
    const json = JSON.stringify(data, null, 2);
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
  }

  async getHost(id: string): Promise<SSHHost | null> {
    const hosts = await this.loadHosts();
    return hosts.find(h => h.id === id) || null;
  }

  async addHost(host: SSHHost): Promise<void> {
    const hosts = await this.loadHosts();
    if (hosts.some(h => h.id === host.id)) {
      throw new Error(`Host "${host.id}" already exists`);
    }
    hosts.push(host);
    await this.saveHosts(hosts);
    log.info(`SSH host added: ${host.id} (${host.hostname}:${host.port})`);
  }

  async removeHost(id: string): Promise<void> {
    const hosts = await this.loadHosts();
    const idx = hosts.findIndex(h => h.id === id);
    if (idx === -1) throw new Error(`Host "${id}" not found`);
    hosts.splice(idx, 1);
    await this.saveHosts(hosts);
    // 清理关联的私钥文件
    const keyPath = path.join(getXuanjiRoot(), 'ssh', 'keys', `${id}_key`);
    if (fs.existsSync(keyPath)) {
      // 覆写后删除，防止数据恢复
      const buf = Buffer.alloc(4096, 0);
      try { fs.writeFileSync(keyPath, buf); } catch { /* ok */ }
      try { fs.unlinkSync(keyPath); } catch { /* ok */ }
    }
    log.info(`SSH host removed: ${id}`);
  }

  async updateHost(id: string, partial: Partial<SSHHost>): Promise<void> {
    const hosts = await this.loadHosts();
    const idx = hosts.findIndex(h => h.id === id);
    if (idx === -1) throw new Error(`Host "${id}" not found`);
    hosts[idx] = { ...hosts[idx], ...partial };
    await this.saveHosts(hosts);
  }

  private decryptHosts(hosts: SSHHost[]): SSHHost[] {
    return hosts.map(h => ({
      ...h,
      auth: {
        ...h.auth,
        encryptedPassword: h.auth.encryptedPassword && SSHCrypto.isEncrypted(h.auth.encryptedPassword)
          ? SSHCrypto.decrypt(h.auth.encryptedPassword)
          : h.auth.encryptedPassword,
        passphrase: h.auth.passphrase && SSHCrypto.isEncrypted(h.auth.passphrase)
          ? SSHCrypto.decrypt(h.auth.passphrase)
          : h.auth.passphrase,
      },
    }));
  }

  private encryptHosts(hosts: SSHHost[]): SSHHost[] {
    return hosts.map(h => ({
      ...h,
      auth: {
        ...h.auth,
        encryptedPassword: h.auth.encryptedPassword && !SSHCrypto.isEncrypted(h.auth.encryptedPassword)
          ? SSHCrypto.encrypt(h.auth.encryptedPassword)
          : h.auth.encryptedPassword,
        passphrase: h.auth.passphrase && !SSHCrypto.isEncrypted(h.auth.passphrase)
          ? SSHCrypto.encrypt(h.auth.passphrase)
          : h.auth.passphrase,
      },
    }));
  }
}
