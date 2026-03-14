/**
 * 任务复杂度分析器
 *
 * 使用 LLM 分析任务复杂度，决定是否需要 Multi-Agent 系统
 */

import type { ILLMProvider } from '@/core/types';
import type { TaskComplexity, SessionContext } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'complexity-analyzer' });

/**
 * 分析缓存项
 */
interface CacheEntry {
  complexity: TaskComplexity;
  timestamp: number;
}

export class ComplexityAnalyzer {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private provider: ILLMProvider,
    private model: string = 'claude-3-5-haiku-20241022',
    private cacheTTL: number = 300, // 5 分钟缓存
  ) {}

  /**
   * 分析任务复杂度
   *
   * @param userInput 用户输入
   * @param context 会话上下文
   * @returns 复杂度分析结果
   */
  async analyze(
    userInput: string,
    context?: SessionContext,
  ): Promise<TaskComplexity> {
    // 1. 检查缓存
    const cacheKey = this.getCacheKey(userInput);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      log.debug('Using cached complexity analysis');
      return cached;
    }

    // 2. 构建分析 prompt
    const prompt = this.buildAnalysisPrompt(userInput, context);

    try {
      // 3. 调用 LLM 分析（使用 Haiku 降低成本）
      log.debug(`Analyzing task complexity with ${this.model}`);

      const stream = this.provider.stream(
        [{ role: 'user', content: prompt }],
        [],
        {
          model: this.model,
          maxTokens: 500,
          temperature: 0.3, // 更确定性的输出
        },
      );

      // 收集所有文本
      let response = '';
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          response += event.text;
        }
      }

      // 4. 解析响应
      const complexity = this.parseResponse(response);

      // 5. 缓存结果
      this.cache.set(cacheKey, {
        complexity,
        timestamp: Date.now(),
      });

      log.info('Task complexity analyzed', {
        complexity: complexity.complexity,
        steps: complexity.estimatedSteps,
        specialist: complexity.requiresSpecialist,
      });

      return complexity;
    } catch (error) {
      log.error('Failed to analyze task complexity', error);

      // 降级：返回默认简单任务
      return this.getDefaultComplexity();
    }
  }

  /**
   * 构建分析 prompt
   */
  private buildAnalysisPrompt(
    userInput: string,
    context?: SessionContext,
  ): string {
    return `你是一个任务复杂度分析专家。请分析以下用户任务的复杂度。

## 用户任务
${userInput}

${context ? `## 会话上下文\n- 消息数: ${context.messageCount}\n- 已使用 Agent: ${context.usedAgents.join(', ') || '无'}\n` : ''}

## 分析维度

请从以下维度评估任务复杂度：

1. **是否多步骤任务**：
   - 是否包含多个独立的子任务？
   - 是否需要按顺序执行多个步骤？
   - 关键词：并且、然后、接着、先...再...

2. **是否需要专业 Agent**：
   - 是否明确提及特定领域（代码审查、数据分析、文档生成等）？
   - 是否需要专业知识或特定工具？
   - 是否超出通用 AI 助手的能力范围？

3. **预估步骤数**：
   - 完成任务需要几个主要步骤？（1-20）
   - 包括：读取文件、分析、生成、验证等

4. **涉及领域**：
   - 编程（coding）、审查（review）、测试（testing）
   - 分析（analysis）、生成（generation）、规划（planning）
   - 其他...

5. **是否可并行**：
   - 子任务之间是否独立？
   - 是否可以同时执行？

## 输出格式

请严格按照以下 JSON 格式输出（不要包含其他文字）：

\`\`\`json
{
  "isMultiStep": true/false,
  "requiresSpecialist": true/false,
  "estimatedSteps": 数字(1-20),
  "domains": ["领域1", "领域2"],
  "parallelizable": true/false,
  "complexity": "simple"/"medium"/"complex",
  "reasoning": "简短说明判断理由"
}
\`\`\`

## 复杂度判断标准

- **simple**（简单）：
  - 单一步骤，无需专业知识
  - 示例："今天天气如何"，"帮我写一个函数"

- **medium**（中等）：
  - 2-4 个步骤，或需要一定专业能力
  - 示例："分析这段代码的性能"，"生成测试用例"

- **complex**（复杂）：
  - ≥5 个步骤，或需要多个专业领域，或可并行执行
  - 示例："审查代码并生成测试报告"，"规划完整的项目结构"

请立即开始分析：`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(response: string): TaskComplexity {
    try {
      // 提取 JSON 块（支持带 ``` 包裹的格式）
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                       response.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, response];

      const jsonStr = jsonMatch[1] || response;
      const parsed = JSON.parse(jsonStr.trim());

      // 验证必填字段
      if (
        typeof parsed.isMultiStep !== 'boolean' ||
        typeof parsed.requiresSpecialist !== 'boolean' ||
        typeof parsed.estimatedSteps !== 'number' ||
        !Array.isArray(parsed.domains) ||
        typeof parsed.parallelizable !== 'boolean' ||
        !['simple', 'medium', 'complex'].includes(parsed.complexity)
      ) {
        throw new Error('Invalid response format');
      }

      return {
        isMultiStep: parsed.isMultiStep,
        requiresSpecialist: parsed.requiresSpecialist,
        estimatedSteps: Math.max(1, Math.min(20, parsed.estimatedSteps)),
        domains: parsed.domains,
        parallelizable: parsed.parallelizable,
        complexity: parsed.complexity,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      log.warn('Failed to parse complexity response, using default', error);
      return this.getDefaultComplexity();
    }
  }

  /**
   * 获取缓存键
   */
  private getCacheKey(userInput: string): string {
    // 简单哈希（实际可用 crypto）
    return userInput.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): TaskComplexity | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    const age = Date.now() - entry.timestamp;
    if (age > this.cacheTTL * 1000) {
      this.cache.delete(key);
      return null;
    }

    return entry.complexity;
  }

  /**
   * 获取默认复杂度（降级方案）
   */
  private getDefaultComplexity(): TaskComplexity {
    return {
      isMultiStep: false,
      requiresSpecialist: false,
      estimatedSteps: 1,
      domains: [],
      parallelizable: false,
      complexity: 'simple',
      reasoning: 'Analysis failed, defaulting to simple',
    };
  }

  /**
   * 清理过期缓存
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.cacheTTL * 1000) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; hitRate: number } {
    // 简单实现，实际可以跟踪 hit/miss
    return {
      size: this.cache.size,
      hitRate: 0, // TODO: 实现 hit rate 统计
    };
  }
}
