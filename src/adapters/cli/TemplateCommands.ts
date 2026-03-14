// ============================================================
// Template Commands — /template 命令的详细实现
// ============================================================

import type { TemplateRepo } from '@/core/template/TemplateRepo';

export interface TemplateCommandResult {
  success: boolean;
  message: string;
  data?: any;
}

/**
 * Template 命令处理器
 */
export class TemplateCommands {
  constructor(private templateRepo: TemplateRepo | null) {}

  /**
   * 处理 /template 命令
   */
  async handle(args: string): Promise<string> {
    if (!this.templateRepo) {
      return '❌ 模板系统未启用\n提示: 请确保 MCP 系统已配置';
    }

    const parts = args.trim().split(/\s+/);
    const subCommand = parts[0] || 'list';

    switch (subCommand) {
      case 'list':
      case 'ls':
        return this.list(parts[1]);

      case 'search':
        return this.search(parts.slice(1).join(' '));

      case 'show':
      case 'info':
        return this.show(parts[1]);

      case 'use':
        return this.use(parts[1], parts.slice(2));

      case 'help':
        return this.help();

      default:
        // 没有子命令，默认为列表
        return this.list(args);
    }
  }

  /**
   * 列出所有模板或指定服务器的模板
   */
  private async list(serverName?: string): Promise<string> {
    try {
      let templates;
      if (serverName) {
        templates = await this.templateRepo!.listByServer(serverName);
      } else {
        templates = await this.templateRepo!.list();
      }

      if (templates.length === 0) {
        if (serverName) {
          return `📝 服务器 "${serverName}" 没有可用的模板`;
        }
        return '📝 没有可用的模板\n提示: 请确保 MCP 服务已配置';
      }

      // 按服务器分组
      const grouped = new Map<string, typeof templates>();
      for (const template of templates) {
        const server = template.serverName;
        if (!grouped.has(server)) {
          grouped.set(server, []);
        }
        grouped.get(server)!.push(template);
      }

      const lines: string[] = [];
      lines.push(`📝 MCP Prompts 模板 (共 ${templates.length} 个):`);
      lines.push('');

      for (const [server, serverTemplates] of grouped) {
        lines.push(`🔗 ${server} (${serverTemplates.length} 个):`);

        for (let i = 0; i < Math.min(serverTemplates.length, 10); i++) {
          const template = serverTemplates[i];
          const args = template.arguments?.length || 0;
          const argInfo = args > 0 ? ` [需要 ${args} 个参数]` : '';
          const description = template.description || '(无描述)';
          lines.push(`  • ${template.name}${argInfo}`);
          lines.push(`    ${description}`);
        }

        if (serverTemplates.length > 10) {
          lines.push(`  ... 还有 ${serverTemplates.length - 10} 个`);
        }
        lines.push('');
      }

      lines.push('💡 提示:');
      lines.push('  /template show <id>           - 查看模板详情');
      lines.push('  /template search <关键词>      - 搜索模板');
      lines.push('  /template use <id> [args...]   - 使用模板');

      return lines.join('\n');
    } catch (err) {
      return `❌ 获取模板列表失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 搜索模板
   */
  private async search(query: string): Promise<string> {
    if (!query) {
      return '❌ 请提供搜索关键词\n用法: /template search <关键词>';
    }

    try {
      const results = await this.templateRepo!.search(query);

      if (results.length === 0) {
        return `🔍 没有找到匹配 "${query}" 的模板`;
      }

      const lines: string[] = [];
      lines.push(`🔍 搜索结果: "${query}" (${results.length} 个):`);
      lines.push('');

      for (let i = 0; i < results.length; i++) {
        const template = results[i];
        const description = template.description || '(无描述)';
        const args = template.arguments?.length || 0;
        const argInfo = args > 0 ? ` [${args} 个参数]` : '';

        lines.push(`${i + 1}. ${template.id}${argInfo}`);
        lines.push(`   ${description}`);

        if (template.arguments && template.arguments.length > 0) {
          lines.push('   参数:');
          for (const arg of template.arguments) {
            const required = arg.required ? ' (必填)' : ' (可选)';
            lines.push(`     - ${arg.name}${required}: ${arg.description || '(无描述)'}`);
          }
        }
        lines.push('');
      }

      return lines.join('\n');
    } catch (err) {
      return `❌ 搜索失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 显示模板详情
   */
  private async show(templateId?: string): Promise<string> {
    if (!templateId) {
      return '❌ 请提供模板 ID\n用法: /template show <id>\n示例: /template show market:analysis_report';
    }

    try {
      const templates = await this.templateRepo!.list();
      const template = templates.find(t => t.id === templateId);

      if (!template) {
        return `❌ 未找到模板: "${templateId}"\n提示: 使用 /template list 查看所有模板`;
      }

      const lines: string[] = [];
      lines.push(`📋 模板详情:`);
      lines.push('');
      lines.push(`ID: ${template.id}`);
      lines.push(`名称: ${template.name}`);
      lines.push(`服务器: ${template.serverName}`);
      lines.push(`描述: ${template.description || '(无描述)'}`);

      if (template.arguments && template.arguments.length > 0) {
        lines.push('');
        lines.push(`参数 (${template.arguments.length} 个):`);
        for (const arg of template.arguments) {
          const required = arg.required ? '[必填]' : '[可选]';
          lines.push(`  • ${arg.name} ${required}`);
          if (arg.description) {
            lines.push(`    ${arg.description}`);
          }
        }
      }

      lines.push('');
      lines.push('使用方法:');
      if (template.arguments && template.arguments.length > 0) {
        const argExample = template.arguments.map(a => `${a.name}=值`).join(' ');
        lines.push(`  /template use ${template.id} ${argExample}`);
      } else {
        lines.push(`  /template use ${template.id}`);
      }

      return lines.join('\n');
    } catch (err) {
      return `❌ 获取模板详情失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 使用模板（渲染）
   */
  private async use(templateId?: string, argParts?: string[]): Promise<string> {
    if (!templateId) {
      return '❌ 请提供模板 ID\n用法: /template use <id> [key1=value1 key2=value2 ...]';
    }

    try {
      // 解析参数
      const args: Record<string, string> = {};
      if (argParts && argParts.length > 0) {
        for (const part of argParts) {
          const [key, value] = part.split('=');
          if (key && value) {
            args[key] = value;
          }
        }
      }

      // 渲染模板
      const rendered = await this.templateRepo!.get(templateId, args);

      const lines: string[] = [];
      lines.push(`✅ 模板已渲染:`);
      lines.push('');

      if (rendered.description) {
        lines.push(`描述: ${rendered.description}`);
        lines.push('');
      }

      lines.push('内容:');
      for (const msg of rendered.messages) {
        const role = msg.role === 'user' ? '👤 用户' : '🤖 助手';
        lines.push(`${role}:`);
        lines.push(`${msg.content}`);
        lines.push('');
      }

      return lines.join('\n');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Missing required arguments')) {
        return `❌ ${errMsg}\n提示: 使用 /template show <id> 查看参数要求`;
      }
      return `❌ 渲染模板失败: ${errMsg}`;
    }
  }

  /**
   * 显示帮助信息
   */
  private help(): Promise<string> {
    const lines = [
      '💡 /template 命令帮助:',
      '',
      '查看模板:',
      '  /template list              - 列出所有模板',
      '  /template list <server>     - 列出指定服务器的模板',
      '  /template ls                - 同 list',
      '',
      '搜索和查看:',
      '  /template search <关键词>    - 搜索模板',
      '  /template show <id>         - 查看模板详情',
      '',
      '使用模板:',
      '  /template use <id>          - 渲染模板（无参数）',
      '  /template use <id> k=v ...  - 渲染模板（带参数）',
      '',
      '其他:',
      '  /template help              - 显示此帮助信息',
      '',
      '示例:',
      '  /template list market       - 查看 market 服务器的模板',
      '  /template search 分析       - 搜索包含"分析"的模板',
      '  /template show market:analysis_report  - 查看 analysis_report 模板详情',
      '  /template use market:analysis_report symbol=AAPL  - 使用模板',
      '',
      '💡 提示:',
      '  • 模板 ID 格式: serverName:templateName',
      '  • 使用 /template search 快速找到需要的模板',
      '  • 使用 /template show 查看模板的参数要求',
    ];

    return Promise.resolve(lines.join('\n'));
  }
}
