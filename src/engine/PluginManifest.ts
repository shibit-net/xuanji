// src/engine/PluginManifest.ts
export interface PluginManifestEntry {
  id: string;
  version: string;
  dependencies: string[];
}

export const DEFAULT_MANIFEST: PluginManifestEntry[] = [
  { id: 'memory',    version: '1.0.0', dependencies: [] },
  { id: 'provider',  version: '1.0.0', dependencies: [] },
  { id: 'permission',version: '1.0.0', dependencies: [] },
  { id: 'tools',     version: '1.0.0', dependencies: ['permission'] },
  { id: 'session',   version: '1.0.0', dependencies: ['memory'] },
  { id: 'agent',     version: '1.0.0', dependencies: ['memory', 'tools', 'provider', 'session'] },
  { id: 'mcp',       version: '1.0.0', dependencies: ['tools', 'permission'] },
  { id: 'skills',    version: '1.0.0', dependencies: ['tools'] },
  { id: 'platform',  version: '1.0.0', dependencies: ['provider'] },
];
