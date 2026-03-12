// ============================================================
// Agent Skill 安装器
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '@/core/logger';
import type { SkillFilesConfig, InstalledPackage } from './types';
import { RegistryClient } from './RegistryClient';

const log = logger.child({ module: 'SkillInstaller' });

export class SkillInstaller {
  private registryClient: RegistryClient;
  private skillsDir: string;
  private installedPath: string;

  constructor(registryClient: RegistryClient) {
    this.registryClient = registryClient;
    this.skillsDir = path.join(os.homedir(), '.xuanji', 'skills');
    this.installedPath = path.join(os.homedir(), '.xuanji', 'tiangong-installed.json');
  }

  /** 安装 Agent Skill */
  async install(packageId: string, version?: string): Promise<string> {
    const config = await this.registryClient.getInstallConfig(packageId, version);

    if (config.type !== 'skill') {
      throw new Error(`"${packageId}" 不是 Agent Skill 类型`);
    }

    const skillConfig: SkillFilesConfig = JSON.parse(config.configTemplate);
    const skillDirName = packageId.replace(/\//g, '-');
    const skillPath = path.join(this.skillsDir, skillDirName);

    // 已存在则先删除
    if (fs.existsSync(skillPath)) {
      log.warn(`Skill 目录 "${skillDirName}" 已存在，将覆盖`);
      fs.rmSync(skillPath, { recursive: true, force: true });
    }

    fs.mkdirSync(skillPath, { recursive: true });

    // 写入文件
    const files = skillConfig.files;
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = path.join(skillPath, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');

      // scripts/ 下的文件添加执行权限
      if (relativePath.startsWith('scripts/')) {
        fs.chmodSync(fullPath, 0o755);
      }
    }

    // 验证 SKILL.md 存在
    if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) {
      throw new Error(`无效的 Skill: "${packageId}" 缺少 SKILL.md`);
    }

    // 记录安装信息
    this.recordInstalled({
      packageId,
      name: skillDirName,
      type: 'skill',
      version: config.version,
      installedAt: new Date().toISOString(),
      installPath: skillPath,
    });

    // 记录下载统计
    await this.registryClient.recordDownload(0, config.versionId);

    const fileList = Object.keys(files).join(', ');
    const msg = `Skill "${packageId}" 安装成功\n  位置: ${skillPath}\n  文件: ${fileList}\n  重启 xuanji 以加载新 Skill`;
    log.info(msg);
    return msg;
  }

  /** 卸载 Skill */
  uninstall(packageId: string): string {
    const installed = this.getInstalledList();
    const record = installed.find(p => p.packageId === packageId && p.type === 'skill');
    if (!record) {
      throw new Error(`"${packageId}" 未通过天工坊安装`);
    }

    if (fs.existsSync(record.installPath)) {
      fs.rmSync(record.installPath, { recursive: true, force: true });
    }
    this.removeInstalled(packageId);

    return `Skill "${packageId}" 已卸载`;
  }

  private recordInstalled(record: InstalledPackage): void {
    const list = this.getInstalledList();
    const idx = list.findIndex(p => p.packageId === record.packageId);
    if (idx !== -1) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    fs.mkdirSync(path.dirname(this.installedPath), { recursive: true });
    fs.writeFileSync(this.installedPath, JSON.stringify(list, null, 2));
  }

  private removeInstalled(packageId: string): void {
    const list = this.getInstalledList().filter(p => p.packageId !== packageId);
    fs.writeFileSync(this.installedPath, JSON.stringify(list, null, 2));
  }

  getInstalledList(): InstalledPackage[] {
    if (!fs.existsSync(this.installedPath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(this.installedPath, 'utf-8'));
  }
}
