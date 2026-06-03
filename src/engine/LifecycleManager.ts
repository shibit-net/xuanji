// src/engine/LifecycleManager.ts
import type { IPlugin, PluginContext } from '@/shared/plugin';
import { PluginRegistry } from './PluginRegistry';
import { MessageRouter } from './MessageRouter';
import { eventBus } from '@/infrastructure/events/EventBus';
import { getConfigManager } from '@/infrastructure/config/ConfigManager';
import { DEFAULT_MANIFEST, type PluginManifestEntry } from './PluginManifest';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'LifecycleManager' });

export class LifecycleManager {
  private registry = new PluginRegistry();
  private router = new MessageRouter();
  private plugins: IPlugin[] = [];
  private manifest: PluginManifestEntry[];
  private configStore = new Map<string, unknown>();

  constructor(manifest?: PluginManifestEntry[]) {
    this.manifest = manifest ?? DEFAULT_MANIFEST;
  }

  register(plugin: IPlugin): void {
    this.plugins.push(plugin);
    this.registry.register(plugin);
  }

  async start(): Promise<void> {
    const order = this.topologicalSort();

    for (const id of order) {
      const plugin = this.plugins.find(p => p.id === id);
      if (!plugin) continue;

      // 尝试从 ConfigManager 加载配置到本地 configStore
      const cfg = getConfigManager();
      try {
        const agentConfig = cfg.getAgentConfig(id);
        if (agentConfig) {
          this.configStore.set(id, agentConfig);
        }
      } catch {
        // ConfigManager 未初始化时静默跳过
      }

      const ctx: PluginContext = {
        router: this.router,
        eventBus: {
          emit: (e, p) => eventBus.emit(e as any, p as any),
          on: (e, h) => eventBus.on(e as any, h as any),
        },
        config: {
          get: <T>(key: string): T | undefined => this.configStore.get(key) as T | undefined,
          set: (key: string, value: unknown) => { this.configStore.set(key, value); },
        },
      };

      this.registry.setContext(id, ctx);

      await plugin.init(ctx);
      this.registry.updateStatus(id, 'initialized');
      log.info(`Plugin "${id}" initialized`);

      await plugin.start();
      this.registry.updateStatus(id, 'started');
      log.info(`Plugin "${id}" started`);
    }
  }

  async stop(): Promise<void> {
    const order = this.topologicalSort().reverse();
    for (const id of order) {
      const plugin = this.plugins.find(p => p.id === id);
      if (plugin) {
        await plugin.stop();
        this.registry.updateStatus(id, 'stopped');
      }
    }
  }

  getRegistry(): PluginRegistry {
    return this.registry;
  }

  getRouter(): MessageRouter {
    return this.router;
  }

  private topologicalSort(): string[] {
    const entryMap = new Map<string, PluginManifestEntry>();
    for (const e of this.manifest) entryMap.set(e.id, e);

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Circular dependency detected at: ${id}`);
      visiting.add(id);
      const entry = entryMap.get(id);
      if (entry) {
        for (const dep of entry.dependencies) visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      result.push(id);
    };

    for (const entry of this.manifest) visit(entry.id);
    return result;
  }
}
