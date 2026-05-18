/**
 * ============================================================
 * Skill System — SkillInstaller
 * ============================================================
 * 从天工坊 Marketplace 安装 Skill JSON/YAML 文件到
 * ~/.xuanji/skills/installed/，并注册到 SkillRegistry。
 */

import { homedir } from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import type { Skill } from './types';
import type { SkillRegistry } from './registry';
import type { TiangongMarket, DownloadInfo } from '@/mcp/market/TiangongMarket';
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

    // 2. 下载 JSON 文件
    let rawContent: string;
    try {
      rawContent = await this.downloadText(downloadInfo.downloadUrl);
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
   * 卸载 marketplace 安装的 Skill
   *
   * 1. SkillRegistry.unregister()
   * 2. 删除 ~/.xuanji/skills/installed/{packageId}.json
   */
  async uninstall(skillId: string): Promise<SkillUninstallResult> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      return { success: false, error: `Skill "${skillId}" 未注册` };
    }
    if (skill.source !== 'marketplace') {
      return { success: false, error: `Skill "${skillId}" 不是 marketplace 安装的` };
    }

    // 从注册表移除
    this.registry.unregister(skillId);

    // 删除文件
    const packageId = skill.packageId ?? skillId;
    const filePath = path.join(this.installDir, `${packageId}.json`);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to remove skill file ${filePath}: ${msg}`);
      // 文件删除失败不算硬错误 — 注册表已经移除了
    }

    log.info(`Skill "${skillId}" uninstalled`);
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
    if (!['prompt', 'action', 'workflow', 'agent'].includes(String(obj.category))) {
      return `无效的 category: ${obj.category}`;
    }
    if (!Array.isArray(obj.tags)) return 'tags 必须是数组';
    return null;
  }

  /**
   * HTTP(S) 下载文本内容
   */
  private downloadText(urlStr: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.get(
        url,
        { headers: { 'User-Agent': 'xuanji/0.9.0' } },
        (res) => {
          const { statusCode } = res;
          if (!statusCode) {
            reject(new Error('No status code'));
            return;
          }

          // 处理重定向
          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            const redirectUrl = this.resolveRedirect(res.headers.location, url);
            this.downloadText(redirectUrl).then(resolve).catch(reject);
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode}`));
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          res.on('error', reject);
        },
      );

      req.on('error', reject);
      req.setTimeout(30_000, () => {
        req.destroy();
        reject(new Error('下载超时 (30s)'));
      });
    });
  }

  /**
   * 解析重定向 URL（支持相对路径）
   */
  private resolveRedirect(location: string, base: URL): string {
    try {
      return new URL(location, base).href;
    } catch {
      return location;
    }
  }
}
