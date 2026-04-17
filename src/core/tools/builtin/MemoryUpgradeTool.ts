// ============================================================
// MemoryUpgradeTool — 记忆升级工具
// ============================================================
// 供 memory-refiner Agent 使用，升级记忆类型

import type { Tool, ToolResult } from '@/core/types';
import type { MemoryStore } from '@/memory/MemoryStore';
import type { MemoryEntry, MemoryEntryType } from '@/memory/types';

export class MemoryUpgradeTool implements Tool {
  name = 'memory_upgrade';
  description = 'Upgrade a memory to a higher type (e.g., error_resolution → lesson_learned). The original memory will be marked as obsolete.';

  parameters = {
    type: 'object',
    properties: {
      sourceId: {
        type: 'string',
        description: 'ID of the memory to upgrade',
      },
      targetType: {
        type: 'string',
        description: 'Target memory type',
        enum: ['lesson_learned', 'reusable_pattern', 'domain_knowledge'],
      },
      upgradedContent: {
        type: 'string',
        description: 'The upgraded memory content (more abstract and general)',
        maxLength: 500,
      },
      lessonType: {
        type: 'string',
        description: 'Type of lesson (required for lesson_learned)',
        enum: ['mistake', 'improvement', 'best_practice'],
      },
      problemDescription: {
        type: 'string',
        description: 'Description of the problem (for lesson_learned)',
      },
      solution: {
        type: 'string',
        description: 'Solution or improvement (for lesson_learned)',
      },
      applicableScenarios: {
        type: 'array',
        items: { type: 'string' },
        description: 'Scenarios where this lesson applies',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keywords for the upgraded memory',
      },
      confidence: {
        type: 'number',
        description: 'Confidence level (0-1)',
        minimum: 0,
        maximum: 1,
        default: 0.85,
      },
    },
    required: ['sourceId', 'targetType', 'upgradedContent', 'keywords'],
  } as const;

  private store: MemoryStore | null = null;

  setStore(store: MemoryStore): void {
    this.store = store;
  }

  async execute(args: {
    sourceId: string;
    targetType: string;
    upgradedContent: string;
    lessonType?: string;
    problemDescription?: string;
    solution?: string;
    applicableScenarios?: string[];
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
      // Validate source memory exists
      const sourceMemory = this.store.getEntry(args.sourceId);
      if (!sourceMemory) {
        return {
          success: false,
          output: `Error: Memory ${args.sourceId} not found`,
        };
      }

      // Validate upgrade path
      const validUpgrades: Record<string, string[]> = {
        error_resolution: ['lesson_learned', 'reusable_pattern'],
        tool_pattern: ['reusable_pattern', 'domain_knowledge'],
        decision: ['domain_knowledge'],
      };

      const allowedTargets = validUpgrades[sourceMemory.type] || [];
      if (!allowedTargets.includes(args.targetType)) {
        return {
          success: false,
          output: `Error: Cannot upgrade ${sourceMemory.type} to ${args.targetType}. Allowed: ${allowedTargets.join(', ')}`,
        };
      }

      const now = new Date().toISOString();

      // Create upgraded memory
      const upgradedMemory: MemoryEntry = {
        id: `upgraded_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type: args.targetType as MemoryEntryType,
        content: args.upgradedContent,
        keywords: args.keywords,
        source: 'memory-refiner-agent',
        confidence: args.confidence || 0.85,
        createdAt: sourceMemory.createdAt, // Preserve original creation time
        lastAccessedAt: now,
        accessCount: 0,
        category: 'lesson',
        scope: 'knowledge',
        volatility: 'normal',
        significance: 0.8,
        categoryLabel: 'Experience/Knowledge',
        lessonType: args.lessonType as any,
        problemDescription: args.problemDescription,
        solution: args.solution,
        applicableScenarios: args.applicableScenarios,
        metadata: {
          upgradedFrom: args.sourceId,
          originalType: sourceMemory.type,
          upgradeMethod: 'agent',
        },
      };

      // Save upgraded memory
      this.store.saveEntry(upgradedMemory);

      // Mark source memory as obsolete
      this.store.updateEntry(args.sourceId, { obsolete: true });

      return {
        success: true,
        output: JSON.stringify({
          action: 'upgraded',
          upgradedId: upgradedMemory.id,
          from: sourceMemory.type,
          to: args.targetType,
          content: upgradedMemory.content,
        }, null, 2),
      };
    } catch (error) {
      return {
        success: false,
        output: `Error upgrading memory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
