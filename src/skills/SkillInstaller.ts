/**
 * ============================================================
 * Skill System — SkillInstaller
 * ============================================================
 * 从天工坊 Marketplace 安装 Skill 到
 * ~/.xuanji/skills/installed/，并注册到 SkillRegistry。
 *
 * 统一 skill:zip 管线：
 *   1. 下载 ZIP 到临时目录
 *   2. 解压到 ~/.xuanji/skills/installed/{packageId}/
 *   3. 读取 SKILL.md，解析 YAML frontmatter 获取元数据
 *   4. Markdown 正文作为 prompt content
 *   5. 写入 manifest.json → 注册到 SkillRegistry
 *
 * scripts/assets/references 完整保留在安装目录，
 * LLM 通过 shell 工具按路径直接调用脚本。
 */

import { homedir } from 'node:os';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYAML } from 'yaml';
import type { Skill } from './types';
import type { SkillRegistry } from './registry';
import type { TiangongMarket } from '@/mcp/market/TiangongMarket';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'SkillInstaller' });

// ============================================================
// 类型
// ============================================================

export interface SkillInstallOptions {
  /** 天工坊 packageId */
  packageId: string;
  /** 目标版本，不传则安装最新版 */
  version?: string;
}

export interface SkillInstallResult {
  success: boolean;
  /** 安装成功后返回主 skill.id */
  skillId?: string;
  /** 子技能 ID 列表（从子目录 SKILL.md 发现） */
  subSkillIds?: string[];
  /** 已安装版本 */
  version?: string;
  /** 写入的文件路径（安装目录） */
  filePath?: string;
  /** 错误信息 */
  error?: string;
}

export interface SkillUninstallResult {
  success: boolean;
  error?: string;
}

// ============================================================
// SkillInstaller
// ============================================================

export class SkillInstaller {
  private readonly installDir: string;
  private readonly market: TiangongMarket;

  constructor(
    market: TiangongMarket,
    private readonly registry: SkillRegistry,
    installDir?: string,
  ) {
    this.market = market;
    this.installDir = installDir ?? path.join(homedir(), '.xuanji', 'skills', 'installed');
  }

  /**
   * 从天工坊安装 Skill（统一 skill:zip 管线）
   *
   * 支持两种 ZIP 结构：
   *   A. 根目录有 SKILL.md → 作为主技能，子目录中的 SKILL.md 作为子技能
   *   B. 根目录无 SKILL.md → 从一级子目录中发现所有 SKILL.md，每个注册为一个技能
   */
  async install(options: SkillInstallOptions): Promise<SkillInstallResult> {
    const { packageId, version } = options;

    // 1. 获取下载信息
    let downloadInfo;
    try {
      downloadInfo = await this.market.getDownloadInfo(packageId, version);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to get download info for skill ${packageId}: ${msg}`);
      return { success: false, error: `获取下载信息失败: ${msg}` };
    }

    const effectiveVersion = downloadInfo.version || 'unknown';
    const skillDir = path.join(this.installDir, packageId.replace(/\//g, '-'));
    let tmpDir: string | undefined;

    try {
      // 2. 下载 ZIP
      log.info(`Downloading skill ZIP: ${packageId}@${effectiveVersion}`);
      const { tempPath } = await this.market.download(packageId, version, '.zip');
      tmpDir = path.dirname(tempPath);

      // 3. 解压到安装目录
      if (existsSync(skillDir)) {
        await fs.rm(skillDir, { recursive: true, force: true });
      }
      await fs.mkdir(skillDir, { recursive: true });

      try {
        if (process.platform === 'win32') {
          execSync(
            `powershell -Command "Expand-Archive -Path '${tempPath}' -DestinationPath '${skillDir}' -Force"`,
            { timeout: 60_000, maxBuffer: 1024 * 1024 },
          );
        } else {
          execSync(`unzip -o "${tempPath}" -d "${skillDir}"`, {
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `ZIP 解压失败: ${msg}` };
      }

      // 4. 尝试读取根目录 SKILL.md
      const rootSkillMdPath = path.join(skillDir, 'SKILL.md');
      let rootSkillMdContent: string;
      let hasRootSkill = false;
      try {
        rootSkillMdContent = await fs.readFile(rootSkillMdPath, 'utf-8');
        hasRootSkill = true;
      } catch {
        rootSkillMdContent = '';
      }

      let primarySkillId: string | undefined;

      if (hasRootSkill) {
        // 结构 A：根目录 SKILL.md 作为主技能
        const frontmatter = parseFrontmatter(rootSkillMdContent);
        if (!frontmatter) {
          return { success: false, error: 'SKILL.md 中缺少有效的 YAML frontmatter' };
        }

        const skillId = String(frontmatter.id ?? packageId);
        if (!this.checkInstallConflict(skillId, packageId, effectiveVersion)) {
          return {
            success: false,
            error: `Skill ID "${skillId}" 已被占用，无法安装`,
          };
        }

        this.registerSkillFromMd(frontmatter, rootSkillMdContent, skillId, packageId, effectiveVersion, skillDir);
        primarySkillId = skillId;
      }

      // 5. 扫描一级子目录，发现子技能（两种结构都扫描）
      const subSkillIds = await this.discoverSubSkills(skillDir, packageId, effectiveVersion);

      if (!hasRootSkill) {
        if (subSkillIds.length > 0) {
          // 结构 B：无根 SKILL.md，子目录技能即为主技能
          primarySkillId = subSkillIds[0];
        } else {
          return { success: false, error: 'ZIP 包中缺少 SKILL.md 文件' };
        }
      }

      // 6. 清理临时文件
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }

      log.info(`Package "${packageId}" installed: primary=${primarySkillId}, subSkills=${subSkillIds.length}`);
      return {
        success: true,
        skillId: primarySkillId,
        subSkillIds: subSkillIds.length > 0 ? subSkillIds : undefined,
        version: effectiveVersion,
        filePath: skillDir,
      };
    } catch (err) {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Skill install failed for ${packageId}: ${msg}`);
      return { success: false, error: `安装失败: ${msg}` };
    }
  }

  /**
   * 卸载 marketplace 安装的 Skill 及其所有子技能
   */
  async uninstall(skillOrPackageId: string): Promise<SkillUninstallResult> {
    const allMarketplace = this.registry.list().filter((s) => s.source === 'marketplace');

    // 多种方式查找目标 skill
    let skill = this.registry.get(skillOrPackageId);
    let packageId = skillOrPackageId;

    if (!skill) {
      // 1) 按 packageId 查找
      skill = allMarketplace.find((s) => s.packageId === skillOrPackageId);
    }
    if (!skill) {
      // 2) 按 id 查找
      skill = allMarketplace.find((s) => s.id === skillOrPackageId);
    }
    if (!skill && allMarketplace.length > 0) {
      // 3) skillOrPackageId 可能就是 packageId，registry 里没有该字段也接受
      packageId = skillOrPackageId;
    } else if (skill) {
      packageId = skill.packageId ?? skillOrPackageId;
    }

    // 卸载所有同 packageId 的 marketplace 技能
    const relatedSkills = allMarketplace.filter((s) => s.packageId === packageId);
    for (const s of relatedSkills) {
      this.registry.unregister(s.id);
    }

    // 删除安装目录
    const skillDir = path.join(this.installDir, packageId.replace(/\//g, '-'));
    try {
      await fs.rm(skillDir, { recursive: true, force: true });
      log.info(`Uninstalled "${packageId}": ${relatedSkills.length} skills, removed: ${skillDir}`);
    } catch {
      // 目录不存在也视为成功
    }

    // 兼容旧 JSON 安装模式
    const oldJsonFile = path.join(this.installDir, `${packageId}.json`);
    try {
      await fs.unlink(oldJsonFile);
    } catch {
      // 文件不存在则跳过
    }

    // 如果 registry 里根本没找到任何相关 skill，但目录存在并删除成功，也算成功
    // 只有既找不到 skill 又删不掉目录时才报错
    if (relatedSkills.length === 0) {
      try {
        await fs.access(skillDir);
        // 目录存在，尝试删除
        await fs.rm(skillDir, { recursive: true, force: true });
        return { success: true };
      } catch {
        return { success: false, error: `Skill "${skillOrPackageId}" 未注册且目录不存在` };
      }
    }

    return { success: true };
  }

  /**
   * 列出所有从 marketplace 安装的 Skill
   */
  listInstalled(): Skill[] {
    return this.registry.list().filter((s) => s.source === 'marketplace');
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

  /**
   * 检查安装冲突：同 ID 同 packageId 允许覆盖，否则拒绝
   */
  private checkInstallConflict(skillId: string, packageId: string, version: string): boolean {
    if (!this.registry.has(skillId)) return true;
    const existing = this.registry.get(skillId)!;
    if (existing.source === 'marketplace' && existing.packageId === packageId) {
      log.info(`Skill "${skillId}" already installed, overwriting to ${version}`);
      return true;
    }
    log.warn(`Skill ID "${skillId}" occupied by ${existing.source ?? 'unknown'} source`);
    return false;
  }

  /**
   * 从 SKILL.md 解析结果构建 Skill 对象、写 manifest、注册
   */
  private async registerSkillFromMd(
    frontmatter: ParsedFrontmatter,
    rawContent: string,
    skillId: string,
    packageId: string,
    version: string,
    installDir: string,
  ): Promise<Skill> {
    const skill: Skill = {
      id: skillId,
      name: String(frontmatter.name ?? skillId),
      version: String(frontmatter.version ?? version),
      description: String(frontmatter.description ?? ''),
      category: 'prompt',
      tags: normalizeTags(frontmatter.tags),
      author: typeof frontmatter.author === 'string' ? frontmatter.author : undefined,
      content: frontmatter.body ?? rawContent,
      parameters: frontmatter.parameters as Skill['parameters'],
      dependencies: Array.isArray(frontmatter.dependencies)
        ? frontmatter.dependencies.map(String)
        : undefined,
      conflicts: Array.isArray(frontmatter.conflicts)
        ? frontmatter.conflicts.map(String)
        : undefined,
      requiredTools: Array.isArray(frontmatter.requiredTools)
        ? frontmatter.requiredTools.map(String)
        : undefined,
      enabled: frontmatter.enabled as boolean | undefined,
      priority: typeof frontmatter.priority === 'number' ? frontmatter.priority : undefined,
      source: 'marketplace',
      packageId,
      installedVersion: version,
      installedAt: new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(installDir, 'manifest.json'),
      JSON.stringify(skill, null, 2),
      'utf-8',
    );

    this.registry.register(skill);
    return skill;
  }

  /**
   * 扫描安装目录的一级子目录，发现并注册子技能
   * @returns 成功注册的子技能 ID 列表
   */
  private async discoverSubSkills(
    skillDir: string,
    packageId: string,
    version: string,
  ): Promise<string[]> {
    const subSkillIds: string[] = [];
    let entries: any[];
    try {
      entries = await fs.readdir(skillDir, { withFileTypes: true });
    } catch {
      return subSkillIds;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(skillDir, entry.name);
      const skillMdPath = path.join(subDir, 'SKILL.md');

      let content: string;
      try {
        content = await fs.readFile(skillMdPath, 'utf-8');
      } catch {
        continue;
      }

      const fm = parseFrontmatter(content);
      if (!fm) continue;

      const subSkillId = String(fm.id ?? entry.name);

      if (!this.checkInstallConflict(subSkillId, packageId, version)) {
        log.warn(`Sub-skill "${subSkillId}" skipped due to conflict`);
        continue;
      }

      await this.registerSkillFromMd(fm, content, subSkillId, packageId, version, subDir);
      subSkillIds.push(subSkillId);
    }

    return subSkillIds;
  }
}

// ============================================================
// YAML Frontmatter 解析
// ============================================================

interface ParsedFrontmatter {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  category?: string;
  tags?: unknown;
  author?: string;
  parameters?: unknown;
  dependencies?: unknown;
  conflicts?: unknown;
  requiredTools?: unknown;
  enabled?: unknown;
  priority?: unknown;
  /** Markdown 正文（frontmatter 之后的内容） */
  body?: string;
  [key: string]: unknown;
}

/**
 * 解析 SKILL.md 中的 YAML frontmatter
 *
 * 格式：
 * ```
 * ---
 * id: my-skill
 * name: My Skill
 * ---
 * # Markdown 正文
 * ```
 */
function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return null;
  }

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) {
    return null;
  }

  const yamlBlock = trimmed.substring(3, endIdx).trim();
  const body = trimmed.substring(endIdx + 3).trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYAML(yamlBlock) as Record<string, unknown>;
  } catch {
    log.warn('Failed to parse SKILL.md YAML frontmatter');
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  return { ...parsed, body: body || undefined };
}

// ============================================================
// 辅助函数
// ============================================================

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.map(String);
  }
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return tags.split(',').map(t => t.trim()).filter(Boolean);
    }
  }
  return [];
}
