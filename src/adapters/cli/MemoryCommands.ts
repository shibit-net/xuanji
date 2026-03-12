// ============================================================
// Memory Commands — /memory 命令的详细实现
// ============================================================

import type { IMemoryStore, MemoryEntry } from '@/memory/types';

export interface MemoryCommandResult {
  success: boolean;
  message: string;
  data?: any;
}

/**
 * Memory 命令处理器
 */
export class MemoryCommands {
  constructor(private memoryManager: IMemoryStore | null) {}

  /**
   * 处理 /memory 命令
   */
  async handle(args: string): Promise<string> {
    if (!this.memoryManager) {
      return '❌ 记忆系统未启用';
    }

    const parts = args.trim().split(/\s+/);
    const subCommand = parts[0] || 'list';

    switch (subCommand) {
      case 'list':
      case 'ls':
        return this.list(parts.slice(1).join(' '));
      
      case 'delete':
      case 'del':
      case 'rm':
        return this.delete(parts[1]);
      
      case 'search':
        return this.search(parts.slice(1).join(' '));
      
      case 'stats':
        return this.stats();
      
      case 'clear':
        return this.clear(parts[1]);
      
      case 'help':
        return this.help();
      
      default:
        // 没有子命令，默认为搜索
        return this.search(args);
    }
  }

  /**
   * 列出所有记忆
   */
  private async list(typeFilter?: string): Promise<string> {
    try {
      // 获取所有记忆（最多100条）
      const allEntries = await this.memoryManager!.retrieve('', { maxResults: 100 });
      
      if (allEntries.length === 0) {
        return '📝 还没有任何记忆';
      }

      // 按类型分组
      const grouped = new Map<string, MemoryEntry[]>();
      for (const entry of allEntries) {
        const type = entry.type;
        if (!grouped.has(type)) {
          grouped.set(type, []);
        }
        grouped.get(type)!.push(entry);
      }

      // 过滤类型
      let filteredGroups: Map<string, MemoryEntry[]>;
      if (typeFilter) {
        filteredGroups = new Map();
        for (const [type, entries] of grouped) {
          if (type.toLowerCase().includes(typeFilter.toLowerCase())) {
            filteredGroups.set(type, entries);
          }
        }
        if (filteredGroups.size === 0) {
          return `❌ 没有找到类型匹配 "${typeFilter}" 的记忆`;
        }
      } else {
        filteredGroups = grouped;
      }

      // 生成输出
      const lines: string[] = [];
      lines.push(`📝 你的记忆 (共 ${allEntries.length} 条):`);
      lines.push('');

      const typeIcons: Record<string, string> = {
        user_preference: '⚙️',
        user_fact: 'ℹ️',
        relationship: '👤',
        important_date: '📅',
        decision: '✅',
        session_summary: '📊',
        tool_pattern: '🔧',
        error_resolution: '🐛',
      };

      for (const [type, entries] of filteredGroups) {
        const icon = typeIcons[type] || '📌';
        const typeName = this.getTypeName(type);
        lines.push(`${icon} ${typeName} (${entries.length}):`);
        
        for (let i = 0; i < Math.min(entries.length, 10); i++) {
          const entry = entries[i];
          const preview = entry.content.slice(0, 60) + (entry.content.length > 60 ? '...' : '');
          const keywords = entry.keywords?.slice(0, 3).join(', ') || '';
          const timestamp = new Date(entry.createdAt).toLocaleDateString();
          lines.push(`  ${i + 1}. ${preview}`);
          if (keywords) {
            lines.push(`     关键词: ${keywords} | ${timestamp}`);
          } else {
            lines.push(`     ${timestamp}`);
          }
        }
        
        if (entries.length > 10) {
          lines.push(`  ... 还有 ${entries.length - 10} 条`);
        }
        lines.push('');
      }

      lines.push('💡 提示:');
      lines.push('  /memory search <关键词>  - 搜索记忆');
      lines.push('  /memory stats           - 查看统计');
      lines.push('  /memory help            - 查看帮助');

      return lines.join('\n');
    } catch (err) {
      return `❌ 获取记忆失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 搜索记忆
   */
  private async search(query: string): Promise<string> {
    if (!query) {
      return '❌ 请提供搜索关键词\n用法: /memory search <关键词>';
    }

    try {
      const results = await this.memoryManager!.retrieve(query, { maxResults: 20 });
      
      if (results.length === 0) {
        return `🔍 没有找到匹配 "${query}" 的记忆`;
      }

      const lines: string[] = [];
      lines.push(`🔍 搜索结果: "${query}" (${results.length} 条):`);
      lines.push('');

      for (let i = 0; i < results.length; i++) {
        const entry = results[i];
        const typeName = this.getTypeName(entry.type);
        const keywords = entry.keywords?.join(', ') || '';
        const timestamp = new Date(entry.createdAt).toLocaleDateString();
        
        lines.push(`${i + 1}. [${typeName}] ${entry.content}`);
        if (keywords) {
          lines.push(`   关键词: ${keywords} | ${timestamp}`);
        } else {
          lines.push(`   ${timestamp}`);
        }
        lines.push('');
      }

      return lines.join('\n');
    } catch (err) {
      return `❌ 搜索失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 删除记忆
   */
  private async delete(id: string): Promise<string> {
    if (!id) {
      return '❌ 请提供要删除的记忆 ID\n用法: /memory delete <id>';
    }

    try {
      // TODO: 实现删除功能（需要 IMemoryStore 添加 delete 方法）
      return '⚠️ 删除功能即将上线...';
    } catch (err) {
      return `❌ 删除失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 清空记忆
   */
  private async clear(type?: string): Promise<string> {
    if (!type) {
      return '❌ 清空所有记忆需要确认\n用法: /memory clear <type>\n可选类型: user_preference, relationship, important_date';
    }

    try {
      // TODO: 实现清空功能
      return '⚠️ 清空功能即将上线...';
    } catch (err) {
      return `❌ 清空失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 显示统计信息
   */
  private async stats(): Promise<string> {
    try {
      const allEntries = await this.memoryManager!.retrieve('', { maxResults: 1000 });
      
      if (allEntries.length === 0) {
        return '📊 还没有任何记忆';
      }

      // 按类型统计
      const typeCounts = new Map<string, number>();
      for (const entry of allEntries) {
        typeCounts.set(entry.type, (typeCounts.get(entry.type) || 0) + 1);
      }

      // 最近 7 天新增
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentCount = allEntries.filter(e => new Date(e.createdAt).getTime() > sevenDaysAgo).length;

      // 生成输出
      const lines: string[] = [];
      lines.push('📊 记忆统计:');
      lines.push('');
      lines.push(`总计: ${allEntries.length} 条记忆`);
      lines.push(`最近 7 天新增: ${recentCount} 条`);
      lines.push('');
      lines.push('按类型分布:');
      
      const typeIcons: Record<string, string> = {
        user_preference: '⚙️',
        user_fact: 'ℹ️',
        relationship: '👤',
        important_date: '📅',
        decision: '✅',
        session_summary: '📊',
        tool_pattern: '🔧',
        error_resolution: '🐛',
      };

      for (const [type, count] of typeCounts) {
        const icon = typeIcons[type] || '📌';
        const typeName = this.getTypeName(type);
        const percentage = ((count / allEntries.length) * 100).toFixed(1);
        lines.push(`  ${icon} ${typeName}: ${count} (${percentage}%)`);
      }

      return lines.join('\n');
    } catch (err) {
      return `❌ 获取统计失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 显示帮助信息
   */
  private help(): Promise<string> {
    const lines = [
      '💡 /memory 命令帮助:',
      '',
      '查看记忆:',
      '  /memory list [type]     - 列出所有记忆（可选过滤类型）',
      '  /memory ls              - 同 list',
      '',
      '搜索记忆:',
      '  /memory search <关键词>  - 搜索记忆',
      '  /memory <关键词>         - 同 search（默认）',
      '',
      '管理记忆:',
      '  /memory delete <id>     - 删除指定记忆',
      '  /memory clear <type>    - 清空指定类型的记忆',
      '',
      '统计信息:',
      '  /memory stats           - 查看记忆统计',
      '',
      '记忆类型:',
      '  ⚙️ user_preference  - 个人偏好（口味、习惯等）',
      '  ℹ️ user_fact        - 用户事实（职业、家庭等）',
      '  👤 relationship     - 人际关系（朋友、家人等）',
      '  📅 important_date   - 重要日期（生日、纪念日等）',
      '  ✅ decision         - 重要决策记录',
      '',
      '示例:',
      '  /memory list relationship   - 只看人际关系记忆',
      '  /memory search Alice        - 搜索关于 Alice 的记忆',
      '  /memory stats               - 查看统计信息',
    ];

    return Promise.resolve(lines.join('\n'));
  }

  /**
   * 获取类型中文名称
   */
  private getTypeName(type: string): string {
    const names: Record<string, string> = {
      user_preference: '个人偏好',
      user_fact: '用户事实',
      relationship: '人际关系',
      important_date: '重要日期',
      decision: '决策记录',
      session_summary: '会话摘要',
      tool_pattern: '工具使用模式',
      error_resolution: '错误解决方案',
    };
    return names[type] || type;
  }
}
