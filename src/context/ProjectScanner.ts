/**
 * ============================================================
 * M3 上下文引擎 — ProjectScanner
 * ============================================================
 * 扫描当前工作目录，识别项目类型和基本元数据。
 *
 * 检测策略：
 * - 从当前工作目录向上递归查找特征文件（最多 5 层）
 * - 找到 .git 或项目配置文件即确定项目根目录
 * - 使用同步 API，启动阶段性能可接受
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectMetadata, ProjectType, DetectionRule } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ProjectScanner' });

/** 向上查找最大层数 */
const MAX_DEPTH = 5;

/** 项目类型检测规则（按优先级排列） */
const DETECTION_RULES: DetectionRule[] = [
  { type: 'node', files: ['package.json'] },
  { type: 'java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { type: 'python', files: ['pyproject.toml', 'setup.py', 'requirements.txt'] },
  { type: 'go', files: ['go.mod'] },
  { type: 'rust', files: ['Cargo.toml'] },
];

export class ProjectScanner {
  private cachedResult: ProjectMetadata | null = null;

  /**
   * 扫描项目元数据，结果在实例生命周期内缓存
   */
  scan(cwd?: string): ProjectMetadata {
    if (this.cachedResult) return this.cachedResult;

    const startDir = cwd ?? process.cwd();
    let currentDir = startDir;
    let depth = 0;

    while (depth < MAX_DEPTH) {
      const hasGit = this.hasGit(currentDir);
      const detected = this.detectType(currentDir);

      if (detected.type !== 'unknown' || hasGit) {
        this.cachedResult = {
          type: detected.type,
          hasGit,
          rootPath: currentDir,
          configFiles: detected.configFiles,
        };
        log.debug('Project detected:', this.cachedResult);
        return this.cachedResult;
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) break; // 到达文件系统根目录
      currentDir = parent;
      depth++;
    }

    // 未检测到，使用当前工作目录
    this.cachedResult = {
      type: 'unknown',
      hasGit: false,
      rootPath: startDir,
      configFiles: [],
    };
    log.debug('No project detected, using cwd as root');
    return this.cachedResult;
  }

  /**
   * 检测目录下的项目类型
   */
  private detectType(dir: string): { type: ProjectType; configFiles: string[] } {
    const configFiles: string[] = [];
    let detectedType: ProjectType = 'unknown';

    for (const rule of DETECTION_RULES) {
      for (const file of rule.files) {
        const filePath = path.join(dir, file);
        try {
          if (fs.existsSync(filePath)) {
            configFiles.push(file);
            if (detectedType === 'unknown') {
              detectedType = rule.type;
            }
          }
        } catch {
          // 忽略文件系统错误
        }
      }
    }

    return { type: detectedType, configFiles };
  }

  /**
   * 检查目录是否为 Git 仓库
   */
  private hasGit(dir: string): boolean {
    try {
      return fs.existsSync(path.join(dir, '.git'));
    } catch {
      return false;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedResult = null;
  }
}
