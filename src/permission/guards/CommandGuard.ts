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
import { t } from '@/i18n';

/**
 * 极度危险命令模式 — 标记为 danger（可通过确认执行，但需极强警告）
 * 这些命令可能导致系统不可逆损坏
 */
const EXTREME_DANGER_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+|--recursive\s+--force\s+|--force\s+--recursive\s+)\/(\s|$|\*)/, description: '删除根目录 (rm -rf /)' },
  { pattern: /\bsudo\s+rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+|--recursive\s+--force\s+|--force\s+--recursive\s+)\/(\s|$|\*)/, description: '以 root 权限删除根目录' },
  { pattern: /\brm\b.*--no-preserve-root/, description: '删除根目录 (--no-preserve-root)' },
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
  // 云原生高危命令
  { pattern: /\bkubectl\s+(delete|destroy)\b/, description: 'kubectl 删除资源' },
  { pattern: /\bterraform\s+destroy\b/, description: 'Terraform 销毁基础设施' },
  { pattern: /\baws\s+.*\s+(delete|remove|destroy)\b/, description: 'AWS CLI 删除操作' },
  { pattern: /\bgcloud\s+.*\s+(delete|destroy)\b/, description: 'GCloud CLI 删除操作' },
  // 容器管理
  { pattern: /\bdocker\s+rmi\b/, description: '删除 Docker 镜像' },
  { pattern: /\bdocker\s+volume\s+rm\b/, description: '删除 Docker 数据卷' },
  { pattern: /\bdocker\s+network\s+rm\b/, description: '删除 Docker 网络' },
  // 数据库危险操作
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, description: '删除数据库表/库' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, description: '清空数据库表 (TRUNCATE)' },
  { pattern: /\bDELETE\s+FROM\b/i, description: '删除数据库记录 (DELETE FROM)' },
  // 全局包安装
  { pattern: /\bnpm\s+install\s+(-g|--global)\b/, description: '全局安装 npm 包' },
  { pattern: /\bpip\s+install\s+(--user|-U)\b/, description: '安装 Python 包 (pip install)' },
  { pattern: /\byarn\s+global\s+add\b/, description: '全局安装 yarn 包' },
  // 环境变量泄露
  { pattern: /\bprintenv\b/, description: '打印所有环境变量' },
  { pattern: /\benv\s*>/, description: '导出环境变量到文件' },
  { pattern: /\bexport\s+\w*(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)\w*\s*=/i, description: '导出敏感环境变量' },
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

    // 先对完整命令检查跨管道的危险模式（如 curl | bash 需要看到整个管道）
    const fullResult = this.checkSingleCommand(trimmedCommand, policyEngine);
    if (fullResult.riskLevel === 'danger' || fullResult.riskLevel === 'warn') {
      return fullResult;
    }

    // 再拆分管道/链式命令，对每个子命令独立检查，取最高风险级别
    const subCommands = this.splitSubCommands(trimmedCommand);
    if (subCommands.length <= 1) {
      return fullResult; // 无管道/链式，直接返回
    }

    let worstResult: GuardCheckResult = fullResult;

    for (const subCmd of subCommands) {
      const result = this.checkSingleCommand(subCmd.trim(), policyEngine);
      if (this.riskOrder(result.riskLevel) > this.riskOrder(worstResult.riskLevel)) {
        worstResult = result;
      }
      // danger 是最高级别，无需继续
      if (result.riskLevel === 'danger') break;
    }

    return worstResult;
  }

  /**
   * 按 |, &&, ||, ; 拆分子命令
   * 注意：不拆分引号和 $() 内的分隔符
   */
  private splitSubCommands(command: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let depth = 0; // $() 嵌套深度

    for (let i = 0; i < command.length; i++) {
      const ch = command[i];
      const prev = i > 0 ? command[i - 1] : '';
      const next = command[i + 1];

      if (ch === "'" && !inDoubleQuote && !inBacktick && depth === 0) {
        inSingleQuote = !inSingleQuote;
        current += ch;
      } else if (ch === '"' && !inSingleQuote && !inBacktick && depth === 0) {
        inDoubleQuote = !inDoubleQuote;
        current += ch;
      } else if (ch === '`' && !inSingleQuote && prev !== '\\') {
        // 反引号切换：提取反引号内的内容作为独立子命令
        if (!inBacktick) {
          // 进入反引号：保存当前内容，开始收集反引号内命令
          inBacktick = true;
          current += ch;
        } else {
          // 离开反引号：反引号内容结束
          inBacktick = false;
          current += ch;
          // 提取反引号内的内容作为独立子命令检查
          const backtickStart = current.lastIndexOf('`', current.length - 2);
          if (backtickStart !== -1) {
            const backtickContent = current.slice(backtickStart + 1, -1);
            if (backtickContent.trim()) {
              parts.push(backtickContent);
            }
          }
        }
      } else if (ch === '$' && next === '(' && !inSingleQuote && !inBacktick) {
        depth++;
        current += ch;
      } else if (ch === ')' && depth > 0 && !inSingleQuote && !inBacktick) {
        depth--;
        current += ch;
        // 当 $() 闭合时，提取内容作为子命令
        if (depth === 0) {
          const subStart = current.lastIndexOf('$(');
          if (subStart !== -1) {
            const subContent = current.slice(subStart + 2, -1); // 去掉 $( 和 )
            if (subContent.trim()) {
              parts.push(subContent);
            }
          }
        }
      } else if (!inSingleQuote && !inDoubleQuote && !inBacktick && depth === 0) {
        // 检查分隔符
        if (ch === '|' && next === '|') {
          parts.push(current);
          current = '';
          i++; // 跳过第二个 |
        } else if (ch === '&' && next === '&') {
          parts.push(current);
          current = '';
          i++; // 跳过第二个 &
        } else if (ch === '|') {
          parts.push(current);
          current = '';
        } else if (ch === ';') {
          parts.push(current);
          current = '';
        } else {
          current += ch;
        }
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);
    return parts.length > 0 ? parts : [command];
  }

  /**
   * 风险级别排序值（值越大越危险）
   */
  private riskOrder(level: string): number {
    switch (level) {
      case 'danger': return 3;
      case 'warn': return 2;
      case 'safe': return 1;
      default: return 0;
    }
  }

  /**
   * 检查单个子命令的风险（原有逻辑）
   */
  private checkSingleCommand(command: string, policyEngine: PolicyEngine): GuardCheckResult {
    const commandName = this.extractCommandName(command);

    // 1. 检查黑名单
    const deniedCommands = policyEngine.getDeniedCommands();
    if (deniedCommands.length > 0 && this.matchesDeniedList(command, commandName, deniedCommands)) {
      return {
        category: 'bashExec',
        riskLevel: 'danger',
        description: t('perm.guard_denied_cmd', { cmd: commandName }),
        cacheKey: `bash:denied:${commandName}`,
      };
    }

    // 2. 检查极度危险命令
    for (const { pattern, description } of EXTREME_DANGER_PATTERNS) {
      if (pattern.test(command)) {
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
      if (pattern.test(command)) {
        return {
          category: 'bashExec',
          riskLevel: 'warn',
          description,
          cacheKey: `bash:warn:${description}`,
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
      // 模式匹配 (含通配符) — 先转义正则特殊字符，再将 * 转为 .*
      if (pattern.includes('*')) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
        const regex = new RegExp('^' + escaped + '$');
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
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
        const regex = new RegExp('^' + escaped + '$');
        return regex.test(commandName);
      }
      return false;
    });
  }

  /**
   * 检测命令的语义操作类型
   */
  detectOperationType(command: string): {
    type: 'delete' | 'write' | 'read' | 'execute' | 'unknown';
    targets: string[];
  } {
    const trimmed = command.trim();

    // 检测删除操作
    if (/\b(rm|rimraf|del|rmdir)\b/.test(trimmed)) {
      return {
        type: 'delete',
        targets: this.extractTargets(trimmed, ['rm', 'rimraf', 'del', 'rmdir']),
      };
    }

    // 检测写入操作
    if (/\b(echo|cat|tee|sed\s+-i)\b.*>|>>/.test(trimmed) || />\s*[^&|]/.test(trimmed)) {
      return {
        type: 'write',
        targets: this.extractTargets(trimmed, ['>', '>>']),
      };
    }

    // 检测读取操作
    if (/\b(cat|less|head|tail|grep|more)\b/.test(trimmed)) {
      return {
        type: 'read',
        targets: this.extractTargets(trimmed, ['cat', 'less', 'head', 'tail', 'grep', 'more']),
      };
    }

    // 检测执行操作
    if (/\b(node|python|python3|bash|sh|zsh|npm|yarn|pnpm)\b/.test(trimmed)) {
      return {
        type: 'execute',
        targets: this.extractTargets(trimmed, ['node', 'python', 'python3', 'bash', 'sh', 'zsh']),
      };
    }

    return {
      type: 'unknown',
      targets: [],
    };
  }

  /**
   * 从命令中提取目标路径
   */
  private extractTargets(command: string, keywords: string[]): string[] {
    const targets: string[] = [];
    
    // 简单的路径提取：查找命令关键字后的参数
    for (const keyword of keywords) {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('\\b' + escapedKeyword + '\\b\\s+([^\\s|&;]+)', 'g');
      let match;
      while ((match = regex.exec(command)) !== null) {
        const target = match[1];
        // 过滤掉选项参数（以 - 开头）
        if (target && !target.startsWith('-')) {
          targets.push(target);
        }
      }
    }

    // 对于重定向操作，提取 > 或 >> 后的文件名
    if (keywords.includes('>') || keywords.includes('>>')) {
      const redirectRegex = />>?\s*([^\s|&;]+)/g;
      let match;
      while ((match = redirectRegex.exec(command)) !== null) {
        const target = match[1];
        if (target && !target.startsWith('-')) {
          targets.push(target);
        }
      }
    }

    return targets;
  }
}
