// ============================================================
// M1 终端 UI — 斜杠命令注册表
// ============================================================
//
// 将原来硬编码在 App.tsx 中的 switch-case 斜杠命令迁移为
// 动态注册模式。支持:
//   - 内置命令注册（应用初始化时）
//   - Workflow Skill 自动注册斜杠命令
//   - 命令列表查询（/help 用）
//

import type { SlashCommand } from './SlashCommands';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SlashCommandRegistry' });

/**
 * 斜杠命令注册表
 *
 * 统一管理所有斜杠命令，支持动态注册和执行。
 */
export class SlashCommandRegistry {
  private commands: Map<string, SlashCommand> = new Map();

  /**
   * 注册命令
   */
  register(command: SlashCommand): void {
    const name = command.name.startsWith('/') ? command.name : `/${command.name}`;
    if (this.commands.has(name)) {
      log.warn(`Overwriting slash command: ${name}`);
    }
    this.commands.set(name, { ...command, name });
  }

  /**
   * 批量注册命令
   */
  registerBulk(commands: SlashCommand[]): void {
    for (const cmd of commands) {
      this.register(cmd);
    }
  }

  /**
   * 注销命令
   */
  unregister(name: string): void {
    const normalizedName = name.startsWith('/') ? name : `/${name}`;
    this.commands.delete(normalizedName);
  }

  /**
   * 执行命令
   */
  async execute(name: string, args: string): Promise<void> {
    const normalizedName = name.startsWith('/') ? name : `/${name}`;
    const command = this.commands.get(normalizedName);
    if (!command) {
      throw new Error(`未知命令: ${normalizedName}。输入 /help 查看可用命令。`);
    }
    log.debug(`Executing slash command: ${normalizedName} ${args}`);
    await command.handler(args);
  }

  /**
   * 检查命令是否存在
   */
  has(name: string): boolean {
    const normalizedName = name.startsWith('/') ? name : `/${name}`;
    return this.commands.has(normalizedName);
  }

  /**
   * 获取单个命令
   */
  get(name: string): SlashCommand | undefined {
    const normalizedName = name.startsWith('/') ? name : `/${name}`;
    return this.commands.get(normalizedName);
  }

  /**
   * 获取所有已注册命令（按名称排序）
   */
  getAll(): SlashCommand[] {
    return Array.from(this.commands.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 获取命令名称列表（用于自动补全）
   */
  getNames(): string[] {
    return Array.from(this.commands.keys()).sort();
  }

  /**
   * 格式化帮助信息（按分组显示）
   */
  formatHelp(): string {
    const commands = this.getAll();
    if (commands.length === 0) {
      return '没有已注册的命令';
    }

    // 按分组整理
    const grouped = new Map<string, SlashCommand[]>();
    for (const cmd of commands) {
      if (cmd.hidden) continue;
      const group = cmd.group || '其他';
      if (!grouped.has(group)) {
        grouped.set(group, []);
      }
      grouped.get(group)!.push(cmd);
    }

    // 构建帮助文本
    const lines: string[] = [];
    for (const [group, cmds] of grouped) {
      lines.push(`\n【${group}】`);
      const maxLen = Math.max(...cmds.map((c) => c.name.length));
      for (const cmd of cmds) {
        const icon = cmd.icon ? `${cmd.icon} ` : '';
        lines.push(`  ${icon}${cmd.name.padEnd(maxLen + 2)} ${cmd.description}`);
        if (cmd.usage) {
          lines.push(`    用法: ${cmd.usage}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * 格式化帮助信息（简洁版，旧格式兼容）
   */
  formatHelpSimple(): string {
    const commands = this.getAll().filter(c => !c.hidden);
    if (commands.length === 0) {
      return '没有已注册的命令';
    }

    const maxLen = Math.max(...commands.map((c) => c.name.length));
    return commands
      .map((c) => `  ${c.name.padEnd(maxLen + 2)} ${c.description}`)
      .join('\n');
  }

  /**
   * 命令数量
   */
  get size(): number {
    return this.commands.size;
  }
}
