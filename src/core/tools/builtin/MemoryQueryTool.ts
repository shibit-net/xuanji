// ============================================================
// MemoryQueryTool — 记忆查询工具
// ============================================================
// 供 memory-refiner Agent 使用，查询和检索记忆

import type { Tool, ToolResult } from '@/core/types';
import type { MemoryStore } from '@/memory/MemoryStore';

export class MemoryQueryTool implements Tool {
  name = 'memory_query';
  description = 'Query and retrieve memories by type, keywords, or access count. Use this to find memories that need refinement.';

  parameters = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Memory type to filter (e.g., error_resolution, decision, lesson_learned)',
        enum: ['error_resolution', 'decision', 'tool_pattern', 'lesson_learned', 'session_summary', 'user_preference'],
      },
      minAccessCount: {
        type: 'number',
        description: 'Minimum access count (find frequently accessed memories)',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keywords to search for',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return per page',
        default: 20,
        maximum: 50,
      },
      offset: {
        type: 'number',
        description: 'Number of results to skip (for pagination)',
        default: 0,
      },
      includeObsolete: {
        type: 'boolean',
        description: 'Include obsolete memories',
        default: false,
      },
    },
    required: [],
  } as const;

  private store: MemoryStore | null = null;

  setStore(store: MemoryStore): void {
    this.store = store;
  }

  async execute(args: {
    type?: string;
    minAccessCount?: number;
    keywords?: string[];
    limit?: number;
    offset?: number;
    includeObsolete?: boolean;
  }): Promise<ToolResult> {
    if (!this.store) {
      return {
        success: false,
        output: 'Error: MemoryStore not initialized',
      };
    }

    try {
      const limit = Math.min(args.limit || 20, 50); // Max 50 per page
      const offset = args.offset || 0;
      let memories = this.store.readAll({ limit: 100000 }); // Get all, then filter

      // Filter by type
      if (args.type) {
        memories = memories.filter(m => m.type === args.type);
      }

      // Filter by access count
      if (args.minAccessCount !== undefined) {
        memories = memories.filter(m => m.accessCount >= args.minAccessCount);
      }

      // Filter obsolete
      if (!args.includeObsolete) {
        memories = memories.filter(m => !m.obsolete);
      }

      // Filter by keywords
      if (args.keywords && args.keywords.length > 0) {
        memories = memories.filter(m => {
          const memoryKeywords = m.keywords || [];
          return args.keywords!.some(kw =>
            memoryKeywords.some(mk => mk.toLowerCase().includes(kw.toLowerCase()))
            || m.content.toLowerCase().includes(kw.toLowerCase())
          );
        });
      }

      // Sort by access count (descending)
      memories.sort((a, b) => b.accessCount - a.accessCount);

      // Total count before pagination
      const totalCount = memories.length;

      // Apply pagination
      memories = memories.slice(offset, offset + limit);

      const output = memories.map(m => ({
        id: m.id,
        type: m.type,
        content: m.content.slice(0, 200) + (m.content.length > 200 ? '...' : ''),
        keywords: m.keywords,
        accessCount: m.accessCount,
        confidence: m.confidence,
        createdAt: m.createdAt,
      }));

      return {
        success: true,
        output: JSON.stringify({
          total: totalCount,
          count: output.length,
          offset,
          hasMore: offset + limit < totalCount,
          nextOffset: offset + limit < totalCount ? offset + limit : null,
          memories: output,
        }, null, 2),
      };
    } catch (error) {
      return {
        success: false,
        output: `Error querying memories: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
