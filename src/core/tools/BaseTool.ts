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
   * 检查路径是否位于受保护的系统/用户目录
   * 用于 WriteTool/EditTool 的路径穿越保护
   */
  protected isSensitivePath(filePath: string): boolean {
    const resolved = resolve(filePath);
    const home = homedir();

    // 禁止写入系统目录
    for (const dir of SENSITIVE_DIRS) {
      if (resolved === dir || resolved.startsWith(dir + '/')) {
        return true;
      }
    }

    // 禁止写入敏感用户目录
    const sensitiveDotDirs = ['.ssh', '.gnupg', '.aws'];
    for (const dotDir of sensitiveDotDirs) {
      const fullDir = resolve(home, dotDir);
      if (resolved === fullDir || resolved.startsWith(fullDir + '/')) {
        return true;
      }
    }

    return false;
  }
}
