/**
 * ConfigManager — 多用户隔离配置管理器
 *
 * 使用项目根目录下的 .xuanji/ 存储所有配置（与 PathManager 一致）。
 * 配置模板仅用于新用户首次初始化，不覆盖已有配置。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '@/core/logger';
import { getXuanjiRoot, getTemplateRoot } from './PathManager';
import type { UserSettings, SystemConfig, AgentConfig } from './types';

export type { UserSettings, SystemConfig, AgentConfig };

const log = logger.child({ module: 'ConfigManager' });

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('/desktop') || cwd.endsWith('\\desktop')) {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

export class ConfigManager {
  private userId: string | null = null;
  private userConfigDir: string = '';
  private systemConfigDir: string;
  private templateDir: string;
  private userSettings: UserSettings | null = null;
  private systemConfig: SystemConfig | null = null;

  constructor() {
    const base = getXuanjiRoot();
    this.systemConfigDir = path.join(base, 'system');
    this.templateDir = getTemplateRoot();
  }

  async initForUser(userId: string): Promise<void> {
    this.userId = userId;
    this.userConfigDir = path.join(getXuanjiRoot(), 'users', userId);

    for (const dir of [
      this.userConfigDir,
      path.join(this.userConfigDir, 'agents'),
      path.join(this.userConfigDir, 'prompts'),
    ]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    await this.syncMissingFromTemplate();
    this.userSettings = this.loadUserSettings();
    this.systemConfig = this.loadSystemConfig();

    log.info(`ConfigManager initialized for user: ${userId}`);
  }

  private requireUser(): string {
    if (!this.userId) throw new Error('ConfigManager not initialized. Call initForUser() first.');
    return this.userId;
  }

  getUserId(): string | null { return this.userId; }
  isLoaded(): boolean { return this.userId !== null; }

  // === User Config (per-user, isolated) ===

  getAgentConfigs(): AgentConfig[] {
    this.requireUser();
    const agentsDir = path.join(this.userConfigDir, 'agents');
    if (!fs.existsSync(agentsDir)) return [];

    return fs.readdirSync(agentsDir)
      .filter(f => f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml'))
      .map(f => {
        try {
          const content = fs.readFileSync(path.join(agentsDir, f), 'utf-8');
          return f.endsWith('.json') ? JSON.parse(content) : this.parseSimpleYaml(content);
        } catch { return null; }
      })
      .filter((c): c is AgentConfig => c !== null);
  }

  getAgentConfig(agentId: string): AgentConfig | null {
    return this.getAgentConfigs().find(c => c.id === agentId) ?? null;
  }

  async saveAgentConfig(agentId: string, config: AgentConfig): Promise<void> {
    this.requireUser();
    const agentsDir = path.join(this.userConfigDir, 'agents');
    if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, `${agentId}.json`), JSON.stringify(config, null, 2), 'utf-8');
    log.info(`Agent config saved: ${agentId}`);
  }

  async deleteAgentConfig(agentId: string): Promise<void> {
    this.requireUser();
    const fp = path.join(this.userConfigDir, 'agents', `${agentId}.json`);
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); log.info(`Agent config deleted: ${agentId}`); }
  }

  getSettings(): UserSettings {
    this.requireUser();
    if (!this.userSettings) this.userSettings = this.loadUserSettings();
    return this.userSettings!;
  }

  async updateSettings(patch: Partial<UserSettings>): Promise<void> {
    this.requireUser();
    const updated = { ...this.getSettings(), ...patch };
    fs.writeFileSync(path.join(this.userConfigDir, 'settings.json'), JSON.stringify(updated, null, 2), 'utf-8');
    this.userSettings = updated;
    log.info('User settings updated');
  }

  getProviderConfig(agentId?: string) {
    const settings = this.getSettings();
    const key = agentId ?? settings.defaultProvider;
    const provider = settings.providers[key];
    if (!provider) throw new Error(`Provider "${key}" not configured.`);
    return provider;
  }

  getEmbeddingConfig(): AgentConfig | null {
    return this.getAgentConfigs().find(c => c.type === 'embedding' && c.enabled !== false) ?? null;
  }

  // === System Config (global) ===

  getSystemConfig(): SystemConfig {
    if (!this.systemConfig) this.systemConfig = this.loadSystemConfig();
    return this.systemConfig!;
  }

  async updateSystemConfig(patch: Partial<SystemConfig>): Promise<void> {
    const updated = { ...this.getSystemConfig(), ...patch };
    if (!fs.existsSync(this.systemConfigDir)) fs.mkdirSync(this.systemConfigDir, { recursive: true });
    fs.writeFileSync(path.join(this.systemConfigDir, 'settings.json'), JSON.stringify(updated, null, 2), 'utf-8');
    this.systemConfig = updated;
  }

  // === Config Watching ===

  watchUserConfig(handler: (filePath: string) => void): () => void {
    this.requireUser();
    let watcher: fs.FSWatcher | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    try {
      watcher = fs.watch(this.userConfigDir, { recursive: true }, (_eventType, filename) => {
        if (filename) {
          handler(path.join(this.userConfigDir, filename));
        }
      });
    } catch {
      log.warn('watchUserConfig: fs.watch not available, using polling fallback');
      const statCache = new Map<string, number>();
      interval = setInterval(() => {
        try {
          for (const file of fs.readdirSync(this.userConfigDir, { recursive: true })) {
            const fp = path.join(this.userConfigDir, file as string);
            const mtime = fs.statSync(fp).mtimeMs;
            if (statCache.get(fp) !== mtime) {
              statCache.set(fp, mtime);
              handler(fp);
            }
          }
        } catch { /* ignore */ }
      }, 5000);
    }

    return () => {
      watcher?.close();
      if (interval) clearInterval(interval);
    };
  }

  // === Template Sync ===

  async syncMissingFromTemplate(): Promise<string[]> {
    this.requireUser();
    const synced: string[] = [];

    for (const sub of ['agents', 'prompts']) {
      const tmplDir = path.join(this.templateDir, sub);
      const usrDir = path.join(this.userConfigDir, sub);
      if (!fs.existsSync(tmplDir)) continue;
      for (const f of fs.readdirSync(tmplDir)) {
        const dest = path.join(usrDir, f);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(tmplDir, f), dest);
          synced.push(`${sub}/${f}`);
        }
      }
    }

    const tmplSettings = path.join(this.templateDir, 'settings.json');
    const usrSettings = path.join(this.userConfigDir, 'settings.json');
    if (fs.existsSync(tmplSettings) && !fs.existsSync(usrSettings)) {
      fs.copyFileSync(tmplSettings, usrSettings);
      synced.push('settings.json');
    }

    if (synced.length > 0) log.info(`Synced ${synced.length} configs from template`);
    return synced;
  }

  // === Private ===

  private loadUserSettings(): UserSettings {
    const fp = path.join(this.userConfigDir, 'settings.json');
    if (fs.existsSync(fp)) {
      try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
      catch { log.warn('Failed to parse user settings'); }
    }
    return {
      defaultProvider: 'default', providers: {}, defaultModel: 'claude-sonnet-4-6',
      maxIterations: 50, maxTokens: 8192, temperature: 0.7,
    };
  }

  private loadSystemConfig(): SystemConfig {
    const fp = path.join(this.systemConfigDir, 'settings.json');
    if (fs.existsSync(fp)) {
      try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
      catch { log.warn('Failed to parse system config'); }
    }
    return { language: 'zh-CN', theme: 'dark', keybindings: {} };
  }

  private parseSimpleYaml(content: string): Record<string, any> {
    const result: Record<string, any> = {};
    let currentKey = '';
    let inContent = false;
    let contentLines: string[] = [];
    let contentIndent = 0;

    for (const line of content.split('\n')) {
      if (inContent) {
        const indent = line.search(/\S/);
        if (indent <= contentIndent && line.trim()) {
          result[currentKey] = contentLines.join('\n').trim();
          inContent = false;
          contentLines = [];
        } else {
          contentLines.push(line.slice(Math.max(0, contentIndent)));
          continue;
        }
      }

      if (!line.trim() || line.trim().startsWith('#')) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) continue;
      currentKey = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      if (value === '|') {
        inContent = true;
        contentIndent = line.search(/\S/) + 2;
        contentLines = [];
      } else if (value) {
        result[currentKey] = this.parseYamlVal(value);
      }
    }
    if (inContent && contentLines.length > 0) {
      result[currentKey] = contentLines.join('\n').trim();
    }
    return result;
  }

  private parseYamlVal(v: string): any {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    const n = Number(v);
    if (!isNaN(n)) return n;
    return v.replace(/^["']|["']$/g, '');
  }
}

let instance: ConfigManager | null = null;
export function getConfigManager(): ConfigManager {
  if (!instance) instance = new ConfigManager();
  return instance;
}
export function resetConfigManager(): void { instance = null; }
