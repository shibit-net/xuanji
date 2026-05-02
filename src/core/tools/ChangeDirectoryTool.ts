// ============================================================
// ChangeDirectoryTool — 切换工作目录并扫描项目信息
// ============================================================

import { access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';
import { ProjectScanner } from '@/context/ProjectScanner';

const log = logger.child({ module: 'ChangeDirectoryTool' });

/**
 * 切换工作目录工具
 *
 * 功能：
 * - 切换当前工作目录
 * - 自动扫描项目信息（类型、git、依赖等）
 * - 触发项目上下文更新
 *
 * 使用场景：
 * - Agent 需要在不同项目间切换
 * - 确保后续工具调用基于正确的项目上下文
 */
export class ChangeDirectoryTool extends BaseTool {
  readonly name = 'change_directory';
  readonly description = [
    'Switch to a different project directory. Always call this before working on a project.',
    '',
    'This ensures all subsequent file operations use the correct working directory',
    'and project context (git info, dependencies, etc.) is loaded.',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Target directory path (absolute or relative, ~ supported)',
      },
    },
    required: ['path'],
  };

  /** 只读工具（不修改文件系统） */
  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const targetPath = input.path as string;

    log.debug(`Changing directory to: ${targetPath}`);

    try {
      // 解析路径（支持 ~ 和相对路径）
      const resolvedPath = resolve(targetPath.replace(/^~/, process.env.HOME || '~'));

      // 检查目录是否存在
      try {
        await access(resolvedPath);
      } catch {
        log.warn(`Directory not found: ${resolvedPath}`);
        return this.error(`目录不存在: ${resolvedPath}`);
      }

      // 检查是否为目录
      const stats = await stat(resolvedPath);
      if (!stats.isDirectory()) {
        log.warn(`Not a directory: ${resolvedPath}`);
        return this.error(`路径不是目录: ${resolvedPath}`);
      }

      // 检查是否为敏感系统目录
      if (this.isSensitivePath(resolvedPath)) {
        log.warn(`Sensitive directory blocked: ${resolvedPath}`);
        return this.error(`不允许切换到系统目录: ${resolvedPath}`);
      }

      // 切换工作目录
      process.chdir(resolvedPath);
      log.info(`Working directory changed to: ${resolvedPath}`);

      // 扫描项目信息
      const scanner = new ProjectScanner();
      const projectInfo = scanner.scan(resolvedPath);

      log.debug('Project info scanned:', projectInfo);

      // 构建返回信息
      const infoLines = [
        `✓ 工作目录已切换: ${resolvedPath}`,
        '',
        '项目信息:',
        `  类型: ${projectInfo.type}`,
        `  Git: ${projectInfo.hasGit ? '是' : '否'}`,
      ];

      if (projectInfo.hasGit) {
        // 获取 git 分支
        try {
          const { execSync } = await import('node:child_process');
          const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: resolvedPath,
            encoding: 'utf-8',
          }).trim();
          infoLines.push(`  分支: ${branch}`);
        } catch (err) {
          log.warn('Failed to get git branch:', err);
        }
      }

      if (projectInfo.configFiles.length > 0) {
        infoLines.push(`  配置文件: ${projectInfo.configFiles.join(', ')}`);
      }

      const output = infoLines.join('\n');

      return this.success(output, {
        path: resolvedPath,
        projectType: projectInfo.type,
        hasGit: projectInfo.hasGit,
        rootPath: projectInfo.rootPath,
        configFiles: projectInfo.configFiles,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to change directory: ${targetPath}`, { error: message });
      return this.error(`切换目录失败: ${message}`);
    }
  }
}
