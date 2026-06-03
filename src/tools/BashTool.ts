// ============================================================
// M6 工具系统 — BashTool 执行命令
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { BackgroundTaskManager } from './BackgroundTaskManager';
import { getSharedShell } from './PersistentShell';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import { getToolTimeouts, getRuntimeConfig } from '@/infrastructure/config/RuntimeConfig';
import { logger } from '@/infrastructure/logger';
import type { SandboxExecutor, SandboxConfig } from './sandbox/SandboxExecutor';

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
    'Execute bash commands. Working directory and env vars persist across calls.',
    '',
    'Use for: tests, build, git, install, and any other shell commands.',
    'For file operations prefer dedicated tools: read_file, edit_file, grep, glob.',
    'Long-running tasks (>30s): set run_in_background=true, query results via task_output.',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Bash command to execute',
      },
      timeout: {
        type: 'number',
        description: `Timeout in milliseconds, default ${DEFAULT_TIMEOUT}ms, max 600000ms`,
      },
      description: {
        type: 'string',
        description: 'Command description (for permission confirmation UI), briefly explain command intent',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Whether to run in background (default false). Background tasks return task_id immediately, query results via task_output tool. Suitable for long-running commands (npm test, build, etc.).',
        default: false,
      },
    },
    required: ['command'],
  };

  /** 沙箱执行器（可选，延迟初始化） */
  private sandboxExecutor: SandboxExecutor | null = null;
  /** 沙箱初始化 Promise（防止并发竞态） */
  private sandboxInitPromise: Promise<void> | null = null;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = Math.min(
      (input.timeout as number | undefined) ?? getToolTimeouts()?.bash ?? DEFAULT_TIMEOUT,
      600_000,
    );
    const runInBackground = (input.run_in_background as boolean | undefined) ?? false;
    // description 参数仅用于权限确认 UI，不影响执行逻辑

    // 延迟初始化沙箱（使用 Promise 去重防竞态）
    if (!this.sandboxInitPromise) {
      this.sandboxInitPromise = this.initSandbox();
    }
    await this.sandboxInitPromise;

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

      // 前台同步执行：优先使用沙箱，降级到持久化 Shell
      if (this.sandboxExecutor) {
        try {
          const cwd = (input._cwd as string) || process.cwd();
          const result = await this.sandboxExecutor.execute(command, cwd, timeout);

          let output = '';
          if (result.stdout) output += result.stdout;
          if (result.stderr) output += (output ? '\n' : '') + `[stderr]\n${result.stderr}`;
          output = middleTruncate(output, getMaxToolOutputLength());

          if (result.exitCode !== 0) {
            return this.error(`命令退出码: ${result.exitCode}\n${output}`, { exitCode: result.exitCode });
          }
          return this.success(output || '(无输出)', { exitCode: result.exitCode, sandboxed: true });
        } catch (sandboxErr) {
          log.warn('Sandbox execution failed, falling back to direct execution. Command:', command, sandboxErr);
          // 沙箱执行失败，降级到直接执行
        }
      }

      // 降级：使用持久化 Shell（无沙箱）
      const shell = getSharedShell();
      const cwd = (input._cwd as string) || undefined;
      const result = await shell.execute(command, timeout, cwd);

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
  // 沙箱初始化
  // ============================================================

  /**
   * 延迟初始化沙箱执行器
   */
  private async initSandbox(): Promise<void> {
    try {
      const config = getRuntimeConfig();
      const sandboxConfig = config?.tools?.bash?.sandbox as SandboxConfig | undefined;

      if (!sandboxConfig?.enabled) {
        return;
      }

      if (sandboxConfig.mode === 'none') {
        return;
      }

      const { SeatbeltExecutor } = await import('./sandbox/SeatbeltExecutor');
      const { BubblewrapExecutor } = await import('./sandbox/BubblewrapExecutor');
      const { NoopSandboxExecutor } = await import('./sandbox/NoopSandboxExecutor');

      // 按优先级尝试各沙箱执行器
      const executors: SandboxExecutor[] = [];

      if (sandboxConfig.mode === 'auto' || sandboxConfig.mode === 'seatbelt') {
        executors.push(new SeatbeltExecutor(sandboxConfig));
      }
      if (sandboxConfig.mode === 'auto' || sandboxConfig.mode === 'bwrap') {
        executors.push(new BubblewrapExecutor(sandboxConfig));
      }
      // Noop 作为最后兜底：Windows 上始终可用，用来替代静默失效
      executors.push(new NoopSandboxExecutor(sandboxConfig));

      for (const executor of executors) {
        if (await executor.isAvailable()) {
          this.sandboxExecutor = executor;
          log.info(`Bash sandbox enabled: ${executor.getName()}`);
          if (executor instanceof NoopSandboxExecutor) {
            log.warn('=============================================');
            log.warn('安全警告：当前平台不支持原生沙箱，Bash 命令将以无隔离模式执行。');
            log.warn('仅通过路径正则匹配做软保护，LLM 可能绕过。');
            log.warn('建议在 macOS (Seatbelt) 或 Linux (Bubblewrap) 上运行以获得完整沙箱保护。');
            log.warn('=============================================');
          }
          return;
        }
      }

      log.warn('Sandbox enabled but no executor available, falling back to direct execution');
    } catch (err) {
      log.debug('Sandbox init failed:', err);
    }
  }

  // ============================================================
  // 沙箱保护
  // ============================================================

  /** 受限系统目录（禁止写入/删除） */
  private static readonly RESTRICTED_PATHS = process.platform === 'win32'
    ? [
      'C:\\Windows', 'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64',
      'C:\\Program Files', 'C:\\Program Files (x86)',
      '~\\.ssh', '~\\AppData\\Roaming',
    ]
    : [
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
    { pattern: /\beval\s+"?\$/, description: 'Dynamic variable execution (eval)' },
    { pattern: /\bexport\s+\w+=.*\$\(/, description: 'Environment variable injection via command substitution' },
    { pattern: />\s*\/dev\/[hs]d/, description: 'Write to raw device' },
    { pattern: /\bnc\s+(-[a-zA-Z]*l|-[a-zA-Z]*p)/, description: 'Network listening (nc -l)' },
    // New: command bypass detection
    { pattern: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\s+-[a-zA-Z]*[rf]/, description: 'Variable substitution executing dangerous command (e.g. $RM -rf)' },
    { pattern: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\s+\//, description: 'Variable substitution path operation' },
    { pattern: /\bdd\s+if=.*of=\/dev\//, description: 'dd write to raw device' },
    { pattern: /\bmkfs\b/, description: 'Format filesystem (mkfs)' },
    { pattern: /\|\s*(ba)?sh\b/, description: 'Pipe to shell execution, may bypass permission checks' },
    { pattern: /\|\s*zsh\b/, description: 'Pipe to zsh execution, may bypass permission checks' },
    { pattern: /\bxargs\s+.*\brm\b/, description: 'xargs pipe delete operation' },
    { pattern: /`[^`]*\brm\b[^`]*`/, description: 'Backtick command substitution containing rm' },
    { pattern: /\$\([^)]*\brm\b[^)]*\)/, description: '$() command substitution containing rm' },
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
