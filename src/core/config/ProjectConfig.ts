// ============================================================
// M9 配置管理 — 项目配置 (.xuanji/config.json)
// ============================================================

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ProjectConfigWriter } from './ProjectConfigWriter';

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
 *
 * 如果配置文件不存在，会自动初始化一份包含所有默认值的完整配置模板。
 * 所有错误静默处理，不阻塞启动流程。
 */
export async function loadProjectConfig(cwd?: string): Promise<Record<string, unknown>> {
  try {
    const path = getProjectConfigPath(cwd);
    const text = await readFile(path, 'utf-8');
    return JSON.parse(text);
  } catch (err) {
    // 项目配置不存在 — 自动初始化
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await autoInitProjectConfig(cwd);
      // 再次尝试读取
      try {
        const path = getProjectConfigPath(cwd);
        const text = await readFile(path, 'utf-8');
        return JSON.parse(text);
      } catch {
        // 初始化失败，返回空对象
      }
    }
    // JSON 解析失败等其他错误，返回空对象
  }
  return {};
}

/**
 * 自动初始化项目配置（静默执行）
 *
 * 首次启动时自动创建 .xuanji/config.json 和 rules.md。
 * 不覆盖已有文件，所有错误静默处理。
 */
async function autoInitProjectConfig(cwd?: string): Promise<void> {
  const writer = new ProjectConfigWriter();
  try {
    // 检测语言偏好（从环境变量或默认 en）
    const language = process.env.XUANJI_LANG === 'zh' ? 'zh' : 'en';
    await writer.initProjectConfig({
      language,
      overwrite: false,
      generateFullConfig: true,
    }, cwd);
  } catch {
    // 静默失败，不打扰用户
  }
}

/**
 * 获取项目规则文件路径 (.xuanji/rules.md)
 */
export function getProjectRulesPath(cwd?: string): string {
  const base = cwd ?? process.cwd();
  return join(base, PROJECT_CONFIG_DIR_NAME, 'rules.md');
}

export { PROJECT_CONFIG_DIR_NAME, PROJECT_CONFIG_FILE_NAME, getProjectConfigPath };
