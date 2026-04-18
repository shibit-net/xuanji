// ============================================================
// 使用示例：自动分类并存储
// ============================================================

import { ConstraintClassifier, type ClassificationResult } from './ConstraintClassifier';
import { PermanentConstraintManager } from './PermanentConstraintManager';
import type { MemoryStore } from './MemoryStore';
import type { ILLMProvider } from '@/core/types';
import type { MemoryEntry } from './types';

/**
 * 智能记忆存储器
 *
 * 自动判断用户输入是约束还是记忆，并存储到正确的位置
 */
export class SmartMemoryStorage {
  private classifier: ConstraintClassifier;
  private constraintManager: PermanentConstraintManager;
  private memoryStore: MemoryStore;

  constructor(
    provider: ILLMProvider,
    memoryStore: MemoryStore
  ) {
    this.classifier = new ConstraintClassifier(provider);
    this.constraintManager = new PermanentConstraintManager(memoryStore);
    this.memoryStore = memoryStore;
  }

  /**
   * 智能存储用户输入
   *
   * 自动判断是约束还是记忆，并存储到正确的位置
   */
  async store(userInput: string): Promise<{
    stored: boolean;
    type: 'constraint' | 'memory';
    confidence: number;
    reason?: string;
  }> {
    // 1. 快速规则判断
    const quickResult = this.classifier.quickClassify(userInput);
    if (quickResult && quickResult.confidence >= 0.9) {
      return await this.storeByClassification(userInput, quickResult);
    }

    // 2. LLM 语义判断
    const classification = await this.classifier.classify(userInput);

    // 3. 根据分类结果存储
    return await this.storeByClassification(userInput, classification);
  }

  /**
   * 根据分类结果存储
   */
  private async storeByClassification(
    userInput: string,
    classification: ClassificationResult
  ): Promise<{
    stored: boolean;
    type: 'constraint' | 'memory';
    confidence: number;
    reason?: string;
  }> {
    if (classification.isConstraint && classification.confidence >= 0.7) {
      // 存储为永久约束
      this.constraintManager.add({
        content: userInput,
        type: classification.type || 'custom',
        source: 'user_explicit',
      });

      return {
        stored: true,
        type: 'constraint',
        confidence: classification.confidence,
        reason: classification.reason,
      };
    } else {
      // 存储为普通记忆
      const now = new Date().toISOString();
      const memory: MemoryEntry = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type: 'user_preference',
        content: userInput,
        keywords: this.extractKeywords(userInput),
        source: 'user',
        confidence: classification.confidence,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        scope: 'knowledge',
        volatility: 'stable',
        significance: 0.7,
        constraint: 'may',
        memoryOriginV2: 'user',
        usageScenarios: [],
        usageCount: 0,
        effectiveCount: 0,
        dreamGeneration: 0,
        evidenceCount: 1,
        dreamCount: 0,
        obsolete: false,
        dismissed: false,
        relatedMemories: [],
        metadata: {},
      };

      this.memoryStore.saveEntry(memory);

      return {
        stored: true,
        type: 'memory',
        confidence: classification.confidence,
        reason: classification.reason,
      };
    }
  }

  private extractKeywords(text: string): string[] {
    // 简单的关键词提取
    return text
      .split(/\s+/)
      .filter(word => word.length > 2)
      .slice(0, 5);
  }
}

// ============================================================
// 使用示例
// ============================================================

/*
// 在 MemoryManager 中集成

class MemoryManager {
  private smartStorage: SmartMemoryStorage;

  async handleUserMemoryRequest(userInput: string) {
    // 自动分类并存储
    const result = await this.smartStorage.store(userInput);

    if (result.type === 'constraint') {
      return `✅ 已记录为永久规则（置信度: ${(result.confidence * 100).toFixed(0)}%）\n理由: ${result.reason}`;
    } else {
      return `✅ 已记录为记忆（置信度: ${(result.confidence * 100).toFixed(0)}%）\n理由: ${result.reason}`;
    }
  }
}

// 用户交互示例

用户: "记住，我希望被称呼为 Boss"
助手: ✅ 已记录为永久规则（置信度: 95%）
     理由: Matched constraint keyword: 我希望被称呼

用户: "记住，项目使用 TypeScript"
助手: ✅ 已记录为记忆（置信度: 85%）
     理由: Descriptive statement about project context

用户: "不要泄露我的隐私"
助手: ✅ 已记录为永久规则（置信度: 98%）
     理由: Matched constraint keyword: 不要
*/
