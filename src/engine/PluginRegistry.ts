// src/engine/PluginRegistry.ts
import type { IPlugin, PluginContext } from '@/shared/plugin';
import type { PluginEntry } from './types';

export class PluginRegistry<TMap extends Record<string, unknown> = Record<string, unknown>> {
  private plugins = new Map<string, PluginEntry>();

  register<K extends keyof TMap & string>(plugin: IPlugin<TMap[K]>): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" already registered`);
    }
    this.plugins.set(plugin.id, {
      plugin: plugin as IPlugin<unknown>,
      status: 'registered',
      ctx: null!,
    });
  }

  get<K extends keyof TMap & string>(id: K): IPlugin<TMap[K]> | undefined {
    return this.plugins.get(id)?.plugin as IPlugin<TMap[K]> | undefined;
  }

  getCapabilities<K extends keyof TMap & string>(id: K): TMap[K] | undefined {
    const entry = this.plugins.get(id);
    if (!entry || entry.status !== 'started') return undefined;
    return entry.plugin.getCapabilities() as TMap[K];
  }

  list(): string[] {
    return Array.from(this.plugins.keys());
  }

  setContext(id: string, ctx: PluginContext): void {
    const entry = this.plugins.get(id);
    if (entry) entry.ctx = ctx;
  }

  updateStatus(id: string, status: PluginEntry['status']): void {
    const entry = this.plugins.get(id);
    if (entry) entry.status = status;
  }
}
