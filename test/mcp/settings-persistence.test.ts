import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MCPSettingsPersistence } from '../../src/mcp/config/settings-persistence';
import { MCPServerConfig } from '../../src/mcp/types';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

/**
 * Each test gets its own config file to ensure isolation.
 */
function makePersistence(): { persistence: MCPSettingsPersistence; configPath: string } {
  const id = randomUUID().slice(0, 8);
  const configPath = path.join(os.homedir(), '.xuanji', `mcp-test-${id}.json`);
  return { persistence: new MCPSettingsPersistence(configPath), configPath };
}

describe('MCPSettingsPersistence', () => {
  describe('load/save lifecycle', () => {
    it('returns empty list when file does not exist', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        const servers = await persistence.listServers();
        expect(servers).toEqual([]);
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });

    it('persists and reloads servers', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        const server: MCPServerConfig = {
          name: 'test-server',
          command: 'node',
          args: ['server.js'],
          env: { NODE_ENV: 'test' },
        };
        await persistence.addServer(server);
        const servers = await persistence.listServers();
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe('test-server');
        expect(servers[0].command).toBe('node');

        // Verify file exists and contains the data
        const raw = await fs.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        expect(parsed.servers).toHaveLength(1);
        expect(parsed.servers[0].name).toBe('test-server');
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });
  });

  describe('addServer', () => {
    it('adds new server', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        const s1: MCPServerConfig = { name: 'alpha', command: 'cmd1' };
        await persistence.addServer(s1);
        const servers = await persistence.listServers();
        expect(servers.map(s => s.name)).toEqual(['alpha']);
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });

    it('updates existing server with same name', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        const s1: MCPServerConfig = { name: 'beta', command: 'cmd1' };
        await persistence.addServer(s1);
        const s2: MCPServerConfig = { name: 'beta', command: 'cmd2', args: ['--verbose'] };
        await persistence.addServer(s2);
        const servers = await persistence.listServers();
        expect(servers).toHaveLength(1);
        expect(servers[0].command).toBe('cmd2');
        expect(servers[0].args).toEqual(['--verbose']);
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });
  });

  describe('removeServer', () => {
    it('returns false when server not found', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        // Pre-populate one server so file exists
        await persistence.addServer({ name: 'keep', command: 'k' });
        const result = await persistence.removeServer('nope');
        expect(result).toBe(false);
        const servers = await persistence.listServers();
        expect(servers).toHaveLength(1);
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });

    it('removes existing server and returns true', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        await persistence.addServer({ name: 'to-remove', command: 'rm' });
        const result = await persistence.removeServer('to-remove');
        expect(result).toBe(true);
        const servers = await persistence.listServers();
        expect(servers).toHaveLength(0);
        // File should still exist but with empty servers
        const raw = await fs.readFile(configPath, 'utf-8');
        expect(JSON.parse(raw).servers).toEqual([]);
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });
  });

  describe('getServer', () => {
    it('returns undefined for missing server', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        await persistence.addServer({ name: 'exists', command: 'e' });
        const server = await persistence.getServer('missing');
        expect(server).toBeUndefined();
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });

    it('returns the matching server', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        await persistence.addServer({ name: 'found', command: 'found-cmd' });
        const server = await persistence.getServer('found');
        expect(server).toBeDefined();
        expect(server!.command).toBe('found-cmd');
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });
  });

  describe('clearCache', () => {
    it('forces re-read from disk', async () => {
      const { persistence, configPath } = makePersistence();
      try {
        await persistence.addServer({ name: 'cached', command: 'v1' });
        expect(await persistence.listServers()).toHaveLength(1);

        // Tamper with file directly (bypass cache)
        const raw = await fs.readFile(configPath, 'utf-8');
        const data = JSON.parse(raw);
        data.servers.push({ name: 'external', command: 'ext' });
        await fs.writeFile(configPath, JSON.stringify(data, null, 2));

        persistence.clearCache();
        const servers = await persistence.listServers();
        expect(servers).toHaveLength(2);
        expect(servers.map(s => s.name)).toContain('external');
      } finally {
        try { await fs.unlink(configPath); } catch {}
      }
    });
  });
});
