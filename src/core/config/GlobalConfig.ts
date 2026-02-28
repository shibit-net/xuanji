// ============================================================
// M9 配置管理 — 全局配置 (~/.xuanji/config.json)
// ============================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

/** 全局配置目录 */
const GLOBAL_CONFIG_DIR = join(homedir(), '.xuanji');

/** 全局配置文件路径 */
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');

/**
 * 加载全局配置
 */
export async function loadGlobalConfig(): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(GLOBAL_CONFIG_PATH, 'utf-8');
    return JSON.parse(text);
  } catch (error) {
    // 文件不存在时静默返回空对象；JSON 语法错误时 warn 提示用户
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(`[Xuanji] Failed to parse config.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {};
}

/**
 * 保存全局配置
 */
export async function saveGlobalConfig(config: Record<string, unknown>): Promise<void> {
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 深度合并配置对象 (后者覆盖前者)
 * 用于合并部分配置而不丢失其他字段
 */
export function deepMergeConfig(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null && srcVal !== undefined && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal !== null && tgtVal !== undefined && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMergeConfig(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

export { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH };

/**
 * 通过点号路径取值 (e.g. "provider.model")
 */
export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * 通过点号路径设值 (e.g. "provider.model", "claude-sonnet-4-20250514")
 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
