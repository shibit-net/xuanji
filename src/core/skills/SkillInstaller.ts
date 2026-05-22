/**
 * ============================================================
 * Skill System — SkillInstaller
 * ============================================================
 * 从天工坊 Marketplace 安装 Skill 文件到
 * ~/.xuanji/skills/installed/，并注册到 SkillRegistry。
 *
 * 支持两种安装模式：
 *   - skill:json — JSON 文件下载（prompt 类型）
 *   - skill:tar — tar.gz 管道（action/workflow 类型）
 */

import { homedir } from 'node:os';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import type { Skill } from './types';
import type { SkillRegistry } from './registry';
import type { TiangongMarket, DownloadInfo } from '@/mcp/market/TiangongMarket';
import { checkCodeSafety } from './validator';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SkillInstaller' });

// ============================================================
// 类型
// ============================================================

export interface SkillInstallOptions {
  /** 天工坊 packageId（数字 ID 的字符串形式） */
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
  /** 写入的文件路径 */
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
   * 流程：
   *  1. getDownloadInfo → 获取 JSON 文件 URL
   *  2. HTTP 下载 JSON 文件内容
   *  3. 解析 & 校验 Skill 格式
   *  4. 写入 ~/.xuanji/skills/installed/{packageId}.json
   *  5. 补充 marketplace 元数据 → SkillRegistry.register()
   */
  async install(options: SkillInstallOptions): Promise<SkillInstallResult> {
    const { packageId, version } = options;

    // 1. 获取下载信息
    let downloadInfo: DownloadInfo;
    try {
      downloadInfo = await this.market.getDownloadInfo(packageId, version);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to get download info for skill ${packageId}: ${msg}`);
      return { success: false, error: `获取下载信息失败: ${msg}` };
    }

    // 2. 判断安装模式
    const pkgType = this.detectPackageType(downloadInfo);
    if (pkgType === 'skill:tar') {
      return this.installFromTar(packageId, downloadInfo);
    }

    // 3. JSON 管道（现有流程）
    let rawContent: string;
    try {
      rawContent = await this.market.downloadText(downloadInfo.downloadUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to download skill ${packageId}: ${msg}`);
      return { success: false, error: `下载失败: ${msg}` };
    }

    // 3. 解析 JSON
    let skillJson: Record<string, unknown>;
    try {
      skillJson = JSON.parse(rawContent);
    } catch {
      return { success: false, error: '下载的内容不是合法的 JSON' };
    }

    // 4. 校验 Skill 格式
    const validationError = this.validateSkillShape(skillJson);
    if (validationError) {
      return { success: false, error: `Skill 格式无效: ${validationError}` };
    }

    const skillId = String(skillJson.id);

    // 5. 检查是否已安装（允许覆盖同 packageId 的旧版本）
    if (this.registry.has(skillId)) {
      const existing = this.registry.get(skillId)!;
      if (existing.source === 'marketplace' && existing.packageId === packageId) {
        log.info(`Skill "${skillId}" already installed from marketplace, overwriting to version ${downloadInfo.version}`);
      } else {
        return {
          success: false,
          error: `Skill ID "${skillId}" 已被占用（来源: ${existing.source ?? 'unknown'}），无法安装`,
        };
      }
    }

    // 6. 构建完整的 Skill 对象
    const skill: Skill = {
      id: skillId,
      name: String(skillJson.name),
      version: String(skillJson.version),
      description: String(skillJson.description),
      category: skillJson.category as Skill['category'],
      tags: Array.isArray(skillJson.tags) ? skillJson.tags.map(String) : [],
      author: typeof skillJson.author === 'string' ? skillJson.author : undefined,
      content: skillJson.content,
      parameters: skillJson.parameters as Skill['parameters'],
      dependencies: Array.isArray(skillJson.dependencies)
        ? skillJson.dependencies.map(String)
        : undefined,
      conflicts: Array.isArray(skillJson.conflicts)
        ? skillJson.conflicts.map(String)
        : undefined,
      requiredTools: Array.isArray(skillJson.requiredTools)
        ? skillJson.requiredTools.map(String)
        : undefined,
      enabled: skillJson.enabled as boolean | undefined,
      priority: typeof skillJson.priority === 'number' ? skillJson.priority : undefined,
      // Marketplace 元数据
      source: 'marketplace',
      packageId,
      installedVersion: downloadInfo.version,
      installedAt: new Date().toISOString(),
    };

    // 7. 写入文件
    const fileName = `${packageId}.json`;
    const filePath = path.join(this.installDir, fileName);

    try {
      await fs.mkdir(this.installDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(skill, null, 2), 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to write skill file ${filePath}: ${msg}`);
      return { success: false, error: `写入文件失败: ${msg}` };
    }

    // 8. 注册到 SkillRegistry
    this.registry.register(skill);

    log.info(`Skill "${skillId}" installed successfully to ${filePath}`);
    return {
      success: true,
      skillId,
      version: downloadInfo.version,
      filePath,
    };
  }

  /**
   * 卸载 marketplace 安装的 Skill。
   *
   * 自动识别安装模式：
   *   - JSON：删除 {packageId}.json
   *   - tar：删除整个目录 + node_modules
   */
  async uninstall(skillId: string): Promise<SkillUninstallResult> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      return { success: false, error: `Skill "${skillId}" 未注册` };
    }
    if (skill.source !== 'marketplace') {
      return { success: false, error: `Skill "${skillId}" 不是 marketplace 安装的` };
    }

    const packageId = skill.packageId ?? skillId;

    // 从注册表移除
    this.registry.unregister(skillId);

    // 检测安装模式
    const tarDir = path.join(this.installDir, packageId);
    const jsonFile = path.join(this.installDir, `${packageId}.json`);
    const manifestFile = path.join(tarDir, 'manifest.json');

    try {
      // 检查 manifest.json → tar 安装模式
      await fs.access(manifestFile);
      // tar 模式：递归删除整个目录
      await fs.rm(tarDir, { recursive: true, force: true });
      log.info(`Skill "${skillId}" uninstalled (tar mode), removed: ${tarDir}`);
    } catch {
      // JSON 模式：删除单个 JSON 文件
      try {
        await fs.unlink(jsonFile);
        log.info(`Skill "${skillId}" uninstalled (json mode), removed: ${jsonFile}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Failed to remove skill file ${jsonFile}: ${msg}`);
        // 文件删除失败不算硬错误
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
  // Private helpers
  // ============================================================

  /**
   * 校验 JSON 对象是否符合 Skill 的基本 shape
   */
  private validateSkillShape(obj: Record<string, unknown>): string | null {
    if (typeof obj.id !== 'string' || !obj.id) return '缺少 id';
    if (typeof obj.name !== 'string' || !obj.name) return '缺少 name';
    if (typeof obj.version !== 'string' || !obj.version) return '缺少 version';
    if (typeof obj.description !== 'string' || !obj.description) return '缺少 description';
    if (!['prompt', 'action', 'workflow'].includes(String(obj.category))) {
      return `无效的 category: ${obj.category}`;
    }
    if (!Array.isArray(obj.tags)) return 'tags 必须是数组';
    return null;
  }

  // ============================================================
  // Package type detection
  // ============================================================

  /**
   * 检测包安装模式。
   * 优先使用 API 返回的 packageType，fallback 用 URL 后缀判断。
   */
  private detectPackageType(info: DownloadInfo): 'skill:json' | 'skill:tar' {
    if (info.packageType) return info.packageType;
    // Fallback: 通过下载 URL 后缀判断
    if (info.downloadUrl.endsWith('.tar.gz')) return 'skill:tar';
    return 'skill:json';
  }

  // ============================================================
  // Tar.gz install pipeline (Todo 2)
  // ============================================================

  /**
   * tar.gz 安装管道（action/workflow Skill）。
   *
   * 流程：
   *  2. 下载 tar.gz 到临时目录
   *  3. SHA256 校验
   *  4. 预读 package.json（不解压全量）
   *  5. 解压到安装目录
   *  6. npm install --production --ignore-scripts
   *  (后续步骤在 Todo 3-4: 代码扫描 → import() 冒烟 → 注册)
   */
  private async installFromTar(
    packageId: string,
    downloadInfo: DownloadInfo,
  ): Promise<SkillInstallResult> {
    const skillDir = path.join(this.installDir, packageId);
    const tmpDir = path.join(this.installDir, '.tmp');
    const tarFile = path.join(tmpDir, `${packageId}-${downloadInfo.version}.tar.gz`);

    try {
      // 2. 下载 tar.gz
      log.info(`Downloading skill tar.gz: ${packageId}`);
      await fs.mkdir(tmpDir, { recursive: true });

      const { tempPath } = await this.market.download(packageId, downloadInfo.version);
      await fs.rename(tempPath, tarFile);

      // 3. SHA256 校验
      if (downloadInfo.sha256) {
        log.info(`Verifying SHA256 for ${packageId}`);
        const actualHash = await sha256File(tarFile);
        if (actualHash !== downloadInfo.sha256) {
          await this.cleanup(tmpDir, tarFile);
          return {
            success: false,
            error: `SHA256 校验失败: 期望 ${downloadInfo.sha256}, 实际 ${actualHash}`,
          };
        }
        log.info(`SHA256 verified: ${packageId}`);
      }

      // 4. 预读 package.json
      let pkgJson: Record<string, unknown>;
      try {
        const pkgContent = execSync(
          `tar -xzf "${tarFile}" -O package.json`,
          { encoding: 'utf-8', timeout: 10_000, maxBuffer: 1024 * 1024 },
        );
        pkgJson = JSON.parse(pkgContent);
      } catch {
        await this.cleanup(tmpDir, tarFile);
        return { success: false, error: 'tar.gz 中缺少有效的 package.json' };
      }

      // 校验 xuanji-skill 字段
      const skillMeta = pkgJson['xuanji-skill'] as Record<string, unknown> | undefined;
      if (!skillMeta || typeof skillMeta.id !== 'string') {
        await this.cleanup(tmpDir, tarFile);
        return { success: false, error: 'package.json 缺少 xuanji-skill.id 字段' };
      }
      if (!['action', 'workflow'].includes(String(skillMeta.category))) {
        await this.cleanup(tmpDir, tarFile);
        return { success: false, error: `无效的 category: ${skillMeta.category}（期望 action 或 workflow）` };
      }
      const skillId = skillMeta.id;

      // 5. 解压到安装目录
      await fs.mkdir(skillDir, { recursive: true });
      try {
        execSync(
          `tar -xzf "${tarFile}" -C "${skillDir}" --strip-components=1`,
          { timeout: 30_000, maxBuffer: 1024 * 1024 },
        );
      } catch (err) {
        await this.cleanup(tmpDir, tarFile);
        await fs.rm(skillDir, { recursive: true, force: true }).catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `解压失败: ${msg}` };
      }

      // 6. npm install
      try {
        log.info(`Running npm install for ${packageId}...`);
        execSync('npm install --production --ignore-scripts', {
          cwd: skillDir,
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf-8',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`npm install failed for ${packageId}: ${msg}`);
        // npm install 失败不是硬错误 — 可能包已预打包依赖
      }

      // 7. 代码安全扫描
      const mainFile = String(pkgJson.main ?? 'index.js');
      const mainPath = path.join(skillDir, mainFile);
      let source: string;
      try {
        source = await fs.readFile(mainPath, 'utf-8');
      } catch {
        await this.cleanup(tmpDir, tarFile);
        return { success: false, error: `找不到入口文件: ${mainFile}` };
      }
      const safetyResult = checkCodeSafety(source);
      if (!safetyResult.safe) {
        await this.cleanup(tmpDir, tarFile);
        return {
          success: false,
          error: `代码安全扫描失败: ${safetyResult.blocked.join(', ')}`,
        };
      }
      if (safetyResult.warnings.length > 0) {
        log.warn(`Code safety warnings for ${packageId}: ${safetyResult.warnings.join(', ')}`);
      }

      // 8. 冒烟测试：import() 试加载
      log.info(`Smoke testing skill: ${skillId}`);
      try {
        const module = await import(mainPath);
        const skillExport = module.default ?? module;
        if (typeof skillExport.execute !== 'function') {
          await this.cleanup(tmpDir, tarFile);
          return { success: false, error: '入口文件缺少 export default { execute }' };
        }
        if (skillExport.id !== skillId) {
          await this.cleanup(tmpDir, tarFile);
          return { success: false, error: `id 不匹配: 期望 ${skillId}, 实际 ${skillExport.id}` };
        }
      } catch (err) {
        await this.cleanup(tmpDir, tarFile);
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `冒烟测试失败: ${msg}` };
      }

      // 9. 构建 Skill 对象并注册
      const skill: Skill = {
        id: skillId,
        name: String(skillMeta.name ?? skillId),
        version: downloadInfo.version,
        description: String(skillMeta.description ?? ''),
        category: skillMeta.category as 'action' | 'workflow',
        tags: Array.isArray(skillMeta.tags) ? skillMeta.tags.map(String) : [],
        author: typeof skillMeta.author === 'string' ? skillMeta.author : undefined,
        parameters: skillMeta.parameters as Skill['parameters'],
        requiredTools: Array.isArray(skillMeta.requiredTools)
          ? skillMeta.requiredTools.map(String)
          : undefined,
        source: 'marketplace',
        packageId,
        installedVersion: downloadInfo.version,
        installedAt: new Date().toISOString(),
        // execute 方法由 SkillSandbox 在运行时通过 Worker 加载
      };

      this.registry.register(skill);

      // 10. 写入 manifest.json
      const manifest = {
        skillId,
        packageId,
        version: downloadInfo.version,
        installedAt: new Date().toISOString(),
        installMode: 'tar',
      };
      await fs.writeFile(
        path.join(skillDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8',
      );

      // 11. 清理临时文件
      await this.cleanup(tmpDir, tarFile);

      log.info(`Skill "${skillId}" installed successfully from tar.gz to ${skillDir}`);
      return {
        success: true,
        skillId,
        version: downloadInfo.version,
        filePath: skillDir,
      };
    } catch (err) {
      await this.cleanup(tmpDir, tarFile).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`installFromTar failed for ${packageId}: ${msg}`);
      return { success: false, error: `tar.gz 安装失败: ${msg}` };
    }
  }

  /**
   * 清理临时目录和文件
   */
  private async cleanup(tmpDir: string, tarFile: string): Promise<void> {
    try { await fs.unlink(tarFile); } catch {}
    try {
      const remaining = await fs.readdir(tmpDir);
      if (remaining.length === 0) {
        await fs.rmdir(tmpDir);
      }
    } catch {}
  }
}

// ============================================================
// Module-level utilities
// ============================================================

/**
 * 计算文件的 SHA256 哈希
 */
function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => { hash.update(chunk); });
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
