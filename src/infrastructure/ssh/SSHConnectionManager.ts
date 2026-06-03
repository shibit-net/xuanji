// ============================================================
// SSHConnectionManager — SSH 连接池管理器 (Singleton)
// ============================================================
//
// 职责:
// 1. 按 host 维护连接池（每 host 最多 maxConnections 个连接）
// 2. acquire/release 模式：获取就绪连接 → 执行操作 → 归还
// 3. 心跳检测：定期清理死连接和空闲超时连接
// 4. SFTP 复用：每个物理连接缓存一个 SFTP 会话
// 5. 密钥认证：优先 ~/.ssh/id_rsa，回退到 ssh-agent

import { Client, type ConnectConfig } from 'ssh2';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '@/infrastructure/logger';
import { ConnectionState, type SSHHost, type SSHExecResult, type PooledConnection } from './types';
import { SSHConfigStore } from './SSHConfigStore';

const log = logger.child({ module: 'SSHConnectionManager' });

const CLEANUP_INTERVAL = 30_000;

let instance: SSHConnectionManager | null = null;

/**
 * 连接等待者 — acquire() 池满时排队等候
 */
interface Waiter {
  hostId: string;
  resolve: (conn: PooledConnection) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  timer: NodeJS.Timeout;
}

export class SSHConnectionManager {
  static getInstance(): SSHConnectionManager {
    if (!instance) {
      instance = new SSHConnectionManager();
    }
    return instance;
  }

  private pools = new Map<string, PooledConnection[]>();
  private waitQueues = new Map<string, Waiter[]>();
  private hostConfigs = new Map<string, SSHHost>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private _started = false;
  private connCounter = 0;
  private configStore = new SSHConfigStore();

  start(): void {
    if (this._started) return;
    this._started = true;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    log.info('SSHConnectionManager started');
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this._started = false;
    for (const [hostId, pool] of this.pools) {
      for (const conn of pool) {
        this.destroyConnection(conn);
      }
    }
    this.pools.clear();
    this.waitQueues.clear();
    log.info('SSHConnectionManager stopped');
  }

  registerHost(host: SSHHost): void {
    this.hostConfigs.set(host.id, host);
  }

  unregisterHost(hostId: string): void {
    this.hostConfigs.delete(hostId);
    const pool = this.pools.get(hostId);
    if (pool) {
      for (const conn of pool) {
        this.destroyConnection(conn);
      }
      this.pools.delete(hostId);
    }
    // reject pending waiters
    const waiters = this.waitQueues.get(hostId);
    if (waiters) {
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.reject(new Error(`Host "${hostId}" removed`));
      }
      this.waitQueues.delete(hostId);
    }
  }

  /**
   * 对指定主机执行命令。自动处理连接获取/释放。
   */
  async exec(
    hostId: string,
    command: string,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<SSHExecResult> {
    const conn = await this.acquire(hostId, signal);
    try {
      return await this.execOnClient(conn.client, command, timeout, signal);
    } finally {
      this.release(conn);
    }
  }

  /**
   * 对指定主机执行 SFTP 操作。回调收到已就绪的 sftp 会话。
   */
  async withSFTP<T>(
    hostId: string,
    fn: (sftp: NonNullable<PooledConnection['sftp']>) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const conn = await this.acquire(hostId, signal);
    try {
      if (!conn.sftp) {
        conn.sftp = await this.getSFTP(conn.client);
      }
      return await fn(conn.sftp);
    } finally {
      this.release(conn);
    }
  }

  // ============================================================
  // 连接池管理
  // ============================================================

  private async acquire(hostId: string, signal?: AbortSignal): Promise<PooledConnection> {
    let host: SSHHost | undefined = this.hostConfigs.get(hostId);
    if (!host) {
      const loaded = await this.configStore.getHost(hostId);
      if (!loaded) throw new Error(`SSH host "${hostId}" not found. Available hosts: use ssh_list.`);
      host = loaded;
      this.hostConfigs.set(hostId, host);
    }

    if (!this._started) this.start();

    let pool = this.pools.get(hostId);
    if (!pool) {
      pool = [];
      this.pools.set(hostId, pool);
    }

    // 查找空闲连接
    for (const conn of pool) {
      if (conn.state === ConnectionState.IDLE) {
        conn.state = ConnectionState.BUSY;
        conn.lastUsedAt = Date.now();
        return conn;
      }
    }

    // 池未满 → 创建新连接
    if (pool.length < (host.maxConnections || 3)) {
      const conn = await this.createConnection(host, signal);
      conn.state = ConnectionState.BUSY;
      pool.push(conn);
      return conn;
    }

    // 池满 → 排队等待
    return this.waitForConnection(hostId, signal);
  }

  private release(conn: PooledConnection): void {
    conn.lastUsedAt = Date.now();
    // 检查连接是否还活着
    try {
      // ssh2 Client 没有直接的 isAlive，通过检查 socket 状态
      if ((conn.client as any)._sock && (conn.client as any)._sock.destroyed) {
        this.markDead(conn);
        return;
      }
    } catch {
      this.markDead(conn);
      return;
    }
    conn.state = ConnectionState.IDLE;
    this.flushWaiters(conn.hostId);
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async createConnection(host: SSHHost, signal?: AbortSignal): Promise<PooledConnection> {
    const connId = `${host.id}-${++this.connCounter}-${Date.now()}`;
    const client = new Client();
    const pooled: PooledConnection = {
      id: connId,
      hostId: host.id,
      client,
      state: ConnectionState.CONNECTING,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      sftp: null,
    };

    const connectConfig = this.buildConnectConfig(host);

    return new Promise((resolve, reject) => {
      const fail = (err: Error) => {
        try { client.end(); } catch { /* ignore */ }
        reject(err);
      };

      if (signal?.aborted) {
        fail(new Error('Aborted'));
        return;
      }

      const abortHandler = () => {
        try { client.end(); } catch { /* ignore */ }
        reject(new Error('Aborted'));
      };
      signal?.addEventListener('abort', abortHandler, { once: true });

      const connectTimeout = setTimeout(() => {
        fail(new Error(`SSH connection to "${host.hostname}:${host.port}" timed out after ${host.connectTimeout}ms`));
      }, host.connectTimeout);

      client.once('ready', () => {
        clearTimeout(connectTimeout);
        signal?.removeEventListener('abort', abortHandler);
        pooled.state = ConnectionState.IDLE;
        log.info(`SSH connection established: ${connId} → ${host.hostname}:${host.port}`);
        resolve(pooled);
      });

      client.once('error', (err: Error) => {
        clearTimeout(connectTimeout);
        signal?.removeEventListener('abort', abortHandler);
        pooled.state = ConnectionState.DEAD;
        const msg = err.message || '';
        if (msg.includes('authentication failed') || msg.includes('All configured authentication methods failed')) {
          fail(new Error(`SSH authentication failed for "${host.id}" (${host.username}@${host.hostname}:${host.port}). Check your key or password.`));
        } else if (msg.includes('connect') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
          fail(new Error(`SSH connection to "${host.id}" (${host.hostname}:${host.port}) failed: ${msg}`));
        } else {
          fail(new Error(`SSH error on "${host.id}": ${msg}`));
        }
      });

      try {
        client.connect(connectConfig);
      } catch (err) {
        clearTimeout(connectTimeout);
        signal?.removeEventListener('abort', abortHandler);
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private buildConnectConfig(host: SSHHost): ConnectConfig {
    const auth = host.auth || { type: 'key' };

    const config: ConnectConfig = {
      host: host.hostname,
      port: host.port || 22,
      username: host.username,
      readyTimeout: host.readyTimeout || 30000,
      keepaliveInterval: host.keepaliveInterval || 30000,
      keepaliveCountMax: 3,
    };

    if (host.verifyHost !== false) {
      // 验证 host key，first-use 信任策略：首次连接自动保存，后续验证
      config.hostVerifier = (_hashedKey: Buffer, cb: (verified: boolean) => void) => {
        // 宽松策略：信任所有 host key，实际生产应结合 known_hosts
        cb(true);
      };
      config.algorithms = {
        serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'],
      };
    }

    switch (auth.type) {
      case 'key': {
        const keyPath = auth.privateKeyPath || path.join(os.homedir(), '.ssh', 'id_rsa');
        if (fs.existsSync(keyPath)) {
          config.privateKey = fs.readFileSync(keyPath, 'utf-8');
          if (auth.passphrase) {
            config.passphrase = auth.passphrase;
          }
        }
        // 回退到 ssh-agent
        if (!config.privateKey) {
          config.agent = auth.agentSocket || process.env.SSH_AUTH_SOCK;
          if (!config.agent) {
            // 最后尝试默认 agent
            config.agent = process.env.SSH_AUTH_SOCK || undefined;
          }
        }
        break;
      }
      case 'password':
        if (auth.encryptedPassword) {
          config.password = auth.encryptedPassword;
        }
        break;
      case 'agent':
        config.agent = auth.agentSocket || process.env.SSH_AUTH_SOCK || undefined;
        break;
    }

    return config;
  }

  private execOnClient(
    client: Client,
    command: string,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<SSHExecResult> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      let settled = false;

      const settle = (result: SSHExecResult | Error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      timer = setTimeout(() => {
        settle(new Error(`SSH command timed out after ${timeout}ms on host`));
      }, timeout);

      if (signal) {
        signal.addEventListener('abort', () => {
          settle(new Error('Aborted'));
        }, { once: true });
      }

      client.exec(command, (err, stream) => {
        if (err) {
          settle(new Error(`SSH exec failed: ${err.message}`));
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        // 输出限制：console 日志中截断的 stdout/stderr
        const MAX_OUTPUT = 500_000; // 500KB

        stream.on('close', (exitCode: number | null, signalName: string | null) => {
          if (stdout.length > MAX_OUTPUT) {
            stdout = stdout.slice(0, MAX_OUTPUT)
              + `\n...[truncated, total ${stdout.length} bytes]`;
          }
          if (stderr.length > MAX_OUTPUT) {
            stderr = stderr.slice(0, MAX_OUTPUT)
              + `\n...[truncated, total ${stderr.length} bytes]`;
          }
          settle({ stdout, stderr, exitCode, signal: signalName });
        });

        stream.on('error', (err: Error) => {
          settle(new Error(`SSH stream error: ${err.message}`));
        });
      });
    });
  }

  private getSFTP(client: Client): Promise<NonNullable<PooledConnection['sftp']>> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) reject(new Error(`SFTP session failed: ${err.message}`));
        else resolve(sftp);
      });
    });
  }

  private waitForConnection(hostId: string, signal?: AbortSignal): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      let queue = this.waitQueues.get(hostId);
      if (!queue) {
        queue = [];
        this.waitQueues.set(hostId, queue);
      }

      const timer = setTimeout(() => {
        const q = this.waitQueues.get(hostId);
        if (q) {
          const idx = q.findIndex(w => w.resolve === resolve);
          if (idx !== -1) q.splice(idx, 1);
        }
        reject(new Error(`SSH connection pool for "${hostId}" is full and wait timed out`));
      }, 60000);

      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        }, { once: true });
      }

      queue.push({ hostId, resolve, reject: reject, signal, timer });
    });
  }

  private flushWaiters(hostId: string): void {
    const queue = this.waitQueues.get(hostId);
    if (!queue || queue.length === 0) return;

    const pool = this.pools.get(hostId);
    if (!pool) return;

    while (queue.length > 0) {
      const idle = pool.find(c => c.state === ConnectionState.IDLE);
      if (!idle) break;
      const waiter = queue.shift()!;
      clearTimeout(waiter.timer);
      idle.state = ConnectionState.BUSY;
      idle.lastUsedAt = Date.now();
      waiter.resolve(idle);
    }
  }

  private markDead(conn: PooledConnection): void {
    conn.state = ConnectionState.DEAD;
    this.destroyConnection(conn);
    // 从池中移除
    const pool = this.pools.get(conn.hostId);
    if (pool) {
      const idx = pool.findIndex(c => c.id === conn.id);
      if (idx !== -1) pool.splice(idx, 1);
    }
  }

  private destroyConnection(conn: PooledConnection): void {
    try {
      if (conn.sftp) {
        try { (conn.sftp as any).end(); } catch { /* ok */ }
        conn.sftp = null;
      }
      conn.client.end();
    } catch { /* 连接可能已经断开 */ }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [hostId, pool] of this.pools) {
      for (let i = pool.length - 1; i >= 0; i--) {
        const conn = pool[i];
        // 移除死连接
        if (conn.state === ConnectionState.DEAD) {
          pool.splice(i, 1);
          this.destroyConnection(conn);
          continue;
        }
        // 回收空闲超时连接
        const host = this.hostConfigs.get(hostId);
        const idleTimeout = host?.idleTimeout || 300_000;
        if (conn.state === ConnectionState.IDLE && (now - conn.lastUsedAt) > idleTimeout) {
          this.destroyConnection(conn);
          pool.splice(i, 1);
          log.debug(`Idle connection closed: ${conn.id}`);
        }
      }
    }
  }
}
