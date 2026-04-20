/**
 * IntentParser - 意图识别器（贾维斯架构）
 *
 * 职责：
 * 1. 快速识别用户意图（编程场景分类）
 * 2. 判断任务复杂度（简单/复杂）
 * 3. 提取关键信息（关键词、置信度）
 *
 * 🎯 优化策略：
 * - 规则引擎优先（0ms，覆盖80%常见场景）
 * - LRU缓存（<1ms，相似问题复用）
 * - 轻量LLM兜底（~200ms，复杂场景）
 */

import type { ILLMProvider } from '@/core/types';
import { LRUCache } from 'lru-cache';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IntentParser' });

/**
 * 意图类型
 */
export type IntentType =
  | 'code_generation'    // 写代码
  | 'debugging'          // 调试
  | 'code_review'        // 审查
  | 'testing'            // 测试
  | 'refactoring'        // 重构
  | 'explanation'        // 讲解
  | 'exploration'        // 探索
  | 'planning';          // 规划

/**
 * 解析结果
 */
export interface ParsedIntent {
  type: 'simple' | 'complex';
  intentType: IntentType;
  needsDecomposition: boolean;
  confidence: number;
  keywords?: string[];
}

/**
 * 规则定义
 */
interface IntentRule {
  pattern: RegExp;
  intent: ParsedIntent;
}

/**
 * IntentParser - 意图识别器
 */
export class IntentParser {
  private provider: ILLMProvider;
  private cache: LRUCache<string, ParsedIntent>;
  private rules: IntentRule[];

  constructor(provider: ILLMProvider) {
    this.provider = provider;
    this.cache = new LRUCache({ max: 100 });
    this.rules = this.initRules();
  }

  /**
   * 解析用户意图
   *
   * 优先级：
   * 1. 规则引擎（关键词匹配，0ms）
   * 2. 缓存（相似问题，<1ms）
   * 3. 轻量LLM（复杂意图，~200ms）
   */
  async parse(userInput: string): Promise<ParsedIntent> {
    // 1. 规则引擎快速匹配
    const ruleMatch = this.matchByRules(userInput);
    if (ruleMatch) {
      log.debug(`[IntentParser] Matched by rule: ${ruleMatch.intentType}`);
      return ruleMatch;
    }

    // 2. 缓存查找
    const cached = this.cache.get(userInput);
    if (cached) {
      log.debug(`[IntentParser] Cache hit: ${cached.intentType}`);
      return cached;
    }

    // 3. LLM识别（仅复杂场景）
    const intent = await this.llmParse(userInput);
    this.cache.set(userInput, intent);
    log.debug(`[IntentParser] LLM parsed: ${intent.intentType}`);
    return intent;
  }

  /**
   * 初始化规则引擎
   */
  private initRules(): IntentRule[] {
    return [
      {
        pattern: /^(写|实现|创建|添加|新增).*(代码|功能|接口|组件|模块|类|函数)/i,
        intent: {
          type: 'simple',
          intentType: 'code_generation',
          needsDecomposition: false,
          confidence: 0.9
        }
      },
      {
        pattern: /^(修复|解决|排查|调试|找出).*(bug|问题|错误|异常|崩溃)/i,
        intent: {
          type: 'simple',
          intentType: 'debugging',
          needsDecomposition: false,
          confidence: 0.9
        }
      },
      {
        pattern: /^(审查|检查|优化|改进|评估).*(代码|实现|质量)/i,
        intent: {
          type: 'simple',
          intentType: 'code_review',
          needsDecomposition: false,
          confidence: 0.9
        }
      },
      {
        pattern: /^(写|添加|补充|完善).*(测试|单元测试|集成测试|测试用例)/i,
        intent: {
          type: 'simple',
          intentType: 'testing',
          needsDecomposition: false,
          confidence: 0.9
        }
      },
      {
        pattern: /^(重构|改造|优化|重写).*(代码|架构|结构|实现)/i,
        intent: {
          type: 'simple',
          intentType: 'refactoring',
          needsDecomposition: false,
          confidence: 0.9
        }
      },
      {
        pattern: /^(讲解|解释|说明|介绍|阐述).*(原理|实现|代码|逻辑|机制)/i,
        intent: {
          type: 'simple',
          intentType: 'explanation',
          needsDecomposition: false,
          confidence: 0.9
        }
      },
      {
        pattern: /^(探索|分析|理解|查看|研究).*(代码库|项目|架构|结构)/i,
        intent: {
          type: 'simple',
          intentType: 'exploration',
          needsDecomposition: false,
          confidence: 0.9
        }
      },
      {
        pattern: /^(规划|设计|制定|构思).*(方案|计划|架构|蓝图)/i,
        intent: {
          type: 'simple',
          intentType: 'planning',
          needsDecomposition: false,
          confidence: 0.9
        }
      },
      // 复杂任务模式
      {
        pattern: /(实现|开发|构建).*(系统|平台|应用|项目)/i,
        intent: {
          type: 'complex',
          intentType: 'code_generation',
          needsDecomposition: true,
          confidence: 0.85
        }
      },
    ];
  }

  /**
   * 规则引擎匹配
   */
  private matchByRules(input: string): ParsedIntent | null {
    for (const rule of this.rules) {
      if (rule.pattern.test(input)) {
        return rule.intent;
      }
    }
    return null;
  }

  /**
   * LLM解析（轻量模型）
   */
  private async llmParse(userInput: string): Promise<ParsedIntent> {
    const prompt = `识别编程意图，仅输出JSON：

用户输入：${userInput}

可选意图类型：
- code_generation: 写代码、实现功能
- debugging: 排查问题、修复bug
- code_review: 代码审查、优化建议
- testing: 编写测试、测试策略
- refactoring: 重构代码、改进架构
- explanation: 讲解原理、代码解释
- exploration: 探索代码库、理解架构
- planning: 任务规划、方案设计

输出格式：
{
  "type": "simple | complex",
  "intentType": "xxx",
  "needsDecomposition": false,
  "confidence": 0.95,
  "keywords": ["关键词1", "关键词2"]
}

判断标准：
- simple: 单一任务，可直接执行（如"写一个登录接口"）
- complex: 多个任务，需拆分（如"实现用户系统，包括注册、登录、权限管理"）`;

    try {
      // TODO: 使用轻量模型（Haiku或本地模型）
      const response = await this.provider.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 500,
      });

      const content = typeof response === 'string' ? response : response.content;
      return JSON.parse(content);
    } catch (error) {
      log.error(`[IntentParser] LLM parse failed:`, error);
      // 降级：返回默认意图
      return {
        type: 'simple',
        intentType: 'code_generation',
        needsDecomposition: false,
        confidence: 0.5
      };
    }
  }
}
