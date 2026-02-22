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
  } catch {
    // 配置文件不存在或解析失败，返回空
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
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
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
