// ============================================================
// M5 权限控制 — 命令守卫
// ============================================================
//
// 分析 Bash 命令的风险级别:
//   - danger: 极度危险命令 (rm -rf /, fork bomb 等)
//   - warn: 潜在危险命令 (sudo, rm -rf, git push --force 等)
//   - safe: 普通命令
//
// 注意: 所有命令均可通过用户确认执行，没有绝对禁止的命令。
// 但 danger 级别的命令会在 UI 中给出 ⛔ 极强的警告提示。
//

import { PolicyEngine } from '../policies/PolicyEngine';
import type { GuardCheckResult } from '../types';
import { t } from '@/core/i18n';

/**
 * 极度危险命令模式 — 标记为 danger（可通过确认执行，但需极强警告）
 * 这些命令可能导致系统不可逆损坏
 */
const EXTREME_DANGER_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+|--recursive\s+--force\s+|--force\s+--recursive\s+)\/(\s|$)/, description: '删除根目录 (rm -rf /)' },
  { pattern: /\bsudo\s+rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+|--recursive\s+--force\s+|--force\s+--recursive\s+)\/(\s|$)/, description: '以 root 权限删除根目录' },
  { pattern: /:\(\)\{.*\|.*&\s*\}\s*;/, description: 'Fork bomb — 系统资源耗尽' },
  { pattern: /\bdd\s+.*\bof\s*=\s*\/dev\/[a-z]/, description: '直接写入设备 (dd of=/dev/...)' },
  { pattern: /\bmkfs\b/, description: '格式化文件系统 (mkfs)' },
  { pattern: />\s*\/dev\/[hs]d[a-z]/, description: '重定向到磁盘设备' },
  { pattern: /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+|--recursive\s+)777\s+\//, description: '递归开放根目录权限' },
];

/**
 * 潜在危险命令模式 — 标记为 warn
 */
const DANGER_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bsudo\b/, description: '使用 sudo 提权' },
  { pattern: /\brm\s+(-[a-zA-Z]*[rf]|--recursive|--force)/, description: '递归/强制删除文件' },
  { pattern: /\bchmod\s+(-[a-zA-Z]*R|--recursive)\s+777\b/, description: '递归开放权限 (chmod -R 777)' },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh/, description: '网络脚本直接执行 (curl | sh)' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh/, description: '网络脚本直接执行 (wget | sh)' },
  { pattern: /\bgit\s+push\s+.*--force\b/, description: '强制推送 (git push --force)' },
  { pattern: /\bgit\s+push\s+-f\b/, description: '强制推送 (git push -f)' },
  { pattern: /\bgit\s+reset\s+--hard\b/, description: '硬重置 (git reset --hard)' },
  { pattern: /\bgit\s+clean\s+.*-[a-zA-Z]*f/, description: '强制清理 (git clean -f)' },
  { pattern: /\bkill\s+-9\b/, description: '强制杀死进程 (kill -9)' },
  { pattern: /\bkillall\b/, description: '批量杀死进程 (killall)' },
  { pattern: /\bshutdown\b|\breboot\b/, description: '系统关机/重启' },
  { pattern: /\bnpm\s+publish\b/, description: '发布 npm 包' },
  { pattern: /\bdocker\s+rm\b/, description: '删除 Docker 容器' },
  { pattern: /\bdocker\s+system\s+prune\b/, description: '清理 Docker 系统' },
];

/**
 * CommandGuard — 命令守卫
 *
 * 检查 Bash 命令的风险级别，返回操作类别、风险等级和描述信息。
 */
export class CommandGuard {
  /**
   * 检查命令的风险
   *
   * @param command 待执行的命令
   * @param policyEngine 策略引擎 (用于读取黑白名单)
   * @returns GuardCheckResult
   */
  check(command: string, policyEngine: PolicyEngine): GuardCheckResult {
    const trimmedCommand = command.trim();
    const commandName = this.extractCommandName(trimmedCommand);

    // 1. 检查黑名单
    const deniedCommands = policyEngine.getDeniedCommands();
    if (deniedCommands.length > 0 && this.matchesDeniedList(trimmedCommand, commandName, deniedCommands)) {
      return {
        category: 'bashExec',
        riskLevel: 'danger',
        description: t('perm.guard_denied_cmd', { cmd: commandName }),
        cacheKey: `bash:denied:${commandName}`,
      };
    }

    // 2. 检查极度危险命令
    for (const { pattern, description } of EXTREME_DANGER_PATTERNS) {
      if (pattern.test(trimmedCommand)) {
        return {
          category: 'bashExec',
          riskLevel: 'danger',
          description: t('perm.guard_extreme_danger', { desc: description }),
          cacheKey: `bash:extreme:${description}`,
        };
      }
    }

    // 3. 检查潜在危险命令
    for (const { pattern, description } of DANGER_PATTERNS) {
      if (pattern.test(trimmedCommand)) {
        return {
          category: 'bashExec',
          riskLevel: 'warn',
          description,
          cacheKey: `bash:${commandName}`,
        };
      }
    }

    // 4. 检查白名单
    const allowedCommands = policyEngine.getAllowedCommands();
    if (allowedCommands.length > 0 && this.matchesAllowedList(commandName, allowedCommands)) {
      return {
        category: 'bashExec',
        riskLevel: 'safe',
        description: t('perm.guard_allowed_cmd', { cmd: commandName }),
        cacheKey: `bash:allowed:${commandName}`,
      };
    }

    // 5. 默认: 安全
    return {
      category: 'bashExec',
      riskLevel: 'safe',
      description: t('perm.guard_bash_exec', { cmd: commandName }),
      cacheKey: `bash:${commandName}`,
    };
  }

  /**
   * 提取命令名 (第一个非环境变量/非 sudo 的单词)
   */
  private extractCommandName(command: string): string {
    // 去除前导环境变量 (KEY=VALUE)
    let stripped = command.replace(/^(\s*\w+=\S+\s+)*/, '');
    // 去除 sudo
    stripped = stripped.replace(/^\s*sudo\s+(-\S+\s+)*/, '');
    // 提取第一个单词
    const match = stripped.match(/^\s*(\S+)/);
    return match?.[1] ?? command.split(/\s/)[0] ?? command;
  }

  /**
   * 检查命令是否匹配黑名单
   */
  private matchesDeniedList(
    fullCommand: string,
    commandName: string,
    deniedCommands: string[],
  ): boolean {
    return deniedCommands.some((pattern) => {
      // 精确匹配命令名
      if (commandName === pattern) return true;
      // 模式匹配 (含通配符)
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(commandName) || regex.test(fullCommand);
      }
      // 子串匹配
      return fullCommand.includes(pattern);
    });
  }

  /**
   * 检查命令名是否匹配白名单
   */
  private matchesAllowedList(commandName: string, allowedCommands: string[]): boolean {
    return allowedCommands.some((pattern) => {
      if (commandName === pattern) return true;
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(commandName);
      }
      return false;
    });
  }
}
