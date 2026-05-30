/**
 * ============================================================
 * Skill System — SkillInstaller
 * ============================================================
 * 从天工坊 Marketplace 安装 Skill 到
 * ~/.xuanji/skills/installed/，并注册到 SkillRegistry。
 *
 * 安装优先级: ZIP 优先 → metadata 回退
 *
 * ZIP 管线：
 *   1. 获取 downloadInfo，检查 downloadUrl 是否为可下载文件
 *   2. 下载 ZIP → 解压到 ~/.xuanji/skills/installed/{packageId}/
 *   3. 读取 SKILL.md，解析 YAML frontmatter 获取元数据
 *   4. Markdown 正文作为 prompt content
 *   5. 写入 manifest.json → 注册到 SkillRegistry
 *
 * Metadata 回退：
 *   1. getDetail + getInstallConfig 获取元数据
 *   2. 生成 markdown content（含 description + configTemplate）
 *   3. 写入 manifest.json → 注册到 SkillRegistry
 */

import { homedir } from 'node:os';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYAML } from 'yaml';
import type { Skill } from './types';
import type { SkillRegistry } from './registry';
import type { TiangongMarket } from '@/mcp/market/TiangongMarket';
import { logger } from '@/core/logger';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

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
  /** 安装成功后返回 skill.id */
  skillId?: string;
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
   * 从天工坊安装 Skill
   *
   * ZIP 优先：先尝试下载 ZIP 包获取完整 SKILL.md 内容，
   * 若 downloadUrl 不可下载则回退到 API 元数据。
   */
  async install(options: SkillInstallOptions): Promise<SkillInstallResult> {
    const { packageId, version } = options;

    try {
      // ── Step 1: 尝试 ZIP 下载 ─────────────────────────
      let downloadInfo;
      try {
        downloadInfo = await this.market.getDownloadInfo(packageId, version);
      } catch {
        // getDownloadInfo 失败 → 回退 metadata
        log.info(`No download info for ${packageId}, falling back to metadata`);
      }

      if (downloadInfo?.downloadUrl && isDownloadableUrl(downloadInfo.downloadUrl)) {
        log.info(`Downloadable ZIP found for ${packageId}, using ZIP pipeline`);
        return this.installFromZip(packageId, downloadInfo);
      }

      // ── Step 2: 回退到 API 元数据 ──────────────────────
      log.info(`No downloadable ZIP for ${packageId}, using metadata pipeline`);
      return this.installFromMetadata(packageId, version);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Skill install failed for ${packageId}: ${msg}`);
      return { success: false, error: `安装失败: ${msg}` };
    }
  }

  /**
   * ZIP 安装管线
   *
   * 下载 ZIP → 解压 → 读 SKILL.md → 解析 frontmatter → 注册
   */
  private async installFromZip(
    packageId: string,
    downloadInfo: { downloadUrl: string; sha256?: string; fileSize?: number; version?: string; versionId?: number },
  ): Promise<SkillInstallResult> {
    const skillDir = path.join(this.installDir, packageId.replace(/\//g, '-'));
    const skillId = packageId.replace(/\//g, '-');
    const effectiveVersion = downloadInfo.version || 'unknown';

    let tmpDir: string | undefined;
    try {
      log.info(`Downloading skill ZIP: ${packageId}@${effectiveVersion}`);
      const { tempPath } = await this.market.download(packageId, effectiveVersion, '.zip');
      tmpDir = path.dirname(tempPath);

      if (existsSync(skillDir)) {
        await fs.rm(skillDir, { recursive: true, force: true });
      }
      await fs.mkdir(skillDir, { recursive: true });

      try {
        execSync(`unzip -o "${tempPath}" -d "${skillDir}"`, {
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `ZIP 解压失败: ${msg}` };
      }

      const skillMdPath = path.join(skillDir, 'SKILL.md');
      let skillMdContent: string;
      try {
        skillMdContent = await fs.readFile(skillMdPath, 'utf-8');
      } catch {
        return { success: false, error: 'ZIP 包中缺少 SKILL.md 文件' };
      }

      const frontmatter = parseFrontmatterHybrid(skillMdContent, packageId, effectiveVersion);
      if (!frontmatter) {
        return { success: false, error: 'SKILL.md 中缺少有效的 YAML frontmatter' };
      }

      // ── 解析 _meta.json（ClawHub 格式） ──
      let metaJson: Record<string, unknown> | undefined;
      try {
        const metaPath = path.join(skillDir, '_meta.json');
        const metaRaw = await fs.readFile(metaPath, 'utf-8');
        metaJson = JSON.parse(metaRaw);
      } catch {
        // _meta.json 不存在则跳过
      }

      // ── 发现 references/ 目录（ClawHub 格式） ──
      let references: string[] | undefined;
      try {
        const refDir = path.join(skillDir, 'references');
        const entries = await fs.readdir(refDir, { withFileTypes: true });
        references = entries
          .filter((e) => e.isFile() && e.name.endsWith('.md'))
          .map((e) => path.join(refDir, e.name));
      } catch {
        // references/ 不存在则跳过
      }

      const skill: Skill = {
        id: String(frontmatter.id ?? skillId),
        name: String(frontmatter.name ?? skillId),
        version: String(frontmatter.version ?? effectiveVersion),
        description: String(frontmatter.description ?? ''),
        category: validateCategory(frontmatter.category),
        tags: normalizeTags(frontmatter.tags),
        author: typeof frontmatter.author === 'string' ? frontmatter.author : undefined,
        content: frontmatter.body ?? skillMdContent,
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
        installedVersion: effectiveVersion,
        installedAt: new Date().toISOString(),
        // ClawHub 兼容字段
        allowedTools: frontmatter.allowedTools,
        clawhubMetadata: frontmatter.clawhubMetadata as Skill['clawhubMetadata'],
        references,
        metaJson: metaJson as Skill['metaJson'],
        license: frontmatter.license,
      };

      return this.registerSkill(skill, packageId, effectiveVersion, skillDir, 'zip');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Skill ZIP install failed for ${packageId}: ${msg}`);
      return { success: false, error: `安装失败: ${msg}` };
    } finally {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * Metadata 安装管线（回退）
   *
   * getDetail + getInstallConfig → 生成 markdown content → 注册
   */
  private async installFromMetadata(
    packageId: string,
    version?: string,
  ): Promise<SkillInstallResult> {
    const skillDir = path.join(this.installDir, packageId.replace(/\//g, '-'));
    const skillId = packageId.replace(/\//g, '-');

    let effectiveVersion = 'unknown';
    let skillName = packageId;
    let skillDescription = '';
    let skillTags: string[] = [];
    let configTemplate: string | undefined;

    try {
      const [detail, installConfig] = await Promise.all([
        this.market.getDetail(packageId),
        this.market.getInstallConfig(packageId, version),
      ]);

      effectiveVersion = installConfig.version || 'unknown';
      skillName = detail.name || skillName;
      skillDescription = detail.description || '';
      skillTags = detail.tags || [];
      configTemplate = installConfig.configTemplate;

      log.info(`Building skill "${skillName}" (${packageId}@${effectiveVersion}) from API metadata`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `获取 Skill 元数据失败: ${msg}` };
    }

    // 生成 markdown content（含 description + configTemplate）
    const content = buildMetadataContent(skillName, skillDescription, skillTags, configTemplate);

    const skill: Skill = {
      id: skillId,
      name: skillName,
      version: effectiveVersion,
      description: skillDescription,
      category: 'prompt',
      tags: skillTags,
      content,
      source: 'marketplace',
      packageId,
      installedVersion: effectiveVersion,
      installedAt: new Date().toISOString(),
    };

    return this.registerSkill(skill, packageId, effectiveVersion, skillDir, 'metadata');
  }

  /**
   * 直接从 npm registry 安装 Skill（绕过 marketplace API）
   *
   * 流程:
   *   1. npm install {packageName}
   *   2. 在 node_modules 中寻找 SKILL.md 或 README.md
   *   3. 解析 YAML frontmatter → 构建 Skill 对象
   *   4. 写入 manifest.json → 注册到 SkillRegistry
   */
  async installFromNpm(packageName: string, options?: SkillInstallOptions): Promise<SkillInstallResult> {
    const skillId = packageName.replace(/\//g, '-');
    const skillDir = path.join(this.installDir, skillId);
    const version = options?.version;

    try {
      log.info(`Installing Skill from npm: ${packageName}`);
      await fs.mkdir(skillDir, { recursive: true });

      // npm init + install
      const appDir = path.join(skillDir, 'app');
      await fs.mkdir(appDir, { recursive: true });
      const pkgJsonPath = path.join(appDir, 'package.json');
      try { await fs.access(pkgJsonPath); } catch {
        await fs.writeFile(pkgJsonPath, JSON.stringify({ private: true, name: skillId }, null, 2), 'utf-8');
      }

      const installPkg = version ? `${packageName}@${version}` : packageName;
      try {
        execSync(`"${this.findNpm()}" install ${installPkg} --no-audit --no-fund`, {
          cwd: appDir, timeout: 120_000, maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err: any) {
        const stderr = err.stderr?.toString() || '';
        return { success: false, error: `npm install 失败: ${stderr.slice(-500)}` };
      }

      // 在 node_modules 中找到包目录
      const pkgDir = path.join(appDir, 'node_modules', ...packageName.split('/'));
      let pkgJson: any = {};
      let effectiveVersion = 'unknown';
      try {
        pkgJson = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf-8'));
        effectiveVersion = pkgJson.version || 'unknown';
      } catch { /* use defaults */ }

      // 寻找 SKILL.md 或 README.md
      let skillMdContent: string | undefined;
      let skillMdPath: string | undefined;
      for (const candidate of ['SKILL.md', 'skill.md', 'README.md', 'readme.md']) {
        const candidatePath = path.join(pkgDir, candidate);
        try {
          skillMdContent = await fs.readFile(candidatePath, 'utf-8');
          skillMdPath = candidatePath;
          break;
        } catch { /* continue */ }
      }

      // 解析 frontmatter
      let frontmatter: ReturnType<typeof parseFrontmatterHybrid> = null;
      let body = skillMdContent || '';
      if (skillMdContent) {
        frontmatter = parseFrontmatterHybrid(skillMdContent, packageName, effectiveVersion);
        body = frontmatter?.body ?? skillMdContent;
      }

      const skill: Skill = {
        id: skillId,
        name: frontmatter?.name ?? pkgJson.name ?? packageName,
        version: frontmatter?.version ?? effectiveVersion,
        description: frontmatter?.description ?? pkgJson.description ?? '',
        category: 'prompt',
        tags: normalizeTags(frontmatter?.tags ?? pkgJson.keywords ?? []),
        content: body,
        source: 'npm' as const,
        packageId: packageName,
        installedVersion: effectiveVersion,
        installedAt: new Date().toISOString(),
        dependencies: frontmatter?.dependencies as string[] | undefined,
        allowedTools: frontmatter?.allowedTools,
        license: frontmatter?.license ?? pkgJson.license,
      };

      return this.registerSkill(skill, packageName, effectiveVersion, skillDir, 'npm');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Skill npm install failed for ${packageName}: ${msg}`);
      return { success: false, error: `npm 安装失败: ${msg}` };
    }
  }

  /** 查找 npm 可执行文件，返回可直接用于 execSync 的命令字符串 */
  private findNpm(): string {
    try {
      const pRes = (process as any).resourcesPath as string | undefined;
      if (pRes) {
        const npmCliPath = path.join(pRes, 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (require('fs').existsSync(npmCliPath)) {
          return `"${process.execPath}" "${npmCliPath}"`;
        }
      }
    } catch { /* 回退 */ }
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
  }

  /**
   * 注册 Skill + 写 manifest + 冲突检查
   */
  private async registerSkill(
    skill: Skill,
    packageId: string,
    version: string,
    skillDir: string,
    installMode: 'zip' | 'metadata' | 'npm',
  ): Promise<SkillInstallResult> {
    // 检查冲突
    if (this.registry.has(skill.id)) {
      const existing = this.registry.get(skill.id)!;
      if (existing.source === 'marketplace' && existing.packageId === packageId) {
        log.info(`Skill "${skill.id}" already installed, overwriting to ${version}`);
      } else {
        return {
          success: false,
          error: `Skill ID "${skill.id}" 已被占用（来源: ${existing.source ?? 'unknown'}），无法安装`,
        };
      }
    }

    // 写 manifest.json（完整 Skill 对象，确保重启后可重新加载）
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'manifest.json'),
      JSON.stringify({
        id: skill.id,
        name: skill.name,
        version: skill.version,
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
        content: skill.content,
        source: 'marketplace',
        packageId: skill.packageId,
        installedVersion: skill.installedVersion,
        installedAt: skill.installedAt,
        dependencies: skill.dependencies,
        conflicts: skill.conflicts,
        requiredTools: skill.requiredTools,
        allowedTools: skill.allowedTools,
        license: skill.license,
      }, null, 2),
      'utf-8',
    );

    // 注册
    this.registry.register(skill);

    log.info(`Skill "${skill.id}" installed successfully (${installMode}) to ${skillDir}`);
    eventBus.emit(XuanjiEvent.SKILL_INSTALLED, { skillId: skill.id, packageId, version });
    return { success: true, skillId: skill.id, version, filePath: skillDir };
  }

  /**
   * 卸载 marketplace 安装的 Skill
   */
  async uninstall(skillId: string): Promise<SkillUninstallResult> {
    // 两级精确查找：registry key (skill.id) → packageId
    let skill = this.registry.get(skillId);
    let registryKey = skillId;
    if (!skill) {
      skill = this.registry.list().find(
        (s) => s.source === 'marketplace' && s.packageId === skillId,
      );
      if (skill) {
        registryKey = skill.id;
      }
    }

    if (skill && skill.source !== 'marketplace') {
      return { success: false, error: `Skill "${skillId}" 不是 marketplace 安装的` };
    }

    if (skill) {
      this.registry.unregister(registryKey);
    }

    // 删除安装目录
    const diskId = skill?.packageId?.replace(/\//g, '-') ?? skillId.replace(/\//g, '-');
    const skillDir = path.join(this.installDir, diskId);
    let removed = false;
    try {
      await fs.rm(skillDir, { recursive: true, force: true });
      log.info(`Skill "${skillId}" uninstalled, removed: ${skillDir}`);
      removed = true;
    } catch {
      // 目录不存在
    }

    // 兼容旧 JSON 安装模式
    try {
      await fs.unlink(path.join(this.installDir, `${diskId}.json`));
    } catch {
      // 文件不存在则跳过
    }

    if (!skill && !removed) {
      // 既不在 registry 中，磁盘上也没有文件 → 彻底找不到
      return { success: false, error: `Skill "${skillId}" 未找到：既未注册，也无安装文件` };
    }

    eventBus.emit(XuanjiEvent.SKILL_UNINSTALLED, { skillId: registryKey });
    return { success: true };
  }

  /**
   * 列出所有从 marketplace 安装的 Skill
   */
  listInstalled(): Skill[] {
    return this.registry.list().filter((s) => s.source === 'marketplace');
  }
}

// ============================================================
// YAML Frontmatter 解析（兼容 xuanji + ClawHub/OpenClaw 两种格式）
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
  /** ClawHub: license */
  license?: string;
  /** ClawHub: allowed-tools */
  allowedTools?: string[];
  /** ClawHub: metadata.* 合并后的数据 */
  clawhubMetadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 混合 frontmatter 解析器：自动检测 xuanji 或 ClawHub/OpenClaw 格式
 *
 * 检测逻辑：
 *   - frontmatter 中有 `id` 字段 → xuanji 格式（保持现有行为）
 *   - frontmatter 中有 `name` 但无 `id` → ClawHub/OpenClaw 格式（自动映射）
 *
 * ClawHub → xuanji 字段映射：
 *   name          → Skill.name
 *   description   → Skill.description
 *   license       → Skill.license
 *   allowed-tools → Skill.allowedTools（逗号分隔字符串 → string[]）
 *   metadata.*    → Skill.clawhubMetadata
 *   id            → 从 packageId 推导
 *   version       → 从 downloadInfo 推导
 */
function parseFrontmatterHybrid(
  content: string,
  packageId: string,
  defaultVersion: string,
): ParsedFrontmatter | null {
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

  // ── 检测格式：有 id → xuanji 格式 ──
  if (parsed.id !== undefined) {
    return { ...parsed, body: body || undefined };
  }

  // ── ClawHub/OpenClaw 格式：映射到 xuanji 字段 ──
  const skillId = packageId.replace(/\//g, '-');
  const result: ParsedFrontmatter = {
    body: body || undefined,
    id: skillId,
    name: String(parsed.name ?? skillId),
    version: defaultVersion,
    description: String(parsed.description ?? ''),
    category: 'prompt',
    tags: [],
  };

  // license
  if (typeof parsed.license === 'string') {
    result.license = parsed.license;
  }

  // allowed-tools: 逗号分隔字符串 "Bash(...), Read(...), Write" 或 YAML 列表
  if (parsed['allowed-tools'] !== undefined) {
    result.allowedTools = normalizeAllowedTools(parsed['allowed-tools']);
  }

  // metadata.* → clawhubMetadata
  if (parsed.metadata && typeof parsed.metadata === 'object') {
    result.clawhubMetadata = parsed.metadata as Record<string, unknown>;
  }

  // 收集其他未知字段
  const knownKeys = new Set([
    'name', 'description', 'license', 'allowed-tools', 'metadata', 'body',
  ]);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!knownKeys.has(k)) {
      extras[k] = v;
    }
  }
  if (Object.keys(extras).length > 0) {
    result.clawhubMetadata = { ...result.clawhubMetadata, ...extras };
  }

  log.info(`Parsed ClawHub SKILL.md: "${result.name}" → id="${result.id}"`);
  return result;
}

function normalizeAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

// ============================================================
// 辅助函数
// ============================================================

function validateCategory(_category: unknown): 'prompt' {
  return 'prompt';
}

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

/** 判断 URL 是否为可下载文件（排除 GitHub/npmjs 等页面链接） */
function isDownloadableUrl(url: string): boolean {
  if (url.includes('github.com') && !url.endsWith('.zip')) return false;
  if (url.includes('npmjs.com')) return false;
  return true;
}

/** 从 API 元数据生成 Skill markdown 内容 */
function buildMetadataContent(
  name: string,
  description: string,
  tags: string[],
  configTemplate?: string,
): string {
  const sections: string[] = [];

  sections.push(`# ${name}`);
  sections.push('');
  sections.push('## 概述');
  sections.push(description || '无描述');

  if (configTemplate) {
    sections.push('');
    sections.push('## 配置');
    sections.push(configTemplate);
  }

  if (tags.length > 0) {
    sections.push('');
    sections.push('## 标签');
    sections.push(tags.join(', '));
  }

  sections.push('');
  sections.push('## 使用方法');
  sections.push(`调用 skill_call 工具来获取 ${name} 的指导内容。`);

  return sections.join('\n');
}

/** 将 API 返回的中文分类名映射为 Skill category 枚举 */
function mapCategoryName(_categoryName?: string): 'prompt' {
  return 'prompt';
}
