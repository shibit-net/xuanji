// ============================================================
// Bash 沙箱 — 执行器接口
// ============================================================

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /** 是否启用沙箱 */
  enabled: boolean;
  /** 沙箱模式: auto=自动选择, seatbelt=macOS, bwrap=Linux, none=禁用 */
  mode: 'auto' | 'seatbelt' | 'bwrap' | 'none';
  /** 允许写入的路径列表 */
  allowedPaths: string[];
  /** 是否拒绝网络访问 */
  denyNetwork: boolean;
  /** 是否拒绝系统路径写入 */
  denySystemPaths: boolean;
}

/**
 * Shell 执行结果
 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 沙箱执行器接口
 */
export interface SandboxExecutor {
  /** 执行命令 */
  execute(command: string, cwd: string, timeout: number): Promise<ShellResult>;
  /** 检查沙箱是否可用 */
  isAvailable(): Promise<boolean>;
  /** 获取执行器名称 */
  getName(): string;
}
