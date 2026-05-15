// ============================================================
// M6 工具系统 — 工具基类
// ============================================================

import type { Tool, ToolResult, JSONSchema } from '@/core/types';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

/** 受保护的系统/用户目录（禁止写入） */
const SENSITIVE_DIRS = [
  '/etc', '/usr', '/bin', '/sbin', '/boot', '/lib', '/lib64',
  '/System', '/Library',         // macOS 系统目录
  '/proc', '/sys', '/dev',       // Linux 虚拟文件系统
];

/**
 * 工具抽象基类
 * 所有具体工具继承此类
 */
export abstract class BaseTool implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly input_schema: JSONSchema;

  /** 默认为写工具（串行执行） */
  readonly readonly: boolean = false;

  abstract execute(input: Record<string, unknown>): Promise<ToolResult>;

  /**
   * 是否为写操作（Plan Mode 中将被拦截）
   * 默认：readonly=true 的工具不是写操作
   */
  isWriteOperation(): boolean {
    return !this.readonly;
  }

  /**
   * 创建成功结果
   */
  protected success(content: string, metadata?: Record<string, unknown>): ToolResult {
    return { content, isError: false, metadata };
  }

  /**
   * 创建错误结果
   */
  protected error(message: string, metadata?: Record<string, unknown>): ToolResult {
    return { content: message, isError: true, metadata };
  }

  /**
   * 创建结构化的错误信息
   *
   * @param options 错误信息选项
   * @param options.type 错误类型（例如：参数错误、权限错误、资源错误）
   * @param options.message 简短的错误描述
   * @param options.reason 详细说明为什么会发生这个错误
   * @param options.solutions 解决方案列表（至少提供 1 个）
   * @param options.example 正确的调用示例代码（可选）
   * @param options.tip 额外的建议或最佳实践（可选）
   * @returns 格式化的错误结果
   *
   * @example
   * ```typescript
   * return this.formatError({
   *   type: '参数错误',
   *   message: '缺少必需参数 system_prompt',
   *   reason: '创建临时 agent 时必须提供 system_prompt 和 tools 参数。',
   *   solutions: [
   *     '先调用 match_agent 查找合适的预置 agent（推荐）',
   *     '提供 system_prompt 和 tools 参数创建临时 agent',
   *   ],
   *   example: 'task({ ... })',
   *   tip: '临时 agent 只应在没有合适的预置 agent 时使用。',
   * });
   * ```
   */
  protected formatError(options: {
    type: string;
    message: string;
    reason: string;
    solutions: string[];
    example?: string;
    tip?: string;
  }): ToolResult {
    const { type, message, reason, solutions, example, tip } = options;

    const content = [
      `❌ ${type}: ${message}`,
      '',
      '原因：',
      reason,
      '',
      '解决方案：',
      ...solutions.map((s, i) => `${i + 1}. ${s}`),
    ];

    if (example) {
      content.push('', '示例：', example);
    }

    if (tip) {
      content.push('', '💡 提示：', tip);
    }

    return this.error(content.join('\n'));
  }

  /**
   * 检查路径是否位于受保护的系统/用户目录
   * 用于 WriteTool/EditTool 的路径穿越保护
   */
  protected isSensitivePath(filePath: string): boolean {
    const resolved = resolve(filePath);
    const sep = resolved.includes('\\') ? '\\' : '/';
    const home = homedir();

    // 禁止写入系统目录
    for (const dir of SENSITIVE_DIRS) {
      if (resolved === dir || resolved.startsWith(dir + sep)) {
        return true;
      }
    }

    // 禁止写入敏感用户目录
    const sensitiveDotDirs = ['.ssh', '.gnupg', '.aws'];
    for (const dotDir of sensitiveDotDirs) {
      const fullDir = resolve(home, dotDir);
      if (resolved === fullDir || resolved.startsWith(fullDir + sep)) {
        return true;
      }
    }

    return false;
  }
}
