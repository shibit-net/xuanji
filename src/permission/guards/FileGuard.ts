// ============================================================
// M5 权限控制 — 文件路径守卫
// ============================================================
//
// 分析文件操作的风险级别:
//   - danger: 系统关键路径、敏感文件写入
//   - warn: 项目外写入、敏感文件读取
//   - safe: 项目内正常操作
//
// 注意: 所有操作均可通过用户确认执行，没有绝对禁止的路径。
//

import { PathMatcher } from '../policies/PathMatcher';
import { PolicyEngine } from '../policies/PolicyEngine';
import type { GuardCheckResult } from '../types';
import { t } from '@/i18n';
import * as path from 'path';
import * as os from 'os';

/**
 * 系统关键路径 — 操作风险极高，标记为 danger（仍可通过确认执行）
 */
const isWin = process.platform === 'win32';

const SYSTEM_PATHS = isWin
  ? [
    'C:\\Windows\\',
    'C:\\Windows\\System32\\',
    'C:\\Windows\\SysWOW64\\',
    'C:\\Windows\\System\\',
    'C:\\Program Files\\',
    'C:\\Program Files (x86)\\',
    'C:\\ProgramData\\',
  ]
  : [
    '/etc/',
    '/bin/',
    '/sbin/',
    '/usr/bin/',
    '/usr/sbin/',
    '/usr/lib/',
    '/System/',
    '/Library/',
    '/boot/',
    '/proc/',
    '/sys/',
    '/dev/',
  ];

/**
 * 关键系统文件 — 写操作极度危险
 */
const CRITICAL_WRITE_PATHS = isWin
  ? [
    'C:\\Windows\\System32\\config\\SAM',
    'C:\\Windows\\System32\\config\\SECURITY',
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    '~/.ssh/authorized_keys',
    '~/.ssh/config',
  ]
  : [
    '/etc/passwd',
    '/etc/shadow',
    '/etc/sudoers',
    '/etc/hosts',
    '/etc/hostname',
    '/etc/resolv.conf',
    '~/.ssh/authorized_keys',
    '~/.ssh/config',
  ];

/**
 * 用户敏感目录 — 操作风险较高，标记为 danger
 */
const SENSITIVE_USER_DIRS = isWin
  ? [
    '~\\.ssh\\',
    '~\\.aws\\',
    '~\\.gnupg\\',
    '~\\AppData\\Roaming\\',
    '~\\AppData\\Local\\',
    '~\\.kube\\',
  ]
  : [
    '~/.ssh/',
    '~/.aws/',
    '~/.gnupg/',
    '~/.config/',
    '~/.kube/',
  ];

/**
 * 敏感配置目录 — 写操作需要警告
 */
const SENSITIVE_CONFIG_DIRS = [
  '~/.npmrc',
  '~/.gitconfig',
  '~/.bash_profile',
  '~/.bashrc',
  '~/.zshrc',
  '~/.profile',
];

/**
 * 敏感文件模式 — 写操作标记为 danger，读操作标记为 warn
 */
const SENSITIVE_FILE_PATTERNS = [
  '**/.env',
  '**/.env.*',
  '**/id_rsa',
  '**/id_ed25519',
  '**/*.pem',
  '**/*.key',
  '**/credentials.json',
  '**/secrets.yaml',
  '**/secrets.yml',
  '**/.netrc',
  '**/.npmrc',
];

/**
 * 扩展敏感文件模式 — 证书、密钥、配置文件
 */
const EXTENDED_SENSITIVE_PATTERNS = [
  '**/.env.local',
  '**/.env.production',
  '**/*.p12',
  '**/*.pfx',
  '**/*.keystore',
  '**/*.jks',
  '**/kubeconfig',
  '**/config.json',
  '**/.aws/credentials',
  '**/.docker/config.json',
];

/**
 * FileGuard — 文件路径守卫
 *
 * 检查文件操作（读/写/编辑）的风险级别，
 * 返回操作类别、风险等级和描述信息。
 */
export class FileGuard {
  private pathMatcher: PathMatcher;
  private ignoreFilter?: { isIgnored(path: string): boolean };

  constructor() {
    this.pathMatcher = new PathMatcher();
  }

  /**
   * 设置 Ignore 过滤器（由 ChatSession 注入）
   */
  setIgnoreFilter(filter: { isIgnored(path: string): boolean }): void {
    this.ignoreFilter = filter;
  }

  /**
   * 检查文件操作的风险
   *
   * @param toolName 工具名 ('read_file' | 'write_file' | 'edit_file' | 'glob' | 'grep')
   * @param input 工具输入参数
   * @param policyEngine 策略引擎 (用于读取黑白名单)
   * @returns GuardCheckResult 或 null (无需特殊处理)
   */
  check(
    toolName: string,
    input: Record<string, unknown>,
    policyEngine: PolicyEngine,
  ): GuardCheckResult | null {
    // 提取文件路径
    const filePath = this.extractPath(toolName, input);
    if (!filePath) return null;

    // 规范化路径 (展开 ~ 为 HOME)
    const normalizedPath = this.normalizePath(filePath);

    // 判断操作类型
    const isWrite = toolName === 'write_file' || toolName === 'edit_file' || toolName === 'notebook_edit';
    const category = isWrite ? 'fileWrite' : 'fileRead';

    // Step 0: .xuanji/ignore 检查 (最高优先级)
    if (this.ignoreFilter?.isIgnored(normalizedPath)) {
      return {
        category,
        riskLevel: 'danger',
        description: t('perm.guard_ignored_path', { path: filePath }),
        cacheKey: `${category}:ignored:${normalizedPath}`,
      };
    }

    // 检查是否命中黑名单
    const deniedPaths = policyEngine.getDeniedPaths();
    if (deniedPaths.length > 0 && this.pathMatcher.matchesAny(normalizedPath, deniedPaths)) {
      return {
        category,
        riskLevel: 'danger',
        description: t('perm.guard_denied_path', { path: filePath }),
        cacheKey: `${category}:denied:${normalizedPath}`,
      };
    }

    // 检查系统关键路径
    if (this.isSystemPath(normalizedPath)) {
      const key = isWrite ? 'perm.guard_system_write' : 'perm.guard_system_read';
      return {
        category,
        riskLevel: 'danger',
        description: t(key, { path: filePath }),
        cacheKey: `${category}:system:${this.getSystemPathPrefix(normalizedPath)}`,
      };
    }

    // 检查关键系统文件（写操作极度危险）
    if (isWrite && this.isCriticalWritePath(normalizedPath)) {
      return {
        category,
        riskLevel: 'danger',
        description: t('perm.guard_critical_write', { path: filePath }),
        cacheKey: `${category}:critical:${path.basename(filePath)}`,
      };
    }

    // 检查用户敏感目录
    if (this.isSensitiveUserDir(normalizedPath)) {
      const key = isWrite ? 'perm.guard_sensitive_dir_write' : 'perm.guard_sensitive_dir_read';
      return {
        category,
        riskLevel: 'danger',
        description: t(key, { path: filePath }),
        cacheKey: `${category}:sensitive-dir:${this.getSensitiveDirPrefix(normalizedPath)}`,
      };
    }

    // 检查敏感配置文件（写操作需要警告）
    if (isWrite && this.isSensitiveConfigFile(normalizedPath)) {
      return {
        category,
        riskLevel: 'warn',
        description: t('perm.guard_sensitive_config_write', { path: filePath }),
        cacheKey: `${category}:config:${path.basename(filePath)}`,
      };
    }

    // 检查敏感文件模式
    if (this.isSensitiveFile(normalizedPath)) {
      const key = isWrite ? 'perm.guard_sensitive_file_write' : 'perm.guard_sensitive_file_read';
      return {
        category,
        riskLevel: isWrite ? 'danger' : 'warn',
        description: t(key, { name: path.basename(filePath) }),
        cacheKey: `${category}:sensitive:${path.basename(filePath)}`,
        context: {
          isProjectPath: !this.isOutsideProject(normalizedPath),
          isSensitiveFile: true,
        },
      };
    }

    // 检查扩展敏感文件模式
    if (this.isExtendedSensitiveFile(normalizedPath)) {
      const key = isWrite ? 'perm.guard_extended_sensitive_write' : 'perm.guard_extended_sensitive_read';
      return {
        category,
        riskLevel: isWrite ? 'danger' : 'warn',
        description: t(key, { name: path.basename(filePath) }),
        cacheKey: `${category}:extended-sensitive:${path.basename(filePath)}`,
        context: {
          isProjectPath: !this.isOutsideProject(normalizedPath),
          isSensitiveFile: true,
        },
      };
    }

    // 检查白名单
    const allowedPaths = policyEngine.getAllowedPaths();
    if (allowedPaths.length > 0 && this.pathMatcher.matchesAny(normalizedPath, allowedPaths)) {
      return {
        category,
        riskLevel: 'safe',
        description: t('perm.guard_allowed_path', { path: filePath }),
        cacheKey: `${category}:allowed`,
        context: {
          isProjectPath: !this.isOutsideProject(normalizedPath),
        },
      };
    }

    // 检查是否在项目目录外写入
    if (isWrite && this.isOutsideProject(normalizedPath)) {
      return {
        category,
        riskLevel: 'warn',
        description: t('perm.guard_outside_project', { path: filePath }),
        cacheKey: `${category}:outside:${path.dirname(normalizedPath)}`,
        context: {
          isProjectPath: false,
        },
      };
    }

    // 默认: 安全操作
    const key = isWrite ? 'perm.guard_file_write' : 'perm.guard_file_read';
    return {
      category,
      riskLevel: 'safe',
      description: t(key, { path: filePath }),
      cacheKey: `${category}:${normalizedPath}`,
      context: {
        isProjectPath: !this.isOutsideProject(normalizedPath),
      },
    };
  }

  /**
   * 从工具输入中提取文件路径
   */
  private extractPath(toolName: string, input: Record<string, unknown>): string | null {
    switch (toolName) {
      case 'read_file':
      case 'write_file':
      case 'edit_file':
        return (input.file_path ?? input.path) as string | null;
      case 'notebook_edit':
        return (input.notebook_path ?? input.path) as string | null;
      case 'glob':
        return (input.path ?? input.pattern) as string | null;
      case 'grep':
        return (input.path) as string | null;
      default:
        return null;
    }
  }

  /**
   * 规范化路径 (展开 ~)
   */
  private normalizePath(filePath: string): string {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return path.resolve(filePath);
  }

  /**
   * 检查是否为系统关键路径
   */
  private isSystemPath(normalizedPath: string): boolean {
    return SYSTEM_PATHS.some((sp) => normalizedPath.startsWith(sp));
  }

  /**
   * 获取匹配的系统路径前缀 (用于缓存 key)
   */
  private getSystemPathPrefix(normalizedPath: string): string {
    for (const sp of SYSTEM_PATHS) {
      if (normalizedPath.startsWith(sp)) return sp;
    }
    return 'system';
  }

  /**
   * 检查是否为用户敏感目录
   */
  private isSensitiveUserDir(normalizedPath: string): boolean {
    const home = os.homedir();
    return SENSITIVE_USER_DIRS.some((dir) => {
      const expanded = dir.replace('~', home);
      return normalizedPath.startsWith(expanded);
    });
  }

  /**
   * 获取匹配的敏感目录前缀 (用于缓存 key)
   */
  private getSensitiveDirPrefix(normalizedPath: string): string {
    const home = os.homedir();
    for (const dir of SENSITIVE_USER_DIRS) {
      const expanded = dir.replace('~', home);
      if (normalizedPath.startsWith(expanded)) return dir;
    }
    return 'sensitive-dir';
  }

  /**
   * 检查是否为敏感文件
   */
  private isSensitiveFile(normalizedPath: string): boolean {
    return this.pathMatcher.matchesAny(normalizedPath, SENSITIVE_FILE_PATTERNS);
  }

  /**
   * 检查是否为扩展敏感文件
   */
  private isExtendedSensitiveFile(normalizedPath: string): boolean {
    return this.pathMatcher.matchesAny(normalizedPath, EXTENDED_SENSITIVE_PATTERNS);
  }

  /**
   * 检查是否为关键系统文件
   */
  private isCriticalWritePath(normalizedPath: string): boolean {
    const home = os.homedir();
    return CRITICAL_WRITE_PATHS.some((criticalPath) => {
      const expanded = criticalPath.replace('~', home);
      return normalizedPath === expanded;
    });
  }

  /**
   * 检查是否为敏感配置文件
   */
  private isSensitiveConfigFile(normalizedPath: string): boolean {
    const home = os.homedir();
    return SENSITIVE_CONFIG_DIRS.some((configPath) => {
      const expanded = configPath.replace('~', home);
      return normalizedPath === expanded;
    });
  }

  /**
   * 检查是否在项目目录外 (使用 cwd 作为项目根)
   */
  private isOutsideProject(normalizedPath: string): boolean {
    const projectRoot = process.cwd();
    const sep = normalizedPath.includes('\\') ? '\\' : '/';
    return !normalizedPath.startsWith(projectRoot + sep) && normalizedPath !== projectRoot;
  }
}
