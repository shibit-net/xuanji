/**
 * 意图学习器
 *
 * 从用户实际使用中自动学习意图，生成和更新向量
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Intent, IntentDefinition, IntentDomain } from './types.js';
import type { VectorIntentMatcher } from './VectorIntentMatcher.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IntentLearner' });

/**
 * 学习记录
 */
export interface LearningRecord {
  /** 意图类型 */
  intentType: string;

  /** 用户输入（作为训练样本） */
  userInput: string;

  /** 置信度 */
  confidence: number;

  /** 学习时间 */
  learnedAt: number;

  /** 来源（llm/vector） */
  source: 'llm' | 'vector';
}

/**
 * 学习的意图数据
 */
export interface LearnedIntentData {
  /** 意图定义 */
  definition: IntentDefinition;

  /** 学习来源 */
  learnedFrom: 'llm';

  /** 创建时间 */
  createdAt: number;

  /** 最后更新时间 */
  lastUpdated: number;

  /** 使用次数 */
  usageCount: number;
}

/**
 * 学习数据文件格式
 */
export interface LearnedIntentsFile {
  version: string;
  intents: Record<string, LearnedIntentData>;
}

/**
 * 意图学习器
 */
export class IntentLearner {
  private learningHistory: LearningRecord[] = [];
  private learningThreshold = 0.7; // 置信度阈值，高于此值才学习
  private learnedIntentsPath: string;
  private learnedIntents = new Map<string, LearnedIntentData>();
  private maxSamplesPerIntent = 20; // 每个意图最多保留的样本数

  constructor(private vectorMatcher: VectorIntentMatcher) {
    this.learnedIntentsPath = path.join(
      os.homedir(),
      '.xuanji/learned-intents.json'
    );
  }

  /**
   * 初始化（加载已学习的意图）
   */
  async init(): Promise<void> {
    try {
      const content = await fs.readFile(this.learnedIntentsPath, 'utf-8');
      const data: LearnedIntentsFile = JSON.parse(content);

      for (const [type, intentData] of Object.entries(data.intents)) {
        this.learnedIntents.set(type, intentData);
      }

      log.debug(`加载 ${this.learnedIntents.size} 个已学习的意图`);
    } catch {
      // 文件不存在，忽略
    }
  }

  /**
   * 从 LLM 分类结果中学习（第一次使用）
   */
  async learnFromLLM(
    userInput: string,
    intent: Intent,
    moduleInfo: { id: string; name: string; domain?: string; type: string }
  ): Promise<void> {
    // 只学习高置信度的结果
    if (intent.confidence < this.learningThreshold) {
      log.debug(`跳过学习（置信度过低: ${intent.confidence}）`);
      return;
    }

    const intentType = intent.type;

    log.debug(`学习意图: ${intentType}, 样本: "${userInput}", 置信度: ${intent.confidence}`);

    // 1. 检查是否已存在此意图
    const existingIntent = this.learnedIntents.get(intentType);

    if (existingIntent) {
      // 意图已存在，增强样本
      await this.enhanceIntent(intentType, userInput, existingIntent);
    } else {
      // 创建新意图
      await this.createIntent(intentType, userInput, moduleInfo);
    }

    // 2. 记录学习历史
    this.recordLearning(intentType, userInput, intent.confidence, 'llm');
  }

  /**
   * 从向量匹配中学习（后续使用，增强样本）
   */
  async learnFromVector(userInput: string, intent: Intent): Promise<void> {
    // 只学习高置信度的结果
    if (intent.confidence < this.learningThreshold) {
      return;
    }

    const existingIntent = this.learnedIntents.get(intent.type);

    if (existingIntent) {
      // 增强现有意图
      await this.enhanceIntent(intent.type, userInput, existingIntent);

      // 记录学习历史
      this.recordLearning(intent.type, userInput, intent.confidence, 'vector');
    }
  }

  /**
   * 创建新意图
   */
  private async createIntent(
    intentType: string,
    userInput: string,
    moduleInfo: { id: string; name: string; domain?: string; type: string }
  ): Promise<void> {
    const intentDef: IntentDefinition = {
      type: intentType,
      domain: (moduleInfo.domain || 'general') as IntentDomain,
      name: moduleInfo.name,
      description: `自动学习: ${moduleInfo.name}`,
      examples: [userInput], // 第一个训练样本
    };

    const intentData: LearnedIntentData = {
      definition: intentDef,
      learnedFrom: 'llm',
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      usageCount: 1,
    };

    // 保存到内存
    this.learnedIntents.set(intentType, intentData);

    // 生成向量
    await this.vectorMatcher.buildIntentVector(intentDef);

    // 持久化
    await this.save();

    log.debug(`创建新意图: ${intentType}`);
  }

  /**
   * 增强现有意图（添加新样本）
   */
  private async enhanceIntent(
    intentType: string,
    newSample: string,
    intentData: LearnedIntentData
  ): Promise<void> {
    const intentDef = intentData.definition;

    // 检查样本是否已存在（去重）
    if (intentDef.examples.includes(newSample)) {
      return; // 已存在，跳过
    }

    // 添加新样本
    intentDef.examples.push(newSample);

    // 限制样本数量（保留最新的）
    if (intentDef.examples.length > this.maxSamplesPerIntent) {
      intentDef.examples = intentDef.examples.slice(-this.maxSamplesPerIntent);
    }

    // 更新元数据
    intentData.lastUpdated = Date.now();
    intentData.usageCount++;

    // 重新生成向量（包含新样本）
    await this.vectorMatcher.buildIntentVector(intentDef);

    // 持久化
    await this.save();

    log.debug(`增强意图 ${intentType}, 新增样本: "${newSample}", 当前样本数: ${intentDef.examples.length}`);
  }

  /**
   * 记录学习历史
   */
  private recordLearning(
    intentType: string,
    userInput: string,
    confidence: number,
    source: 'llm' | 'vector'
  ): void {
    this.learningHistory.push({
      intentType,
      userInput,
      confidence,
      learnedAt: Date.now(),
      source,
    });

    // 限制历史记录数量
    if (this.learningHistory.length > 100) {
      this.learningHistory = this.learningHistory.slice(-100);
    }
  }

  /**
   * 保存学习数据到文件
   */
  private async save(): Promise<void> {
    const data: LearnedIntentsFile = {
      version: '1.0.0',
      intents: Object.fromEntries(this.learnedIntents),
    };

    await fs.mkdir(path.dirname(this.learnedIntentsPath), { recursive: true });
    await fs.writeFile(this.learnedIntentsPath, JSON.stringify(data, null, 2));
  }

  /**
   * 获取所有已学习的意图定义
   */
  getLearnedIntentDefinitions(): IntentDefinition[] {
    return Array.from(this.learnedIntents.values()).map((data) => data.definition);
  }

  /**
   * 获取学习统计
   */
  getStats() {
    return {
      totalLearned: this.learnedIntents.size,
      totalSamples: Array.from(this.learnedIntents.values()).reduce(
        (sum, data) => sum + data.definition.examples.length,
        0
      ),
      learningHistory: {
        total: this.learningHistory.length,
        fromLLM: this.learningHistory.filter((r) => r.source === 'llm').length,
        fromVector: this.learningHistory.filter((r) => r.source === 'vector').length,
      },
      mostUsed: Array.from(this.learnedIntents.entries())
        .sort((a, b) => b[1].usageCount - a[1].usageCount)
        .slice(0, 5)
        .map(([type, data]) => ({
          type,
          usageCount: data.usageCount,
          samplesCount: data.definition.examples.length,
        })),
    };
  }

  /**
   * 获取学习历史
   */
  getHistory(limit: number = 10): LearningRecord[] {
    return this.learningHistory.slice(-limit).reverse();
  }

  /**
   * 清空学习数据
   */
  async clear(): Promise<void> {
    this.learnedIntents.clear();
    this.learningHistory = [];
    await this.save();
  }
}
