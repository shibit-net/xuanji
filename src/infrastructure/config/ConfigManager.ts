/**
 * ConfigManager — 多用户隔离配置管理器
 *
 * 使用项目根目录下的 .xuanji/ 存储所有配置（与 PathManager 一致）。
 * 配置模板仅用于新用户首次初始化，不覆盖已有配置。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '@/infrastructure/logger';
import { getXuanjiRoot, getTemplateRoot } from './PathManager';
import type { AgentConfig } from './types';
import { parse as parseYaml } from 'yaml';
import JSON5 from 'json5';

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
  private templateDir: string;

  constructor() {
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

    // 按 agentId 分组收集 YAML（模板基准）和 JSON（用户覆盖）
    // 避免同一 agentId 的 .yaml 和 .json 因 fs.readdirSync 顺序不确定而随机返回
    const yamlConfigs = new Map<string, AgentConfig>();
    const jsonConfigs = new Map<string, AgentConfig>();

    for (const f of fs.readdirSync(agentsDir)) {
      const isJson = f.endsWith('.json');
      if (!isJson && !f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
      try {
        const content = fs.readFileSync(path.join(agentsDir, f), 'utf-8');
        const config = (isJson ? JSON.parse(content) : parseYaml(content)) as AgentConfig;
        (isJson ? jsonConfigs : yamlConfigs).set(config.id, config);
      } catch { /* skip malformed */ }
    }

    // 合并：YAML 为基础，JSON 字段覆盖（保留 YAML 中未在 JSON 出现的默认字段如 tools）
    const merged = new Map<string, AgentConfig>();
    for (const [id, yaml] of yamlConfigs) {
      merged.set(id, yaml);
    }
    for (const [id, json] of jsonConfigs) {
      const yaml = merged.get(id);
      merged.set(id, yaml ? { ...yaml, ...json } : json);
    }

    return [...merged.values()].map(c => this.applyAgentOverride(c));
  }

  getAgentConfig(agentId: string): AgentConfig | null {
    return this.getAgentConfigs().find(c => c.id === agentId) ?? null;
  }

  /** 应用 agent-overrides 中的用户覆盖到 agent 配置 */
  private applyAgentOverride(config: AgentConfig): AgentConfig {
    const overridesDir = path.join(this.userConfigDir, 'agent-overrides');
    const overridePath = path.join(overridesDir, `${config.id}.json5`);
    if (!fs.existsSync(overridePath)) return config;

    try {
      const content = fs.readFileSync(overridePath, 'utf-8');
      const override = JSON5.parse(content) as { enabled?: boolean; provider?: Record<string, any>; model?: Record<string, any> };

      if (override.enabled !== undefined) {
        config.enabled = override.enabled;
      }
      if (override.provider) {
        config.provider = { ...config.provider, ...override.provider };
      }
      if (override.model) {
        config.model = { ...config.model, ...override.model };
      }
    } catch (error) {
      throw new Error(`Agent override 解析失败: ${overridePath} — ${error instanceof Error ? error.message : String(error)}`);
    }

    return config;
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

  getEmbeddingConfig(): AgentConfig | null {
    return this.getAgentConfigs().find(c => c.type === 'embedding' && c.enabled !== false) ?? null;
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

  /**
   * 从模板同步缺失的配置文件到用户目录
   *
   * - agents/、prompts/：子目录内文件级别同步（仅补缺失）
   * - config.json、mcp.json、prompt.json：根级别文件同步（仅补缺失）
   * - 已有文件不会被覆盖，用户自定义优先
   */
  async syncMissingFromTemplate(): Promise<string[]> {
    this.requireUser();
    const synced: string[] = [];

    // 参照 AgentRegistry.copyBuiltinAgentsToUserDir() 的模式：
    // 模板目录不存在时打 warning，不要静默跳过
    if (!fs.existsSync(this.templateDir)) {
      log.warn(`模板目录不存在: ${this.templateDir}，跳过配置同步`);
      return synced;
    }

    // 同步子目录文件（agents/、prompts/）
    for (const sub of ['agents', 'prompts']) {
      const tmplDir = path.join(this.templateDir, sub);
      if (!fs.existsSync(tmplDir)) {
        log.warn(`模板子目录不存在: ${tmplDir}`);
        continue;
      }
      // 同步子目录到用户目录
      const usrDir = path.join(this.userConfigDir, sub);
      for (const f of fs.readdirSync(tmplDir)) {
        const dest = path.join(usrDir, f);
        if (!fs.existsSync(dest)) {
          if (!fs.existsSync(usrDir)) fs.mkdirSync(usrDir, { recursive: true });
          fs.copyFileSync(path.join(tmplDir, f), dest);
          synced.push(`${sub}/${f}`);
        }
      }
    }

    // 同步根级别配置文件（仅当用户侧不存在时）
    for (const fileName of ['config.json', 'mcp.json']) {
      const tmplPath = path.join(this.templateDir, fileName);
      const usrPath = path.join(this.userConfigDir, fileName);

      if (!fs.existsSync(tmplPath)) {
        log.warn(`模板文件不存在: ${tmplPath}`);
        continue;
      }

      if (!fs.existsSync(usrPath)) {
        if (fileName === 'mcp.json') {
          // 从模板 mcp.json 仅提取有效字段，过滤 _examples
          const cleaned = this.cleanMCPTemplate(tmplPath);
          fs.writeFileSync(usrPath, JSON.stringify(cleaned, null, 2), 'utf-8');
        } else {
          fs.copyFileSync(tmplPath, usrPath);
        }
        synced.push(fileName);
      }
    }

    if (synced.length > 0) log.info(`Synced ${synced.length} configs from template: ${synced.join(', ')}`);
    return synced;
  }

  /** 清洗 mcp.json 模板：去掉 _examples 等非标准字段 */
  private cleanMCPTemplate(tmplPath: string): Record<string, any> {
    try {
      const raw = JSON.parse(fs.readFileSync(tmplPath, 'utf-8'));
      const { _examples, ...rest } = raw;
      return rest;
    } catch {
      return { servers: [] };
    }
  }

}

let instance: ConfigManager | null = null;
export function getConfigManager(): ConfigManager {
  if (!instance) instance = new ConfigManager();
  return instance;
}
export function resetConfigManager(): void { instance = null; }
