// ============================================================
// M9 配置管理 — 项目配置 (.xuanji/config.json)
// ============================================================

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

/** 项目配置目录名 */
const PROJECT_CONFIG_DIR_NAME = '.xuanji';

/** 项目配置文件名 */
const PROJECT_CONFIG_FILE_NAME = 'config.json';

/**
 * 获取项目配置文件路径
 * @param cwd 项目根目录 (默认 process.cwd())
 */
function getProjectConfigPath(cwd?: string): string {
  const base = cwd ?? process.cwd();
  return join(base, PROJECT_CONFIG_DIR_NAME, PROJECT_CONFIG_FILE_NAME);
}

/**
 * 加载项目级配置
 */
export async function loadProjectConfig(cwd?: string): Promise<Record<string, unknown>> {
  try {
    const path = getProjectConfigPath(cwd);
    const text = await readFile(path, 'utf-8');
    return JSON.parse(text);
  } catch {
    // 项目配置不存在或解析失败
  }
  return {};
}

/**
 * 获取项目规则文件路径 (.xuanji/rules.md)
 */
export function getProjectRulesPath(cwd?: string): string {
  const base = cwd ?? process.cwd();
  return join(base, PROJECT_CONFIG_DIR_NAME, 'rules.md');
}

export { PROJECT_CONFIG_DIR_NAME, PROJECT_CONFIG_FILE_NAME, getProjectConfigPath };
