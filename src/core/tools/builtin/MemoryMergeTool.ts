// ============================================================
// MemoryMergeTool — 记忆合并工具
// ============================================================
// 供 memory-refiner Agent 使用，合并相似的记忆

import type { Tool, ToolResult } from '@/core/types';
import type { MemoryStore } from '@/memory/MemoryStore';
import type { MemoryEntry } from '@/memory/types';

export class MemoryMergeTool implements Tool {
  name = 'memory_merge';
  description = 'Merge multiple similar memories into one concise, comprehensive memory. The original memories will be marked as obsolete.';

  parameters = {
    type: 'object',
    properties: {
      sourceIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of memories to merge (2-10 memories)',
        minItems: 2,
        maxItems: 10,
      },
      mergedContent: {
        type: 'string',
        description: 'The merged memory content (concise and comprehensive)',
        maxLength: 500,
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keywords for the merged memory',
      },
      confidence: {
        type: 'number',
        description: 'Confidence level (0-1)',
        minimum: 0,
        maximum: 1,
        default: 0.85,
      },
    },
    required: ['sourceIds', 'mergedContent', 'keywords'],
  } as const;

  private store: MemoryStore | null = null;

  setStore(store: MemoryStore): void {
    this.store = store;
  }

  async execute(args: {
    sourceIds: string[];
    mergedContent: string;
    keywords: string[];
    confidence?: number;
  }): Promise<ToolResult> {
    if (!this.store) {
      return {
        success: false,
        output: 'Error: MemoryStore not initialized',
      };
    }

    try {
      // Validate source memories exist
      const sourceMemories: MemoryEntry[] = [];
      for (const id of args.sourceIds) {
        const memory = this.store.getEntry(id);
        if (!memory) {
          return {
            success: false,
            output: `Error: Memory ${id} not found`,
          };
        }
        sourceMemories.push(memory);
      }

      // Check all memories are the same type
      const types = new Set(sourceMemories.map(m => m.type));
      if (types.size > 1) {
        return {
          success: false,
          output: `Error: Cannot merge memories of different types: ${Array.from(types).join(', ')}`,
        };
      }

      const type = sourceMemories[0]!.type;
      const now = new Date().toISOString();

      // Create merged memory
      const mergedMemory: MemoryEntry = {
        id: `merged_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type,
        content: args.mergedContent,
        keywords: args.keywords,
        source: 'memory-refiner-agent',
        confidence: args.confidence || 0.85,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        scope: sourceMemories[0]!.scope || 'knowledge',
        volatility: sourceMemories[0]!.volatility || 'normal',
        significance: 0.75,
        categoryLabel: 'Merged Knowledge',
        metadata: {
          mergedFrom: args.sourceIds,
          mergeMethod: 'agent',
        },
      };

      // Save merged memory
      this.store.saveEntry(mergedMemory);

      // Mark source memories as obsolete
      for (const id of args.sourceIds) {
        this.store.updateEntry(id, { obsolete: true });
      }

      return {
        success: true,
        output: JSON.stringify({
          action: 'merged',
          mergedId: mergedMemory.id,
          sourceCount: args.sourceIds.length,
          content: mergedMemory.content,
        }, null, 2),
      };
    } catch (error) {
      return {
        success: false,
        output: `Error merging memories: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
