// ============================================================
// SystemDiagnostics — 系统诊断服务
// ============================================================
// 负责系统诊断，生成诊断信息供 /doctor 命令使用

import type { AppConfig } from '@/core/types';
import { MCPManager } from '@/mcp/MCPManager';
import type { SkillRegistry } from '@/core/skills';
import type { IPermissionController } from '@/permission/types';
import { generateDiagnostics, type DiagnosticsContext } from './SessionDiagnostics';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SystemDiagnostics' });

/**
 * 系统诊断服务
 * 负责生成系统诊断信息
 */
export class SystemDiagnostics {
  /**
   * 获取系统诊断信息
   * @param context 诊断上下文
   * @returns 诊断信息字符串
   */
  async getDiagnostics(context: {
    config: AppConfig;
    mcpManager: MCPManager | null;
    skillRegistry: SkillRegistry | null;
    permissionController: IPermissionController | null;
    initialized: boolean;
  }): Promise<string> {
    try {
      const diagnosticsContext: DiagnosticsContext = {
        config: context.config,
        mcpManager: context.mcpManager,
        skillRegistry: context.skillRegistry,
        permissionController: context.permissionController,
        initialized: context.initialized,
      };

      const diagnostics = await generateDiagnostics(diagnosticsContext);
      log.debug('System diagnostics generated successfully');
      return diagnostics;
    } catch (err) {
      log.warn('Failed to generate system diagnostics:', err);
      return `❌ 诊断生成失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 验证系统配置
   * @param config 应用配置
   * @returns 验证结果
   */
  validateConfig(config: AppConfig): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证 Provider 配置
    if (!config.provider) {
      errors.push('Provider 配置缺失');
    } else {
      if (!config.provider.apiKey) {
        errors.push('API Key 配置缺失');
      }
      if (!config.provider.model) {
        errors.push('模型配置缺失');
      }
    }

    // 验证 MCP 配置
    if (config.mcp) {
      if (config.mcp.enabled && (!config.mcp.servers || config.mcp.servers.length === 0)) {
        warnings.push('MCP 已启用但未配置服务器地址');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查系统依赖
   * @returns 依赖检查结果
   */
  checkDependencies(): {
    installed: boolean;
    version: string | null;
    issues: string[];
  } {
    const issues: string[] = [];
    let version: string | null = null;

    try {
      // 检查 Node.js 版本
      const nodeVersion = process.version;
      version = nodeVersion;

      // 检查最低 Node.js 版本要求
      const requiredMajor = 20;
      const currentMajor = parseInt(nodeVersion.replace('v', '').split('.')[0]);

      if (currentMajor < requiredMajor) {
        issues.push(`Node.js 版本过低，需要 v${requiredMajor}+，当前为 ${nodeVersion}`);
      }
    } catch (err) {
      issues.push('无法检查 Node.js 版本');
    }

    return {
      installed: issues.length === 0,
      version,
      issues,
    };
  }

  /**
   * 生成系统状态报告
   * @param context 诊断上下文
   * @returns 状态报告字符串
   */
  async generateStatusReport(context: {
    config: AppConfig;
    mcpManager: MCPManager | null;
    skillRegistry: SkillRegistry | null;
    permissionController: IPermissionController | null;
    initialized: boolean;
  }): Promise<string> {
    try {
      const diagnostics = await this.getDiagnostics(context);
      const configValidation = this.validateConfig(context.config);
      const dependencyCheck = this.checkDependencies();

      let report = '## 📊 系统状态报告\n\n';

      // 依赖检查
      report += '### 🛠️ 依赖状态\n';
      if (dependencyCheck.installed) {
        report += `✅ Node.js: ${dependencyCheck.version}\n`;
      } else {
        report += `❌ 依赖问题:\n`;
        for (const issue of dependencyCheck.issues) {
          report += `  - ${issue}\n`;
        }
      }

      // 配置验证
      report += '\n### ⚙️ 配置状态\n';
      if (configValidation.valid) {
        report += '✅ 配置有效\n';
      } else {
        report += `❌ 配置错误:\n`;
        for (const error of configValidation.errors) {
          report += `  - ${error}\n`;
        }
      }

      if (configValidation.warnings.length > 0) {
        report += `\n⚠️ 配置警告:\n`;
        for (const warning of configValidation.warnings) {
          report += `  - ${warning}\n`;
        }
      }

      // 详细诊断
      report += '\n### 📋 详细诊断\n';
      report += diagnostics;

      return report;
    } catch (err) {
      log.warn('Failed to generate status report:', err);
      return `❌ 状态报告生成失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
