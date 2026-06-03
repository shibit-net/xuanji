// ============================================================
// SSH 模块 — 类型定义
// ============================================================

import type { Client, SFTPWrapper } from 'ssh2';

export type SSHAuthType = 'password' | 'key' | 'agent';

export interface SSHAuth {
  /** 认证方式 (默认 key，兼容 SSH config 中的 IdentityFile) */
  type: SSHAuthType;
  /** 密码认证：加密后的密码密文 */
  encryptedPassword?: string;
  /** 密钥认证：PEM 格式私钥路径，默认 ~/.ssh/id_rsa */
  privateKeyPath?: string;
  /** 密钥认证：私钥 Passphrase（加密存储） */
  passphrase?: string;
  /** SSH Agent 路径，默认 SSH_AUTH_SOCK */
  agentSocket?: string;
}

export interface SSHHost {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth: SSHAuth;
  /** 是否验证 known_hosts (默认 true) */
  verifyHost: boolean;
  /** 连接超时 (ms, 默认 10000) */
  connectTimeout: number;
  /** SSH 握手超时 (ms, 默认 30000) */
  readyTimeout: number;
  /** Keepalive 间隔 (ms, 0=禁用, 默认 30000) */
  keepaliveInterval: number;
  /** 最大连接数 (默认 3) */
  maxConnections: number;
  /** 空闲超时 (ms, 默认 300000 = 5分钟) */
  idleTimeout: number;
  tags: string[];
}

export interface SSHConfig {
  enabled: boolean;
  execTimeout: number;
  chunkSize: number;
  sftpTimeout: number;
}

export enum ConnectionState {
  IDLE = 'idle',
  BUSY = 'busy',
  CONNECTING = 'connecting',
  DEAD = 'dead',
}

export interface PooledConnection {
  id: string;
  hostId: string;
  client: Client;
  state: ConnectionState;
  createdAt: number;
  lastUsedAt: number;
  sftp: SFTPWrapper | null;
}

export interface SSHExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

export interface SSHFileStat {
  type: 'file' | 'directory' | 'symlink' | 'other';
  name: string;
  size: number;
  modifyTime: number;
  accessTime: number;
  permissions: string;
  owner: number;
  group: number;
  relativePath: string;
}
