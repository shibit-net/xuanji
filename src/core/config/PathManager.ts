// ============================================================
// Xuanji 路径管理器
// ============================================================
// 统一管理所有文件系统路径，确保用户数据集中管理
//
// 新的目录结构:
// src/core/templates/        # 模板目录（源码，git 追踪）
// ├── config.json
// ├── mcp.json
// ├── prompt.json
// ├── agents/
// └── protocols/
//
// .xuanji/
// └── users/                # 用户数据目录（不被 git 追踪）
//     └── {userId}/        # 每个用户的独立目录
//         ├── config.json
//         ├── mcp.json
//         ├── prompt.json
//         ├── agents/
//         ├── memory/      # 记忆系统
//         ├── permissions/  # 权限决策
//         ├── sessions/     # 会话历史
//         ├── protocols/   # 执行规范
//         ├── reminders/  # 提醒系统
//         ├── stats/       # 统计
//         ├── logs/        # 日志
//         └── skills/      # 技能
// ============================================================

import { join, resolve, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 获取当前文件的目录，用于定位源代码中的模板目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 获取项目根目录
 */
function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('/desktop') || cwd.endsWith('\\desktop')) {
    return resolve(cwd, '..');
  }
  return cwd;
}

/**
 * 获取 Xuanji 数据根目录（项目目录）
 */
function getXuanjiRoot(): string {
  return join(getProjectRoot(), '.xuanji');
}

// ============================================================
// 模板相关路径（在源代码中，git 追踪）
// ============================================================

/**
 * 获取源代码中的模板目录
 */
export function getTemplateRoot(): string {
  return join(__dirname, '..', 'templates');
}

/**
 * 获取模板配置文件路径
 */
export function getTemplateConfigPath(): string {
  return join(getTemplateRoot(), 'config.json');
}

/**
 * 获取模板 MCP 配置文件路径
 */
export function getTemplateMCPPath(): string {
  return join(getTemplateRoot(), 'mcp.json');
}

/**
 * 获取模板 prompt 文件路径
 */
export function getTemplatePromptPath(): string {
  return join(getTemplateRoot(), 'prompt.json');
}

/**
 * 获取模板 Agent 配置目录
 */
export function getTemplateAgentsDir(): string {
  return join(getTemplateRoot(), 'agents');
}

/**
 * 获取模板协议目录
 */
export function getTemplateProtocolsDir(): string {
  return join(getTemplateRoot(), 'protocols');
}

/**
 * 获取模板 Prompt 组件目录
 */
export function getTemplatePromptsDir(): string {
  return join(getTemplateRoot(), 'prompts');
}

// ============================================================
// 项目相关路径
// ============================================================

/**
 * 获取项目的 .xuanji 根目录
 */
export function getProjectXuanjiRoot(projectRoot: string): string {
  return join(projectRoot, '.xuanji');
}

/**
 * 获取项目的 Prompt 组件目录
 */
export function getProjectPromptsDir(projectRoot: string): string {
  return join(getProjectXuanjiRoot(projectRoot), 'prompts');
}

// ============================================================
// 用户相关路径
// ============================================================

/**
 * 获取用户根目录
 */
export function getUserRoot(userId: string): string {
  return join(getXuanjiRoot(), 'users', userId);
}

/**
 * 获取用户配置文件路径
 */
export function getUserConfigPath(userId: string): string {
  return join(getUserRoot(userId), 'config.json');
}

/**
 * 获取用户 MCP 配置路径
 */
export function getUserMCPPath(userId: string): string {
  return join(getUserRoot(userId), 'mcp.json');
}

/**
 * 获取用户 prompt 路径
 */
export function getUserPromptPath(userId: string): string {
  return join(getUserRoot(userId), 'prompt.json');
}

/**
 * 获取用户 Agent 配置目录
 */
export function getUserAgentsDir(userId: string): string {
  return join(getUserRoot(userId), 'agents');
}

/**
 * 获取用户 Prompt 组件目录
 */
export function getUserPromptsDir(userId: string): string {
  return join(getUserRoot(userId), 'prompts');
}

/**
 * 获取用户记忆目录
 */
export function getUserMemoryDir(userId: string): string {
  return join(getUserRoot(userId), 'memory');
}

/**
 * 获取用户记忆数据库路径
 */
export function getUserMemoryPath(userId: string): string {
  return join(getUserMemoryDir(userId), 'memory.db');
}

/**
 * 获取用户权限目录
 */
export function getUserPermissionsDir(userId: string): string {
  return join(getUserRoot(userId), 'permissions');
}

/**
 * 获取用户权限数据库路径
 */
export function getUserPermissionPath(userId: string): string {
  return join(getUserPermissionsDir(userId), 'decisions.db');
}

/**
 * 获取用户会话目录
 */
export function getUserSessionsDir(userId: string): string {
  return join(getUserRoot(userId), 'sessions');
}

/**
 * 获取用户会话文件路径
 */
export function getUserSessionPath(userId: string): string {
  return join(getUserSessionsDir(userId), 'sessions.jsonl');
}

/**
 * 获取用户协议目录
 */
export function getUserProtocolsDir(userId: string): string {
  return join(getUserRoot(userId), 'protocols');
}

/**
 * 获取用户日志目录
 */
export function getUserLogsDir(userId: string): string {
  return join(getUserRoot(userId), 'logs');
}

/**
 * 获取用户提醒目录
 */
export function getUserRemindersDir(userId: string): string {
  return join(getUserRoot(userId), 'reminders');
}

/**
 * 获取用户技能目录
 */
export function getUserSkillsDir(userId: string): string {
  return join(getUserRoot(userId), 'skills');
}

/**
 * 获取用户统计目录
 */
export function getUserStatsDir(userId: string): string {
  return join(getUserRoot(userId), 'stats');
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 确保目录存在
 */
export async function ensureDirExists(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * 初始化用户完整目录结构
 */
export async function ensureUserDirectories(userId: string): Promise<void> {
  const dirs = [
    getUserRoot(userId),
    getUserAgentsDir(userId),
    getUserMemoryDir(userId),
    getUserPermissionsDir(userId),
    getUserSessionsDir(userId),
    getUserProtocolsDir(userId),
    getUserLogsDir(userId),
    getUserRemindersDir(userId),
    getUserSkillsDir(userId),
    getUserStatsDir(userId),
  ];
  for (const dir of dirs) {
    await ensureDirExists(dir);
  }
}

// ============================================================
// 路径管理器类
// ============================================================

export class PathManager {
  private _userId: string;

  constructor(userId: string) {
    this._userId = userId;
  }

  get userId(): string {
    return this._userId;
  }

  // 用户相关路径
  get root(): string { return getUserRoot(this._userId); }
  get config(): string { return getUserConfigPath(this._userId); }
  get mcp(): string { return getUserMCPPath(this._userId); }
  get prompt(): string { return getUserPromptPath(this._userId); }
  get agents(): string { return getUserAgentsDir(this._userId); }
  get memory(): string { return getUserMemoryDir(this._userId); }
  get permissions(): string { return getUserPermissionsDir(this._userId); }
  get sessions(): string { return getUserSessionsDir(this._userId); }
  get protocols(): string { return getUserProtocolsDir(this._userId); }
  get logs(): string { return getUserLogsDir(this._userId); }
  get reminders(): string { return getUserRemindersDir(this._userId); }
  get skills(): string { return getUserSkillsDir(this._userId); }
  get stats(): string { return getUserStatsDir(this._userId); }

  // 权限相关路径的具体文件
  get permissionDb(): string {
    return join(this.permissions, 'decisions.db');
  }

  get permissionJson(): string {
    return join(this.permissions, 'decisions.json');
  }

  // 会话相关文件
  get sessionsJsonl(): string {
    return join(this.sessions, 'sessions.jsonl');
  }

  // 记忆相关文件
  get memoryDb(): string {
    return join(this.memory, 'memory.db');
  }

  get knowledgeJsonl(): string {
    return join(this.memory, 'knowledge.jsonl');
  }

  // 提醒相关文件
  get remindersJsonl(): string {
    return join(this.reminders, 'reminders.jsonl');
  }

  // 确保所有用户目录都存在
  async ensureAllDirs(): Promise<void> {
    await ensureUserDirectories(this._userId);
  }
}

export default PathManager;
