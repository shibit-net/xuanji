/**
 * Hook 配置加载器
 *
 * 加载优先级:
 * 1. 项目级: .xuanji/hooks.json（当前目录）
 * 2. 全局级: .xuanji/hooks.json
 *
 * 项目级配置会**合并**（非覆盖）到全局配置:
 * - 同一事件的 Handler 数组会拼接（项目级追加到全局后面）
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { HookConfig, HookEvent, HookHandler } from './types.js';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'HookConfigLoader' });

const GLOBAL_HOOKS_PATH = path.join(process.cwd(), '.xuanji', 'hooks.json');
const PROJECT_HOOKS_FILE = 'hooks.json';

export class HookConfigLoader {
  /**
   * 加载合并后的 Hook 配置
   */
  async load(): Promise<HookConfig> {
    const [globalConfig, projectConfig] = await Promise.all([
      this.loadFile(GLOBAL_HOOKS_PATH),
      this.loadProjectConfig(),
    ]);

    return this.mergeConfigs(globalConfig, projectConfig);
  }

  /**
   * 加载全局配置
   */
  async loadGlobal(): Promise<HookConfig> {
    return this.loadFile(GLOBAL_HOOKS_PATH);
  }

  /**
   * 加载项目级配置
   */
  async loadProject(): Promise<HookConfig> {
    return this.loadProjectConfig();
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 从文件加载配置
   */
  private async loadFile(filePath: string): Promise<HookConfig> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // 基本验证
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        log.warn(`Invalid config format: ${filePath}`);
        return {};
      }

      return this.validateConfig(parsed, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在，静默返回空
        return {};
      }
      log.warn(
        `Failed to load ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  }

  /**
   * 加载项目级配置（从当前目录向上查找 .xuanji/hooks.json）
   */
  private async loadProjectConfig(): Promise<HookConfig> {
    const projectPath = path.join(process.cwd(), '.xuanji', PROJECT_HOOKS_FILE);
    return this.loadFile(projectPath);
  }

  /**
   * 验证配置结构
   */
  private validateConfig(raw: Record<string, unknown>, source: string): HookConfig {
    const config: HookConfig = {};

    for (const [key, value] of Object.entries(raw)) {
      // 验证事件名
      if (!this.isValidEvent(key)) {
        log.warn(`Unknown event "${key}" in ${source}, skipping`);
        continue;
      }

      // 验证 Handler 数组
      if (!Array.isArray(value)) {
        log.warn(`Event "${key}" value must be an array in ${source}, skipping`);
        continue;
      }

      const handlers: HookHandler[] = [];
      for (const item of value) {
        const handler = this.validateHandler(item, key, source);
        if (handler) {
          handlers.push(handler);
        }
      }

      if (handlers.length > 0) {
        config[key as HookEvent] = handlers;
      }
    }

    return config;
  }

  /**
   * 验证单个 Handler
   */
  private validateHandler(
    raw: unknown,
    event: string,
    source: string,
  ): HookHandler | null {
    if (typeof raw !== 'object' || raw === null) {
      log.warn(`Invalid handler in ${event} (${source}), skipping`);
      return null;
    }

    const handler = raw as Record<string, unknown>;

    // 必须有 type
    if (!handler.type || !['command', 'prompt', 'agent'].includes(handler.type as string)) {
      log.warn(
        `Invalid handler type "${handler.type}" in ${event} (${source}), skipping`,
      );
      return null;
    }

    // 安全: 项目级配置不允许 command 类型 handler（防止恶意仓库通过 .xuanji/hooks.json 执行任意命令）
    if (handler.type === 'command' && this.isProjectSource(source)) {
      log.warn(
        `Security: command handler in project-level config is not allowed (${event} in ${source}), skipping`,
      );
      return null;
    }

    // command 类型必须有 script
    if (handler.type === 'command' && typeof handler.script !== 'string') {
      log.warn(`Command handler missing "script" in ${event} (${source}), skipping`);
      return null;
    }

    // prompt 类型必须有 content
    if (handler.type === 'prompt' && typeof handler.content !== 'string') {
      log.warn(`Prompt handler missing "content" in ${event} (${source}), skipping`);
      return null;
    }

    // agent 类型必须有 prompt
    if (handler.type === 'agent' && typeof handler.prompt !== 'string') {
      log.warn(`Agent handler missing "prompt" in ${event} (${source}), skipping`);
      return null;
    }

    // 可选字段类型校验
    if ('timeout' in handler) {
      if (typeof handler.timeout !== 'number' || handler.timeout <= 0) {
        delete handler.timeout; // 无效值，忽略
      }
    }
    if ('scope' in handler) {
      if (!['global', 'parent', 'subagent'].includes(handler.scope as string)) {
        handler.scope = 'global'; // 无效值，默认 'global'
      }
    }
    if ('match' in handler) {
      if (typeof handler.match !== 'object' || handler.match === null || Array.isArray(handler.match)) {
        delete handler.match; // 无效值，忽略
      }
    }
    if ('enabled' in handler) {
      if (typeof handler.enabled !== 'boolean') {
        delete handler.enabled; // 无效值，忽略
      }
    }

    return handler as unknown as HookHandler;
  }

  /**
   * 检查事件名是否合法
   */
  private isValidEvent(event: string): boolean {
    const validEvents: string[] = [
      'SessionStart', 'SessionEnd',
      'PreToolUse', 'PostToolUse',
      'PreCompact', 'PostCompact',
      'PreMemorySave', 'PostMemorySave',
      'ErrorOccurred',
      'SubAgentStart', 'SubAgentEnd', 'SubAgentToolUse',
      'CheckpointCreated', 'CheckpointRestored',
    ];
    return validEvents.includes(event);
  }

  /**
   * 判断配置来源是否为项目级（非全局）
   */
  private isProjectSource(source: string): boolean {
    // 全局配置路径: .xuanji/hooks.json
    const globalDir = path.resolve(process.cwd(), '.xuanji');
    const resolvedSource = path.resolve(source);
    return !resolvedSource.startsWith(globalDir + path.sep);
  }

  /**
   * 合并两个配置（项目级追加到全局后面）
   */
  private mergeConfigs(global: HookConfig, project: HookConfig): HookConfig {
    const merged: HookConfig = { ...global };

    for (const [event, handlers] of Object.entries(project)) {
      const existing = merged[event as HookEvent] ?? [];
      merged[event as HookEvent] = [...existing, ...(handlers ?? [])];
    }

    return merged;
  }
}
