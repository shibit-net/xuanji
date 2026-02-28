// ============================================================
// M6 工具系统 — BashTool 执行命令
// ============================================================

import { spawn } from 'node:child_process';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { BackgroundTaskManager } from './BackgroundTaskManager';
import { getSharedShell } from './PersistentShell';
import { middleTruncate, getMaxToolOutputLength } from '@/core/utils/truncation';
import { getToolTimeouts } from '@/core/config/RuntimeConfig';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'BashTool' });

/** 默认命令超时 (ms) */
const DEFAULT_TIMEOUT = 120_000;

/**
 * 需要从后台任务子进程中清除的敏感环境变量
 * 防止通过 `env` 或 `printenv` 泄漏凭据
 */
const SENSITIVE_ENV_VARS = [
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN',
  'NPM_TOKEN', 'PYPI_TOKEN',
  'DATABASE_URL', 'DATABASE_PASSWORD',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'XUANJI_API_KEY',
  'JASYPT_ENCRYPTOR_PASSWORD',
];

/**
 * Bash 命令执行工具
 *
 * 前台命令使用持久化 Shell（cwd/环境变量跨调用保持），
 * 后台命令使用 BackgroundTaskManager（独立子进程）。
 */
export class BashTool extends BaseTool {
  readonly name = 'bash';
  readonly description = [
    '在 shell 中执行 bash 命令。工作目录和环境变量在多次调用间保持。',
    '',
    '# 使用指南',
    '- 优先使用专用工具而非 bash: 读文件用 read_file, 搜索用 grep/glob, 编辑用 edit_file',
    '- 后台运行长时间任务: run_in_background=true, 通过 task_output 查询结果',
    '- 多个独立命令可并行调用多次 bash, 有依赖的命令用 && 串联',
    '- 避免交互式命令 (如 git rebase -i), 不支持 stdin 交互',
    '',
    '# Git 操作规范',
    '- 提交前: 先 git status + git diff 查看变更, 再 git log 了解提交风格',
    '- 提交时: 仅 add 具体文件 (避免 git add -A 误提交敏感文件), 用 HEREDOC 传递多行 commit message',
    '- 绝不执行: git push --force 到 main/master, git reset --hard (除非用户明确要求)',
    '- 绝不跳过: --no-verify, --no-gpg-sign (除非用户明确要求)',
    '',
    '# 安全注意',
    '- 破坏性操作 (rm -rf, drop table 等) 需先确认',
    '- 不要在命令中包含密码、API Key 等敏感信息',
    '- 超时默认 120s, 长任务请用 run_in_background',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 bash 命令',
      },
      timeout: {
        type: 'number',
        description: `超时时间 (毫秒)，默认 ${DEFAULT_TIMEOUT}ms，最大 600000ms`,
      },
      description: {
        type: 'string',
        description: '命令描述（用于权限确认 UI 展示），简要说明命令的意图',
      },
      run_in_background: {
        type: 'boolean',
        description: '是否在后台运行（默认 false）。后台任务立即返回 task_id，通过 task_output 工具查询结果。适用于长时间运行的命令（如 npm test、构建等）。',
        default: false,
      },
    },
    required: ['command'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = Math.min(
      (input.timeout as number | undefined) ?? getToolTimeouts()?.bash ?? DEFAULT_TIMEOUT,
      600_000,
    );
    const runInBackground = (input.run_in_background as boolean | undefined) ?? false;
    // description 参数仅用于权限确认 UI，不影响执行逻辑

    try {
      // 沙箱检查: 检测命令是否尝试操作受限目录
      const sandboxWarning = this.checkSandbox(command);
      if (sandboxWarning) {
        log.warn(`Sandbox warning: ${sandboxWarning}`);
      }

      // 后台执行模式（独立子进程）
      if (runInBackground) {
        const manager = BackgroundTaskManager.getInstance();
        // 清理敏感环境变量，防止通过 env/printenv 泄漏
        const cleanEnv = this.sanitizeEnv(process.env);
        const result = manager.startTask(command, cleanEnv);

        if (result.status === 'failed') {
          return this.error(result.stderr ?? '启动后台任务失败');
        }

        return this.success(
          `后台任务已启动\n任务 ID: ${result.taskId}\n命令: ${command}\n\n使用 task_output 工具查询结果: task_output({ task_id: "${result.taskId}" })`,
          { taskId: result.taskId, status: 'running' },
        );
      }

      // 前台同步执行：使用持久化 Shell
      const shell = getSharedShell();
      const result = await shell.execute(command, timeout);

      // 合并 stdout 和 stderr
      let output = '';
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? '\n' : '') + `[stderr]\n${result.stderr}`;

      // 中间截断过长输出
      output = middleTruncate(output, getMaxToolOutputLength());

      if (result.exitCode !== 0) {
        return this.error(`命令退出码: ${result.exitCode}\n${output}`, { exitCode: result.exitCode });
      }

      return this.success(output || '(无输出)', { exitCode: result.exitCode });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`执行命令失败: ${message}`);
    }
  }

  // ============================================================
  // 沙箱保护
  // ============================================================

  /** 受限系统目录（禁止写入/删除） */
  private static readonly RESTRICTED_PATHS = [
    '/etc', '/usr', '/bin', '/sbin', '/boot', '/lib', '/lib64',
    '/System', '/Library',                          // macOS 系统目录
    '~/.ssh', '~/.gnupg', '~/.config/systemd',     // 敏感用户目录
  ];

  /** 预编译的沙箱写入检测正则（按受限路径缓存） */
  private static readonly SANDBOX_PATTERNS: Map<string, RegExp[]> = BashTool.buildSandboxPatterns();

  private static buildSandboxPatterns(): Map<string, RegExp[]> {
    const home = process.env.HOME ?? '~';
    const map = new Map<string, RegExp[]>();
    for (const restricted of BashTool.RESTRICTED_PATHS) {
      const expanded = restricted.replace(/~/g, home);
      const escaped = expanded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      map.set(restricted, [
        new RegExp(`\\brm\\b[^|]*${escaped}`),
        new RegExp(`\\bmv\\b[^|]*${escaped}`),
        new RegExp(`\\bcp\\b[^|]*${escaped}`),
        new RegExp(`>\\s*${escaped}`),
        new RegExp(`\\btee\\b[^|]*${escaped}`),
        new RegExp(`\\bchmod\\b[^|]*${escaped}`),
        new RegExp(`\\bchown\\b[^|]*${escaped}`),
      ]);
    }
    return map;
  }

  /** 高风险命令模式（与 RESTRICTED_PATHS 无关的全局风险） */
  private static readonly DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /\beval\s+"?\$/, description: '动态执行变量内容 (eval)' },
    { pattern: /\bexport\s+\w+=.*\$\(/, description: '环境变量注入命令替换' },
    { pattern: />\s*\/dev\/[hs]d/, description: '写入裸设备' },
    { pattern: /\bnc\s+(-[a-zA-Z]*l|-[a-zA-Z]*p)/, description: '网络监听 (nc -l)' },
  ];

  /**
   * 沙箱检查：检测命令是否尝试操作受限目录
   * 仅做 **警告**（log.warn），不阻止执行 — 阻止逻辑由 PermissionController 负责
   */
  private checkSandbox(command: string): string | null {
    const expandedCmd = command.replace(/~/g, process.env.HOME ?? '~');

    // 检查全局高风险模式
    for (const { pattern, description } of BashTool.DANGEROUS_PATTERNS) {
      if (pattern.test(expandedCmd)) {
        return description;
      }
    }

    for (const [restricted, patterns] of BashTool.SANDBOX_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(expandedCmd)) {
          return `命令尝试操作受限目录: ${restricted}`;
        }
      }
    }

    return null;
  }

  /**
   * 清理敏感环境变量
   * 用于后台任务子进程，防止通过 `env`/`printenv` 泄漏凭据
   */
  private sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined && !SENSITIVE_ENV_VARS.includes(key)) {
        clean[key] = value;
      }
    }
    return clean;
  }
}
