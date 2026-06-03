/**
 * ============================================================
 * MCP Market Module — UpdateChecker
 * ============================================================
 * 检查 marketplace 安装的 MCP 服务器和 Skill 是否有更新。
 *
 * 工作流：
 *  1. 收集 MCP 服务器 → MCPManager.getServerRuntimes()
 *  2. 收集 Skill        → SkillRegistry.list()
 *  3. 过滤 source='marketplace' 且有 packageId 的项
 *  4. 批量调用 TiangongMarket.checkUpdates()
 *  5. 返回更新列表
 */

import type { TiangongMarket, UpdateCheckItem } from './TiangongMarket';
import type { MCPManager } from '../MCPManager';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'UpdateChecker' });

// ============================================================
// 类型
// ============================================================

/** 更新检查结果 */
export interface UpdateCheckResult {
  /** 是否有任何可更新项 */
  hasUpdates: boolean;
  /** MCP 服务器可更新列表 */
  mcpUpdates: InstalledPackage[];
  /** Skill 可更新列表 */
  skillUpdates: InstalledPackage[];
  /** 检查失败的包（用于降级展示） */
  errors: Array<{ packageId: string; error: string }>;
}

/** 一个已安装包的更新信息 */
export interface InstalledPackage {
  /** 包类型 */
  type: 'mcp' | 'skill';
  /** 天工坊 packageId */
  packageId: string;
  /** 本地名称（MCP server name 或 skill.id） */
  localId: string;
  /** 当前版本 */
  currentVersion: string;
  /** 最新版本 */
  latestVersion: string;
  /** 更新日志 */
  changelog?: string;
}

// ============================================================
// UpdateChecker
// ============================================================

export class UpdateChecker {
  constructor(
    private readonly market: TiangongMarket,
    private readonly mcpManager?: MCPManager,
    private readonly skillRegistry?: { list(): Array<{ source?: string; packageId?: string; installedVersion?: string; id: string; version: string }> },
  ) {}

  /**
   * 检查所有 marketplace 安装的包是否有更新
   */
  async checkAll(): Promise<UpdateCheckResult> {
    const errors: Array<{ packageId: string; error: string }> = [];

    // 1. 收集 MCP 服务器
    const mcpPackages = this.collectMcpPackages(errors);

    // 2. 收集 Skill
    const skillPackages = this.collectSkillPackages(errors);

    // 3. 去重 + 合并
    const seen = new Set<string>();
    const merged = [...mcpPackages, ...skillPackages];

    const uniquePackages = merged.filter((p) => {
      if (seen.has(p.packageId)) return false;
      seen.add(p.packageId);
      return true;
    });

    if (uniquePackages.length === 0) {
      log.debug('No marketplace packages to check');
      return { hasUpdates: false, mcpUpdates: [], skillUpdates: [], errors };
    }

    // 4. 批量查询
    let checkResults: UpdateCheckItem[] = [];
    try {
      checkResults = await this.market.checkUpdates(
        uniquePackages.map((p) => ({
          packageId: p.packageId,
          currentVersion: p.currentVersion,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`checkUpdates failed: ${msg}`);
      errors.push({ packageId: '*', error: msg });
      return { hasUpdates: false, mcpUpdates: [], skillUpdates: [], errors };
    }

    // 5. 分拣结果
    const updateMap = new Map<string, UpdateCheckItem>();
    for (const item of checkResults) {
      updateMap.set(String(item.packageId), item);
    }

    const mcpUpdates: InstalledPackage[] = [];
    const skillUpdates: InstalledPackage[] = [];

    for (const pkg of mcpPackages) {
      const info = updateMap.get(pkg.packageId);
      if (info?.hasUpdate) {
        mcpUpdates.push({
          type: 'mcp',
          packageId: pkg.packageId,
          localId: pkg.localId,
          currentVersion: pkg.currentVersion,
          latestVersion: info.latestVersion,
          changelog: info.changelog,
        });
      }
    }

    for (const pkg of skillPackages) {
      const info = updateMap.get(pkg.packageId);
      if (info?.hasUpdate) {
        skillUpdates.push({
          type: 'skill',
          packageId: pkg.packageId,
          localId: pkg.localId,
          currentVersion: pkg.currentVersion,
          latestVersion: info.latestVersion,
          changelog: info.changelog,
        });
      }
    }

    return {
      hasUpdates: mcpUpdates.length > 0 || skillUpdates.length > 0,
      mcpUpdates,
      skillUpdates,
      errors,
    };
  }

  /**
   * 仅检查 MCP 服务器更新
   */
  async checkMcp(): Promise<UpdateCheckResult> {
    const errors: Array<{ packageId: string; error: string }> = [];
    const mcpPackages = this.collectMcpPackages(errors);

    if (mcpPackages.length === 0) {
      return { hasUpdates: false, mcpUpdates: [], skillUpdates: [], errors };
    }

    let checkResults: UpdateCheckItem[];
    try {
      checkResults = await this.market.checkUpdates(
        mcpPackages.map((p) => ({
          packageId: p.packageId,
          currentVersion: p.currentVersion,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ packageId: '*', error: msg });
      return { hasUpdates: false, mcpUpdates: [], skillUpdates: [], errors };
    }

    const updateMap = new Map<string, UpdateCheckItem>();
    for (const item of checkResults) {
      updateMap.set(String(item.packageId), item);
    }

    const mcpUpdates: InstalledPackage[] = [];
    for (const pkg of mcpPackages) {
      const info = updateMap.get(pkg.packageId);
      if (info?.hasUpdate) {
        mcpUpdates.push({
          type: 'mcp',
          packageId: pkg.packageId,
          localId: pkg.localId,
          currentVersion: pkg.currentVersion,
          latestVersion: info.latestVersion,
          changelog: info.changelog,
        });
      }
    }

    return { hasUpdates: mcpUpdates.length > 0, mcpUpdates, skillUpdates: [], errors };
  }

  /**
   * 仅检查 Skill 更新
   */
  async checkSkills(): Promise<UpdateCheckResult> {
    const errors: Array<{ packageId: string; error: string }> = [];
    const skillPackages = this.collectSkillPackages(errors);

    if (skillPackages.length === 0) {
      return { hasUpdates: false, mcpUpdates: [], skillUpdates: [], errors };
    }

    let checkResults: UpdateCheckItem[];
    try {
      checkResults = await this.market.checkUpdates(
        skillPackages.map((p) => ({
          packageId: p.packageId,
          currentVersion: p.currentVersion,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ packageId: '*', error: msg });
      return { hasUpdates: false, mcpUpdates: [], skillUpdates: [], errors };
    }

    const updateMap = new Map<string, UpdateCheckItem>();
    for (const item of checkResults) {
      updateMap.set(String(item.packageId), item);
    }

    const skillUpdates: InstalledPackage[] = [];
    for (const pkg of skillPackages) {
      const info = updateMap.get(pkg.packageId);
      if (info?.hasUpdate) {
        skillUpdates.push({
          type: 'skill',
          packageId: pkg.packageId,
          localId: pkg.localId,
          currentVersion: pkg.currentVersion,
          latestVersion: info.latestVersion,
          changelog: info.changelog,
        });
      }
    }

    return { hasUpdates: skillUpdates.length > 0, mcpUpdates: [], skillUpdates, errors };
  }

  // ============================================================
  // Private collectors
  // ============================================================

  private collectMcpPackages(
    errors: Array<{ packageId: string; error: string }>,
  ): Array<{ packageId: string; localId: string; currentVersion: string }> {
    const result: Array<{ packageId: string; localId: string; currentVersion: string }> = [];

    if (!this.mcpManager) return result;

    try {
      const runtimes = this.mcpManager.getServerRuntimes();
      for (const rt of runtimes) {
        if (!rt.config.source || rt.config.source !== 'marketplace') continue;
        if (!rt.config.packageId) continue;

        result.push({
          packageId: rt.config.packageId,
          localId: rt.name,
          currentVersion: rt.config.installedVersion ?? '0.0.0',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to collect MCP packages: ${msg}`);
      errors.push({ packageId: 'mcp:*', error: msg });
    }

    return result;
  }

  private collectSkillPackages(
    errors: Array<{ packageId: string; error: string }>,
  ): Array<{ packageId: string; localId: string; currentVersion: string }> {
    const result: Array<{ packageId: string; localId: string; currentVersion: string }> = [];

    if (!this.skillRegistry) return result;

    try {
      const skills = this.skillRegistry.list();
      for (const skill of skills) {
        if (!skill.source || skill.source !== 'marketplace') continue;
        if (!skill.packageId) continue;

        result.push({
          packageId: skill.packageId,
          localId: skill.id,
          currentVersion: skill.installedVersion ?? skill.version ?? '0.0.0',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to collect skill packages: ${msg}`);
      errors.push({ packageId: 'skill:*', error: msg });
    }

    return result;
  }
}
