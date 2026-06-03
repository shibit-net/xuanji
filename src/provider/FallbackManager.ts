/**
 * FallbackManager — Provider 故障转移管理
 *
 * 当 provider 连续失败时，自动切换到备用 provider。
 */
import { logger } from '@/infrastructure/logger';
import type { FallbackConfig } from './types';

const log = logger.child({ module: 'FallbackManager' });

interface FallbackState {
  currentIndex: number;
  failureCount: number;
  maxFailures: number;
  cooldownUntil: number;
}

export class FallbackManager {
  private config: FallbackConfig | null = null;
  private state: FallbackState = { currentIndex: 0, failureCount: 0, maxFailures: 3, cooldownUntil: 0 };

  configure(config: FallbackConfig): void {
    this.config = config;
    this.state.maxFailures = config.maxRetries;
    this.state.currentIndex = 0;
    this.state.failureCount = 0;
  }

  onFailure(): string | null {
    this.state.failureCount++;

    if (this.state.failureCount >= this.state.maxFailures) {
      const next = this.selectNext();
      if (next) {
        log.warn(`Fallback triggered: switching to ${next.model} (${next.adapter})`);
        this.state.failureCount = 0;
        this.state.cooldownUntil = Date.now() + 30_000;
        return next.model;
      }
    }
    return null;
  }

  onSuccess(): void {
    this.state.failureCount = 0;
  }

  getCurrentProvider(): { adapter: string; model: string } | null {
    if (!this.config || this.config.providers.length === 0) return null;
    if (Date.now() < this.state.cooldownUntil) return null;
    const p = this.config.providers[this.state.currentIndex];
    return p ? { adapter: p.adapter, model: p.model } : null;
  }

  private selectNext(): { adapter: string; model: string } | null {
    if (!this.config || this.config.providers.length === 0) return null;
    if (this.config.strategy === 'round_robin') {
      this.state.currentIndex = (this.state.currentIndex + 1) % this.config.providers.length;
    } else {
      this.state.currentIndex = Math.min(this.state.currentIndex + 1, this.config.providers.length - 1);
    }
    const p = this.config.providers[this.state.currentIndex];
    if (!p) return null;
    return { adapter: p.adapter, model: p.model };
  }

  reset(): void {
    this.state = { currentIndex: 0, failureCount: 0, maxFailures: 3, cooldownUntil: 0 };
  }
}
