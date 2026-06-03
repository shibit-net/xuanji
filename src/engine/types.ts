// src/engine/types.ts
import type { IPlugin, PluginContext } from '@/shared/plugin';

export type { IPlugin, PluginContext };

export interface PluginEntry<T = unknown> {
  plugin: IPlugin<T>;
  status: 'registered' | 'initialized' | 'started' | 'stopped';
  ctx: PluginContext;
}
