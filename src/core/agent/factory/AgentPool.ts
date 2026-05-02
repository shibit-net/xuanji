import { logger } from '@/core/logger';
import type { AgentLoop } from '@/core/agent/AgentLoop';

const log = logger.child({ module: 'AgentPool' });

interface PooledAgent {
  agent: AgentLoop;
  inUse: boolean;
  lastUsed: number;
}

export class AgentPool {
  private pool = new Map<string, PooledAgent>();
  private maxSize: number;
  private maxIdleMs: number;

  constructor(maxSize = 10, maxIdleMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.maxIdleMs = maxIdleMs;
  }

  acquire(agentId: string, factory: () => AgentLoop): AgentLoop {
    const entry = this.pool.get(agentId);
    if (entry && !entry.inUse) {
      entry.inUse = true;
      entry.lastUsed = Date.now();
      return entry.agent;
    }

    if (this.pool.size >= this.maxSize) this.evictOne();

    const agent = factory();
    this.pool.set(agentId, { agent, inUse: true, lastUsed: Date.now() });
    return agent;
  }

  release(agentId: string): void {
    const entry = this.pool.get(agentId);
    if (entry) entry.inUse = false;
  }

  evictIdle(): void {
    const now = Date.now();
    for (const [key, entry] of this.pool) {
      if (!entry.inUse && now - entry.lastUsed > this.maxIdleMs) {
        this.pool.delete(key);
        log.debug(`Evicted idle agent: ${key}`);
      }
    }
  }

  abortAll(): void {
    for (const [, entry] of this.pool) {
      try { entry.agent.stop(); } catch { /* ignore */ }
    }
    this.pool.clear();
  }

  private evictOne(): void {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, entry] of this.pool) {
      if (!entry.inUse && entry.lastUsed < oldestTime) {
        oldestKey = key;
        oldestTime = entry.lastUsed;
      }
    }
    if (oldestKey) this.pool.delete(oldestKey);
  }

  get size(): number { return this.pool.size; }
}
